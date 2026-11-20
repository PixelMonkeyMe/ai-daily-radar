import io, json, os, shutil, subprocess, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
TRI = os.path.join(HERE, "triage.py")
STATE = os.path.join(HERE, "state.json")
CRIT = os.path.join(HERE, "criteria.json")
SHIM = os.path.join(HERE, "_testbin")

R = []
def rec(k, ok, msg):
    R.append((k, ok))
    print(("  PASS " if ok else "  FAIL ") + k + "  " + msg)

def run(args, env=None, crit=None):
    e = dict(os.environ)
    if env: e.update(env)
    p = subprocess.run([sys.executable, TRI] + args, cwd=ROOT, capture_output=True, text=True, env=e)
    return p

def run_json(args, env=None):
    p = run(args + ["--json"], env)
    try:
        return p.returncode, json.loads(p.stdout)
    except Exception:
        return p.returncode, {"_raw": p.stdout, "_err": p.stderr}

def sha_of(path):
    import hashlib
    with open(path, "rb") as f: return hashlib.sha256(f.read()).hexdigest()

backup_state = None
if os.path.exists(STATE):
    backup_state = io.open(STATE, encoding="utf-8").read()
backup_crit = io.open(CRIT, encoding="utf-8").read()

try:
    # 基线状态：今天跑过、本周未占额度、标准指纹一致
    y, w, _ = datetime.now(timezone.utc).isocalendar()
    base = {"last_run": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "week": "%d-W%02d" % (y, w), "runs_this_week": 0,
            "criteria_sha256": sha_of(CRIT)}
    json.dump(base, io.open(STATE, "w", encoding="utf-8"))

    print("\n[验收 1] 四种信号")
    rc, d = run_json(["--window-days", "0", "--memory-feedback", "0"], {"PATH": SHIM + os.pathsep + os.environ["PATH"]})
    # shim 会让 CI 失败，先排除它，用空 PATH 前缀
    rc, d = run_json(["--window-days", "0", "--memory-feedback", "0"])
    rec("1a", d["decision"] == "NO-GO", "四信号全无 → " + d["decision"])

    rc, d = run_json(["--window-days", "0", "--memory-feedback", "2"])
    m = [s for s in d["signals"] if s["key"] == "memory_feedback"][0]
    rec("1b", d["decision"] == "GO" and m["hit"], "memory 信号命中 → " + d["decision"])

    rc, d = run_json(["--window-days", "7", "--memory-feedback", "0"])
    f = [s for s in d["signals"] if s["key"] == "fix_commits"][0]
    rec("1c", d["decision"] == "GO" and f["hit"], "fix_commits 命中（%d 个）→ %s" % (len(d["fix_commits"]), d["decision"]))

    rc, d = run_json(["--window-days", "0", "--memory-feedback", "0"], {"PATH": SHIM + os.pathsep + os.environ["PATH"]})
    c = [s for s in d["signals"] if s["key"] == "ci_failed"][0]
    rec("1d", d["decision"] == "GO" and c["hit"], "CI 失败命中 → " + d["decision"])

    print("\n[验收 2] 预算闸（双闸）")
    json.dump(base, io.open(STATE, "w", encoding="utf-8"))
    p1 = run(["--claim"])
    rec("2a", p1.returncode == 0, "第一次占用成功（退出码 %d）" % p1.returncode)
    p2 = run(["--claim"])
    rec("2b", p2.returncode == 3 and "本周额度已用完" in p2.stderr, "第二次被拒绝（退出码 %d）" % p2.returncode)
    st = json.load(io.open(STATE, encoding="utf-8"))
    rec("2c", st.get("runs_this_week") == 1, "state 记录 runs_this_week=%s" % st.get("runs_this_week"))

    print("\n[验收 5] 物理边界：改评判标准")
    io.open(CRIT, "a", encoding="utf-8").write("\n")
    p3 = run(["--claim"])
    rec("5a", p3.returncode == 4 and "评判标准" in p3.stderr, "改标准后 --claim 被拒绝（退出码 %d）" % p3.returncode)
    rc, d = run_json([])
    rec("5b", d.get("blocked") is True, "预筛报告标记 blocked=%s" % d.get("blocked"))

finally:
    io.open(CRIT, "w", encoding="utf-8", newline="\n").write(backup_crit)
    if backup_state is None:
        if os.path.exists(STATE): os.remove(STATE)
    else:
        io.open(STATE, "w", encoding="utf-8").write(backup_state)
    if os.path.isdir(SHIM):
        shutil.rmtree(SHIM, ignore_errors=True)

bad = [k for k, ok in R if not ok]
print("\n结果：%d/%d 通过%s" % (len(R) - len(bad), len(R), ("，失败：" + ", ".join(bad)) if bad else ""))
sys.exit(1 if bad else 0)
