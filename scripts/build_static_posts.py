#!/usr/bin/env python3
"""Sinh trang tĩnh cho SEO: post/<id>/index.html, post/index.html, sitemap.xml, robots.txt.

Vì sao: SPA dùng hash route (/#post/<id>) nên Google không index được từng bài.
Script chỉ dùng thư viện chuẩn, đọc data/posts.min.csv + data/details/<id>.json,
KHÔNG sửa data. Mỗi lần chạy sẽ XOÁ và sinh lại toàn bộ thư mục post/.

Cách dùng (chạy ở thư mục gốc của blog):
    python3 scripts/build_static_posts.py                 # dùng scripts/static-post-ids.txt
    python3 scripts/build_static_posts.py --refresh-ids   # quét lại repo cha để cập nhật danh sách id
    python3 scripts/build_static_posts.py --all           # sinh cho tất cả bài có dữ liệu
    python3 scripts/build_static_posts.py --linked-only   # chỉ các id trong static-post-ids.txt (không thêm bài dài)
    python3 scripts/build_static_posts.py --links         # quét lại ánh xạ bài -> route app, ghi
                                                          # scripts/post-routes.json + ../../scripts/landing-pages/blog-links.json

Mặc định: id trong static-post-ids.txt  HỢP  các bài "có nội dung" (>= MIN_CHARS ký tự sau khi bỏ markdown).
Bài ngắn (thông báo mỏng) bị bỏ để không làm loãng chất lượng site.
Hộp "Công cụ liên quan" ở cuối bài đọc scripts/post-routes.json (do --links sinh) và PAGES của landing page
(scripts/landing-pages/pages.js ở repo cha, đọc qua `node`).
"""
import argparse
import csv
import html
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://blog.fbaio.org'
MAIN_SITE = 'https://fbaio.org'
SITE_NAME = 'Social AIO Blog'
IDS_FILE = ROOT / 'scripts' / 'static-post-ids.txt'
IMAGE_EXTS = ['jpg', 'png', 'jpeg', 'webp']
VN = timezone(timedelta(hours=7))
LINK_RE = re.compile(r'blog\.fbaio\.org/#post/([0-9]+)')
MIN_CHARS = 300  # bài có text (đã bỏ markdown) >= ngưỡng này thì được sinh trang tĩnh
ROUTES_FILE = ROOT / 'scripts' / 'post-routes.json'
REPO = ROOT.parent.parent
LINKS_OUT = REPO / 'scripts' / 'landing-pages' / 'blog-links.json'
LANDING_BLOG = REPO / 'scripts' / 'landing-pages' / 'landing-blog.json'  # do generate.js ghi
PAGES_JS = REPO / 'scripts' / 'landing-pages' / 'pages.js'
LANDING_SITE = 'https://fbaio.org'
LANDING_DIR = 'tinh-nang'
MAX_PER_ROUTE = 8
# link nội dung bài trỏ tới app: fbaio.org/#/x, facebook-all-in-one.com/dist/#/x, fb-aio.github.io/(dev/)#/x ...
APP_LINK_RE = re.compile(
    r'(?:fbaio\.org|facebook-all-in-one\.com|fb-aio\.web\.app|fb-aio\.github\.io)'
    r'(?:/(?:dist|dev|fbaio))?/?#(/[A-Za-z0-9_\-/]*)(\?[A-Za-z0-9_=&%.\-]+)?')
PLATFORM_DIRS = {'facebook': 'Facebook', 'instagram': 'Instagram', 'threads': 'Threads', 'tiktok': 'Tiktok'}

