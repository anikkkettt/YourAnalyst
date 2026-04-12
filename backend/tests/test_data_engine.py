import pytest
from unittest.mock import MagicMock, patch

def test_get_result_summary_empty():
    from backend.core.query_executor import summarize_result
    result = {"columns": [], "rows": [], "row_count": 0, "error": None}
    summary = summarize_result(result)
    assert "0 rows" in summary

def test_get_result_summary_with_data():
    from backend.core.query_executor import summarize_result
    result = {"columns": ["name", "value"], "rows": [["Alice", 100]], "row_count": 1, "error": None}
    summary = summarize_result(result)
    assert "name" in summary
    assert "1 rows" in summary

def test_get_result_summary_error():
    from backend.core.query_executor import summarize_result
    result = {"error": "table not found"}
    summary = summarize_result(result)
    assert "failed" in summary.lower()
