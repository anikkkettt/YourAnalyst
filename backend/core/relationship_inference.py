"""
Relationship inference engine — multi-signal confidence scoring.

Infers likely joins between tables within a data source using four
weighted signals adapted from the TrustLens AI inference pipeline:

    name_similarity    35%  — fuzzy column name matching
    value_overlap      35%  — Jaccard similarity of sampled column values
    cardinality_signal 20%  — uniqueness ratio hints at FK/PK relationship
    id_pattern_match   10%  — heuristic for _id / _key suffix naming

For SQL sources (PostgreSQL, MySQL): relationships are read directly from the
FK/PK metadata collected at connection time — no extra DB queries needed.
For DuckDB sources (CSV/Excel): statistical inference is used.
"""

import itertools
import logging
import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Tuple

import sqlalchemy as sa

logger = logging.getLogger(__name__)

_ID_SUFFIX = re.compile(r"(_id|_key|_code|_ref|_uuid)$", re.IGNORECASE)
_GENERIC_ID = re.compile(r"^id$", re.IGNORECASE)

W_NAME = 0.35
W_OVERLAP = 0.35
W_CARDINALITY = 0.20
W_ID_PATTERN = 0.10

_HIGH_UNIQUENESS = 0.95
_MED_UNIQUENESS = 0.50

MIN_CONFIDENCE = 0.6
VALUE_SAMPLE_SIZE = 500


# ── Signal functions ─────────────────────────────────────────────────────────

def _name_similarity(col_a: str, col_b: str) -> float:
    if col_a.lower() == col_b.lower():
        return 1.0

    def strip_prefix(name: str) -> str:
        parts = name.lower().split("_")
        return "_".join(parts[-2:]) if len(parts) > 2 else name.lower()

    sa, sb = strip_prefix(col_a), strip_prefix(col_b)
    score = SequenceMatcher(None, sa, sb).ratio()

    if _ID_SUFFIX.search(col_a) and _ID_SUFFIX.search(col_b):
        score = min(1.0, score + 0.15)

    return round(score, 3)


def _id_pattern_score(col_a: str, col_b: str) -> float:
    a_is_id = bool(_ID_SUFFIX.search(col_a)) or bool(_GENERIC_ID.match(col_a))
    b_is_id = bool(_ID_SUFFIX.search(col_b)) or bool(_GENERIC_ID.match(col_b))
    if a_is_id and b_is_id:
        return 1.0
    if a_is_id or b_is_id:
        return 0.5
    return 0.0


def _cardinality_signal(stats_a: Dict, stats_b: Dict) -> float:
    total_a = stats_a.get("total_rows", 0)
    total_b = stats_b.get("total_rows", 0)
    if total_a == 0 or total_b == 0:
        return 0.0
    ur_a = stats_a["distinct_count"] / total_a
    ur_b = stats_b["distinct_count"] / total_b
    if ur_a >= _HIGH_UNIQUENESS or ur_b >= _HIGH_UNIQUENESS:
        return 0.9
    if ur_a >= _MED_UNIQUENESS or ur_b >= _MED_UNIQUENESS:
        return 0.5
    return 0.2


def _infer_type(stats_a: Dict, stats_b: Dict) -> str:
    total_a = stats_a.get("total_rows", 1) or 1
    total_b = stats_b.get("total_rows", 1) or 1
    ur_a = stats_a["distinct_count"] / total_a
    ur_b = stats_b["distinct_count"] / total_b
    if ur_a >= _HIGH_UNIQUENESS and ur_b >= _HIGH_UNIQUENESS:
        return "one_to_one"
    if ur_a >= _HIGH_UNIQUENESS:
        return "one_to_many"
    if ur_b >= _HIGH_UNIQUENESS:
        return "many_to_one"
    return "many_to_many"


def _build_reason(col_a: str, col_b: str, breakdown: Dict, rel_type: str) -> str:
    signals = []
    if breakdown["name_similarity"] >= 0.9:
        signals.append("column names are identical or nearly identical ('{}' / '{}')".format(col_a, col_b))
    elif breakdown["name_similarity"] >= 0.6:
        signals.append("column names are similar ({:.0%})".format(breakdown["name_similarity"]))
    if breakdown["value_overlap"] >= 0.5:
        signals.append("high value overlap ({:.0%} Jaccard)".format(breakdown["value_overlap"]))
    elif breakdown["value_overlap"] >= 0.2:
        signals.append("moderate value overlap ({:.0%})".format(breakdown["value_overlap"]))
    if breakdown["id_pattern_match"] >= 0.5:
        signals.append("both columns match identifier naming conventions")
    if breakdown["cardinality_signal"] >= 0.8:
        signals.append("{} cardinality pattern".format(rel_type.replace("_", "-")))
    if signals:
        return "Inferred join: " + "; ".join(signals) + "."
    return "Candidate join based on column name and value analysis."


