"""
Assumption Checker — Deep risk assessment for analytical assumptions.

Active in Deep and Compare modes. Takes assumptions surfaced by the Intent
Parser and performs a thorough risk evaluation, categorising each as SAFE,
RISKY, or UNKNOWN with suggested mitigations. This strengthens overall
trustworthiness of the analysis workflow.
"""
from core.llm_client import invoke_llm, MODEL_RELIABILITY
from datetime import datetime

def audit_assumptions(state: dict) -> dict:
    """Deeply audit each assumption for risk before query generation."""
    if not state.get("assumptions"):
        return state

    system = """You are a data audit specialist. For each assumption provided,
evaluate its risk more deeply and suggest mitigations.

Return ONLY valid JSON:
{
  "audited_assumptions": [
    {
      "statement": "...",
      "risk": "SAFE|RISKY|UNKNOWN",
      "mitigation": "...",
      "audit_note": "..."
    }
  ],
  "overall_risk": "LOW|MEDIUM|HIGH"
}"""

    user = f"""Question: {state['user_question']}
Assumptions to audit: {state['assumptions']}
Available schemas: {[s['name'] for s in state['available_sources']]}"""

    try:
        result = invoke_llm(system, user, temperature=0.1, max_tokens=600, model=MODEL_RELIABILITY)
        state["audit_result"] = result.get("audited_assumptions", state["assumptions"])
        state["assumptions"] = result.get("audited_assumptions", state["assumptions"])
        if not isinstance(state.get("trust_trace"), list):
            state["trust_trace"] = []
        state["trust_trace"].append({
            "agent": "Assumption Checker",
            "action": f"Deep Audit — Overall Risk: {result.get('overall_risk','UNKNOWN')}",
            "output": f"Audited {len(state['assumptions'])} assumptions",
            "color": "agent-critic",
            "timestamp": datetime.utcnow().isoformat(),
            "details": {
                "audited_assumptions": state["assumptions"],
                "overall_risk": result.get("overall_risk", "UNKNOWN"),
            }
        })
    except Exception:
        pass
    return state
