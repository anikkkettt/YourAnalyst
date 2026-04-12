"""
Suggestion Engine — Generates contextual follow-up questions.

Proposes three natural follow-up questions derived from the query results,
enabling iterative data exploration without requiring users to formulate
their next question from scratch.
"""
from core.llm_client import invoke_llm, MODEL_RELIABILITY
from core.query_executor import summarize_result

def suggest_followups(state: dict) -> dict:
    result_summary = summarize_result(state.get("execution_result", {}))
    system = """Suggest 3 natural follow-up questions a business user would ask next.
Each under 10 words. Specific to the data shown.
Return ONLY valid JSON: {"followups": ["q1", "q2", "q3"]}"""

    user = f"""Question just answered: {state['user_question']}
Result: {result_summary}"""

    try:
        result = invoke_llm(system, user, temperature=0.6, max_tokens=200, model=MODEL_RELIABILITY)
        state["suggested_followups"] = result.get("followups", [])
    except Exception:
        state["suggested_followups"] = []
    return state
