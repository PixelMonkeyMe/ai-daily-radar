"""邮件推送：读取最新 report.json，生成 HTML 邮件，通过 QQ 邮箱 SMTP 发送。

环境变量：
  SMTP_AUTH_CODE: QQ 邮箱 SMTP 授权码（在 QQ 邮箱 → 设置 → 账户 → POP3/SMTP 中获取）
  SMTP_USER: 发件人邮箱（默认 fancocat@qq.com）
  MAIL_TO: 收件人邮箱（默认 fancocat@qq.com）
"""
import json
import os
import sys
import glob
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header

BASE = os.path.join(os.path.dirname(__file__), "..")
REPORTS_DIR = os.path.join(BASE, "data", "reports")

SMTP_SERVER = "smtp.qq.com"
SMTP_PORT = 465  # SSL
DEFAULT_EMAIL = "fancocat@qq.com"


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
    """通过 QQ 邮箱 SMTP 发送邮件"""
    auth_code = os.environ.get("SMTP_AUTH_CODE", "").strip()
    if not auth_code:
        print("未设置 SMTP_AUTH_CODE，跳过邮件推送")
        return False

    from_addr = os.environ.get("SMTP_USER", DEFAULT_EMAIL).strip()
    to_addr = os.environ.get("MAIL_TO", DEFAULT_EMAIL).strip()
    subject = f"AI 日报雷达 | {report['date']} | {len(report['items'])} 条资讯"
    html_content = build_email_html(report)

    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = f"AI Daily Radar <{from_addr}>"
        msg["To"] = to_addr
        msg["Subject"] = Header(subject, "utf-8")
        msg.attach(MIMEText(html_content, "html", "utf-8"))

        with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT, timeout=30) as server:
            server.login(from_addr, auth_code)
            server.sendmail(from_addr, [to_addr], msg.as_string())

        print(f"邮件已发送至 {to_addr} (subject: {subject})")
        return True
    except smtplib.SMTPAuthenticationError as e:
        print(f"SMTP 认证失败，请检查 SMTP_AUTH_CODE 是否正确: {e}")
        return False
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
