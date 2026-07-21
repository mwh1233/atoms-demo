from openai import OpenAI

from app.agents.prompts import SYSTEM_PROMPTS
from app.agents.state import AgentState
from app.config import settings


client = OpenAI(
    api_key=settings.deepseek_api_key,
    base_url=settings.deepseek_base_url,
)


def _call_llm(system_prompt: str, user_content: str, stream: bool = False) -> str:
    response = client.chat.completions.create(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        stream=stream,
    )

    if stream:
        chunks: list[str] = []
        for chunk in response:
            delta = chunk.choices[0].delta.content
            if delta:
                chunks.append(delta)
        return "".join(chunks)

    return response.choices[0].message.content or ""


def _clean_html_code(code: str) -> str:
    cleaned = code.strip()

    if cleaned.startswith("```html"):
        cleaned = cleaned.removeprefix("```html").strip()
    elif cleaned.startswith("```"):
        cleaned = cleaned.removeprefix("```").strip()

    if cleaned.endswith("```"):
        cleaned = cleaned.removesuffix("```").strip()

    return cleaned


def analyze_node(state: AgentState) -> dict:
    result = _call_llm(
        SYSTEM_PROMPTS["analyzer"],
        state["user_prompt"],
    )

    return {
        "analysis_result": result,
        "current_step": "analyzing",
    }


def design_node(state: AgentState) -> dict:
    result = _call_llm(
        SYSTEM_PROMPTS["architect"],
        state["analysis_result"] or "",
    )

    return {
        "design_result": result,
        "current_step": "designing",
    }


def code_node(state: AgentState) -> dict:
    result = _call_llm(
        SYSTEM_PROMPTS["coder"],
        state["design_result"] or "",
    )

    return {
        "generated_code": _clean_html_code(result),
        "current_step": "coding",
    }


async def deploy_node(state: AgentState) -> dict:
    from app.services.deploy_service import deploy_project

    deploy_url = await deploy_project(
        state["project_id"],
        state["generated_code"] or "",
    )

    return {
        "deploy_url": deploy_url,
        "current_step": "deploying",
        "status": "completed",
    }
