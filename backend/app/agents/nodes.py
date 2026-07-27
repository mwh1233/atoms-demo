import asyncio
import json
import re
import shutil
import tempfile
import time
from pathlib import Path
from typing import Callable

import httpx
from openai import OpenAI, APIError, APIConnectionError, APITimeoutError

from app.agents.prompts import SYSTEM_PROMPTS
from app.agents.state import AgentState
from app.config import settings
from app.services.template_service import template_service


# LLM客户端懒加载：启动时不初始化，第一次调用时再创建，降低启动内存占用
_deepseek_client = None
_coder_client = None


def get_deepseek_client():
    global _deepseek_client
    if _deepseek_client is None:
        _deepseek_client = OpenAI(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            timeout=120.0,
            max_retries=3,
        )
    return _deepseek_client


def get_coder_client():
    global _coder_client
    if _coder_client is None:
        if settings.openai_api_key:
            _coder_client = OpenAI(
                api_key=settings.openai_api_key,
                base_url=settings.openai_base_url,
                timeout=180.0,  # 代码生成时间长，给3分钟超时
                max_retries=3,
            )
        else:
            _coder_client = get_deepseek_client()
    return _coder_client


TokenCallback = Callable[[str, str], None]
BUILD_FIX_MAX_ATTEMPTS = 3
BUILD_FIX_CONTEXT_MAX_CHARS = 25000
LLM_MAX_RETRIES = 3


