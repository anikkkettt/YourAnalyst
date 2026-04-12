"""
Data Profiling Endpoints — EDA statistics, data quality, and anomaly detection.

Computes per-column aggregate statistics, data quality metrics, and
IQR-based outlier counts for any connected data source.
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from core.source_registry import lookup_source
from core.connection_manager import ConnectionManager, DatabaseKind
import logging

router = APIRouter()
connector = ConnectionManager()
log = logging.getLogger(__name__)

NUMERIC_TYPES = {"integer", "int", "bigint", "smallint", "tinyint", "float",
                 "double", "numeric", "decimal", "real", "number", "int64",
                 "float64", "int32", "float32", "money", "serial", "bigserial"}

TEXT_TYPES = {"text", "varchar", "char", "string", "nvarchar", "nchar",
              "character varying", "character", "object", "clob"}

DATE_TYPES = {"date", "datetime", "timestamp", "timestamptz",
              "datetime64", "time", "datetime64[ns]"}


def _classify(col_type: str) -> str:
    raw = col_type.lower().split("(")[0].strip()
    if raw in NUMERIC_TYPES:
        return "numeric"
    if raw in TEXT_TYPES:
        return "text"
    if raw in DATE_TYPES:
        return "date"
    return "other"


def _q(name: str) -> str:
    return '"{}"'.format(name.replace('"', '""'))


def _build_stats_sql(table: str, columns: list, dialect: str) -> str:
    qt = _q(table)
    parts = ["COUNT(*) AS __total_rows__"]

    for col in columns:
        qc = _q(col["name"])
        cn = col["name"].replace('"', "")
        kind = _classify(col.get("type", ""))

        parts.append('COUNT(DISTINCT {c}) AS "{cn}_distinct"'.format(c=qc, cn=cn))
        parts.append('SUM(CASE WHEN {c} IS NULL THEN 1 ELSE 0 END) AS "{cn}_nulls"'.format(c=qc, cn=cn))

        if kind == "numeric":
            parts.append('MIN({c}) AS "{cn}_min"'.format(c=qc, cn=cn))
            parts.append('MAX({c}) AS "{cn}_max"'.format(c=qc, cn=cn))
            parts.append('AVG(CAST({c} AS DOUBLE)) AS "{cn}_avg"'.format(c=qc, cn=cn))
        elif kind == "text":
            if dialect == "mysql":
                parts.append('MAX(CHAR_LENGTH({c})) AS "{cn}_maxlen"'.format(c=qc, cn=cn))
            else:
                parts.append('MAX(LENGTH(CAST({c} AS VARCHAR))) AS "{cn}_maxlen"'.format(c=qc, cn=cn))
        elif kind == "date":
            parts.append('MIN({c}) AS "{cn}_min"'.format(c=qc, cn=cn))
            parts.append('MAX({c}) AS "{cn}_max"'.format(c=qc, cn=cn))

    return "SELECT {} FROM {}".format(",\n  ".join(parts), qt)


def _build_iqr_sql(table: str, col_name: str, dialect: str) -> str | None:
    qt = _q(table)
    qc = _q(col_name)

    if dialect in ("duckdb", "postgresql"):
        return (
            "SELECT "
            "PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY {c}) AS q1, "
            "PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY {c}) AS q3 "
            "FROM {t} WHERE {c} IS NOT NULL"
        ).format(c=qc, t=qt)
    return None


def _dialect_for(source) -> str:
    if source.duckdb_conn:
        return "duckdb"
    if source.db_type == DatabaseKind.POSTGRESQL:
        return "postgresql"
    if source.db_type == DatabaseKind.MYSQL:
        return "mysql"
    if source.db_type in (DatabaseKind.SQLITE, DatabaseKind.TURSO):
        return "sqlite"
    return "duckdb"


@router.post("/api/sources/{source_id}/profile")
async def profile_source(source_id: str):
    try:
        source = lookup_source(source_id)
    except KeyError:
        return JSONResponse(status_code=404, content={"error": "Source not found"})

    dialect = _dialect_for(source)
    schema = source.schema or {}
    tables = schema.get("tables", {})
    result_tables = {}

    for tname, tinfo in tables.items():
        columns = tinfo.get("columns", [])
        if not columns:
            continue

        stats_sql = _build_stats_sql(tname, columns, dialect)
        stats_result = connector.execute_on_source(source, stats_sql)

        if stats_result.get("error") or not stats_result.get("rows"):
            result_tables[tname] = {
                "row_count": tinfo.get("row_count", -1),
                "columns": {},
                "quality": {"completeness_pct": 0, "high_null_columns": [], "has_duplicates": False},
                "anomalies": [],
                "error": stats_result.get("error"),
            }
            continue

        cols_list = stats_result["columns"]
        row = stats_result["rows"][0]
        stats_map = dict(zip(cols_list, row))
        total_rows = stats_map.get("__total_rows__", 0) or 0

        col_profiles = {}
        null_totals = 0
        high_null_cols = []

        for col in columns:
            cn = col["name"].replace('"', "")
            kind = _classify(col.get("type", ""))
            distinct = stats_map.get(cn + "_distinct", None)
            nulls = stats_map.get(cn + "_nulls", 0) or 0
            null_pct = round(100 * nulls / total_rows, 1) if total_rows > 0 else 0
            null_totals += nulls

            profile: dict = {
                "type": col.get("type", "unknown"),
                "kind": kind,
                "total": total_rows,
                "distinct": distinct,
                "nulls": nulls,
                "null_pct": null_pct,
            }

            if kind == "numeric":
                profile["min"] = stats_map.get(cn + "_min")
                profile["max"] = stats_map.get(cn + "_max")
                profile["mean"] = round(float(stats_map.get(cn + "_avg", 0) or 0), 2)
            elif kind == "text":
                profile["max_length"] = stats_map.get(cn + "_maxlen")
            elif kind == "date":
                dmin = stats_map.get(cn + "_min")
                dmax = stats_map.get(cn + "_max")
                profile["min"] = str(dmin) if dmin else None
                profile["max"] = str(dmax) if dmax else None

            if null_pct > 50:
                high_null_cols.append(cn)

            col_profiles[cn] = profile

        total_cells = total_rows * len(columns) if total_rows > 0 else 1
        completeness = round(100 * (1 - null_totals / total_cells), 1)

        anomalies = []
        for col in columns:
            cn = col["name"].replace('"', "")
            kind = _classify(col.get("type", ""))
            if kind != "numeric":
                continue

            iqr_sql = _build_iqr_sql(tname, col["name"], dialect)
            if not iqr_sql:
                continue

            iqr_result = connector.execute_on_source(source, iqr_sql)
            if iqr_result.get("error") or not iqr_result.get("rows"):
                continue

            iqr_row = dict(zip(iqr_result["columns"], iqr_result["rows"][0]))
            q1 = iqr_row.get("q1")
            q3 = iqr_row.get("q3")
            if q1 is None or q3 is None:
                continue

            q1, q3 = float(q1), float(q3)
            iqr = q3 - q1
            lower_bound = q1 - 1.5 * iqr
            upper_bound = q3 + 1.5 * iqr

            qc = _q(col["name"])
            qt = _q(tname)
            outlier_sql = (
                'SELECT COUNT(*) AS cnt FROM {t} WHERE {c} IS NOT NULL AND ({c} < {lo} OR {c} > {hi})'
            ).format(t=qt, c=qc, lo=lower_bound, hi=upper_bound)

            outlier_result = connector.execute_on_source(source, outlier_sql)
            if outlier_result.get("error") or not outlier_result.get("rows"):
                continue

            outlier_count = outlier_result["rows"][0][0] or 0
            if outlier_count > 0:
                anomalies.append({
                    "column": cn,
                    "outlier_count": outlier_count,
                    "q1": round(q1, 2),
                    "q3": round(q3, 2),
                    "iqr": round(iqr, 2),
                    "lower_bound": round(lower_bound, 2),
                    "upper_bound": round(upper_bound, 2),
                })

        result_tables[tname] = {
            "row_count": total_rows,
            "columns": col_profiles,
            "quality": {
                "completeness_pct": completeness,
                "high_null_columns": high_null_cols,
                "has_duplicates": False,
            },
            "anomalies": anomalies,
        }

    return {
        "source_id": source.source_id,
        "source_name": source.name,
        "db_type": source.db_type.value,
        "tables": result_tables,
    }
