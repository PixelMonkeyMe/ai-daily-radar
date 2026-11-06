#!/bin/bash
# AI 日报雷达 — 自动化测试脚本（动态 CI/CD 版本）
# 每次提交前必须运行，全部通过才允许推送

set -e
PASS=0
FAIL=0
SKIP=0

# 兼容 Windows (MSYS/Git Bash) 和 Linux/Mac
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_NODE="$ROOT"
if command -v cygpath &>/dev/null; then
  ROOT_NODE="$(cygpath -m "$ROOT")"
fi
cd "$ROOT"

pass() { PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
skip() { SKIP=$((SKIP+1)); echo "  ⏭️  $1"; }

echo "═══════════════════════════════════════"
echo "  AI 日报雷达 · 自动化测试"
echo "═══════════════════════════════════════"

# ── 检测变更类型（动态测试） ──
echo ""
echo "▸ 检测变更范围"
if [ -n "$CI" ]; then
  TEST_MODE="${TEST_MODE:-full}"
else
  if git diff --quiet HEAD 2>/dev/null; then
    CHANGED_FILES=""
  else
    CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null || echo "")
  fi
  
  if [ -z "$CHANGED_FILES" ]; then
    TEST_MODE="full"
    echo "  无未提交变更，运行完整测试"
  else
    JS_CHANGED=$(echo "$CHANGED_FILES" | grep -E '\.(js|ts)$' || true)
    PYTHON_CHANGED=$(echo "$CHANGED_FILES" | grep -E '\.py$' || true)
    
    if [ -n "$JS_CHANGED" ] && [ -n "$PYTHON_CHANGED" ]; then
      TEST_MODE="full"
      echo "  JS + Python 变更，运行完整测试"
    elif [ -n "$JS_CHANGED" ]; then
      TEST_MODE="js"
      echo "  JS 变更，运行 JS 测试"
    elif [ -n "$PYTHON_CHANGED" ]; then
      TEST_MODE="python"
      echo "  Python 变更，运行 Python 测试"
    else
      TEST_MODE="full"
      echo "  其他变更，运行完整测试"
    fi
  fi
fi
echo "  测试模式：$TEST_MODE"

# ── 1. JS 语法校验 ──
echo ""
echo "▸ JS 语法校验"
if [ "$TEST_MODE" = "full" ] || [ "$TEST_MODE" = "js" ]; then
  for f in fav-core.js fav-page.js fav-index.js back-to-top.js; do
    if [ -f "$ROOT/docs/$f" ]; then
      if node -e "new Function(require('fs').readFileSync('$ROOT_NODE/docs/$f','utf8'))" 2>/dev/null; then
        pass "docs/$f 语法正确"
      else
        fail "docs/$f 语法错误"
      fi
    else
      fail "docs/$f 不存在"
    fi
  done

  if [ -f "$ROOT/docs/export_pdf.js" ]; then
    if node -e "new Function(require('fs').readFileSync('$ROOT_NODE/docs/export_pdf.js','utf8'))" 2>/dev/null; then
      pass "docs/export_pdf.js 语法正确"
    else
      fail "docs/export_pdf.js 语法错误"
    fi
  fi
else
  skip "JS 语法校验（非 JS 变更）"
fi

# ─ 2. JS 函数名一致性检查 ─
echo ""
echo "▸ JS 函数名一致性检查"
if [ "$TEST_MODE" = "full" ] || [ "$TEST_MODE" = "js" ]; then
  if [ -f "$ROOT/docs/fav-core.js" ]; then
    check_result=$(python "$ROOT/scripts/check_js_consistency.py" "$ROOT/docs/fav-core.js" 2>/dev/null)
    if [ "$check_result" = "OK" ]; then
      pass "docs/fav-core.js 函数名一致"
    else
      IFS='|' read -ra errs <<< "$check_result"
      for e in "${errs[@]}"; do
        fail "docs/fav-core.js: $e"
      done
    fi
  fi
else
  skip "JS 函数名一致性检查（非 JS 变更）"
fi

# ── 3. Python 语法校验 ──
echo ""
echo "▸ Python 语法校验"
if [ "$TEST_MODE" = "full" ] || [ "$TEST_MODE" = "python" ]; then
  for f in "$ROOT/scripts/"*.py; do
    name=$(basename "$f")
    if python -m py_compile "$f" 2>/dev/null; then
      pass "scripts/$name 语法正确"
    else
      fail "scripts/$name 语法错误"
    fi
  done
else
  skip "Python 语法校验（非 Python 变更）"
fi

# ── 4. 构建测试 ─
echo ""
echo "▸ 构建测试"
if python scripts/build_site.py >/dev/null 2>&1; then
  pass "build_site.py 构建成功"
else
  fail "build_site.py 构建失败"
fi