# ── SQL: relationships from FK/PK schema metadata ────────────────────────────

def _relationships_from_schema(source) -> List[Dict[str, Any]]:
    """
    Extract relationships directly from the FK metadata stored in the schema.
    SQLAlchemy collects this at connect time via inspector.get_foreign_keys().
    No additional DB queries are needed.
    """
    schema = source.schema
    tables = schema.get("tables", {})
    results = []

    for tname, tinfo in tables.items():
        for col in tinfo.get("columns", []):
            fk = col.get("fk")
            if not fk:
                continue
            # fk format: "referred_table.referred_column"
            parts = fk.split(".", 1)
            if len(parts) != 2:
                continue
            referred_table, referred_col = parts

            # Infer relationship type from PK/FK roles
            left_is_pk = col.get("pk", False)
            ref_cols = tables.get(referred_table, {}).get("columns", [])
            right_is_pk = any(c.get("pk") and c["name"] == referred_col for c in ref_cols)

            if left_is_pk and right_is_pk:
                rel_type = "one_to_one"
            elif right_is_pk:
                rel_type = "many_to_one"
            elif left_is_pk:
                rel_type = "one_to_many"
            else:
                rel_type = "many_to_many"

            results.append({
                "left_table": tname,
                "right_table": referred_table,
                "left_column": col["name"],
                "right_column": referred_col,
                "relationship_type": rel_type,
                "confidence_score": 1.0,
                "confidence_breakdown": {
                    "name_similarity": 1.0,
                    "value_overlap": 1.0,
                    "cardinality_signal": 1.0,
                    "id_pattern_match": 1.0,
                },
                "reason": "Explicit foreign key constraint: {}.{} → {}.{}".format(
                    tname, col["name"], referred_table, referred_col
                ),
            })

    # If no FK constraints found, fall back to name-similarity inference
    # using just the schema column names (no DB queries)
    if not results:
        results = _infer_from_column_names(tables)

    logger.info(
        "Schema-based relationship inference for source '%s': %d relationships found",
        source.name, len(results),
    )
    return results


def _infer_from_column_names(tables: dict) -> List[Dict[str, Any]]:
    """
    Fallback: infer likely joins purely from column name similarity.
    Used when no FK constraints exist. No DB queries.
    """
    table_names = list(tables.keys())
    results: List[Dict[str, Any]] = []
    pair_best: Dict[Tuple[str, str], Dict] = {}

    for tbl_a, tbl_b in itertools.combinations(table_names, 2):
        cols_a = [c for c in tables[tbl_a].get("columns", [])]
        cols_b = [c for c in tables[tbl_b].get("columns", [])]

        for col_a_meta, col_b_meta in itertools.product(cols_a, cols_b):
            col_a = col_a_meta["name"]
            col_b = col_b_meta["name"]

            name_sim = _name_similarity(col_a, col_b)
            id_pat = _id_pattern_score(col_a, col_b)

            if name_sim < 0.5 and id_pat < 0.5:
                continue

            confidence = W_NAME * name_sim + W_ID_PATTERN * id_pat + W_CARDINALITY * 0.5

            if confidence < MIN_CONFIDENCE:
                continue

            left_is_pk = col_a_meta.get("pk", False)
            right_is_pk = col_b_meta.get("pk", False)
            if left_is_pk and right_is_pk:
                rel_type = "one_to_one"
            elif right_is_pk:
                rel_type = "many_to_one"
            elif left_is_pk:
                rel_type = "one_to_many"
            else:
                rel_type = "many_to_many"

            breakdown = {
                "name_similarity": round(name_sim, 3),
                "value_overlap": 0.0,
                "cardinality_signal": 0.5,
                "id_pattern_match": round(id_pat, 3),
            }
            reason = _build_reason(col_a, col_b, breakdown, rel_type)

            rel = {
                "left_table": tbl_a,
                "right_table": tbl_b,
                "left_column": col_a,
                "right_column": col_b,
                "relationship_type": rel_type,
                "confidence_score": round(confidence, 3),
                "confidence_breakdown": breakdown,
                "reason": reason,
            }

            key = (tbl_a, col_a, tbl_b, col_b)
            if key not in pair_best or pair_best[key]["confidence_score"] < confidence:
                pair_best[key] = rel

    results.extend(pair_best.values())
    results.sort(key=lambda r: r["confidence_score"], reverse=True)
    return results


# ── DuckDB: data access helpers ──────────────────────────────────────────────