CSS = """:root{--bg:#faf7f2;--card:#fff;--ink:#172033;--muted:#5d6777;--line:#e6dfd3;--ember:#db5c44;--lagoon:#0f766e;--link:#0f766e}
@media (prefers-color-scheme:dark){:root{--bg:#0f141f;--card:#171e2d;--ink:#e8ecf4;--muted:#9aa5b8;--line:#2a3447;--ember:#f0735b;--lagoon:#2dd4bf;--link:#5eead4}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
a{color:var(--link)}
.wrap{max-width:760px;margin:0 auto;padding:0 16px}
header.top{border-bottom:1px solid var(--line);background:var(--card)}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:12px;padding-bottom:12px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;color:var(--ink);text-decoration:none}
.brand img{width:28px;height:28px;border-radius:6px}
nav.links{display:flex;gap:16px;font-size:.92rem}
main{padding:24px 0 40px}
article h1{font-size:1.7rem;line-height:1.3;margin:.2em 0 .3em;overflow-wrap:anywhere}
.meta{color:var(--muted);font-size:.9rem;margin-bottom:18px}
.body{overflow-wrap:anywhere}
.body h2,.body h3,.body h4,.body h5,.body h6{line-height:1.35;margin:1.4em 0 .5em}
.body p{margin:.8em 0}
.body pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;font-size:.88rem}
.body code{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:.9em}
.body pre code{border:0;padding:0;background:none}
.body blockquote{margin:1em 0;padding:.2em 1em;border-left:4px solid var(--ember);color:var(--muted)}
.body hr{border:0;border-top:1px solid var(--line);margin:1.5em 0}
.media{margin:24px 0 0;display:grid;gap:14px}
.media figure{margin:0}
.media img,.media video{display:block;max-width:100%;height:auto;border-radius:10px;border:1px solid var(--line);background:var(--card)}
.related{margin:24px 0 0;padding:14px 16px;border:1px solid var(--line);border-radius:10px;background:var(--card)}
.related h2{font-size:1rem;margin:0 0 6px}
.related ul{margin:0;padding-left:1.2em}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin:28px 0 8px}
.btn{display:inline-block;padding:10px 16px;border-radius:999px;font-weight:600;text-decoration:none;border:1px solid var(--lagoon);color:var(--lagoon)}
.btn.primary{background:var(--lagoon);color:#fff}
@media (prefers-color-scheme:dark){.btn.primary{color:#06201d}}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:.88rem;padding:18px 0 32px}
ul.posts{list-style:none;margin:0;padding:0}
ul.posts li{padding:12px 0;border-bottom:1px solid var(--line)}
ul.posts a{font-weight:600;overflow-wrap:anywhere}
ul.posts .d{color:var(--muted);font-size:.85rem}
ul.posts p{margin:.2em 0 0;color:var(--muted);font-size:.92rem}
.home-cta{display:block;margin:0 0 16px;padding:16px 18px;border-radius:12px;background:var(--lagoon);color:#fff;text-decoration:none}
.home-cta b{display:block;font-size:1.1rem}
.home-cta span{font-size:.9rem;opacity:.9}
@media (prefers-color-scheme:dark){.home-cta{color:#06201d}}
.search{width:100%;padding:12px 14px;font:inherit;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);margin-bottom:8px}
ul.posts li[hidden]{display:none}
"""

# ---------------------------------------------------------------- helpers

esc = lambda s: html.escape(str(s), quote=True)


