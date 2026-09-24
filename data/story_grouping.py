"""跨源故事分组：标题相似度 + 同域名聚类"""
import re
from urllib.parse import urlparse

# 阈值
CHAR_JACCARD_THRESHOLD = 0.25   # 字符 bigram Jaccard（高度相似标题）
WORD_JACCARD_THRESHOLD = 0.22   # 词级 Jaccard（不同措辞但相同主题）

# 停用词（中英文常见虚词，不参与词级比较）
_STOP_WORDS = set("a an the is are was were be been being of for in on at to from by with and or but if then so as it its this that these those i you he she we they me him her us them my your his our their what which who whom whose where when how why do does did will would can could should may might shall must not no yes all each every some any few many much more most less least one two three".split())
# 中文停用字
_STOP_WORDS.update("的了是在我有和就不人都一个上也这到说们为你会对就而且但那要被已经还正在让把它他们自己什么没有知道可以因为所以如果虽然但是或者而且关于关于".split())

# 通用域名黑名单（这些域名下不同内容不应分组）
_GENERIC_DOMAINS = frozenset((
    "github.com", "reddit.com", "infoq.cn", "huggingface.co",
    "news.ycombinator.com", "producthunt.com", "openai.com",
    "x.com", "twitter.com", "youtube.com",
))


def _char_jaccard(a, b):
    """基于字符 bigram 的 Jaccard 相似度"""
    a, b = str(a).lower(), str(b).lower()
    if len(a) < 2 or len(b) < 2:
        return 0.0
    sa = set(a[i:i + 2] for i in range(len(a) - 1))
    sb = set(b[i:i + 2] for i in range(len(b) - 1))
    inter = len(sa & sb)
    union = len(sa | sb)
    return inter / union if union else 0.0


def _word_jaccard(a, b):
    """基于词的 Jaccard 相似度（去停用词）"""
    a = str(a).lower()
    b = str(b).lower()
    # 分词：中文按字符拆分，英文按空格+标点拆分
    words_a = set(re.findall(r'[一-鿿]|[a-z0-9_\-]+', a)) - _STOP_WORDS
    words_b = set(re.findall(r'[一-鿿]|[a-z0-9_\-]+', b)) - _STOP_WORDS
    if not words_a or not words_b:
        return 0.0
    inter = len(words_a & words_b)
    union = len(words_a | words_b)
    return inter / union if union else 0.0


def _titles_similar(a, b):
    """综合判断两个标题是否相似"""
    cj = _char_jaccard(a, b)
    if cj >= CHAR_JACCARD_THRESHOLD:
        return True
    wj = _word_jaccard(a, b)
    if wj >= WORD_JACCARD_THRESHOLD:
        return True
    return False


def _extract_domain(url):
    """从 URL 提取主域名（去掉 www 和子域名）"""
    try:
        parsed = urlparse(url)
        host = parsed.hostname or ""
        host = re.sub(r'^www\.', '', host)
        parts = host.split('.')
        if len(parts) >= 2:
            return '.'.join(parts[-2:])
        return host
    except Exception:
        return ""


def group_stories(items):
    """
    对条目列表做跨源故事分组。

    分组规则（满足任一即合并）：
    1. 字符 bigram Jaccard >= 0.35（高度相似标题）
    2. 词级 Jaccard >= 0.30（不同措辞但相同主题）
    3. 同域名且非通用域名（不同来源报道同一网站）

    返回: list of dict, 每个 dict 是一个 Story:
        {story_id, title, items, domain, source_count}
    """
    if not items:
        return []

    n = len(items)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    # 预计算域名
    domains = [_extract_domain(item.get("url", "")) for item in items]

    # 两两比较
    for i in range(n):
        for j in range(i + 1, n):
            # 规则1+2：标题相似度
            if _titles_similar(items[i].get("title", ""), items[j].get("title", "")):
                union(i, j)
                continue
            # 规则3：同域名 + 不同来源（排除通用域名）
            # 同一来源的多篇文章不应因同域名被错误聚合
            di, dj = domains[i], domains[j]
            si = items[i].get("source", "")
            sj = items[j].get("source", "")
            if di and di == dj and si != sj and di not in _GENERIC_DOMAINS:
                union(i, j)

    # 收集分组
    groups = {}
    for i in range(n):
        root = find(i)
        if root not in groups:
            groups[root] = []
        groups[root].append(i)

    # 生成 Story 列表（按组大小降序）
    stories = []
    for story_id, indices in enumerate(sorted(groups.values(), key=lambda x: -len(x))):
        group_items = [items[i] for i in indices]
        title = max(group_items, key=lambda x: len(x.get("title", ""))).get("title", "")
        domain = domains[indices[0]] if indices else ""
        stories.append({
            "story_id": story_id,
            "title": title,
            "items": group_items,
            "domain": domain,
            "source_count": len(set(i.get("source", "") for i in group_items)),
        })

    return stories