# ── 5. HTML 结构检查 ──
echo ""
echo "▸ HTML 结构检查"
if [ -f "$ROOT/docs/index.html" ]; then
  count=$(grep -c "adr-login-modal" "$ROOT/docs/index.html" 2>/dev/null || echo 0)
  if [ "$count" -ge 1 ]; then
    pass "index.html 包含登录弹窗"
  else
    fail "index.html 缺少登录弹窗"
  fi

  if grep -q "supabase-js" "$ROOT/docs/index.html" 2>/dev/null; then
    pass "index.html 加载 supabase-js"
  else
    fail "index.html 缺少 supabase-js"
  fi

  if grep -q "fav-core.js" "$ROOT/docs/index.html" 2>/dev/null; then
    pass "index.html 引用 fav-core.js"
  else
    fail "index.html 缺少 fav-core.js 引用"
  fi
  # 单元测试（node:test，纯逻辑）
  if command -v node >/dev/null 2>&1; then
    if node --test "$ROOT/scripts/test/fav-core.test.js" >/dev/null 2>&1; then
      pass "fav-core 单元测试通过"
    else
      fail "fav-core 单元测试失败"
    fi
  else
    skip "单元测试（node 不可用）"
  fi
else
  fail "docs/index.html 不存在"
fi

# ─ 6. FAV_JS 双写检查 ──
echo ""
echo "▸ 双写检查"
if grep -q "FAV_JS" "$ROOT/scripts/build_site.py" 2>/dev/null; then
  fail "build_site.py 中仍存在 FAV_JS 常量（应已删除）"
else
  pass "build_site.py 无 FAV_JS 双写"
fi

# ─ 6.5 历史片段完整性检查（懒加载产物） ──
echo ""
echo "▸ 期次片段与日期索引检查"
# PRD v2.2：不再有 hist-day 壳，改为校验"内联日期索引 ↔ 片段文件"一致性
IDX_JSON=$(grep -o 'window.__ADR_ISSUES=\[[^]]*\]' "$ROOT/docs/index.html" 2>/dev/null | head -1 | sed 's/^window.__ADR_ISSUES=//')
if [ -n "$IDX_JSON" ]; then
  pass "index.html 内联期次索引存在"
  IDX_DATES=$(echo "$IDX_JSON" | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}')
  IDX_COUNT=$(echo "$IDX_DATES" | wc -l | tr -d ' ')
  UNIQ_COUNT=$(echo "$IDX_DATES" | sort -u | wc -l | tr -d ' ')
  if [ "$IDX_COUNT" -eq "$UNIQ_COUNT" ]; then
    pass "期次索引无重复日期（$IDX_COUNT 期）"
  else
    fail "期次索引存在重复日期（$IDX_COUNT 条 / $UNIQ_COUNT 唯一）"
  fi
  FRAG_COUNT=$(ls "$ROOT/docs/history/"*.html 2>/dev/null | wc -l | tr -d ' ')
  if [ "$IDX_COUNT" -eq "$FRAG_COUNT" ]; then
    pass "索引期次数与片段文件数一致（$IDX_COUNT）"
  else
    fail "索引期次数与片段文件数不一致（索引 $IDX_COUNT / 片段 $FRAG_COUNT）"
  fi
  MISSING=0
  for d in $IDX_DATES; do
    [ -f "$ROOT/docs/history/$d.html" ] || MISSING=$((MISSING+1))
  done
  if [ "$MISSING" -eq 0 ]; then
    pass "每个索引期次均有片段文件"
  else
    fail "有 $MISSING 个索引期次缺少片段文件"
  fi
  LATEST_IN_IDX=$(grep -o 'window.__ADR_LATEST="[0-9-]*"' "$ROOT/docs/index.html" | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}')
  if [ -n "$LATEST_IN_IDX" ] && [ -f "$ROOT/docs/history/$LATEST_IN_IDX.html" ]; then
    pass "最新期片段存在（往返切换无缺口，评审 T1）"
  else
    fail "最新期 $LATEST_IN_IDX 缺少片段文件（会导致往返内容缺失）"
  fi
  SAMPLE=$(echo "$IDX_DATES" | head -1)
  if grep -q 'class="item-line"' "$ROOT/docs/history/$SAMPLE.html" 2>/dev/null; then
    pass "片段内容抽查（item-line 存在）"
  else
    fail "片段内容异常（缺少 item-line）"
  fi
  RESIDUAL=$(grep -o 'details class="hist-day"' "$ROOT/docs/index.html" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$RESIDUAL" -eq 0 ]; then
    pass "无残留 hist-day 旧壳"
  else
    fail "发现 $RESIDUAL 个残留 hist-day 旧壳"
  fi
else
  fail "index.html 缺少内联期次索引 window.__ADR_ISSUES"
fi

# ─ 7. 性能检查（大规模变更时运行） ──
echo ""
echo " 性能检查"
if [ "$TEST_MODE" = "full" ]; then
  LARGE_FILES=$(find docs -name "*.html" -size +1M 2>/dev/null | wc -l)
  if [ "$LARGE_FILES" -gt 0 ]; then
    fail "发现 $LARGE_FILES 个超过 1MB 的 HTML 文件"
  else
    pass "HTML 文件大小正常"
  fi
else
  skip "性能检查（非完整测试）"
fi

# ── 结果汇总 ──
echo ""
echo "═══════════════════════════════════════"
TOTAL=$((PASS+FAIL+SKIP))
echo "  结果: $PASS 通过, $FAIL 失败, $SKIP 跳过 (共 $TOTAL 项)"
if [ "$FAIL" -eq 0 ]; then
  echo "  🎉 全部通过，可以推送"
else
  echo "  ⚠️  有 $FAIL 项未通过，请修复后再推送"
fi
echo "═══════════════════════════════════════"

exit $FAIL
