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
| 角色 | 职责 | 由谁担任 |
|------|------|---------|
| PM | 目标分析、方案讨论、原型设计、PRD 输出 | Claude（自动进入） |
| Dev | 技术设计、编码、自测、部署 | Claude（自动进入） |
| QA | PRD 评审、测试用例设计、验收、回归分析 | Claude（自动进入） |
| Reviewer | 独立视角代码审查 | Claude（自动进入） |

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
1. 理解用户核心目标（Why，不只是 What）
2. 主动分析是否有更优方案，与用户讨论
3. 输出 PRD，必须包含：
   - 背景与目标
   - 备选方案对比（如有）
   - 功能要求（编号列表）
   - 🖼 原型设计（文本线框图 + 交互流程）
   - 边界条件 & 异常场景
   - 验收标准（可测试的 checklist）
   - 影响范围（文件列表）
   - 需求分级（S/A/B/C）
4. QA 视角评审 PRD：验收标准是否完整？边界条件是否遗漏？
5. **等待用户确认后才进入开发**

#### ② Dev 模式（技术设计 + 编码）
1. 技术方案：修改哪些文件/函数，是否改数据库
2. 编码实现
3. 运行 `bash scripts/test.sh` 全部通过
4. 提交代码（暂不推送）

#### ③ QA 模式（质量验收）
1. 运行 `bash scripts/test.sh` 全部通过（前置条件）
2. 逐项对照 PRD 验收标准验证（必须写明验证方式，不允许直接打勾）
3. **手动流程测试（不可跳过）**：
   - 通用核心路径：未登录→收藏→弹登录、登录→收藏→收藏夹可见、跨页面持久化、退出重登数据仍在
   - 本次改动相关路径：由 Dev 交接时列出
4. **数据流验证**（涉及数据库改动时）：写入成功？读回正确？降级机制？新旧兼容？
5. 回归测试：现有功能是否受影响
6. 输出测试报告（通过/未通过 + 问题列表）
7. **全部通过后才允许推送**
8. **禁止仅凭自动化脚本通过就判定测试通过**
9. **禁止未经手动流程测试就标记验收标准为通过**

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

### 确认节点（硬性要求）
- **PRD 输出后**：必须用户确认才进入开发
- **Bug 分析后**：必须用户确认才修改
- **最终验收**：必须用户确认才算完成
- 中间环节（技术设计、QA 报告）展示给用户，用户无异议则自动推进
