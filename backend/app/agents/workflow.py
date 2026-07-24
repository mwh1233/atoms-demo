from langgraph.graph import END, StateGraph

from app.agents.nodes import (
    analyze_node,
    code_node,
    code_review_node,
    design_node,
    select_template_node,
)
from app.agents.state import AgentState


def build_workflow(entry_point: str = "analyze"):
    workflow = StateGraph(AgentState)

    workflow.add_node("analyze", analyze_node)
    workflow.add_node("select_template", select_template_node)
    workflow.add_node("design", design_node)
    workflow.add_node("code", code_node)
    workflow.add_node("code_review", code_review_node)

    workflow.set_entry_point(entry_point)

    # analyze 后由 task_manager 暂停，等待用户确认 features；
    # 确认后从 select_template 继续进入 design/code。
    # code_review 完成后直接结束：preview.html 已可即时预览，无需等待构建部署
    workflow.add_edge("analyze", END)
    workflow.add_edge("select_template", "design")
    workflow.add_edge("design", "code")
    workflow.add_edge("code", "code_review")
    workflow.add_edge("code_review", END)

    return workflow.compile()


agent_workflow = build_workflow()
post_confirmation_workflow = build_workflow("select_template")
