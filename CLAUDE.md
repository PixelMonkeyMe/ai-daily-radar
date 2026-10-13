# AI 日报雷达 — 项目规范

## 项目简介
自动抓取 AI 领域信息源（GitHub Trending、HuggingFace、Product Hunt、知乎、V2EX），生成日报，支持邮箱登录收藏、AI 时段分析。

## 技术架构
```
GitHub Pages (静态托管)
├── HTML 页面 (Python 模板生成)
├── docs/fav.js (前端逻辑 · 唯一数据源)
└── docs/export_pdf.js

GitHub Actions (CI/CD · 每天 UTC 01:00 触发)
├── fetch_sources.py → 抓取信息源
├── summarize.py → Kimi 生成解读
├── build_site.py → 生成网页 + 同步 Supabase
└── send_email.py → 邮件推送

Supabase (后端)
├── PostgreSQL: items / favorites / analysis_cache
├── Auth: 邮箱 OTP 登录
└── Edge Functions: analyze-range (Deno/TS)
```

## 核心约束
- **单一数据源**：前端 JS 只维护 `docs/fav.js`，`build_site.py` 不再内嵌
- **每次修改 JS 后**必须运行 `node -e "new Function(require('fs').readFileSync('docs/fav.js','utf8'))"` 校验语法
- **每次修改后**必须运行 `python scripts/build_site.py` 确认构建通过
- **每次推送前**必须运行 `bash scripts/test.sh` 全部通过
- **FAV_JS 已删除**：不要往 build_site.py 中重新添加内嵌 JS 代码

## 编码规范
- Python：UTF-8，中文注释
- JavaScript：ES5 兼容（不用 let/const/箭头函数），IIFE 封装
- JS 中处理换行用 `.split('\n').join()` 而非 `.replace(/\n/g)` （避免 Python 写入时变成实际换行）
- Supabase Edge Function：TypeScript，Deno 运行时
- Git 提交信息：中文，格式 `fix:/feat:/chore: + 简述`

## 环境信息
- Supabase URL: `https://bvhzexdluniqdwmsxaxw.supabase.co`
- Supabase Anon Key: `sb_publishable_ZkAEga1YBOmfUrFba7yFYQ_5gt4kkMj`
- Kimi API 模型：`kimi-k2.6`，temperature 必须为 `1`
- Supabase secrets 名称必须小写（如 `kimi_api_key`）
- GitHub Pages 部署后 CDN 缓存 10 分钟，测试时注意强制刷新

## 已知坑点（踩过的不能再踩）
1. Python raw string `r"""..."""` 中 `\n` 是实际换行符，不是 JS 转义字符 → 用 `.split().join()` 替代
2. Supabase Edge Function secret 名只能小写
3. kimi-k2.6 只支持 temperature=1，其他值会 400
4. GitHub Actions 部署后需等 1-2 分钟才生效
5. fav-btn 点击必须先检查登录状态，再检查收藏状态（否则旧缓存导致逻辑错误）
6. 未登录时所有收藏按钮一律显示 ☆，不读 localStorage 缓存

---

## Workflow 定义

### 角色
| 角色 | 职责 | 命令文件 |
|------|------|---------|
| PM | 调研→目标分析→方案讨论→原型设计→PRD 输出 | .claude/commands/pm.md |
| Dev | 技术设计→编码→自测→QA 交接 | .claude/commands/dev.md |
| QA | 代码审查→浏览器测试→数据流验证→回归→测试报告 | .claude/commands/qa.md |
| Ship | 前置检查→部署→冒烟→回滚预案 | .claude/commands/ship.md |
| Fix | 定位→确认→修复→验证→**事件驱动复盘** | .claude/commands/fix.md |

> Reviewer 职责已合并至 QA（代码审查步骤）

### 智能路由规则
Claude 根据用户消息自动判断当前阶段，无需手动输入命令：

| 用户意图信号 | 自动进入 |
|-------------|---------|
| 提出新想法/新需求/功能请求 | → PM 模式 |
| 质疑/讨论/优化方案 | → PM 模式 |
| 确认 PRD / 同意方案 / "动手吧" | → Dev 模式 |
| 报告问题 / bug / 报错 | → Fix 模式 |
| 要求检查 / 验证 / 测试 | → QA 模式 |
| 要求推送 / 上线 / 部署 | → Ship 模式 |

### 需求分级
| 级别 | 定义 | 走哪些阶段 | 示例 |
|------|------|-----------|------|
| S | 新功能/架构变更 | 完整 ①→②→③→④ | 新增评论系统 |
| A | 现有功能改进 | ①→③→④（简化 PRD） | 收藏需登录 |
| B | Bug 修复 | ③→④ | JS 语法错误 |
| C | 配置/文案 | 直接改→验证 | 改 cron 时间 |

### 阶段详细流程

#### ① PM 模式（需求共创）
1. **调研（不可跳过）**：读现有代码 + 查 docs/changes/ + 查已知坑点
2. 理解用户核心目标（Why，不只是 What）
3. 主动分析是否有更优方案，与用户讨论；检查与现有功能的冲突
4. 输出 PRD（含现有功能分析、原型、验收标准）
5. QA 视角评审 PRD
6. **等待用户确认后才进入开发**

#### ② Dev 模式（技术设计 + 编码）
1. 技术方案：修改哪些文件/函数，是否改数据库
2. 编码实现
3. 运行 `bash scripts/test.sh` 全部通过
4. 提交代码（暂不推送）
5. **输出 QA 交接清单**：改了什么、数据库变更、重点测试路径、已知风险

#### ③ QA 模式（质量验收）
1. 运行 `bash scripts/test.sh` 全部通过（前置条件）
2. **代码逻辑审查**（原 Reviewer 职责）：覆盖度、边界、安全、冲突
3. **浏览器测试**（Playwright MCP，不可跳过）：
   - 通用核心路径：未登录→收藏→弹登录、登录→收藏→收藏夹可见、跨页面持久化
   - 本次改动相关路径：由 Dev 交接清单指定
   - MCP 不可用时降级为：API 测试 + 代码追踪 + 标注"建议用户手动验证"
4. **数据流验证**（涉及数据库改动时）：写入/读回/降级/兼容
5. 回归测试
6. 输出测试报告
7. **全部通过后才允许推送**
8. **禁止仅凭自动化脚本通过就判定测试通过**

#### ④ Ship 模式（部署上线）
1. git push
2. 等待 GitHub Actions 部署完成
3. 线上冒烟测试：
   - curl 线上 JS → node 语法校验
   - 关键 HTML 元素检查
   - 核心交互验证
4. **用户最终验收**

#### Fix 模式（Bug 快速修复）
1. 定位问题根因
2. 分析给用户确认
3. 修复 + test.sh 通过
4. 推送 + 线上验证
5. **事件驱动复盘**：这个 bug 是 workflow 哪个环节漏掉的？修正 workflow 文件或更新已知坑点

### 确认节点（硬性要求）
- **PRD 输出后**：必须用户确认才进入开发
- **Bug 分析后**：必须用户确认才修改
- **最终验收**：必须用户确认才算完成
- 中间环节（技术设计、QA 报告）展示给用户，用户无异议则自动推进
