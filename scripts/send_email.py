"""邮件推送：读取最新 report.json，生成 HTML 邮件，通过 Resend API 发送。

环境变量：
  RESEND_API_KEY: Resend.com API 密钥（免费 3000 封/月）
  MAIL_TO: 收件人邮箱（默认 fancocat@qq.com）
"""
import json
import os
import sys
import glob

import requests

BASE = os.path.join(os.path.dirname(__file__), "..")
REPORTS_DIR = os.path.join(BASE, "data", "reports")
RESEND_API_URL = "https://api.resend.com/emails"

DEFAULT_TO = "fancocat@qq.com"
FROM_ADDR = "AI Daily Radar <onboarding@resend.dev>"  # Resend 沙箱默认发件人


def build_email_html(report):
    """根据 report 生成 HTML 邮件内容"""
    date = report["date"]
    items = report["items"]
    ai_enabled = report.get("ai_enabled", False)
    summary = report.get("summary")

    # 邮件内嵌 CSS（邮件客户端不支持外部 CSS）
    css = """
    body { font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
           background: #f4f5f7; color: #1f2329; line-height: 1.7; margin: 0; padding: 0; }
    .container { max-width: 680px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #0f2027, #203a43, #2c5364);
              color: #fff; padding: 28px 20px; border-radius: 12px 12px 0 0; }
    .header h1 { font-size: 22px; margin: 0; }
    .header .meta { color: rgba(255,255,255,.7); font-size: 12px; margin-top: 6px; }
    .badge { display: inline-block; background: rgba(255,255,255,.15);
             border-radius: 99px; padding: 2px 10px; font-size: 11px; margin-top: 8px; }
    .content { background: #fff; padding: 20px; border-radius: 0 0 12px 12px; }
    .summary { background: #f7fbfc; border: 2px solid #2c5364; border-radius: 10px;
               padding: 16px; margin-bottom: 18px; }
    .summary h2 { font-size: 17px; color: #203a43; margin: 0 0 10px; }
    .summary dt { font-weight: 700; font-size: 13px; color: #203a43; margin-top: 10px; }
    .summary dd { font-size: 14px; color: #3c434c; margin: 4px 0 0 10px; }
    .card { border: 1px solid #e5e8ec; border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
    .card h3 { font-size: 15px; margin: 0 0 6px; }
    .card h3 a { color: #1f2329; text-decoration: none; }
    .card h3 a:hover { color: #1677ff; }
    .tags { font-size: 12px; color: #8a919c; margin-bottom: 6px; }
    .tag-src { background: #eef3ff; color: #1677ff; border-radius: 4px; padding: 1px 6px; margin-right: 6px; }
    .brief { font-size: 14px; color: #3c434c; margin-top: 6px; }
    .detail { font-size: 13px; color: #3c434c; margin-top: 8px; padding-left: 10px;
              border-left: 3px solid #2c5364; }
    .detail dt { font-weight: 700; font-size: 12px; color: #203a43; margin-top: 8px; }
    .detail dd { margin: 2px 0 0 10px; font-size: 13px; }
    .footer { text-align: center; color: #a0a6ad; font-size: 12px; margin-top: 20px; padding: 10px; }
    .footer a { color: #1677ff; text-decoration: none; }
    .story-badge { background: #eef3ff; color: #1677ff; border-radius: 4px;
                   padding: 2px 8px; font-size: 11px; font-weight: 600; display: inline-block; margin-bottom: 8px; }
    """

    parts = [f'<html><head><style>{css}</style></head><body><div class="container">']

    # Header
    parts.append(f'<div class="header"><h1>AI 日报雷达</h1>'
                 f'<div class="meta">{date} | {len(items)} 条资讯</div>'
                 f'<span class="badge">{"AI 深度解读" if ai_enabled else "原始榜单"}</span></div>')
    parts.append('<div class="content">')

    # Summary
    if summary and ai_enabled:
        parts.append('<div class="summary"><h2>今日总结</h2><dl>')
        parts.append(f'<dt>今日总览</dt><dd>{summary.get("overview", "")}</dd>')
        for c in summary.get("conclusions", []):
            parts.append(f'<dt>核心结论</dt><dd>{c}</dd>')
        parts.append(f'<dt>行业启示</dt><dd>{summary.get("industry_use", "")}</dd>')
        parts.append(f'<dt>风险提示</dt><dd>{summary.get("risks", "")}</dd>')
        parts.append('</dl></div>')

    # Items
    for item in items:
        title = item.get("title", "")
        url = item.get("url", "")
        src = item.get("source", "")
        parts.append(f'<div class="card"><h3><a href="{url}">{title}</a></h3>')
        parts.append(f'<div class="tags"><span class="tag-src">{src}</span></div>')
        brief = item.get("brief") or item.get("what") or item.get("description", "")
        if brief:
            parts.append(f'<div class="brief">{brief}</div>')
        if ai_enabled and item.get("what"):
            parts.append('<div class="detail"><dl>')
            for label, key in [("这是什么", "what"), ("行业用途", "industry_use"),
                               ("能力", "capability"), ("评估", "assessment"), ("风险", "risk")]:
                val = item.get(key)
                if val:
                    parts.append(f'<dt>{label}</dt><dd>{val}</dd>')
            parts.append('</dl></div>')
        parts.append('</div>')

    # Footer
    parts.append('</div>')
    parts.append('<div class="footer">由 AI 日报雷达自动生成 | '
                 '<a href="https://github.com">查看完整日报</a></div>')
    parts.append('</div></body></html>')

    return ''.join(parts)


def send_email(report):
    """发送邮件"""
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        print("未设置 RESEND_API_KEY，跳过邮件推送")
        return False

    to_addr = os.environ.get("MAIL_TO", DEFAULT_TO).strip()
    subject = f"AI 日报雷达 | {report['date']} | {len(report['items'])} 条资讯"
    html_content = build_email_html(report)

    try:
        r = requests.post(
            RESEND_API_URL,
            json={
                "from": FROM_ADDR,
                "to": [to_addr],
                "subject": subject,
                "html": html_content,
            },
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )
        r.raise_for_status()
        print(f"邮件已发送至 {to_addr} (subject: {subject})")
        return True
    except Exception as e:
        print(f"邮件发送失败: {e}")
        return False


def main():
    files = sorted(glob.glob(os.path.join(REPORTS_DIR, "*.json")), reverse=True)
    if not files:
        print("没有找到日报数据，跳过邮件推送")
        return
    report = json.load(open(files[0], encoding="utf-8"))
    send_email(report)


if __name__ == "__main__":
    main()
