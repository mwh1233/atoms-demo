from langgraph.graph import END, StateGraph

from app.agents.nodes import analyze_node, code_node, deploy_node, design_node
from app.agents.state import AgentState


def build_workflow():
    workflow = StateGraph(AgentState)

    workflow.add_node("analyze", analyze_node)
    workflow.add_node("design", design_node)
    workflow.add_node("code", code_node)
    workflow.add_node("deploy", deploy_node)

    workflow.set_entry_point("analyze")

    workflow.add_edge("analyze", "design")
    workflow.add_edge("design", "code")
    workflow.add_edge("code", "deploy")
    workflow.add_edge("deploy", END)

    return workflow.compile()


agent_workflow = build_workflow()
