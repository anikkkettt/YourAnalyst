"""
Query Executor — Dispatches generated SQL to the appropriate data source.

Serves as the central execution gateway for running code against connected
sources. Routes queries by session, manages cross-source federation via
an ephemeral DuckDB instance, and formats columnar output.
"""
from core.source_registry import lookup_source, enumerate_sources
import duckdb
import pandas as pd


def run_query(session_id, code, code_type, source_ids, cross_db):
    """Execute a query against one or more connected sources."""
    if not source_ids:
        return {"columns": [], "rows": [], "row_count": 0, "truncated": False,
                "error": "No sources selected"}

    if cross_db and len(source_ids) > 1:
        return _federated_exec(source_ids, code)

    source = None
    for sid in source_ids:
        try:
            source = lookup_source(sid)
            break
        except KeyError:
            continue

    if source is None:
        all_sources = enumerate_sources(session_id)
        if all_sources:
            source = all_sources[0]
        else:
            return {"columns": [], "rows": [], "row_count": 0, "truncated": False,
                    "error": "Source not found — please reconnect your data source."}

    from core.connection_manager import ConnectionManager
    conn = ConnectionManager()
    return conn.execute_on_source(source, code)


def _federated_exec(source_ids, sql):
    """Join data across multiple sources in a temporary DuckDB context."""
    tmp = duckdb.connect()
    try:
        for sid in source_ids:
            try:
                source = lookup_source(sid)
            except KeyError:
                continue
            if source.dataframe is not None:
                tmp.register(source.safe_name, source.dataframe)
            elif source.engine is not None:
                with source.engine.connect() as conn:
                    for tname in source.schema.get("tables", {}).keys():
                        try:
                            df = pd.read_sql('SELECT * FROM "{}"'.format(tname), conn)
                            tmp.register("{}_{}".format(source.safe_name, tname), df)
                        except Exception:
                            pass
        outcome = tmp.execute(sql)
        cols = [d[0] for d in outcome.description]
        rows = outcome.fetchmany(500)
        return {"columns": cols, "rows": [list(r) for r in rows],
                "row_count": len(rows), "truncated": False, "error": None}
    except Exception as e:
        return {"columns": [], "rows": [], "row_count": 0, "truncated": False, "error": str(e)}
    finally:
        tmp.close()


def summarize_result(outcome: dict) -> str:
    """Produce a human-readable digest of query output for downstream agents."""
    if not outcome:
        return "No result returned."
    if outcome.get("error"):
        return "Query failed: {}".format(outcome['error'])
    cols = outcome.get("columns", [])
    rows = outcome.get("rows", [])
    count = outcome.get("row_count", 0)
    if not rows:
        return "Query returned 0 rows."

    summary_lines = ["{} row(s) returned. Columns: {}.".format(count, ', '.join(cols))]
    for i, row in enumerate(rows[:5]):
        row_str = ", ".join("{}={}".format(col, val) for col, val in zip(cols, row))
        summary_lines.append(f"  Row {i+1}: {row_str}")
    if count > 5:
        summary_lines.append("  ... and {} more rows.".format(count - 5))
    if outcome.get("truncated"):
        summary_lines.append("  (Result was truncated at 500 rows.)")
    return "\n".join(summary_lines)
