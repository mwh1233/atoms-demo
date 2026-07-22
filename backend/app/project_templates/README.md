# Project Templates

这是 Atoms 的多模板目录，用于让 AI 根据用户需求快速选择合适的项目起点。

## 目录结构

```text
project_templates/
  index.json
  README.md
  simple-html/
    template.json
    template/
      index.html
  fullstack-agent/
    template.json
    template/
      backend/
      frontend/
```

## 如何新增模板

1. 在 `project_templates/` 下创建新的模板目录，例如 `dashboard-app/`。
2. 在模板目录中添加 `template.json`，描述模板元信息、入口文件和生成约束。
3. 在 `template/` 子目录中放置可直接运行的参考代码。
4. 在根目录 `index.json` 的 `templates` 数组中追加摘要信息，方便 AI 检索匹配。

## 元信息字段

- `id`：模板唯一标识，使用 kebab-case。
- `name`：面向用户展示的模板名称。
- `description`：模板适用场景说明。
- `category`：模板分类，例如 `frontend`、`fullstack`。
- `complexity`：复杂度，建议使用 `low`、`medium`、`high`。
- `techStack`：核心技术栈。
- `useCases`：适合的用户需求。
- `tags`：用于检索和匹配的关键词。
- `deployment`：部署方式摘要。

## AI 如何选择模板

- 只需要静态页面、展示页、小游戏或轻量工具时，优先选择 `simple-html`。
- 需要后端 API、数据库、业务逻辑或 Agent/LLM 能力时，优先选择 `fullstack-agent`。
- 选择模板后，先读取对应 `template.json` 的生成约束，再参考 `template/` 中的代码风格生成项目。
