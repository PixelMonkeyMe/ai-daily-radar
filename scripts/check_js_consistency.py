#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""检查 JS 文件中函数定义与调用之间的大小写一致性。
捕捉类似 updateAuthUi() 定义但 updateAuthUI() 调用的 bug。
输出: "OK" 表示无问题，否则输出 "|".join(errors)
"""
import re, sys, glob, os

def check(js_file):
    text = open(js_file, encoding='utf-8').read()
    errors = []

    # 1. 找所有内部 function xxx() 定义
    defs = set(re.findall(r'\bfunction\s+([A-Za-z_]\w*)\s*\(', text))

    # 2. 对每个定义，搜索大小写不同但忽略大小写相同的标识符
    for func in sorted(defs):
        # 搜索所有以相同字母开头的标识符
        pattern = re.compile(r'\b' + re.escape(func[0]) + r'[A-Za-z0-9_]*\b')
        for match in set(pattern.findall(text)):
            if match.lower() == func.lower() and match != func:
                errors.append(
                    f"function '{func}' called as '{match}' (case mismatch)"
                )

    # 3. 找所有 window.xxx = function 定义，检查 HTML/其他 JS 中是否有引用
    window_funcs = set(re.findall(r'window\.([A-Za-z_]\w*)\s*=', text))
    html_dir = os.path.dirname(js_file)
    root_dir = os.path.dirname(html_dir)
    # 搜索范围：同目录 HTML + 同目录其他 JS + scripts/ 目录 JS
    # （构建前 docs/export_pdf.js 可能是旧版本，需要同时检查 scripts/export_pdf.js）
    search_text = ""
    for hf in glob.glob(os.path.join(html_dir, "*.html")):
        search_text += open(hf, encoding='utf-8').read()
    for jf in glob.glob(os.path.join(html_dir, "*.js")):
        if os.path.basename(jf) != os.path.basename(js_file):
            search_text += open(jf, encoding='utf-8').read()
    # 也搜索 scripts/ 目录（源码位置，构建前可能更新）
    scripts_dir = os.path.join(root_dir, "scripts")
    if os.path.isdir(scripts_dir):
        for jf in glob.glob(os.path.join(scripts_dir, "*.js")):
            search_text += open(jf, encoding='utf-8').read()
    for func in sorted(window_funcs):
        if func not in search_text:
            # 也在 JS 内搜索（排除定义行本身）
            js_no_def = re.sub(r'window\.' + func + r'\s*=', '', text)
            if func not in js_no_def:
                errors.append(f"window.{func} defined but never referenced")

    return errors


if __name__ == "__main__":
    errors = check(sys.argv[1])
    if errors:
        print("|".join(errors))
    else:
        print("OK")