def _call_llm(
    system_prompt: str,
    user_content: str,
    stream: bool = False,
    use_coder: bool = False,
) -> str:
    cl = get_coder_client() if use_coder else get_deepseek_client()
    md = settings.coder_model if use_coder else settings.llm_model

    last_error = None
    for attempt in range(LLM_MAX_RETRIES):
        try:
            response = cl.chat.completions.create(
                model=md,
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
        except (APIConnectionError, APITimeoutError, httpx.ReadError, httpx.RemoteProtocolError, json.JSONDecodeError) as e:
            last_error = e
            wait_time = 2 ** attempt
            print(f"[LLM] Network error (attempt {attempt+1}/{LLM_MAX_RETRIES}): {e}, retrying in {wait_time}s...")
            time.sleep(wait_time)
            continue
        except APIError as e:
            if e.status_code in {429, 500, 502, 503, 504}:
                last_error = e
                wait_time = 2 ** attempt
                print(f"[LLM] API error {e.status_code} (attempt {attempt+1}/{LLM_MAX_RETRIES}), retrying in {wait_time}s...")
                time.sleep(wait_time)
                continue
            raise

    raise RuntimeError(f"LLM call failed after {LLM_MAX_RETRIES} retries: {last_error}")


def _call_llm_stream(system_prompt: str, user_content: str, use_coder: bool = False):
    """流式调用 LLM，yield (delta, full_content)。网络中断自动重试。"""
    cl = get_coder_client() if use_coder else get_deepseek_client()
    md = settings.coder_model if use_coder else settings.llm_model

    full_content = ""
    last_error = None

    for attempt in range(LLM_MAX_RETRIES):
        try:
            response = cl.chat.completions.create(
                model=md,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                stream=True,
            )

            for chunk in response:
                delta = chunk.choices[0].delta.content
                if delta:
                    full_content += delta
                    yield delta, full_content

            # 成功完成
            yield None, full_content
            return

        except (APIConnectionError, APITimeoutError, httpx.ReadError, httpx.RemoteProtocolError) as e:
            last_error = e
            wait_time = 2 ** attempt
            print(f"[LLM] Stream interrupted (attempt {attempt+1}/{LLM_MAX_RETRIES}): {e}, retrying in {wait_time}s...")
            time.sleep(wait_time)
            # 重试时带上已经生成的内容作为上下文，让LLM继续
            if full_content:
                user_content = user_content + f"\n\n【注意】之前已经生成了以下内容，请从这里继续，不要重复前面的内容：\n{full_content[-2000:]}"
            continue
        except APIError as e:
            if e.status_code in {429, 500, 502, 503, 504}:
                last_error = e
                wait_time = 2 ** attempt
                print(f"[LLM] Stream API error {e.status_code} (attempt {attempt+1}/{LLM_MAX_RETRIES}), retrying in {wait_time}s...")
                time.sleep(wait_time)
                continue
            raise

    raise RuntimeError(f"LLM stream failed after {LLM_MAX_RETRIES} retries: {last_error}")


def _call_llm_with_optional_stream(
    system_prompt: str,
    user_content: str,
    on_token: TokenCallback | None = None,
    use_coder: bool = False,
) -> str:
    if not on_token:
        return _call_llm(system_prompt, user_content, use_coder=use_coder)

    full_result = ""
    for delta, full_content in _call_llm_stream(
        system_prompt,
        user_content,
        use_coder=use_coder,
    ):
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


def _format_limited_template_files(files: dict[str, str], max_chars: int) -> str:
    blocks: list[str] = []
    used_chars = 0

    for path in sorted(files):
        block = f"```file:{path}\n{files[path]}\n```"
        if used_chars + len(block) > max_chars:
            remaining = max_chars - used_chars
            if remaining > 300 or not blocks:
                blocks.append(block[:remaining] + "\n...内容已截断...\n```")
            break

        blocks.append(block)
        used_chars += len(block)

    return "\n\n".join(blocks)


def _is_frontend_build_file(path: str) -> bool:
    normalized = path.replace("\\", "/").lstrip("/")
    frontend_roots = ("frontend/src/", "src/")
    config_files = {
        "frontend/package.json",
        "package.json",
        "frontend/tsconfig.json",
        "tsconfig.json",
        "frontend/vite.config.ts",
        "vite.config.ts",
        "frontend/vite.config.js",
        "vite.config.js",
        "frontend/tailwind.config.ts",
        "tailwind.config.ts",
        "frontend/tailwind.config.js",
        "tailwind.config.js",
        "frontend/postcss.config.js",
        "postcss.config.js",
    }

    return normalized.startswith(frontend_roots) or normalized in config_files


def _candidate_file_keys(path: str, current_files: dict[str, str]) -> list[str]:
    normalized = _normalize_tree_path(re.sub(r":\d+(?::\d+)?$", "", path.strip()))
    variants = [normalized]

    if normalized.startswith("frontend/"):
        variants.append(normalized.removeprefix("frontend/"))
    else:
        variants.append(f"frontend/{normalized}")

    if normalized.startswith("src/"):
        variants.append(f"frontend/{normalized}")

    result: list[str] = []
    for variant in variants:
        if variant in current_files and variant not in result:
            result.append(variant)
    return result


def _extract_error_file_paths(error_msg: str) -> list[str]:
    patterns = [
        r'from\s+["\']((?:frontend/)?src/[^"\']+)["\']',
        r'["\']((?:frontend/)?src/[^"\']+\.(?:tsx|ts|jsx|js|css))(?::\d+)?(?::\d+)?["\']',
        r"\b((?:frontend/)?src/[A-Za-z0-9_./@()-]+\.(?:tsx|ts|jsx|js|css))(?::\d+)?(?::\d+)?",
        r"\b((?:frontend/)?(?:package\.json|tsconfig\.json|vite\.config\.[tj]s|tailwind\.config\.[tj]s|postcss\.config\.js))\b",
    ]

    paths: list[str] = []
    for pattern in patterns:
        for match in re.finditer(pattern, error_msg):
            path = match.group(1).strip()
            if path not in paths:
                paths.append(path)
    return paths


def _resolve_import_path(source_path: str, import_path: str, current_files: dict[str, str]) -> list[str]:
    if not import_path.startswith((".", "@/")):
        return []

    normalized_source = source_path.replace("\\", "/")
    if normalized_source.startswith("frontend/"):
        frontend_relative_source = normalized_source.removeprefix("frontend/")
    else:
        frontend_relative_source = normalized_source

    if import_path.startswith("@/"):
        base = f"src/{import_path.removeprefix('@/')}"
    else:
        base_path = (Path(frontend_relative_source).parent / import_path).as_posix()
        base = str(Path(base_path)).replace("\\", "/")

    candidates: list[str] = []
    for suffix in ("", ".tsx", ".ts", ".jsx", ".js", ".css", "/index.tsx", "/index.ts"):
        candidates.extend(_candidate_file_keys(f"{base}{suffix}", current_files))

    result: list[str] = []
    for candidate in candidates:
        if candidate not in result:
            result.append(candidate)
    return result


def _select_build_fix_files(current_files: dict[str, str], error_msg: str) -> dict[str, str]:
    frontend_files = {
        key: value
        for key, value in current_files.items()
        if _is_frontend_build_file(key)
    }
    selected_keys: list[str] = []

    for path in _extract_error_file_paths(error_msg):
        for key in _candidate_file_keys(path, current_files):
            if key not in selected_keys:
                selected_keys.append(key)

    if re.search(r"failed to resolve import|could not resolve|cannot find module", error_msg, re.I):
        for package_key in ("frontend/package.json", "package.json"):
            if package_key in current_files and package_key not in selected_keys:
                selected_keys.append(package_key)

    for key in list(selected_keys):
        content = current_files.get(key)
        if not isinstance(content, str):
            continue

        imports = re.findall(r"(?:from\s+|import\s+)['\"]([^'\"]+)['\"]", content)
        for import_path in imports:
            for dependency_key in _resolve_import_path(key, import_path, current_files):
                if dependency_key not in selected_keys:
                    selected_keys.append(dependency_key)

    if selected_keys:
        return {
            key: current_files[key]
            for key in selected_keys
            if key in current_files and _is_frontend_build_file(key)
        }

    return frontend_files


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


def _run_async_command_in_node(command, cwd: Path):
    from app.services.deploy_service import _run_command

    return asyncio.run(_run_command(command, cwd))


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

    system_prompt = (
        SYSTEM_PROMPTS["coder"]
        .replace("{{user_prompt}}", state["user_prompt"])
        .replace("{{analysis_result}}", state.get("analysis_result") or "")
        .replace("{{architecture_doc}}", architecture_doc)
        .replace("{{file_tree_plan_str}}", _format_file_tree_plan(file_tree_plan))
        .replace("{{template_code_str}}", _format_template_files(template_code))
    )

    result = _call_llm_with_optional_stream(
        system_prompt,
        "请严格按照要求生成代码，preview.html必须第一个输出，然后是React项目文件。只输出 ```file:路径 代码块，不要其他解释。",
        on_token,
        use_coder=True,
    )
    changed_files = _parse_generated_files(result)
    print("[CODE] changed files count:", len(changed_files))
    print("[CODE] changed file keys:", list(changed_files.keys())[:20])
    index_key = next(
        (k for k in changed_files.keys() if "index" in k.lower() and k.endswith(".tsx")),
        None,
    )
    if index_key:
        print(f"[CODE] found index file: {index_key}")
        print(f"[CODE] index content preview: {changed_files[index_key][:300]}")
    else:
        print("[CODE] NO index.tsx file found in changed_files!")

    index_path = "frontend/src/pages/Index.tsx"
    normalized_index_path = "src/pages/Index.tsx"
    if index_path not in changed_files and normalized_index_path not in changed_files:
        print("[CODE] AI did not generate Index.tsx; creating fallback entry page")

        component_imports = []
        component_usages = []
        for key in changed_files.keys():
            if key.startswith("frontend/src/components/") and key.endswith(".tsx"):
                component_path = key.removeprefix("frontend/src/components/").removesuffix(".tsx")
            elif key.startswith("src/components/") and key.endswith(".tsx"):
                component_path = key.removeprefix("src/components/").removesuffix(".tsx")
            else:
                continue

            parts = component_path.split("/")
            component_name = parts[-1]
            import_path = "@/components/" + "/".join(parts)
            component_imports.append(f"import {component_name} from '{import_path}'")
            component_usages.append(f"<{component_name} />")

        imports_str = "\n".join(component_imports)
        usages_str = "\n        ".join(component_usages) if component_usages else "<p>页面生成中...</p>"

        fallback_index = f"""import React from 'react'
{imports_str}

export default function Index() {{
  return (
    <div className="min-h-screen bg-gray-50">
      {usages_str}
    </div>
  )
}}
"""
        changed_files[index_path] = fallback_index
        print(f"[CODE] fallback Index.tsx generated with {len(component_imports)} components")

    generated_files = _merge_generated_files(template_code, changed_files)
    generated_code = _files_to_compat_code(generated_files, _clean_html_code(result))

    return {
        "generated_files": generated_files,
        "generated_code": generated_code,
        "current_step": "coding",
    }


def code_review_node(state: AgentState, on_token: TokenCallback | None = None) -> dict:
    """Deterministic code review for common frontend file/path issues."""
    generated_files = dict(state.get("generated_files") or {})
    fixes_applied: list[str] = []
    removed_generated_keys: set[str] = set()

    # 保存 preview.html（单文件预览版），code_review 不处理它，最后原样放回
    preview_html = generated_files.get("preview.html")

    def _norm(path: str) -> str:
        return path.strip().replace("\\", "/").lstrip("/")

    def _get_frontend_files() -> dict[str, str]:
        result: dict[str, str] = {}
        for key, value in generated_files.items():
            normalized = _norm(key)
            # preview.html 单独处理，不加入前端构建文件
            if normalized == "preview.html":
                continue
            if normalized.startswith("frontend/"):
                result[normalized.removeprefix("frontend/")] = value
            elif normalized.startswith(("src/", "public/")) or normalized in {
                "index.html",
                "package.json",
                "vite.config.ts",
                "vite.config.js",
            }:
                result[normalized] = value
        return result

    def _pascal_case(name: str) -> str:
        return "".join(word[:1].upper() + word[1:] for word in re.split(r"[-_]", name) if word)

    frontend_files = _get_frontend_files()

    if "src/pages/Index.tsx" not in frontend_files:
        print("[REVIEW] Missing Index.tsx, creating safe fallback")
        frontend_files["src/pages/Index.tsx"] = _generate_safe_index(frontend_files)
        fixes_applied.append("created Index.tsx fallback")

    renamed_paths: dict[str, str] = {}
    for path in list(frontend_files.keys()):
        parts = path.split("/")
        filename = parts[-1]
        if "/components/" not in path or not filename.endswith(".tsx"):
            continue

        name = filename.removesuffix(".tsx")
        if "-" not in name and "_" not in name:
            continue

        pascal_name = f"{_pascal_case(name)}.tsx"
        new_path = "/".join(parts[:-1] + [pascal_name])
        if new_path == path or new_path in frontend_files:
            continue

        frontend_files[new_path] = frontend_files.pop(path)
        renamed_paths[path] = new_path
        removed_generated_keys.add(path)
        removed_generated_keys.add(f"frontend/{path}")
        fixes_applied.append(f"renamed {path} -> {new_path}")

    for path, content in list(frontend_files.items()):
        if not path.endswith((".tsx", ".ts")) or not isinstance(content, str):
            continue

        original = content

        def fix_import(match: re.Match) -> str:
            quote = match.group(1)
            imp_path = match.group(2)
            if imp_path.startswith("@/components/"):
                file_part = imp_path.split("/")[-1]
                dir_part = "/".join(imp_path.split("/")[:-1])
                if "-" in file_part or "_" in file_part:
                    pascal_file = _pascal_case(file_part)
                    new_imp = f"{dir_part}/{pascal_file}"
                    fixes_applied.append(f"fixed import: {imp_path} -> {new_imp}")
                    return f"from {quote}{new_imp}{quote}"
            return match.group(0)

        content = re.sub(r"from\s+(['\"])(@/components/[^'\"]+)\1", fix_import, content)
        for old_path, new_path in renamed_paths.items():
            old_import = old_path.removeprefix("src/")
            new_import = new_path.removeprefix("src/").removesuffix(".tsx")
            content = content.replace(
                f"@/{old_import.removesuffix('.tsx')}",
                f"@/{new_import}",
            )

        if content != original:
            frontend_files[path] = content

    for path, content in list(frontend_files.items()):
        if not path.endswith((".tsx", ".ts")) or not isinstance(content, str):
            continue

        lines = content.split("\n")
        new_lines: list[str] = []
        changed = False
        for line in lines:
            match = re.match(r"^(\s*import\s+.+?\s+from\s+['\"])(.+?)(['\"].*)$", line)
            if match:
                prefix, imp_path, suffix = match.groups()
                resolved = None
                if imp_path.startswith("@/"):
                    resolved = f"src/{imp_path[2:]}"

                if resolved:
                    candidates = [
                        f"{resolved}.tsx",
                        f"{resolved}.ts",
                        f"{resolved}.jsx",
                        f"{resolved}.js",
                        f"{resolved}/index.tsx",
                        f"{resolved}/index.ts",
                    ]
                    exists = any(candidate in frontend_files for candidate in candidates)
                    if not exists and not imp_path.startswith("@/components/ui/"):
                        new_lines.append(f"// [REVIEW] commented out missing import: {line.strip()}")
                        fixes_applied.append(f"commented missing import: {imp_path} in {path}")
                        changed = True
                        continue
            new_lines.append(line)

        if changed:
            frontend_files[path] = "\n".join(new_lines)

    package_json = frontend_files.get("package.json", "")
    if package_json and isinstance(package_json, str):
        try:
            package_data = json.loads(package_json)
            existing_deps = set(package_data.get("dependencies", {})) | set(
                package_data.get("devDependencies", {})
            )
            if not existing_deps:
                fixes_applied.append("package.json has no dependencies declared")
        except json.JSONDecodeError:
            fixes_applied.append("package.json is not valid JSON")

    for key in removed_generated_keys:
        generated_files.pop(key, None)

    for key, value in frontend_files.items():
        generated_files[f"frontend/{key}"] = value

    # 放回 preview.html（单文件预览版），确保不丢失
    if preview_html:
        generated_files["preview.html"] = preview_html
        print(f"[REVIEW] preserved preview.html ({len(preview_html)} bytes)")

    if fixes_applied:
        print(f"[REVIEW] Applied {len(fixes_applied)} fixes:")
        for fix in fixes_applied[:10]:
            print(f"  - {fix}")
    else:
        print("[REVIEW] No issues found")

    return {
        "generated_files": generated_files,
        "generated_code": _files_to_compat_code(generated_files),
        "current_step": "reviewing",
    }


def _generate_safe_index(frontend_files: dict[str, str]) -> str:
    """Generate a safe visible homepage when the model forgot Index.tsx."""
    components: list[str] = []
    for path in frontend_files:
        if path.startswith("src/components/") and path.endswith(".tsx"):
            name = path.split("/")[-1].removesuffix(".tsx")
            if name and name[0].isupper():
                components.append(name)

    components = list(dict.fromkeys(components))[:12]
    badge_items = "\n              ".join(
        f'<Badge key="{component}" variant="secondary">{component}</Badge>'
        for component in components
    )
    if not badge_items:
        badge_items = '<span className="text-sm text-slate-500">暂无可展示组件</span>'

    return f"""import React from 'react'
import {{ Badge }} from '@/components/ui/badge'
import {{ Card, CardContent, CardHeader, CardTitle }} from '@/components/ui/card'

export default function Index() {{
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="space-y-3 py-8 text-center">
          <Badge variant="outline" className="text-sm">AI Generated</Badge>
          <h1 className="text-3xl font-bold text-slate-900">页面已生成</h1>
          <p className="text-slate-500">AI 已生成 {len(components)} 个组件，可在编辑器中查看和继续完善。</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">已生成组件</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {badge_items}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}}
"""


def build_fix_node(state: AgentState, on_token: TokenCallback | None = None) -> dict:
    """Validate generated frontend build and ask the LLM for a small fix if needed."""
    generated_files = dict(state.get("generated_files") or {})
    template_id = state.get("template_id") or "fullstack-shadcn"

    if template_id == "simple-html":
        return {
            "build_success": True,
            "build_attempts": 0,
            "build_error": "",
            "current_step": "building",
        }

    last_error = state.get("build_error") or ""
    for attempt_index in range(BUILD_FIX_MAX_ATTEMPTS):
        attempt_number = attempt_index + 1
        if attempt_index > 0 and last_error:
            print(f"[BUILD_FIX] attempt {attempt_number}: fixing generated files with build error")
            generated_files = _fix_code_with_llm(
                {
                    **state,
                    "generated_files": generated_files,
                    "build_error": last_error,
                },
                last_error,
                on_token,
            )

        success, error_msg = _try_build(
            state.get("project_id") or "temp",
            generated_files,
        )
        if success:
            print(f"[BUILD_FIX] build succeeded on attempt {attempt_number}")
            return {
                "generated_files": generated_files,
                "generated_code": _files_to_compat_code(generated_files),
                "build_success": True,
                "build_attempts": attempt_number,
                "build_error": "",
                "current_step": "building",
            }

        last_error = error_msg
        print(f"[BUILD_FIX] build failed on attempt {attempt_number}: {error_msg[:500]}")

    print(f"[BUILD_FIX] max attempts reached: {BUILD_FIX_MAX_ATTEMPTS}; continuing to deploy")
    return {
        "generated_files": generated_files,
        "generated_code": _files_to_compat_code(generated_files),
        "build_success": False,
        "build_attempts": BUILD_FIX_MAX_ATTEMPTS,
        "build_error": last_error,
        "current_step": "building",
    }


def _try_build(project_id: str, generated_files: dict[str, str]) -> tuple[bool, str]:
    """Write frontend files into a temporary directory and run npm build."""
    from app.services.deploy_service import (
        _extract_frontend_files,
        _force_vite_relative_base,
        _npm_command,
    )

    temp_dir = Path(tempfile.mkdtemp(prefix=f"buildfix_{project_id}_"))
    try:
        frontend_files = _extract_frontend_files(generated_files)
        if not frontend_files:
            return False, "No frontend files were available for build validation."

        for relative_path, content in frontend_files.items():
            file_path = temp_dir / relative_path
            file_path.parent.mkdir(parents=True, exist_ok=True)
            if isinstance(content, str):
                file_path.write_text(content, encoding="utf-8", errors="replace")
            else:
                file_path.write_bytes(content)

        _force_vite_relative_base(temp_dir / "vite.config.ts")

        install_result = _run_async_command_in_node(_npm_command("install"), temp_dir)
        if install_result.returncode != 0:
            return (
                False,
                "npm install failed:\n"
                f"{install_result.stderr or install_result.stdout or 'No output'}",
            )

        build_result = _run_async_command_in_node(
            _npm_command("run", "build", "--", "--base=./"),
            temp_dir,
        )
        if build_result.returncode != 0:
            return (
                False,
                "npm run build failed:\n"
                f"{build_result.stderr or build_result.stdout or 'No output'}",
            )

        return True, ""
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _fix_code_with_llm(
    state: AgentState,
    error_msg: str,
    on_token: TokenCallback | None = None,
) -> dict[str, str]:
    """Ask the LLM for build-level patches and merge them into generated_files."""
    current_files = state.get("generated_files") or {}
    focused_file_map = _select_build_fix_files(current_files, error_msg)
    files_summary = "\n".join([f"- {key}" for key in sorted(focused_file_map.keys())])
    focused_files = _format_limited_template_files(
        focused_file_map,
        BUILD_FIX_CONTEXT_MAX_CHARS,
    )

    # 提取 package.json 中的已有依赖，帮助 LLM 优先复用现有包。
    pkg_content = current_files.get("frontend/package.json") or current_files.get("package.json") or ""
    available_deps = ""
    if isinstance(pkg_content, str):
        try:
            import json as _json

            pkg_data = _json.loads(pkg_content)
            deps = list(pkg_data.get("dependencies", {}).keys())
            available_deps = "\n".join(f"  - {dep}" for dep in sorted(deps))
        except Exception:
            pass

    user_prompt = f"""
## 构建错误
```
{error_msg}
```

## 当前项目文件
{files_summary}

## 可用依赖（package.json 中已安装，可直接使用）
{available_deps if available_deps else "  (see package.json)"}

## 修复策略
1. 如果缺包（cannot resolve import "xxx"）：优先改代码用已有依赖实现；必须用的话在 package.json dependencies 里加
2. 如果是 import 路径错误：修正路径，@/ 指向 src/，文件名 PascalCase
3. 如果是语法/类型错误：修复代码
4. 不要删除或重写整个文件，只改有问题的部分

## 相关前端源码
{focused_files}

只输出需要修改的文件，用 ```file:完整路径 格式。
"""

    result = _call_llm_with_optional_stream(
        SYSTEM_PROMPTS["build_fix"],
        user_prompt,
        on_token,
        use_coder=True,
    )
    changed_files = _parse_generated_files(result)
    print("[BUILD_FIX] LLM patch files:", list(changed_files.keys()))

    fixed_files = dict(current_files)
    fixed_files.update(changed_files)
    return fixed_files


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
