from typing import Optional, TypedDict


class AgentState(TypedDict):
    task_id: str
    project_id: str
    user_id: str
    user_prompt: str
    analysis_result: Optional[str]
    design_result: Optional[str]
    architecture_doc: str
    file_tree_plan: list[dict]
    generated_code: Optional[str]
    template_id: str
    template_code: dict[str, str]
    generated_files: dict[str, str]
    features_list: list[dict]
    confirmed_features: list[dict]
    deploy_url: Optional[str]
    build_attempts: int
    build_error: str
    build_success: bool
    current_step: str
    status: str
    error_message: Optional[str]
    is_iteration: bool
    previous_code: Optional[str]
