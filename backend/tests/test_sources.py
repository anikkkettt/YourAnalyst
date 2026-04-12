import pytest

def test_source_store_add_get():
    from backend.core.source_registry import register_source, lookup_source
    from unittest.mock import MagicMock
    source = MagicMock()
    source.source_id = "test-id-123"
    source.session_id = "sess-1"
    register_source(source)
    retrieved = lookup_source("test-id-123")
    assert retrieved.source_id == "test-id-123"

def test_source_store_not_found():
    from backend.core.source_registry import lookup_source
    with pytest.raises(KeyError):
        lookup_source("nonexistent-id")
