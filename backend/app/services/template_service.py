import json
import logging
import os
from copy import deepcopy
from typing import Any


logger = logging.getLogger(__name__)


class TemplateServiceError(RuntimeError):
    """模板服务异常，统一用于描述模板索引或文件读取问题。"""


class TemplateService:
    def __init__(self):
        self.template_root = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "project_templates")
        )
        self.index_path = os.path.join(self.template_root, "index.json")
        self._index: dict[str, Any] = {}
        self._templates_by_id: dict[str, dict[str, Any]] = {}
        self._template_cache: dict[str, dict[str, Any]] = {}
        self._template_code_cache: dict[str, dict[str, str]] = {}

        self._load_index()

    def list_templates(self) -> list[dict]:
        """返回 index.json 中的模板摘要，供 Agent 快速检索。"""
        fields = {
            "id",
            "name",
            "description",
            "category",
            "techStack",
            "useCases",
            "tags",
        }
        return [
            {key: deepcopy(value) for key, value in template.items() if key in fields}
            for template in self._index.get("templates", [])
        ]

    def get_template(self, template_id: str) -> dict:
        """返回模板元信息和 template/ 目录下的全部代码文件。"""
        if template_id in self._template_cache:
            return deepcopy(self._template_cache[template_id])

        metadata = self._load_template_metadata(template_id)
        template = {
            **metadata,
            "files": self.get_template_code(template_id),
        }
        self._template_cache[template_id] = template
        return deepcopy(template)

    def get_template_code(self, template_id: str) -> dict[str, str]:
        """只返回模板代码文件映射，用于注入 Agent Prompt。"""
        if template_id in self._template_code_cache:
            return deepcopy(self._template_code_cache[template_id])

        template_dir = self._get_template_dir(template_id)
        code_dir = os.path.join(template_dir, "template")
        if not os.path.isdir(code_dir):
            raise TemplateServiceError(f"Template code directory not found: {code_dir}")

        # 只读取文本类型文件，跳过二进制/编译产物
        TEXT_EXTENSIONS = {
            ".py", ".ts", ".tsx", ".js", ".jsx", ".html", ".css", ".json",
            ".md", ".yaml", ".yml", ".txt", ".ini", ".mako", ".svg",
            ".gitignore", ".default"
        }
        BINARY_EXTENSIONS = {".pyc", ".pyo", ".so", ".dll", ".exe", ".png", ".jpg", ".jpeg", ".gif", ".ico"}

        files: dict[str, str] = {}
        try:
            for root, _, filenames in os.walk(code_dir):
                for filename in filenames:
                    file_path = os.path.join(root, filename)
                    relative_path = os.path.relpath(file_path, code_dir).replace(os.sep, "/")
                    ext = os.path.splitext(filename)[1].lower()
                    if ext in BINARY_EXTENSIONS:
                        continue
                    if TEXT_EXTENSIONS and ext not in TEXT_EXTENSIONS and not filename.startswith("."):
                        continue
                    with open(file_path, "r", encoding="utf-8", errors="replace") as file:
                        files[relative_path] = file.read()
        except OSError as exc:
            logger.exception("Failed to read template code for %s: %s", template_id, exc)
            raise TemplateServiceError(
                f"Failed to read template code for {template_id}: {exc}"
            ) from exc

        self._template_code_cache[template_id] = files
        logger.info("Loaded %s files for template %s", len(files), template_id)
        return deepcopy(files)

    def match_template(self, user_prompt: str, features: list | None = None) -> dict:
        """Always use the enterprise fullstack-shadcn template.

        The earlier keyword matching rules are intentionally bypassed so every
        project follows one fullstack generation, preview, and deploy path.
        """
        template_id = "fullstack-shadcn"
        template = self._templates_by_id.get(template_id)
        if not template:
            raise TemplateServiceError(f"Template not found: {template_id}")

        return deepcopy(template)

    def _load_index(self) -> None:
        if not os.path.isfile(self.index_path):
            raise TemplateServiceError(f"Template index not found: {self.index_path}")

        try:
            with open(self.index_path, "r", encoding="utf-8") as file:
                self._index = json.load(file)
        except (OSError, json.JSONDecodeError) as exc:
            logger.exception("Failed to load template index: %s", exc)
            raise TemplateServiceError(f"Failed to load template index: {exc}") from exc

        templates = self._index.get("templates")
        if not isinstance(templates, list):
            raise TemplateServiceError("Template index must contain a templates list")

        self._templates_by_id = {}
        for template in templates:
            template_id = template.get("id")
            if not template_id:
                raise TemplateServiceError("Template summary is missing id")
            self._templates_by_id[template_id] = template

        logger.info("Loaded %s template summaries", len(self._templates_by_id))

    def _load_template_metadata(self, template_id: str) -> dict[str, Any]:
        template_dir = self._get_template_dir(template_id)
        metadata_path = os.path.join(template_dir, "template.json")
        if not os.path.isfile(metadata_path):
            raise TemplateServiceError(f"Template metadata not found: {metadata_path}")

        try:
            with open(metadata_path, "r", encoding="utf-8") as file:
                metadata = json.load(file)
        except (OSError, json.JSONDecodeError) as exc:
            logger.exception("Failed to load template metadata for %s: %s", template_id, exc)
            raise TemplateServiceError(
                f"Failed to load template metadata for {template_id}: {exc}"
            ) from exc

        return metadata

    def _get_template_dir(self, template_id: str) -> str:
        if template_id not in self._templates_by_id:
            raise TemplateServiceError(f"Template not found: {template_id}")

        template_dir = os.path.join(self.template_root, template_id)
        if not os.path.isdir(template_dir):
            raise TemplateServiceError(f"Template directory not found: {template_dir}")

        return template_dir


template_service = TemplateService()
