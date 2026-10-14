#!/bin/bash
# AI 日报雷达 — 自动化测试脚本
# 每次提交前必须运行，全部通过才允许推送

set -e
PASS=0
FAIL=0

# 兼容 Windows (MSYS/Git Bash) 和 Linux/Mac
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# 为 Node.js 转换路径（Windows 用正斜杠格式，Linux 直接用）
if command -v cygpath &>/dev/null; then
  ROOT_NODE="$(cygpath -m "$ROOT")"
else
  ROOT_NODE="$ROOT"
fi
cd "$ROOT"

pass() { PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

echo "═══════════════════════════════════════"
echo "  AI 日报雷达 · 自动化测试"
echo "═══════════════════════════════════════"

# ── 1. JS 语法校验 ──
echo ""
echo "▸ JS 语法校验"
if [ -f "$ROOT/docs/fav.js" ]; then
  if node -e "new Function(require('fs').readFileSync('$ROOT_NODE/docs/fav.js','utf8'))" 2>/dev/null; then
    pass "docs/fav.js 语法正确"
  else
    fail "docs/fav.js 语法错误"
  fi
else
  fail "docs/fav.js 不存在"
fi

if [ -f "$ROOT/docs/export_pdf.js" ]; then
  if node -e "new Function(require('fs').readFileSync('$ROOT_NODE/docs/export_pdf.js','utf8'))" 2>/dev/null; then
    pass "docs/export_pdf.js 语法正确"
  else
    fail "docs/export_pdf.js 语法错误"
  fi
fi

# ── 2. JS 函数名一致性检查 ──
echo ""
echo "▸ JS 函数名一致性检查"
if [ -f "$ROOT/docs/fav.js" ]; then
  check_result=$(python "$ROOT/scripts/check_js_consistency.py" "$ROOT/docs/fav.js" 2>/dev/null)
  if [ "$check_result" = "OK" ]; then
    pass "docs/fav.js 函数名一致"
  else
    IFS='|' read -ra errs <<< "$check_result"
    for e in "${errs[@]}"; do
      fail "docs/fav.js: $e"
    done
  fi
fi

# ── 3. Python 语法校验 ──
echo ""
echo "▸ Python 语法校验"
for f in "$ROOT/scripts/"*.py; do
  name=$(basename "$f")
  if python -m py_compile "$f" 2>/dev/null; then
    pass "scripts/$name 语法正确"
  else
    fail "scripts/$name 语法错误"
  fi
done

# ── 3. 构建测试 ──
echo ""
echo "▸ 构建测试"
if python scripts/build_site.py >/dev/null 2>&1; then
  pass "build_site.py 构建成功"
else
  fail "build_site.py 构建失败"
fi

# ── 4. HTML 结构检查 ──
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

  if grep -q "fav.js" "$ROOT/docs/index.html" 2>/dev/null; then
    pass "index.html 引用 fav.js"
  else
    fail "index.html 缺少 fav.js 引用"
  fi
else
  fail "docs/index.html 不存在"
fi

# ── 5. FAV_JS 双写检查 ──
echo ""
echo "▸ 双写检查"
if grep -q "FAV_JS" "$ROOT/scripts/build_site.py" 2>/dev/null; then
  fail "build_site.py 中仍存在 FAV_JS 常量（应已删除）"
else
  pass "build_site.py 无 FAV_JS 双写"
fi

# ── 结果汇总 ──
echo ""
echo "═══════════════════════════════════════"
TOTAL=$((PASS+FAIL))
echo "  结果: $PASS/$TOTAL 通过"
if [ "$FAIL" -eq 0 ]; then
  echo "  🎉 全部通过，可以推送"
else
  echo "  ⚠️  有 $FAIL 项未通过，请修复后再推送"
fi
echo "═══════════════════════════════════════"

exit $FAIL
