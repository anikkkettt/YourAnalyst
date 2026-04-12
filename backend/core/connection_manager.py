"""
Connection Manager — Multi-dialect database connectivity layer.

Handles establishment and introspection of connections across PostgreSQL,
MySQL, SQLite, Turso/libSQL, CSV and Excel sources. Performs credential
masking, schema discovery, and DuckDB registration for flat-file inputs.
SQLAlchemy powers relational engines; libsql_client handles Turso.
"""
from dataclasses import dataclass, field
from enum import Enum
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect
import pandas as pd
import duckdb, uuid, re
from datetime import datetime
import libsql_client


class DatabaseKind(Enum):
    POSTGRESQL = "postgresql"
    MYSQL = "mysql"
    SQLITE = "sqlite"
    TURSO = "turso"
    CSV = "csv"
    EXCEL = "excel"


@dataclass
class LiveSource:
    source_id: str
    name: str
    safe_name: str
    db_type: DatabaseKind
    masked_conn: str
    engine: any
    duckdb_conn: any
    dataframe: any
    schema: dict
    is_connected: bool
    connected_at: str
    table_count: int
    session_id: str
    config: dict
    turso_client: any = None


class ConnectionManager:

    def _safe_name(self, name: str) -> str:
        return re.sub(r'[^a-zA-Z0-9_]', '_', name).lower()

    def _build_conn_str(self, db_type: DatabaseKind, params: dict) -> str:
        """Assemble a SQLAlchemy connection URI from the given parameters."""
        if db_type == DatabaseKind.POSTGRESQL:
            return "postgresql+psycopg2://{}:{}@{}:{}/{}?sslmode=require".format(
                params['username'], params['password'], params['host'],
                params.get('port', 5432), params['database'])
        elif db_type == DatabaseKind.MYSQL:
            return "mysql+pymysql://{}:{}@{}:{}/{}".format(
                params['username'], params['password'], params['host'],
                params.get('port', 3306), params['database'])
        elif db_type == DatabaseKind.SQLITE:
            return f"sqlite:///{params['file_path']}"
        return ""

    def _build_turso_url(self, params: dict) -> str:
        """Construct the libsql:// endpoint from raw host configuration."""
        host = params.get('host', '')
        clean_host = host.replace('libsql://', '').replace('https://', '')
        return "libsql://{}".format(clean_host)

    def _create_turso_client(self, params: dict):
        """Instantiate a synchronous libsql handle for Turso databases."""
        url = self._build_turso_url(params)
        token = params.get('password') or params.get('token', '')
        return libsql_client.create_client_sync(
            url=url,
            auth_token=token
        )

    def test_connection(self, db_type: DatabaseKind, params: dict) -> dict:
        """Verify connectivity and return table metadata without persisting state."""
        try:
            if db_type == DatabaseKind.CSV:
                tname = params.get("file_path", "data.csv").split("/")[-1]
                return {"success": True, "error": None, "table_count": 1, "tables": [tname]}

            if db_type == DatabaseKind.EXCEL:
                xl = pd.ExcelFile(params["file_path"])
                sheets = xl.sheet_names
                return {"success": True, "error": None, "table_count": len(sheets), "tables": sheets}

            if db_type == DatabaseKind.TURSO:
                client = self._create_turso_client(params)
                try:
                    rs = client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
                    tables = [row[0] for row in rs.rows]
                    return {"success": True, "error": None, "table_count": len(tables), "tables": tables}
                finally:
                    client.close()

            conn_str = self._build_conn_str(db_type, params)

            connect_args = {}
            if db_type == DatabaseKind.POSTGRESQL or db_type == DatabaseKind.MYSQL:
                connect_args["connect_timeout"] = 10

            if db_type == DatabaseKind.MYSQL:
                connect_args["ssl"] = {"verify_identity": True}

            engine = sa.create_engine(conn_str, connect_args=connect_args)
            with engine.connect() as conn:
                inspector = sa_inspect(engine)
                tables = inspector.get_table_names()
            engine.dispose()
            return {"success": True, "error": None, "table_count": len(tables), "tables": tables}
        except Exception as e:
            return {"success": False, "error": str(e), "table_count": 0}

    def connect(self, db_type: DatabaseKind, params: dict, name: str, session_id: str, selected_tables: list = None) -> LiveSource:
        """Establish a persistent connection and return a fully-populated LiveSource."""
        source_id = str(uuid.uuid4())
        safe_name = self._safe_name(name)

        if db_type == DatabaseKind.CSV:
            df = pd.read_csv(params["file_path"], encoding="utf-8-sig")
            conn = duckdb.connect()
            conn.register(safe_name, df)
            schema = self._schema_from_df(df, safe_name)
            return LiveSource(source_id, name, safe_name, db_type, "csv://{}".format(name),
                              None, conn, df, schema, True,
                              datetime.utcnow().isoformat(), 1, session_id, params)

        elif db_type == DatabaseKind.EXCEL:
            sheets = pd.read_excel(params["file_path"], sheet_name=None)
            conn = duckdb.connect()
            all_tables = {}
            first_df = None
            for sheet_name, df in sheets.items():
                tname = self._safe_name(str(sheet_name))
                conn.register(tname, df)
                sheet_schema = self._schema_from_df(df, tname)
                all_tables.update(sheet_schema["tables"])
                if first_df is None:
                    first_df = df
            schema = {"tables": all_tables}
            return LiveSource(source_id, name, safe_name, db_type, "excel://{}".format(name),
                              None, conn, first_df, schema, True,
                              datetime.utcnow().isoformat(), len(schema["tables"]), session_id, params)

        elif db_type == DatabaseKind.TURSO:
            client = self._create_turso_client(params)
            masked = "turso://{}".format(params.get('host', '****'))
            schema = self._schema_from_turso(client, selected_tables)
            return LiveSource(source_id, name, safe_name, db_type, masked,
                              None, None, None, schema, True,
                              datetime.utcnow().isoformat(), len(schema["tables"]),
                              session_id, params, turso_client=client)

        else:
            conn_str = self._build_conn_str(db_type, params)
            masked = conn_str.replace(params.get("password", "NOPASS"), "****")

            connect_args = {}
            if db_type == DatabaseKind.MYSQL:
                connect_args["ssl"] = {"verify_identity": True}

            engine = sa.create_engine(conn_str, connect_args=connect_args, pool_pre_ping=True)
            schema = self._schema_from_engine(engine, selected_tables)
            return LiveSource(source_id, name, safe_name, db_type, masked,
                              engine, None, None, schema, True,
                              datetime.utcnow().isoformat(), len(schema["tables"]), session_id, params)

    def _schema_from_df(self, df: pd.DataFrame, table_name: str) -> dict:
        """Derive column metadata from a pandas DataFrame with heuristic PK detection."""
        type_map = {"int64": "INTEGER", "float64": "FLOAT", "object": "STRING",
                    "bool": "BOOLEAN", "datetime64[ns]": "TIMESTAMP"}
        cols = []
        for c in df.columns:
            is_pk = False
            cl = c.lower().strip()
            if cl == 'id' or cl == f'{table_name}_id' or cl == f'{table_name}id':
                if df[c].is_unique and df[c].notna().all():
                    is_pk = True
            cols.append({
                "name": c,
                "type": type_map.get(str(df[c].dtype), "STRING"),
                "pk": is_pk,
                "fk": None,
                "nullable": bool(df[c].isna().any()),
            })
        return {"tables": {table_name: {"row_count": len(df), "columns": cols}}}

    def _schema_from_engine(self, engine, selected_tables: list = None) -> dict:
        """Introspect an SQLAlchemy engine to extract full table/column metadata."""
        inspector = sa_inspect(engine)
        tables = {}
        all_tables = inspector.get_table_names()
        target_tables = [t for t in all_tables if t in selected_tables] if selected_tables else all_tables

        for tname in target_tables:
            pk_cols = set(inspector.get_pk_constraint(tname).get("constrained_columns", []))
            fk_map = {}
            for fk in inspector.get_foreign_keys(tname):
                if fk.get("constrained_columns"):
                    fk_map[fk["constrained_columns"][0]] = "{}.{}".format(fk['referred_table'], fk['referred_columns'][0])
            cols = [{"name": c["name"], "type": str(c["type"]),
                     "pk": c["name"] in pk_cols,
                     "fk": fk_map.get(c["name"]),
                     "nullable": c.get("nullable", True)}
                    for c in inspector.get_columns(tname)]
            try:
                with engine.connect() as con:
                    if str(engine.url).startswith("mysql"):
                        con.execute(sa.text("SET SESSION sql_mode=(SELECT CONCAT(@@sql_mode, ',ANSI_QUOTES'))"))
                    count = con.execute(sa.text(f"SELECT COUNT(*) FROM \"{tname}\"")).scalar()
            except Exception:
                count = -1
            tables[tname] = {"row_count": count, "columns": cols}
        return {"tables": tables}

    def _schema_from_turso(self, client, selected_tables: list = None) -> dict:
        """Pull schema information from a Turso database via PRAGMA introspection."""
        tables = {}
        rs = client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        all_tables = [row[0] for row in rs.rows]
        target_tables = [t for t in all_tables if t in selected_tables] if selected_tables else all_tables

        for tname in target_tables:
            col_rs = client.execute(f"PRAGMA table_info('{tname}')")
            cols = []
            for row in col_rs.rows:
                cols.append({
                    "name": row[1],
                    "type": row[2] or "TEXT",
                    "pk": bool(row[5]),
                    "fk": None,
                    "nullable": not bool(row[3])
                })
            try:
                count_rs = client.execute(f'SELECT COUNT(*) FROM "{tname}"')
                count = count_rs.rows[0][0] if count_rs.rows else -1
            except Exception:
                count = -1
            tables[tname] = {"row_count": count, "columns": cols}
        return {"tables": tables}

    def execute_on_source(self, source: LiveSource, sql: str) -> dict:
        """Run arbitrary SQL against a connected source and return columnar output."""
        try:
            if source.duckdb_conn:
                outcome = source.duckdb_conn.execute(sql)
                cols = [d[0] for d in outcome.description]
                rows = outcome.fetchmany(500)
                try:
                    total = source.duckdb_conn.execute(f"SELECT COUNT(*) FROM ({sql}) __t__").fetchone()[0]
                except Exception:
                    total = len(rows)
                return {"columns": cols, "rows": [list(r) for r in rows],
                        "row_count": total, "truncated": total > 500, "error": None}
            elif source.turso_client:
                rs = source.turso_client.execute(sql)
                cols = [col.name for col in rs.columns] if rs.columns else []
                all_rows = [list(row) for row in rs.rows]
                truncated = len(all_rows) > 500
                rows = all_rows[:500]
                return {"columns": cols, "rows": rows,
                        "row_count": len(all_rows), "truncated": truncated, "error": None}
            else:
                with source.engine.connect() as conn:
                    if str(source.engine.url).startswith("mysql"):
                        conn.execute(sa.text("SET SESSION sql_mode=(SELECT CONCAT(@@sql_mode, ',ANSI_QUOTES'))"))
                    res = conn.execute(sa.text(sql))
                    cols = list(res.keys())
                    rows = res.fetchmany(500)
                    return {"columns": cols, "rows": [list(r) for r in rows],
                            "row_count": len(rows), "truncated": False, "error": None}
        except Exception as e:
            return {"columns": [], "rows": [], "row_count": 0, "truncated": False, "error": str(e)}
