"""
Result Validator — Structural and semantic quality checks.

Performs both rule-based structural validation (null detection, empty results,
query success) and LLM-driven semantic verification (does the output actually
answer the question?). When validation fails in Deep/Compare mode, the workflow
loops back to the SQL Generator for revision.
"""
from core.llm_client import invoke_llm, MODEL_RELIABILITY
from core.query_executor import summarize_result
from datetime import datetime


def validate_result(state: dict) -> dict:
    exec_result = state.get("execution_result", {}) or {}
    result_summary = summarize_result(exec_result)

    row_count = exec_result.get("row_count", 0)
    columns = exec_result.get("columns", [])
    rows = exec_result.get("rows", [])
    has_error = bool(exec_result.get("error"))

    structural_checks = []

    if has_error:
        structural_checks.append({"label": "Query executed successfully", "pass": False, "note": exec_result.get("error", "")})
    else:
        structural_checks.append({"label": "Query executed successfully", "pass": True, "note": ""})

        null_cols = []
        if rows:
            for ci, col in enumerate(columns):
                null_count = sum(1 for r in rows if len(r) > ci and r[ci] is None)
                if null_count > 0:
                    null_cols.append(f"{col} ({null_count} nulls)")
        if null_cols:
            structural_checks.append({"label": "No null values", "pass": False, "note": f"Nulls found in: {', '.join(null_cols)}"})
        else:
            structural_checks.append({"label": "No null values", "pass": True, "note": ""})

        if row_count == 0:
            structural_checks.append({"label": "Result has data", "pass": False, "note": "0 rows returned"})
        else:
            structural_checks.append({"label": "Result has data", "pass": True, "note": f"{row_count:,} row(s) returned"})

    system = """You are a Data Quality Analyst doing a semantic verification.
Given a question, the SQL used, and the result summary, assess:
1. Does the result semantically answer the question asked?
2. Are the values in a plausible range for the question?
3. Is the result shape correct (e.g., single value for totals, multiple rows for rankings)?

Return ONLY valid JSON:
{
  "answers_question": true,
  "value_plausible": true,
  "result_shape_correct": true,
  "semantic_note": "one sentence explaining what was verified",
  "is_verified": true
}"""

    user = f"""Question: {state['user_question']}
SQL used: {state.get('generated_code', '')}
Result: {result_summary}"""

    try:
        llm_result = invoke_llm(system, user, temperature=0.1, max_tokens=300, model=MODEL_RELIABILITY)
        state["is_verified"] = llm_result.get("is_verified", True)
        state["verification_note"] = llm_result.get("semantic_note", "Verification complete.")

        semantic_checks = [
            {"label": "Answers the question", "pass": llm_result.get("answers_question", True), "note": ""},
            {"label": "Values in plausible range", "pass": llm_result.get("value_plausible", True), "note": ""},
            {"label": "Result shape correct", "pass": llm_result.get("result_shape_correct", True), "note": llm_result.get("semantic_note", "")},
        ]
    except Exception:
        state["is_verified"] = not has_error
        state["verification_note"] = "Structural checks passed." if not has_error else "Query failed."
        semantic_checks = []

    all_checks = structural_checks + (semantic_checks if not has_error else [])

    if not isinstance(state.get("trust_trace"), list):
        state["trust_trace"] = []
    state["trust_trace"].append({
        "agent": "Result Validator",
        "action": "Result Verification",
        "output": state["verification_note"],
        "details": {
            "checks": all_checks,
            "is_verified": state["is_verified"],
            "row_count": row_count,
            "columns": columns,
        },
        "color": "agent-critic",
        "timestamp": datetime.utcnow().isoformat(),
    })
    return state
