"""
Live Source Registry — Volatile catalogue of active database connections.

Every connected data source is tracked here, keyed by a unique identifier
and scoped to the originating session. Supports cloning across sessions
for workspace duplication.
"""
import uuid
import duckdb
from dataclasses import replace

_registry: dict = {}


def register_source(source) -> str:
    _registry[source.source_id] = source
    return source.source_id


def lookup_source(source_id: str):
    if source_id not in _registry:
        raise KeyError("Source {} not found".format(source_id))
    return _registry[source_id]


def enumerate_sources(session_id: str) -> list:
    return [s for s in _registry.values() if s.session_id == session_id]


def duplicate_sources(from_session_id: str, to_session_id: str):
    """
    Replicate every source from one session into another.

    File-backed sources (CSV/Excel) get a fresh DuckDB handle with the
    DataFrame re-registered, since DuckDB connections are not thread-safe.
    SQL-engine sources share the existing SQLAlchemy pool directly.
    Turso sources spin up a new libsql_client from stored credentials.
    """
    existing = enumerate_sources(from_session_id)

    for s in existing:
        fresh_id = str(uuid.uuid4())

        if s.duckdb_conn is not None and s.dataframe is not None:
            fresh_conn = duckdb.connect()
            fresh_conn.register(s.safe_name, s.dataframe)
            cloned = replace(s, source_id=fresh_id, session_id=to_session_id,
                             duckdb_conn=fresh_conn)
        elif s.turso_client is not None:
            import libsql_client
            params = s.config
            raw_host = params.get("host", "")
            clean_host = raw_host.replace("libsql://", "").replace("https://", "")
            url = "libsql://{}".format(clean_host)
            token = params.get("password") or params.get("token", "")
            fresh_client = libsql_client.create_client_sync(url=url, auth_token=token)
            cloned = replace(s, source_id=fresh_id, session_id=to_session_id,
                             turso_client=fresh_client)
        else:
            cloned = replace(s, source_id=fresh_id, session_id=to_session_id)

        _registry[fresh_id] = cloned


def unregister_source(source_id: str):
    if source_id in _registry:
        del _registry[source_id]