def strip_md(text):
    t = re.sub(r'```[\s\S]*?```', ' ', text)
    t = re.sub(r'`([^`]+)`', r'\1', t)
    t = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', r'\1', t)
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1', t)
    t = re.sub(r'^\s{0,3}#{1,6}\s+', '', t, flags=re.M)
    t = re.sub(r'^\s*>+\s?', '', t, flags=re.M)
    t = re.sub(r'^\s*[-*+]\s+', '', t, flags=re.M)
    t = re.sub(r'^\s*\d+\.\s+', '', t, flags=re.M)
    t = re.sub(r'[*_~|]', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def truncate(text, n):
    text = re.sub(r'\s+', ' ', text).strip()
    if len(text) <= n:
        return text
    cand = text[: n + 1]
    sp = cand.rfind(' ')
    cand = cand[:sp] if sp > n * 0.6 else text[:n]
    return re.sub(r'[\s,.;:!?\-]+$', '', cand) + '…'


_INLINE = re.compile(
    r'(?P<code>`[^`\n]+`)'
    r'|(?P<img>!\[[^\]]*\]\([^)\s]+\))'
    r'|(?P<link>\[[^\]]+\]\((?P<lu>https?://[^)\s]+)\))'
    r'|(?P<url>https?://[^\s<]+)'
    r'|(?P<bold>\*\*[^*\n]+\*\*)'
    r'|(?P<it>(?<![\w*])\*[^*\s][^*\n]*?\*(?![\w*]))'
)
_ENT_CUT = re.compile(r'&(?:quot|lt|gt|#39);')


def _a(url, label):
    return '<a href="%s" rel="nofollow noopener ugc" target="_blank">%s</a>' % (url, label)


def inline(escaped):
    """Nhận text ĐÃ escape HTML, trả về HTML inline."""
    def repl(m):
        g = m.lastgroup
        s = m.group(0)
        if g == 'code':
            return '<code>%s</code>' % s[1:-1]
        if g == 'img':
            return re.match(r'!\[([^\]]*)\]', s).group(1)
        if g == 'link':
            label = re.match(r'\[([^\]]+)\]', s).group(1)
            return _a(m.group('lu'), inline(label))
        if g == 'url':
            cut = _ENT_CUT.search(s)
            tail = ''
            if cut:
                tail = s[cut.start():]
                s = s[: cut.start()]
            stripped = re.sub(r'[).,;:!?]+$', '', s)
            tail = s[len(stripped):] + tail
            return _a(stripped, stripped) + tail
        if g == 'bold':
            return '<strong>%s</strong>' % inline(s[2:-2])
        if g == 'it':
            return '<em>%s</em>' % inline(s[1:-1])
        return s
    return _INLINE.sub(repl, escaped)


def render_md(text):
    lines = text.split('\n')
    out, para, i = [], [], 0

    def flush():
        if para:
            out.append('<p>%s</p>' % '<br>\n'.join(inline(esc(p)) for p in para))
            para.clear()

    while i < len(lines):
        raw = lines[i].rstrip()
        s = raw.strip()
        if s.startswith('```'):
            flush()
            buf, i = [], i + 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                buf.append(lines[i])
                i += 1
            out.append('<pre><code>%s</code></pre>' % esc('\n'.join(buf)))
            i += 1
            continue
        if not s:
            flush(); i += 1; continue
        m = re.match(r'^(#{1,6})\s+(.*)$', s)
        if m:
            flush()
            lvl = min(len(m.group(1)) + 1, 6)
            out.append('<h%d>%s</h%d>' % (lvl, inline(esc(m.group(2))), lvl))
            i += 1; continue
        if re.match(r'^(-{3,}|\*{3,}|_{3,})$', s):
            flush(); out.append('<hr>'); i += 1; continue
        if s.startswith('>'):
            flush()
            buf = []
            while i < len(lines) and lines[i].strip().startswith('>'):
                buf.append(re.sub(r'^>+\s?', '', lines[i].strip()))
                i += 1
            out.append('<blockquote><p>%s</p></blockquote>' % '<br>\n'.join(inline(esc(b)) for b in buf))
            continue
        ul = re.match(r'^[-*+]\s+(.*)$', s)
        ol = re.match(r'^\d+[.)]\s+(.*)$', s)
        if ul or ol:
            flush()
            tag = 'ul' if ul else 'ol'
            pat = r'^[-*+]\s+(.*)$' if ul else r'^\d+[.)]\s+(.*)$'
            items = []
            while i < len(lines):
                mm = re.match(pat, lines[i].strip())
                if not mm:
                    break
                items.append('<li>%s</li>' % inline(esc(mm.group(1))))
                i += 1
            out.append('<%s>%s</%s>' % (tag, ''.join(items), tag))
            continue
        para.append(s)
        i += 1
    flush()
    return '\n'.join(out)


def fmt_date(ts_ms):
    d = datetime.fromtimestamp(int(ts_ms) / 1000, VN)
    return d, d.strftime('%d/%m/%Y')


# ---------------------------------------------------------------- data

def load_rows():
    with open(ROOT / 'data' / 'posts.min.csv', encoding='utf-8-sig', newline='') as f:
        return {r['post_id']: r for r in csv.DictReader(f)}


def scan_ids():
    repo = ROOT.parent.parent
    dirs = [repo / 'src', repo / 'submodules' / 'extension']
    skip = {'node_modules', '.output', '.wxt', '.git', 'dist'}
    ids = set()
    for base in dirs:
        if not base.exists():
            continue
        for p in base.rglob('*'):
            if skip & set(p.parts) or not p.is_file() or p.stat().st_size > 3_000_000:
                continue
            try:
                ids.update(LINK_RE.findall(p.read_text(encoding='utf-8', errors='ignore')))
            except OSError:
                pass
    return sorted(ids)


def find_media(row):
    items, seen = [], set()
    for tok in (row.get('attachments') or '').split(','):
        tok = tok.strip()
        if not tok or tok in seen or ':' not in tok:
            continue
        seen.add(tok)
        typ, mid = tok.split(':', 1)
        base = '%s_%s' % (row['post_id'], mid)
        img = next((base + '.' + e for e in IMAGE_EXTS if (ROOT / 'media' / (base + '.' + e)).exists()), None)
        if typ == 'Video':
            vid = base + '.mp4' if (ROOT / 'media' / (base + '.mp4')).exists() else None
            if vid:
                items.append(('video', vid, img))
        elif img:
            items.append(('image', img, None))
    return items


def get_text(pid, row):
    text = ''
    p = ROOT / 'data' / 'details' / ('%s.json' % pid)
    if p.exists():
        try:
            text = (json.loads(p.read_text(encoding='utf-8')).get('result') or {}).get('text') or ''
        except ValueError:
            pass
    if not text.strip():
        text = row.get('content_text') or row.get('message') or ''
        text = text.replace('\\n', '\n')
    return text.replace('\r\n', '\n').replace('\r', '\n').strip()


# ---------------------------------------------------------------- pages

def page_shell(title, desc, canonical, body, head_extra='', ogtype='website'):
    return """<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{canon}">
<link rel="icon" type="image/png" href="/logo.png">
<meta property="og:site_name" content="{site}">
<meta property="og:locale" content="vi_VN">
<meta property="og:type" content="{ogtype}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{canon}">
{extra}<link rel="stylesheet" href="/post/post.css">
</head>
<body>
<header class="top"><div class="wrap">
<a class="brand" href="/post/"><img src="/logo.png" alt="Social AIO" width="28" height="28"><span>{site}</span></a>
<nav class="links"><a href="/post/">Tất cả bài viết</a><a href="{main}/">Social AIO</a></nav>
</div></header>
{body}
<footer><div class="wrap">
Social AIO – bộ công cụ tự động hoá và tải dữ liệu cho Facebook, Instagram, TikTok, Threads. <a href="{main}/">Dùng thử tại fbaio.org</a> · <a href="/">Blog (bản đầy đủ)</a>
</div></footer>
</body>
</html>
""".format(title=esc(title), desc=esc(desc), canon=canonical, site=SITE_NAME, ogtype=ogtype,
           extra=head_extra, body=body, main=MAIN_SITE)


def build_post(pid, row, related=None):
    text = get_text(pid, row)
    media = find_media(row)
    if not text and not media:
        return None

    lines = text.split('\n')
    first = next((i for i, l in enumerate(lines) if l.strip()), None)
    heading = None
    if first is not None:
        m = re.match(r'^\s{0,3}#{1,6}\s+(.*)$', lines[first])
        if m:
            heading = strip_md(m.group(1))
            body_md = '\n'.join(lines[first + 1:]).strip()
        else:
            body_md = text
    else:
        body_md = ''
    plain_all = strip_md(text)
    h1 = heading or truncate(plain_all, 100) or ('Bài viết #%s' % pid)
    h1 = truncate(h1, 140)
    short_title = truncate(h1, 60)
    title = '%s | %s' % (short_title, SITE_NAME)

    rest_plain = strip_md(body_md) if heading else plain_all
    if heading and rest_plain:
        desc_src = rest_plain
    else:
        desc_src = plain_all
        if desc_src.startswith(h1.rstrip('…')):
            desc_src = desc_src[len(h1.rstrip('…')):].strip(' .:-') or desc_src
    desc = truncate(desc_src or h1, 155)

    d, dstr = fmt_date(row['creation_time'])
    iso = d.isoformat()
    canonical = '%s/post/%s/' % (SITE, pid)

    og_img = next((m[1] for m in media if m[0] == 'image'), None) or next((m[2] for m in media if m[0] == 'video' and m[2]), None)
    og_img_url = '%s/media/%s' % (SITE, og_img) if og_img else ''

    figs = []
    for n, (kind, f, poster) in enumerate(media, 1):
        alt = '%s – hình %d' % (short_title, n)
        if kind == 'image':
            figs.append('<figure><img src="/media/%s" alt="%s" loading="lazy" decoding="async"></figure>' % (esc(f), esc(alt)))
        else:
            p = ' poster="/media/%s"' % esc(poster) if poster else ''
            figs.append('<figure><video controls preload="none"%s src="/media/%s"></video></figure>' % (p, esc(f)))
    media_html = '<div class="media">%s</div>' % '\n'.join(figs) if figs else ''

    rel_html = ''
    if related:
        rel_html = ('<aside class="related"><h2>Công cụ liên quan</h2><ul>%s</ul></aside>'
                    % ''.join('<li><a href="%s">%s</a></li>' % (esc(u), esc(t)) for u, t in related))
    body = """<main><div class="wrap"><article>
<h1>{h1}</h1>
<div class="meta"><time datetime="{iso}">{ds}</time> · {site}</div>
<div class="body">
{content}
</div>
{media}
{related}
<div class="cta">
<a class="btn primary" href="/#post/{pid}">Xem trên blog (kèm bình luận)</a>
<a class="btn" href="{main}/">Dùng Social AIO tại fbaio.org</a>
</div>
</article></div></main>""".format(h1=esc(h1), iso=iso, ds=dstr, site=SITE_NAME,
                                  content=render_md(body_md), media=media_html, related=rel_html, pid=pid, main=MAIN_SITE)

    ld = {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        'headline': short_title,
        'description': desc,
        'datePublished': iso,
        'dateModified': iso,
        'inLanguage': 'vi',
        'mainEntityOfPage': canonical,
        'url': canonical,
        'author': {'@type': 'Organization', 'name': 'Social AIO', 'url': MAIN_SITE},
        'publisher': {'@type': 'Organization', 'name': 'Social AIO', 'url': MAIN_SITE,
                      'logo': {'@type': 'ImageObject', 'url': SITE + '/logo.png'}},
    }
    if og_img_url:
        ld['image'] = [og_img_url]
    ld_json = json.dumps(ld, ensure_ascii=False).replace('</', '<\\/')

    extra = '<meta property="article:published_time" content="%s">\n' % iso
    if og_img_url:
        extra += '<meta property="og:image" content="%s">\n' % esc(og_img_url)
    extra += '<meta name="twitter:card" content="%s">\n' % ('summary_large_image' if og_img_url else 'summary')
    extra += '<script type="application/ld+json">%s</script>\n' % ld_json
    return {
        'html': page_shell(title, desc, canonical, body, extra, 'article'),
        'title': h1, 'desc': desc, 'date': dstr, 'ts': int(row['creation_time']),
        'lastmod': d.strftime('%Y-%m-%d'),
    }


def build_index(pages):
    items = []
    for pid, p in sorted(pages.items(), key=lambda kv: -kv[1]['ts']):
        items.append('<li><a href="/post/%s/">%s</a> <span class="d">· %s</span><p>%s</p></li>'
                     % (pid, esc(p['title']), p['date'], esc(truncate(p['desc'], 140))))
    body = """<main><div class="wrap">
<h1>Hướng dẫn &amp; thông báo Social AIO</h1>
<p class="meta">{n} bài viết hướng dẫn sử dụng các tính năng của Social AIO.</p>
<a class="home-cta" href="/"><b>Mở {site} đầy đủ →</b><span>Lọc theo chủ đề, xem ảnh/video, bình luận — giao diện đẹp hơn trang danh sách này.</span></a>
<input id="q" class="search" type="search" placeholder="Tìm trong {n} bài (gõ không dấu cũng được)…" autocomplete="off">
<p id="qn" class="meta" hidden></p>
<ul class="posts" id="list">
{items}
</ul></div></main>
<script>
// Lọc tại chỗ: danh sách vẫn nằm đủ trong HTML cho Google, ô tìm chỉ ẩn/hiện dòng
(function(){{
var norm=function(s){{return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d')}};
var q=document.getElementById('q'),qn=document.getElementById('qn');
var li=[].slice.call(document.querySelectorAll('#list li')).map(function(e){{return [e,norm(e.textContent)]}});
q.addEventListener('input',function(){{
  var w=norm(q.value).split(/\\s+/).filter(Boolean),n=0;
  li.forEach(function(x){{var ok=w.every(function(t){{return x[1].indexOf(t)>=0}});x[0].hidden=!ok;if(ok)n++}});
  qn.hidden=!w.length;qn.textContent=n?n+' bài khớp':'Không thấy bài nào — thử tìm ở trang chủ blog.';
}});
}})();
</script>""".format(n=len(pages), site=SITE_NAME, items='\n'.join(items))
    return page_shell('Tất cả bài viết | ' + SITE_NAME,
                      'Danh sách bài viết hướng dẫn, mẹo và thông báo cập nhật của Social AIO.',
                      SITE + '/post/', body)


def build_sitemap(pages):
    urls = ['<url><loc>%s/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>' % SITE,
            '<url><loc>%s/post/</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>' % SITE]
    for pid, p in sorted(pages.items(), key=lambda kv: -kv[1]['ts']):
        urls.append('<url><loc>%s/post/%s/</loc><lastmod>%s</lastmod></url>' % (SITE, pid, p['lastmod']))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n%s\n</urlset>\n' % '\n'.join(urls))


# ---------------------------------------------------------------- post -> route mapping

def load_pages():
    """Đọc PAGES của landing page qua node (không hardcode). Trả list {slug, route, short}."""
    if not PAGES_JS.exists():
        return []
    code = ("import('%s').then(m=>console.log(JSON.stringify(m.PAGES.map(p=>({slug:p.slug,route:p.route,short:p.short})))))"
            % PAGES_JS.as_posix())
    try:
        out = subprocess.run(['node', '--input-type=module', '-e', code], capture_output=True, text=True, check=True, timeout=60)
        return json.loads(out.stdout)
    except (OSError, subprocess.SubprocessError, ValueError) as e:
        print('CẢNH BÁO: không đọc được PAGES (%s) -> bỏ qua hộp "Công cụ liên quan"' % e)
        return []


def parse_menus():
    """src/routes/menus.ts -> list (spec_path, route). spec_path là file .tsx hoặc thư mục trong src/screens."""
    txt = (REPO / 'src' / 'routes' / 'menus.ts').read_text(encoding='utf-8')
    comps = dict((m.group(1), m.group(2)) for m in
                 re.finditer(r"const (\w+)\s*=\s*loadable\(\s*\(\)\s*=>\s*import\('@screens/([^']+)'\)", txt))
    txt_nc = re.sub(r'^\s*//.*$', '', txt, flags=re.M)
    out = []
    for m in re.finditer(r"path:\s*'(/[^']*)',?\s*(?:[^{}]*?)element:\s*(\w+)", txt_nc):
        route, comp = m.group(1), m.group(2)
        spec = comps.get(comp)
        if not spec:
            continue
        base = REPO / 'src' / 'screens' / spec
        if base.is_dir():
            out.append((base, route))
        elif base.with_suffix('.tsx').exists():
            out.append((base.with_suffix('.tsx'), route))
    return out


def routes_for_file(fp, menus):
    """File nguồn -> các route (chọn spec khớp dài nhất). BulkDownloader/<platform>/ -> thêm ?platform=."""
    best, best_len = [], -1
    for spec, route in menus:
        if fp == spec or (spec.is_dir() and spec in fp.parents):
            n = len(spec.parts)
            if n > best_len:
                best, best_len = [(spec, route)], n
            elif n == best_len:
                best.append((spec, route))
    res = []
    for spec, route in best:
        res.append(route)
        if route == '/bulk-downloader' and spec.is_dir():
            sub = fp.relative_to(spec).parts
            if len(sub) > 1 and sub[0] in PLATFORM_DIRS:
                res.append('%s?platform=%s' % (route, PLATFORM_DIRS[sub[0]]))
    return res


def title_of(text):
    for l in text.split('\n'):
        if l.strip():
            return truncate(strip_md(re.sub(r'^\s{0,3}#{1,6}\s+', '', l)), 80)
    return ''


def build_links(rows, pages):
    """Ánh xạ post id -> route. Nguồn: (1) file src tham chiếu id, (2) link app trong nội dung bài."""
    menus = parse_menus()
    post_routes = {}  # pid -> {route: nguồn}

    def add(pid, route, how):
        post_routes.setdefault(pid, {}).setdefault(route, how)

    skip = {'node_modules', '.output', '.wxt', '.git', 'dist', 'tmp'}
    src = REPO / 'src'
    for fp in src.rglob('*'):
        if skip & set(fp.parts) or not fp.is_file() or fp.suffix not in ('.ts', '.tsx', '.js', '.jsx') or fp.stat().st_size > 3_000_000:
            continue
        try:
            txt = fp.read_text(encoding='utf-8', errors='ignore')
        except OSError:
            continue
        if '#post/' not in txt:
            continue
        ids = set()
        for line in txt.split('\n'):
            if line.lstrip().startswith(('//', '*', '/*')):
                continue
            ids.update(LINK_RE.findall(line))
        if not ids:
            continue
        rts = routes_for_file(fp, menus)
        for pid in ids:
            for r in rts:
                add(pid, r, 'source')

    for pid, row in rows.items():
        text = get_text(pid, row)
        for m in APP_LINK_RE.finditer(text):
            path = m.group(1).rstrip('/') or '/'
            q = m.group(2) or ''
            if path == '/':
                continue
            add(pid, path + q, 'content')
            if q:
                add(pid, path, 'content')

    # route có query trong PAGES (vd /bulk-downloader?platform=Facebook) cũng nhận bài của route gốc
    for pg in pages:
        r = pg.get('route')  # trang tiện ích extension không có route
        if r and '?' in r:
            base = r.split('?')[0]
            for pid, rs in post_routes.items():
                if base in rs and r not in rs:
                    # bài đã gắn rõ với nền tảng khác (vd Threads) thì không kéo sang trang Facebook
                    if any(k.startswith(base + '?') and k != r for k in rs):
                        continue
                    rs[r] = rs[base]

    # bỏ bài không có dữ liệu
    post_routes = {pid: rs for pid, rs in post_routes.items() if pid in rows and get_text(pid, rows[pid])}

    by_route = {}
    for pid, rs in post_routes.items():
        for r in rs:
            by_route.setdefault(r, []).append(pid)
    links = {}
    for r in sorted(by_route):
        lst = sorted(by_route[r], key=lambda p: -int(rows[p]['creation_time']))[:MAX_PER_ROUTE]
        links[r] = [{'id': p, 'title': title_of(get_text(p, rows[p]))} for p in lst]
    return post_routes, links


def related_for(pid, landing_blog, pages):
    """Các (url, anchor) landing page liên quan tới bài.

    Dùng đúng ánh xạ slug -> [id bài] mà generate.js đã chọn cho mục "Bài hướng dẫn" của landing page
    (landing-blog.json) → link luôn hai chiều, không lệch nhau.
    """
    return [('%s/%s/%s/' % (LANDING_SITE, LANDING_DIR, pg['slug']), pg['short'])
            for pg in pages if pid in landing_blog.get(pg['slug'], [])]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--refresh-ids', action='store_true', help='quét repo cha để cập nhật scripts/static-post-ids.txt')
    ap.add_argument('--all', action='store_true', help='sinh cho mọi bài trong posts.min.csv có dữ liệu')
    ap.add_argument('--linked-only', action='store_true', help='chỉ id trong static-post-ids.txt (bỏ qua bài dài chưa được app link tới)')
    ap.add_argument('--links', action='store_true', help='quét lại ánh xạ bài -> route app; ghi post-routes.json và blog-links.json')
    args = ap.parse_args()

    rows = load_rows()
    if args.refresh_ids:
        ids = scan_ids()
        IDS_FILE.write_text('\n'.join(ids) + '\n', encoding='utf-8')
        print('Đã quét repo cha: %d id -> %s' % (len(ids), IDS_FILE.relative_to(ROOT)))
    pages_cfg = load_pages()
    if args.links or not ROUTES_FILE.exists():
        post_routes, links = build_links(rows, pages_cfg)
        ROUTES_FILE.write_text(json.dumps(post_routes, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
        LINKS_OUT.write_text(json.dumps(links, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print('Đã ghi %s (%d route, %d bài) và %s' % (LINKS_OUT.relative_to(REPO), len(links), len(post_routes), ROUTES_FILE.relative_to(ROOT)))
    else:
        post_routes = json.loads(ROUTES_FILE.read_text(encoding='utf-8'))
    landing_blog = json.loads(LANDING_BLOG.read_text(encoding='utf-8')) if LANDING_BLOG.exists() else {}
    if args.all:
        ids = sorted(rows)
    else:
        if not IDS_FILE.exists():
            sys.exit('Thiếu %s, chạy với --refresh-ids' % IDS_FILE)
        linked = [x.strip() for x in IDS_FILE.read_text().split() if x.strip()]
        ids = list(linked)
        if not args.linked_only:
            have = set(linked)
            extra = [pid for pid, r in rows.items() if pid not in have and len(strip_md(get_text(pid, r))) >= MIN_CHARS]
            ids += sorted(extra)
            print('Bài liên kết: %d, bài đủ dài thêm: %d (ngưỡng %d ký tự), bài ngắn bỏ qua: %d'
                  % (len(linked), len(extra), MIN_CHARS, len(rows) - len(have & set(rows)) - len(extra)))

    out_dir = ROOT / 'post'
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir()
    (out_dir / 'post.css').write_text(CSS, encoding='utf-8')

    pages, skipped = {}, []
    for pid in ids:
        row = rows.get(pid)
        if not row:
            skipped.append((pid, 'không có trong posts.min.csv'))
            continue
        res = build_post(pid, row, related_for(pid, landing_blog, pages_cfg))
        if not res:
            skipped.append((pid, 'không có nội dung/ảnh'))
            continue
        pages[pid] = res
        (out_dir / pid).mkdir()
        (out_dir / pid / 'index.html').write_text(res['html'], encoding='utf-8')

    (out_dir / 'index.html').write_text(build_index(pages), encoding='utf-8')
    (ROOT / 'sitemap.xml').write_text(build_sitemap(pages), encoding='utf-8')
    (ROOT / 'robots.txt').write_text('User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n' % SITE, encoding='utf-8')
    print('Đã sinh %d trang bài, bỏ qua %d id.' % (len(pages), len(skipped)))
    for pid, why in skipped:
        print('  bỏ qua %s: %s' % (pid, why))


if __name__ == '__main__':
    main()
