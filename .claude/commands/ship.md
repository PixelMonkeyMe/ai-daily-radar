进入 Ship（部署上线）模式。

用户输入: $ARGUMENTS

## 前置检查
1. 确认 QA 测试报告全部通过（如未做过 QA，**停止并提醒用户**）
2. 确认 `bash scripts/test.sh` 全部通过
3. 确认 git status 干净（无未提交的变更）

## 执行步骤
1. 记录当前 commit hash（用于回滚）
2. `git push origin main`
3. 等待 GitHub Actions 部署完成：
   ```
   curl -s "https://api.github.com/repos/PixelMonkeyMe/ai-daily-radar/actions/runs?per_page=1"
   ```
   等待 status=completed 且 conclusion=success
4. **线上冒烟测试**：
   - curl 线上 fav.js → node 语法校验
   - curl 线上 index.html → 检查关键 HTML 元素
   - 通过 Supabase API 验证核心数据读写
   - 如 Playwright MCP 可用：打开线上页面做交互验证
5. **输出上线报告**：
   ```
   ## 上线报告
   - 部署版本：commit hash
   - 部署状态：✅ 成功 / ❌ 失败
   - JS 语法：✅ / ❌
   - 关键元素：✅ / ❌
   - 冒烟测试：✅ / ❌
   - 回滚版本：commit hash（如需回滚用）
   - 用户最终验收：等待中
   ```
6. **等待用户最终验收确认**

## 回滚方案
如果上线后发现严重问题：
1. 用户反馈问题后，立即评估严重程度
2. **严重（整站崩溃/数据丢失）**：
   - `git revert HEAD` 回退到上一个版本
   - `git push origin main` 紧急部署
   - 通知用户
3. **非严重（功能异常但可用）**：
   - 进入 Fix 模式修复
   - 走正常流程
4. **数据库变更回滚**：
   - 如果涉及表结构变更，给出回滚 SQL
   - 用户在 Supabase SQL Editor 执行

## 注意
- GitHub Pages CDN 缓存 10 分钟，冒烟测试用 curl 直接请求源文件
- 如果部署失败，立即通知用户并分析原因
- 回滚后必须执行完整 QA 再重新上线
