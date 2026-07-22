import json
import re
from typing import Callable

from openai import OpenAI

from app.agents.prompts import SYSTEM_PROMPTS
from app.agents.state import AgentState
from app.config import settings
from app.services.template_service import template_service


client = OpenAI(
    api_key=settings.deepseek_api_key,
    base_url=settings.deepseek_base_url,
)

TokenCallback = Callable[[str, str], None]


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


def _call_llm_stream(system_prompt: str, user_content: str):
    """流式调用 LLM，yield (delta, full_content)。"""
    response = client.chat.completions.create(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        stream=True,
    )

    full_content = ""
    for chunk in response:
        delta = chunk.choices[0].delta.content
        if delta:
            full_content += delta
            yield delta, full_content

    yield None, full_content


def _call_llm_with_optional_stream(
    system_prompt: str,
    user_content: str,
    on_token: TokenCallback | None = None,
) -> str:
    if not on_token:
        return _call_llm(system_prompt, user_content)

    full_result = ""
    for delta, full_content in _call_llm_stream(system_prompt, user_content):
        full_result = full_content
        if delta is not None:
            on_token(delta, full_content)

    return full_result


def _clean_html_code(code: str) -> str:
    cleaned = code.strip()

    if cleaned.startswith("```html"):
        cleaned = cleaned.removeprefix("```html").strip()
    elif cleaned.startswith("```"):
        cleaned = cleaned.removeprefix("```").strip()

    if cleaned.endswith("```"):
        cleaned = cleaned.removesuffix("```").strip()

    return cleaned


def _format_template_files(files: dict[str, str]) -> str:
    blocks: list[str] = []
    for path in sorted(files):
        blocks.append(f"```file:{path}\n{files[path]}\n```")
    return "\n\n".join(blocks)


def _format_file_tree_plan(file_tree_plan: list[dict]) -> str:
    if not file_tree_plan:
        return "未解析到文件树计划，请基于架构设计和模板结构生成必要文件。"

    lines: list[str] = []
    for item in file_tree_plan:
        if not isinstance(item, dict):
            continue

        path = str(item.get("path") or "").strip()
        if not path:
            continue

        description = str(item.get("description") or "").strip()
        if description:
            lines.append(f"- {path} # {description}")
        else:
            lines.append(f"- {path}")

    return "\n".join(lines) or "未解析到文件树计划，请基于架构设计和模板结构生成必要文件。"


def _parse_generated_files(output: str) -> dict[str, str]:
    pattern = re.compile(r"```file:(.+?)\n([\s\S]*?)```", re.MULTILINE)
    files: dict[str, str] = {}

    for match in pattern.finditer(output):
        path = _normalize_tree_path(match.group(1).strip())
        code = match.group(2).strip("\n\r")
        if path:
            files[path] = code

    return files


def _parse_features(output: str) -> list[dict]:
    match = re.search(r"```features\s*(.*?)```", output, re.DOTALL)
    if not match:
        return []

    try:
        features = json.loads(match.group(1).strip())
    except json.JSONDecodeError:
        return []

    if not isinstance(features, list):
        return []

    normalized_features: list[dict] = []
    for index, feature in enumerate(features, start=1):
        if not isinstance(feature, dict):
            continue

        name = str(feature.get("name") or f"功能 {index}").strip()
        description = str(feature.get("description") or "").strip()
        normalized_features.append(
            {
                "id": str(feature.get("id") or f"feature-{index}"),
                "name": name,
                "description": description,
                "defaultSelected": bool(feature.get("defaultSelected", True)),
            }
        )

    return normalized_features


def _normalize_tree_path(path: str) -> str:
    normalized = path.strip().strip("/").replace("\\", "/")
    for prefix in ("template/", "app/"):
        if normalized.startswith(prefix):
            normalized = normalized.removeprefix(prefix)
    return normalized.strip("/")


