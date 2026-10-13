进入 Ship（部署上线）模式。

用户输入: $ARGUMENTS

## 前置检查
1. 确认 QA 测试报告全部通过（如未做过 QA，先提醒用户）
2. 确认 `bash scripts/test.sh` 全部通过
3. 确认 git status 干净（无未提交的变更）

## 执行步骤
1. `git push origin main`
2. 等待 GitHub Actions 部署完成（轮询 API 检查 status）：
   ```
   curl -s "https://api.github.com/repos/PixelMonkeyMe/ai-daily-radar/actions/runs?per_page=1"
   ```
   等待 status=completed 且 conclusion=success
3. **线上冒烟测试**：
   - `curl 线上 fav.js | node 语法校验`
   - `curl 线上 index.html | grep 关键元素`
   - 核心交互验证（根据本次改动内容确定验证项）
4. **输出上线报告**：
   ```
   ## 上线报告
   - 部署状态：✅ 成功
   - JS 语法：✅ 通过
   - 关键元素：✅ 存在
   - 冒烟测试：✅ 通过
   - 用户最终验收：等待中
   ```
5. **等待用户最终验收确认**

## 注意
- GitHub Pages CDN 缓存 10 分钟，冒烟测试用 curl 直接请求源文件
- 如果部署失败，立即通知用户并分析原因
