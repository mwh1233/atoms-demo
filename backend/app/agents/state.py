from typing import Optional, TypedDict


class AgentState(TypedDict):
    task_id: str
    project_id: str
    user_id: str
    user_prompt: str
    analysis_result: Optional[str]
    design_result: Optional[str]
    generated_code: Optional[str]
    deploy_url: Optional[str]
    current_step: str
    status: str
    error_message: Optional[str]
