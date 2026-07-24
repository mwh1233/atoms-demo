# Atoms Demo

> AI 多智能体全栈应用生成平台，通过自然语言对话，自动生成可运行的全栈网页应用，支持实时预览。

## ✨ 功能特性

- 🤖 **多智能体协作工作流**：需求分析 → 架构设计 → 代码生成 → 代码审查，全流程自动化
- ⚡ **实时流式预览**：生成过程中实时输出进度，生成完成后立即在浏览器中预览可交互效果
- 💬 **对话式迭代**：支持多轮对话修改，基于已有代码持续迭代优化
- 🎨 **现代UI设计**：基于 shadcn/ui + TailwindCSS，亮色主题，符合现代SaaS审美
- 🔐 **用户系统**：完整的注册登录，数据隔离，支持邮箱/手机号双登录模式
- 📱 **桌面端优先**：专门优化电脑浏览器访问体验，生成标准桌面端网页布局

## 🛠️ 技术栈

### 前端
- **框架**：Next.js 14 App Router + TypeScript
- **样式**：TailwindCSS + shadcn/ui 组件库
- **图标**：lucide-react
- **数据层**：Supabase Auth + Supabase PostgreSQL
- **实时通信**：SSE (Server-Sent Events) 流式输出
- **代码预览**：iframe 沙箱即时预览，无需构建

### 后端
- **Web框架**：FastAPI + uvicorn
- **Agent编排**：LangGraph 多节点工作流
- **LLM**：双模型架构
  - DeepSeek V3：负责需求分析、架构设计（低成本高速度）
  - GPT-5.5：负责代码生成（强代码能力）
- **任务调度**：数据库驱动轮询模式，支持失败自动重试
- **流式输出**：sse-starlette

### 数据存储
- **数据库**：Supabase PostgreSQL（美国节点）
- **认证**：Supabase Auth
- **对象存储**：Supabase Storage

## 🚀 本地运行

### 环境要求
- Node.js 18+
- Python 3.10+
- Conda（推荐）

### 1. 克隆项目
```bash
git clone https://github.com/mwh1233/atoms-demo.git
cd atoms-demo
```

### 2. 后端启动
```bash
cd backend
# 创建并激活conda环境
conda create -n atoms python=3.11
conda activate atoms

# 安装依赖
pip install -r requirements.txt

# 配置环境变量（参考.env.example）
cp .env.example .env
# 编辑.env填入你的API Key

# 启动服务
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

后端服务启动后访问 http://localhost:8000/health 显示 `{"ok": true}` 即正常。

### 3. 前端启动
```bash
cd frontend
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env.local
# 编辑.env.local填入你的Supabase配置和后端地址

# 启动开发服务
npm run dev
```

前端访问 http://localhost:3000

### 4. 数据库初始化
在Supabase SQL编辑器中执行 `backend/app/db/schema_init.sql` 初始化表结构、索引和RLS策略。

## ☁️ 部署

### 前端（Vercel）
1. 在Vercel中导入GitHub仓库
2. Root Directory 选择 `frontend`
3. 配置环境变量：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_AGENT_API_URL`（后端部署完成后填写）
4. 点击Deploy，自动完成部署

### 后端（Render）
1. 在Render中新建Web Service，选择同一个GitHub仓库
2. Root Directory 选择 `backend`
3. Build Command: `pip install -r requirements.txt`
4. Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. 配置所有后端环境变量
6. 点击Deploy，3-5分钟完成部署

## 📁 项目结构
```
atoms-demo/
├── frontend/                 # Next.js前端
│   ├── app/                  # App Router页面
│   │   ├── (auth)/auth/      # 登录注册页
│   │   ├── (dashboard)/      # 受保护路由（工作台、项目页）
│   │   ├── layout.tsx        # 根布局
│   │   ├── page.tsx          # 首页
│   │   └── globals.css       # 全局样式
│   ├── components/           # React组件
│   │   ├── home/             # 首页组件
│   │   ├── project/          # 项目工作区组件
│   │   ├── chat/             # 聊天组件
│   │   ├── preview/          # 代码预览组件
│   │   └── layout/           # 布局组件
│   └── lib/                  # 工具库
│       └── supabase/         # Supabase客户端
├── backend/                  # FastAPI后端
│   ├── app/
│   │   ├── agents/           # LangGraph Agent工作流
│   │   │   ├── nodes.py      # 工作流节点（分析/设计/编码/审查）
│   │   │   ├── workflow.py   # 工作流定义
│   │   │   ├── prompts.py    # Prompt模板
│   │   │   └── state.py      # Agent状态定义
│   │   ├── api/              # API路由
│   │   ├── db/               # 数据库相关
│   │   ├── services/         # 业务服务（任务管理等）
│   │   ├── project_templates/# 项目模板
│   │   ├── config.py         # 配置
│   │   └── main.py           # 入口文件
│   └── requirements.txt      # Python依赖
└── README.md
```

## 🎯 核心架构：双模式预览
为了实现"生成即预览"的0等待体验，系统采用双模式输出架构：
1. **preview.html 单文件预览版**：AI同时生成一个内联所有依赖的单HTML文件，通过Blob URL直接在iframe中渲染，无需构建，秒开预览
2. **完整React项目代码**：标准Next.js项目结构，展示在代码编辑器中，支持查看、下载、二次开发

## 🔄 Agent工作流
```
用户输入需求 → 需求分析（DeepSeek）→ 用户确认功能点 → 模板选择
→ 架构设计（DeepSeek）→ 代码生成（GPT-5.5）→ 代码规则审查 → 完成
```

## 📝 笔试说明
本项目为ROOT AI Native全栈工程师岗位笔试Demo，开发时长约6小时，实现了从自然语言需求到可运行全栈应用的完整闭环。

在线演示：[待部署]
GitHub：https://github.com/mwh1233/atoms-demo

## License
MIT
