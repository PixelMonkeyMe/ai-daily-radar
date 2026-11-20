"""RSI 预筛验收：python .claude/rsi/_acceptance.py"""
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
TRI = os.path.join(HERE, "triage.py")
STATE = os.path.join(HERE, "state.json")
CRIT = os.path.join(HERE, "criteria.json")
SHIM = os.path.join(HERE, "_testbin")
CRLF = chr(13) + chr(10)

R = []


def rec(k, ok, msg):
    R.append((k, ok))
    print(("  PASS " if ok else "  FAIL ") + k + "  " + msg)


def run(args, extra_env=None):
    e = dict(os.environ)
    if extra_env:
        e.update(extra_env)
    return subprocess.run([sys.executable, TRI] + args, cwd=ROOT,
                          capture_output=True, text=True, env=e)


def run_json(args, extra_env=None):
    p = run(args + ["--json"], extra_env)
    try:
        return p.returncode, json.loads(p.stdout)
    except Exception:
        return p.returncode, {"_raw": p.stdout, "_err": p.stderr}


def sha_of(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def make_shim():
    """伪造 gh：让 CI 判定为失败。Windows 不认无扩展名 shebang，故用 .cmd。"""
    os.makedirs(SHIM, exist_ok=True)
    body = ("@echo off" + CRLF +
            'if "%1"=="--version" ( echo gh version 0.0.0-test & exit /b 0 )' + CRLF +
            'echo [{"conclusion":"failure","status":"completed",'
            '"createdAt":"2026-11-20T00:00:00Z","workflowName":"daily"}]' + CRLF +
            "exit /b 0" + CRLF)
    with io.open(os.path.join(SHIM, "gh.cmd"), "w", encoding="utf-8", newline="") as f:
        f.write(body)
    return {"PATH": SHIM + os.pathsep + os.environ.get("PATH", "")}


def main():
    backup_state = None
    if os.path.exists(STATE):
        backup_state = io.open(STATE, encoding="utf-8").read()
    backup_crit = io.open(CRIT, encoding="utf-8").read()
    shim_env = make_shim()

    try:
        y, w, _ = datetime.now(timezone.utc).isocalendar()
        base = {"last_run": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "week": "%d-W%02d" % (y, w),
                "runs_this_week": 0,
                "criteria_sha256": sha_of(CRIT)}
        with io.open(STATE, "w", encoding="utf-8") as f:
            json.dump(base, f)

        print("\n[验收 1] 三类信号")
        _, d = run_json(["--window-days", "0", "--memory-feedback", "0"])
        rec("1a", d["decision"] == "NO-GO", "三信号全无 → " + d["decision"])

        _, d = run_json(["--window-days", "0", "--memory-feedback", "2"])
        m = [s for s in d["signals"] if s["key"] == "memory_feedback"][0]
        rec("1b", d["decision"] == "GO" and m["hit"], "memory 信号命中 → " + d["decision"])

        _, d = run_json(["--window-days", "7", "--memory-feedback", "0"])
        f_ = [s for s in d["signals"] if s["key"] == "fix_commits"][0]
        rec("1c", d["decision"] == "GO" and f_["hit"],
            "fix_commits 命中（%d 个）→ %s" % (len(d["fix_commits"]), d["decision"]))

        _, d = run_json(["--window-days", "0", "--memory-feedback", "0"], shim_env)
        c = [s for s in d["signals"] if s["key"] == "ci_failed"][0]
        rec("1d", d["decision"] == "GO" and c["hit"], "CI 失败命中 → " + d["decision"])

        _, d = run_json(["--window-days", "0", "--memory-feedback", "0"])
        rec("1e", len(d["signals"]) == 3,
            "只有 3 类信号（long_gap 已移除）→ 实际 %d" % len(d["signals"]))

        print("\n[验收 2] 预算闸（双闸）")
        with io.open(STATE, "w", encoding="utf-8") as f:
            json.dump(base, f)
        p1 = run(["--claim"])
        rec("2a", p1.returncode == 0, "第一次占用成功（退出码 %d）" % p1.returncode)
        p2 = run(["--claim"])
        rec("2b", p2.returncode == 3 and "本周额度已用完" in p2.stderr,
            "第二次被拒绝（退出码 %d）" % p2.returncode)
        st = json.load(io.open(STATE, encoding="utf-8"))
        rec("2c", st.get("runs_this_week") == 1,
            "state 记录 runs_this_week=%s" % st.get("runs_this_week"))

        print("\n[验收 5] 物理边界：改评判标准")
        io.open(CRIT, "a", encoding="utf-8").write("\n")
        p3 = run(["--claim"])
        rec("5a", p3.returncode == 4 and "评判标准" in p3.stderr,
            "改标准后 --claim 被拒绝（退出码 %d）" % p3.returncode)
        _, d = run_json([])
        rec("5b", d.get("blocked") is True, "预筛报告标记 blocked=%s" % d.get("blocked"))

    finally:
        io.open(CRIT, "w", encoding="utf-8", newline="\n").write(backup_crit)
        if backup_state is None:
            if os.path.exists(STATE):
                os.remove(STATE)
        else:
            io.open(STATE, "w", encoding="utf-8").write(backup_state)
        shutil.rmtree(SHIM, ignore_errors=True)

    bad = [k for k, ok in R if not ok]
    print("\n结果：%d/%d 通过%s" % (len(R) - len(bad), len(R),
                                  ("，失败：" + ", ".join(bad)) if bad else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