def _column_stats_duckdb(conn, table: str, col: str) -> Dict:
    qt = table.replace('"', '""')
    qc = col.replace('"', '""')
    total = conn.execute('SELECT COUNT(*) FROM "{}"'.format(qt)).fetchone()[0]
    distinct = conn.execute('SELECT COUNT(DISTINCT "{}") FROM "{}"'.format(qc, qt)).fetchone()[0]
    return {"total_rows": total, "distinct_count": distinct}


def _sample_values_duckdb(conn, table: str, col: str, n: int = VALUE_SAMPLE_SIZE) -> set:
    qt = table.replace('"', '""')
    qc = col.replace('"', '""')
    rows = conn.execute(
        'SELECT DISTINCT CAST("{}" AS VARCHAR) FROM "{}" WHERE "{}" IS NOT NULL LIMIT {}'.format(qc, qt, qc, n)
    ).fetchall()
    return {r[0] for r in rows}


def _jaccard(set_a: set, set_b: set) -> float:
    if not set_a or not set_b:
        return 0.0
    intersection = set_a & set_b
    union = set_a | set_b
    return len(intersection) / len(union) if union else 0.0


# ── Main inference ───────────────────────────────────────────────────────────

def infer_relationships(source) -> List[Dict[str, Any]]:
    """
    Infer relationships between all table pairs within a single LiveSource.

    SQL sources: reads FK/PK metadata directly from schema — no extra queries.
    DuckDB sources (CSV/Excel): uses statistical inference over sampled values.
    """
    is_duckdb = source.duckdb_conn is not None

    # SQL sources — use schema FK/PK metadata
    if not is_duckdb:
        return _relationships_from_schema(source)

    # DuckDB sources — statistical inference
    schema = source.schema
    tables = schema.get("tables", {})
    table_names = list(tables.keys())

    if len(table_names) < 2:
        return []

    def get_stats(table: str, col: str) -> Dict:
        try:
            return _column_stats_duckdb(source.duckdb_conn, table, col)
        except Exception:
            return {"total_rows": 0, "distinct_count": 0}

    def get_samples(table: str, col: str) -> set:
        try:
            return _sample_values_duckdb(source.duckdb_conn, table, col)
        except Exception:
            return set()

    results: List[Dict[str, Any]] = []

    for tbl_a, tbl_b in itertools.combinations(table_names, 2):
        cols_a = [c["name"] for c in tables[tbl_a].get("columns", [])]
        cols_b = [c["name"] for c in tables[tbl_b].get("columns", [])]

        pair_best: Dict[Tuple[str, str], Dict] = {}

        for col_a, col_b in itertools.product(cols_a, cols_b):
            name_sim = _name_similarity(col_a, col_b)
            id_pat = _id_pattern_score(col_a, col_b)

            if name_sim < 0.3 and id_pat < 0.5:
                continue

            stats_a = get_stats(tbl_a, col_a)
            stats_b = get_stats(tbl_b, col_b)

            if stats_a["total_rows"] == 0 or stats_b["total_rows"] == 0:
                continue

            v_overlap = 0.0
            if name_sim >= 0.4 or id_pat >= 0.5:
                samples_a = get_samples(tbl_a, col_a)
                samples_b = get_samples(tbl_b, col_b)
                v_overlap = _jaccard(samples_a, samples_b)

            card = _cardinality_signal(stats_a, stats_b)

            confidence = (
                W_NAME * name_sim
                + W_OVERLAP * v_overlap
                + W_CARDINALITY * card
                + W_ID_PATTERN * id_pat
            )

            if confidence < MIN_CONFIDENCE:
                continue

            rel_type = _infer_type(stats_a, stats_b)
            breakdown = {
                "name_similarity": round(name_sim, 3),
                "value_overlap": round(v_overlap, 3),
                "cardinality_signal": round(card, 3),
                "id_pattern_match": round(id_pat, 3),
            }
            reason = _build_reason(col_a, col_b, breakdown, rel_type)

            rel = {
                "left_table": tbl_a,
                "right_table": tbl_b,
                "left_column": col_a,
                "right_column": col_b,
                "relationship_type": rel_type,
                "confidence_score": round(confidence, 3),
                "confidence_breakdown": breakdown,
                "reason": reason,
            }

            key = (col_a, col_b)
            if key not in pair_best or pair_best[key]["confidence_score"] < confidence:
                pair_best[key] = rel

        results.extend(pair_best.values())

    results.sort(key=lambda r: r["confidence_score"], reverse=True)

    logger.info(
        "Relationship inference for source '%s': %d relationships found",
        source.name, len(results),
    )
    return results
