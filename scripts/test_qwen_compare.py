#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Phase 0: Qwen vs Kimi comparison"""
import json, os, sys, time, re
import requests

BASE = os.path.join(os.path.dirname(__file__), "..")
RAW = os.path.join(BASE, "data", "raw.json")

KIMI_URL = "https://api.moonshot.cn/v1/chat/completions"
KIMI_KEY = os.environ.get("MOONSHOT_API_KEY", "")
KIMI_MODEL = os.environ.get("KIMI_MODEL", "kimi-k2.6")

QWEN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
QWEN_KEY = os.environ.get("QWEN_API_KEY", "")
QWEN_MODEL = "qwen-plus"

PROMPT = """你是一位资深的 AI 与开源技术分析师，服务对象是一位【完全不懂编程】的用户。
【用户背景】行业：中国智慧交通（含智慧高速）、智慧消防。身份：业务/管理人员，非技术人员。
【任务】对输入的资讯输出 JSON 数组，每个元素含字段：title, url, source, brief(<=40字), what(1-2句), industry_use(1-2句), capability(1-2句), assessment(1-2句), risk(1-2句), importance(1-5整数)。
【要求】只输出 JSON 数组，不要 markdown 代码块，简体中文，中立。"""

def call(api_url, api_key, model, items):
    payload = {"model": model, "messages": [{"role":"system","content":PROMPT},{"role":"user","content":"解读以下资讯：\n"+json.dumps(items,ensure_ascii=False)}]}
    if "moonshot" in api_url:
        payload["thinking"] = {"type": "disabled"}
    for attempt in range(3):
        try:
            r = requests.post(api_url, headers={"Authorization":f"Bearer {api_key}","Content-Type":"application/json"}, json=payload, timeout=120)
            if r.status_code == 200:
                d = r.json()
                return d["choices"][0]["message"]["content"], d.get("usage",{}), r.elapsed.total_seconds()
            if r.status_code != 429: break
            time.sleep(5)
        except: time.sleep(2)
    return None, None, 0

def parse_json(text):
    if not text: return None
    t = text.strip()
    if t.startswith("```"):
        lines = t.split("\n")
        if lines[0].startswith("```"): lines = lines[1:]
        if lines[-1].strip() == "```": lines = lines[:-1]
        t = "\n".join(lines)
    try: return json.loads(t)
    except:
        m = re.search(r'\[[\s\S]*\]', t)
        if m:
            try: return json.loads(m.group())
            except: pass
    return None

with open(RAW,"r",encoding="utf-8") as f:
    raw = json.load(f)
items = raw.get("items",[])
print(f"Loaded {len(items)} items, testing first 5")
test = items[:5]

print("\n=== Kimi ===")
kc, ku, ke = call(KIMI_URL, KIMI_KEY, KIMI_MODEL, test)
kp = parse_json(kc)
print(f"  OK={kp is not None}, time={ke:.1f}s, usage={ku}")
if kp: print(f"  Items={len(kp)}")
else: print(f"  RAW[:300]: {kc[:300] if kc else 'NONE'}")

print("\n=== Qwen ===")
qc, qu, qe = call(QWEN_URL, QWEN_KEY, QWEN_MODEL, test)
qp = parse_json(qc)
print(f"  OK={qp is not None}, time={qe:.1f}s, usage={qu}")
if qp: print(f"  Items={len(qp)}")
else: print(f"  RAW[:300]: {qc[:300] if qc else 'NONE'}")

if kp and qp:
    print("\n=== Compare ===")
    deltas = []
    for i,(k,q) in enumerate(zip(kp,qp)):
        ki,qi = k.get("importance",0), q.get("importance",0)
        if ki != qi: deltas.append({"t":k.get("title","")[:30],"k":ki,"q":qi})
    print(f"Importance differs: {len(deltas)}/{len(kp)}")
    for d in deltas: print(f"  {d['t']}: K={d['k']} Q={d['q']}")
    
    # Check field completeness
    km = sum(1 for k in kp if not k.get("industry_use"))
    qm = sum(1 for q in qp if not q.get("industry_use"))
    print(f"Missing industry_use: Kimi={km}, Qwen={qm}")
else:
    print("\n=== SKIP (parse failed) ===")
