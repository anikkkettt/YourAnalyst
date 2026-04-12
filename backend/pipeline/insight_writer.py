"""
Insight Writer — Transforms query results into business narratives.

Converts raw execution output into a confident, jargon-free summary aimed at
business users. Adapts length by analysis mode (Quick = 1 sentence, Deep = 2-3,
Compare = 2-4 with delta emphasis). Handles query failures gracefully with a
clear error explanation.
"""
from core.llm_client import invoke_llm, MODEL_ACCURACY
from core.query_executor import summarize_result
from datetime import datetime

LENGTH_BY_MODE = {
    "quick": "1 sentence only.",
    "deep": "3-4 sentences.",
    "compare": "2-4 sentences focusing on growth, deltas, and key comparison insights.",
}


def compose_narrative(state: dict) -> dict:
    exec_result = state.get("execution_result", {})
    error = exec_result.get("error") if exec_result else None

    if error:
        narrative = (
            f"I wasn't able to retrieve the data for your question. "
            f"The query ran into an issue: {error}. "
            f"Please try rephrasing your question or check that your data source is connected."
        )
        state["insight_narrative"] = narrative
        if not isinstance(state.get("trust_trace"), list):
            state["trust_trace"] = []
        state["trust_trace"].append({
            "agent": "Insight Writer",
            "action": "Error Report",
            "output": narrative,
            "color": "agent-narrator",
            "timestamp": datetime.utcnow().isoformat(),
        })
        return state

    result_summary = summarize_result(exec_result)
    length = LENGTH_BY_MODE.get(state.get("mode", "deep"), "2-3 sentences.")

    system = f"""You are a senior data analyst giving a direct, confident answer to a business user.
{length}

Rules:
- Lead with the direct answer immediately. No preamble, no "based on the data".
- For single-value questions ("who has highest X"): state the name/ID and the exact number first.
- Use specific numbers from the data. Format large numbers with commas (e.g. 2,579,000).
- Never mention SQL, queries, tables, LIMIT, rows, or any technical terms.
- Never say "the data shows" or "according to the results" — just state the fact.
- Never hedge about data completeness unless there are literally 0 rows returned.
- If result is 0 rows, say clearly what was searched and that nothing matched.
- Sound like a confident Bloomberg analyst, not a cautious data engineer.
Return ONLY the narrative. No JSON, no bullet points, no headers."""

    user = f"""Question asked: {state['user_question']}
Data result: {result_summary}
Verification note: {state.get('verification_note', '')}"""

    try:
        narrative = invoke_llm(system, user, temperature=0.4, max_tokens=400, expect_json=False, model=MODEL_ACCURACY)
        if not isinstance(narrative, str):
            narrative = str(narrative)
    except Exception:
        narrative = result_summary

    state["insight_narrative"] = narrative

    if not isinstance(state.get("trust_trace"), list):
        state["trust_trace"] = []
    state["trust_trace"].append({
        "agent": "Insight Writer",
        "action": "Business Insight",
        "output": narrative,
        "color": "agent-narrator",
        "timestamp": datetime.utcnow().isoformat(),
    })
    return state
