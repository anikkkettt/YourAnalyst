import pytest
from unittest.mock import patch

def test_narrator_quick_mode():
    with patch("backend.pipeline.insight_writer.invoke_llm") as mock_llm:
        mock_llm.return_value = "Sales were $100K in Q1."
        from backend.pipeline.insight_writer import compose_narrative
        state = {
            "user_question": "What were sales in Q1?",
            "execution_result": {"columns": ["sales"], "rows": [[100000]], "row_count": 1},
            "verification_note": "Verified.",
            "mode": "quick",
            "trust_trace": []
        }
        result = compose_narrative(state)
        assert result["insight_narrative"] == "Sales were $100K in Q1."

def test_followup_agent():
    with patch("backend.pipeline.suggestion_engine.invoke_llm") as mock_llm:
        mock_llm.return_value = {"followups": ["q1", "q2", "q3"]}
        from backend.pipeline.suggestion_engine import suggest_followups
        state = {
            "user_question": "What were sales?",
            "execution_result": {"columns": [], "rows": [], "row_count": 0}
        }
        result = suggest_followups(state)
        assert len(result["suggested_followups"]) == 3
