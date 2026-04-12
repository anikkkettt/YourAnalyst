"""
Schema Reader — Unified schema access across all session sources.

Provides helpers to retrieve combined or per-source schema metadata,
used by downstream agents to understand available tables and columns
before generating queries.
"""
from core.source_registry import enumerate_sources, lookup_source


def read_all_schemas(session_id: str) -> dict:
    """Merge schema information from every source in the given session."""
    sources = enumerate_sources(session_id)
    combined = {}
    for s in sources:
        combined[s.name] = {
            "source_id": s.source_id,
            "safe_name": s.safe_name,
            "db_type": s.db_type.value,
            "tables": s.schema.get("tables", {})
        }
    return combined


def read_source_schema(source_id: str) -> dict:
    """Fetch the schema dict for a single source by its identifier."""
    source = lookup_source(source_id)
    return source.schema
