#!/usr/bin/env python3
"""RSI 预筛 —— 零 LLM、零依赖。

决定"该不该跑一次归因会话"。信号全部来自客观来源：git log、CI 状态、
以及会话内调用 memory_list 得到的 feedback 条数（memory 不在仓库里，脚本读不到）。

用法：
  python .claude/rsi/triage.py                        # 出报告（只读，不占额度）
  python .claude/rsi/triage.py --memory-feedback 3    # 带上会话内查到的纠正条数
  python .claude/rsi/triage.py --claim                # 占用本周额度（失败退出码 3）
  python .claude/rsi/triage.py --finish               # 会话结束，记录最后运行时间
  python .claude/rsi/triage.py --json                 # 机器可读

退出码：0 正常 / 3 本周额度已用完 / 4 评判标准被改动需人工批准
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
STATE_PATH = os.path.join(HERE, "state.json")
CRITERIA_PATH = os.path.join(HERE, "criteria.json")

FIX_MARKERS = ("fix:", "fix(", "revert", "hotfix", "修复", "回滚")


def sh(args, cwd=None):
    try:
        p = subprocess.run(args, cwd=cwd or ROOT, capture_output=True, text=True, timeout=40)
        return p.stdout.strip() if p.returncode == 0 else ""
    except Exception:
        return ""


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def week_key(dt=None):
    dt = dt or datetime.now(timezone.utc)
    y, w, _ = dt.isocalendar()
    return "%d-W%02d" % (y, w)


def recent_commits(days):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    out = sh(["git", "log", "--since=" + since, "--pretty=%H%x09%ad%x09%s", "--date=short"])
    rows = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 3:
            rows.append({"sha": parts[0][:8], "date": parts[1], "subject": "\t".join(parts[2:])})
    return rows


def ci_last_run():
    gh = shutil.which("gh")
    if not gh:
        return {"status": "unknown", "conclusion": "unknown", "reason": "gh CLI 不可用"}
    raw = sh([gh, "run", "list", "--limit", "1",
              "--json", "conclusion,status,createdAt,workflowName"])
    if not raw:
        return {"status": "unknown", "conclusion": "unknown", "reason": "查询失败"}
    try:
        arr = json.loads(raw)
        if not arr:
            return {"status": "unknown", "conclusion": "unknown", "reason": "无运行记录"}
        r = arr[0]
        return {"status": r.get("status"), "conclusion": r.get("conclusion"),
                "workflow": r.get("workflowName"), "createdAt": r.get("createdAt")}
    except Exception:
        return {"status": "unknown", "conclusion": "unknown", "reason": "解析失败"}


def criteria_fingerprint():
    try:
        with open(CRITERIA_PATH, "rb") as f:
            raw = f.read()
        sha = hashlib.sha256(raw).hexdigest()
    except Exception:
        return {"sha256": None, "last_commit": None, "error": "criteria.json 缺失"}
    last = sh(["git", "log", "-1", "--format=%h %ad", "--date=short",
               "--", ".claude/rsi/criteria.json"])
    return {"sha256": sha, "last_commit": last or None}


def compute(args):
    state = load_json(STATE_PATH, {})
    wk = week_key()
    runs_this_week = state.get("runs_this_week", 0) if state.get("week") == wk else 0
    last_run = state.get("last_run")

    commits = recent_commits(args.window_days)
    fix_commits = [c for c in commits
                   if any(m in c["subject"].lower() for m in FIX_MARKERS)]
    ci = ci_last_run()
    crit = criteria_fingerprint()

    days_since = None
    if last_run:
        try:
            days_since = (datetime.now(timezone.utc).date() -
                          datetime.strptime(last_run, "%Y-%m-%d").date()).days
        except Exception:
            days_since = None

    signals = []

    if args.memory_feedback >= 1:
        signals.append({"key": "memory_feedback", "hit": True,
                        "detail": "近 %d 天新增 feedback 记忆 %d 条" % (args.window_days, args.memory_feedback),
                        "evidence": "报告中须粘贴 memory_list 的原始 updatedAt"})
    else:
        signals.append({"key": "memory_feedback", "hit": False,
                        "detail": "近 %d 天无新增 feedback（若确有纠正而此处为 0，说明没入账）" % args.window_days})

    if len(fix_commits) >= 2:
        signals.append({"key": "fix_commits", "hit": True,
                        "detail": "近 %d 天 %d 个修复类提交" % (args.window_days, len(fix_commits)),
                        "evidence": ", ".join("%s %s" % (c["sha"], c["subject"][:40])
                                              for c in fix_commits[:5])})
    else:
        signals.append({"key": "fix_commits", "hit": False,
                        "detail": "近 %d 天修复类提交 %d 个（阈值 2）" % (args.window_days, len(fix_commits))})

    if ci.get("conclusion") == "failure":
        signals.append({"key": "ci_failed", "hit": True,
                        "detail": "最近一次 CI 失败（%s）" % ci.get("workflow"),
                        "evidence": str(ci.get("createdAt"))})
    else:
        signals.append({"key": "ci_failed", "hit": False,
                        "detail": "最近一次 CI 结论：%s" % ci.get("conclusion")})

    decision = "GO" if any(s["hit"] for s in signals) else "NO-GO"

    blocked = False
    block_reason = None
    if (crit.get("sha256") and state.get("criteria_sha256")
            and crit["sha256"] != state["criteria_sha256"]):
        blocked = True
        block_reason = ("评判标准 criteria.json 自上次运行后被修改（%s），需人工批准"
                        % crit.get("last_commit"))

    return {
        "decision": decision,
        "blocked": blocked,
        "block_reason": block_reason,
        "week": wk,
        "runs_this_week": runs_this_week,
        "budget_remaining_this_week": max(0, 1 - runs_this_week),
        "last_run": last_run,
        "days_since_last_run": days_since,
        "signals": signals,
        "ci": ci,
        "criteria": crit,
        "fix_commits": fix_commits,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def render(rep):
    lines = []
    lines.append("RSI 预筛 · %s" % rep["generated_at"][:19].replace("T", " "))
    lines.append("=" * 46)
    lines.append("结论：%s   本周剩余额度：%d 次"
                 % (rep["decision"], rep["budget_remaining_this_week"]))
    if rep["blocked"]:
        lines.append("!! 阻断：%s" % rep["block_reason"])
    lines.append("")
    lines.append("信号：")
    for s in rep["signals"]:
        lines.append("  [%s] %-16s %s" % ("命中" if s["hit"] else "  -", s["key"], s["detail"]))
        if s.get("evidence"):
            lines.append("      证据：%s" % s["evidence"])
    lines.append("")
    gap = rep.get("days_since_last_run")
    lines.append("距上次复盘：%s（仅作上下文，不参与判定）"
                 % (("%d 天" % gap) if gap is not None else "从未运行"))
    lines.append("评判标准指纹：%s" % (rep["criteria"].get("sha256") or "缺失")[:16])
    lines.append("标准最后改动：%s" % (rep["criteria"].get("last_commit") or "无记录"))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--window-days", type=int, default=7,
                    help="统计修复类提交的时间窗口，默认 7 天")
    ap.add_argument("--memory-feedback", type=int, default=0,
                    help="近 N 天新增 feedback 型 memory 条数（会话内调 memory_list 得到）")
    ap.add_argument("--claim", action="store_true", help="占用本周额度")
    ap.add_argument("--finish", action="store_true", help="记录会话结束")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if args.finish:
        state = load_json(STATE_PATH, {})
        state["last_run"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        state["criteria_sha256"] = criteria_fingerprint().get("sha256")
        save_json(STATE_PATH, state)
        print("已记录本次复盘结束：%s" % state["last_run"])
        return 0

    rep = compute(args)

    if args.claim:
        if rep["blocked"]:
            print(rep["block_reason"], file=sys.stderr)
            return 4
        if rep["budget_remaining_this_week"] <= 0:
            print("本周额度已用完（每周上限 1 次）。下周再跑，或用不带 --claim 的方式只读查看。",
                  file=sys.stderr)
            return 3
        state = load_json(STATE_PATH, {})
        state["week"] = rep["week"]
        state["runs_this_week"] = rep["runs_this_week"] + 1
        state.setdefault("criteria_sha256", rep["criteria"].get("sha256"))
        save_json(STATE_PATH, state)
        print("已占用本周额度（%s，剩余 0 次）" % rep["week"])

    if args.json:
        print(json.dumps(rep, ensure_ascii=False, indent=2))
    else:
        print(render(rep))
    return 0


if __name__ == "__main__":
    sys.exit(main())