def _parse_file_tree_plan(output: str) -> list[dict]:
    """从架构文档的文件树代码块中提取文件路径和说明。

    LLM 输出偶尔会出现树形缩进不标准、根目录不同或注释缺失的情况；
    这里尽量解析，失败时返回空列表，不影响主流程。
    """

    code_blocks = re.findall(r"```(?:\w+)?\s*\n(.*?)```", output, re.DOTALL)
    tree_block = ""
    for block in code_blocks:
        if any(keyword in block for keyword in ("backend/", "frontend/", "index.html")):
            tree_block = block
            break

    if not tree_block:
        return []

    file_tree_plan: list[dict] = []
    directory_stack: dict[int, str] = {}

    for raw_line in tree_block.splitlines():
        if not raw_line.strip():
            continue

        line_without_comment, _, comment = raw_line.partition("#")
        description = comment.strip()
        match = re.search(r"(├──|└──)\s*(.+)$", line_without_comment)

        if match:
            prefix = line_without_comment[: match.start()]
            level = max(prefix.count("│") + 1, len(prefix.expandtabs(4)) // 4 + 1)
            node_name = match.group(2).strip()
        else:
            level = 0
            node_name = line_without_comment.strip()

        node_name = node_name.strip().strip("/")
        if not node_name:
            continue

        if node_name in {"app", "template"}:
            directory_stack = {0: node_name}
            continue

        if "." not in node_name.split("/")[-1]:
            directory_stack[level] = node_name
            for key in list(directory_stack):
                if key > level:
                    directory_stack.pop(key, None)
            continue

        path_parts = [
            directory_stack[index].strip("/")
            for index in sorted(directory_stack)
            if 0 < index < level and directory_stack[index] not in {"app", "template"}
        ]
        path_parts.append(node_name)
        path = _normalize_tree_path("/".join(path_parts))

        if not path:
            continue

        file_tree_plan.append(
            {
                "path": path,
                "description": description,
            }
        )

    return file_tree_plan


def _files_to_compat_code(files: dict[str, str], fallback: str = "") -> str:
    if "index.html" in files:
        return files["index.html"]

    if "frontend/index.html" in files:
        return files["frontend/index.html"]

    if fallback:
        return fallback

    return "\n\n".join(
        f"<!-- file: {path} -->\n{content}" for path, content in sorted(files.items())
    )


def _merge_generated_files(template_code: dict[str, str], generated_files: dict[str, str]) -> dict[str, str]:
    return {
        **template_code,
        **generated_files,
    }


def _template_summary(template_id: str) -> dict:
    summary: dict = {"id": template_id, "name": template_id, "techStack": []}
    for template in template_service.list_templates():
        if template["id"] == template_id:
            summary = template
            break

    metadata = template_service.get_template(template_id)
    return {**metadata, **summary}


def analyze_node(state: AgentState, on_token: TokenCallback | None = None) -> dict:
    result = _call_llm_with_optional_stream(
        SYSTEM_PROMPTS["analyzer"],
        state["user_prompt"],
        on_token,
    )
    features_list = _parse_features(result)

    return {
        "analysis_result": result,
        "features_list": features_list,
        "current_step": "analyzing",
    }


def select_template_node(state: AgentState) -> dict:
    template = template_service.match_template(
        state["user_prompt"],
        state.get("confirmed_features") or [],
    )
    template_id = template["id"]
    template_code = template_service.get_template_code(template_id)

    return {
        "template_id": template_id,
        "template_code": template_code,
        # 前端不展示单独“选择模板”步骤，归入设计阶段前置工作。
        "current_step": "designing",
    }


def design_node(state: AgentState, on_token: TokenCallback | None = None) -> dict:
    template_id = state.get("template_id") or "fullstack-shadcn"
    template = _template_summary(template_id)
    system_prompt = (
        SYSTEM_PROMPTS["architect"]
        .replace("{{user_prompt}}", state["user_prompt"])
        .replace("{{analysis_result}}", state.get("analysis_result") or "")
        .replace("{{template_id}}", template_id)
        .replace("{{template_name}}", template.get("name", template_id))
        .replace("{{tech_stack}}", ", ".join(template.get("techStack") or []))
        .replace(
            "{{confirmed_features}}",
            json.dumps(state.get("confirmed_features") or [], ensure_ascii=False, indent=2),
        )
    )
    result = _call_llm_with_optional_stream(
        system_prompt,
        state["analysis_result"] or "",
        on_token,
    )
    file_tree_plan = _parse_file_tree_plan(result)

    return {
        "design_result": result,
        "architecture_doc": result,
        "file_tree_plan": file_tree_plan,
        "current_step": "designing",
    }


def code_node(state: AgentState, on_token: TokenCallback | None = None) -> dict:
    template_id = state.get("template_id") or "fullstack-shadcn"
    template_code = state.get("template_code") or template_service.get_template_code(template_id)
    architecture_doc = state.get("architecture_doc") or state.get("design_result") or ""
    file_tree_plan = state.get("file_tree_plan") or []

    # 迭代时如果暂时只有旧的 generated_code，则用它覆盖 index.html 作为增量基线。
    if state.get("is_iteration") and state.get("previous_code"):
        template_code = {
            **template_code,
            "index.html": state["previous_code"] or template_code.get("index.html", ""),
        }

    user_content = (
        SYSTEM_PROMPTS["coder"]
        .replace("{{user_prompt}}", state["user_prompt"])
        .replace("{{analysis_result}}", state.get("analysis_result") or "")
        .replace("{{architecture_doc}}", architecture_doc)
        .replace("{{file_tree_plan_str}}", _format_file_tree_plan(file_tree_plan))
        .replace("{{template_code_str}}", _format_template_files(template_code))
    )

    result = _call_llm_with_optional_stream(
        "你只输出 ```file:path/to/file 代码块，不输出解释文字。",
        user_content,
        on_token,
    )
    changed_files = _parse_generated_files(result)

    generated_files = _merge_generated_files(template_code, changed_files)
    generated_code = _files_to_compat_code(generated_files, _clean_html_code(result))

    return {
        "generated_files": generated_files,
        "generated_code": generated_code,
        "current_step": "coding",
    }


async def deploy_node(state: AgentState) -> dict:
    from app.services.deploy_service import deploy_project

    template_id = state.get("template_id") or "fullstack-shadcn"
    deploy_url = await deploy_project(
        state["project_id"],
        template_id,
        state.get("generated_files") or {},
        state.get("generated_code") or "",
    )

    return {
        "deploy_url": deploy_url,
        "current_step": "deploying",
        "status": "completed",
    }
