"""
Pipeline State Definition — Shared typed dictionary for the analysis workflow.

Every processing node reads from and writes to this structure as the user's
question progresses through intent resolution, code generation, execution,
validation, and narrative composition.
"""
from typing import TypedDict, Optional


class PipelineState(TypedDict):
    """Full state flowing through the analytical pipeline.

    Organised by processing phase: input -> intent -> generation ->
    execution -> validation -> narration -> output.
    """
    session_id: str
    user_question: str
    mode: str
    source_ids: list[str]

    conversation_history: list[dict]
    available_sources: list[dict]

    resolved_question: str
    metric_mappings: dict
    assumptions: list[dict]
    selected_sources: list[str]
    cross_db_query: bool

    audit_result: Optional[list[dict]]

    generated_code: str
    code_type: str
    code_explanation: str
    retry_count: int

    execution_result: Optional[dict]
    execution_error: Optional[str]

    is_verified: bool
    verification_note: str

    confidence_score: Optional[int]
    confidence_reasoning: Optional[str]

    insight_narrative: str
    visualization: dict
    suggested_followups: list[str]
    trust_trace: list[dict]
    final_error: Optional[str]
