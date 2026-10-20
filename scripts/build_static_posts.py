#!/usr/bin/env python3
"""Sinh trang tĩnh cho SEO: post/<id>/index.html, post/index.html, sitemap.xml, robots.txt.

Vì sao: SPA dùng hash route (/#post/<id>) nên Google không index được từng bài.
Script chỉ dùng thư viện chuẩn, đọc data/posts.min.csv + data/details/<id>.json,
KHÔNG sửa data. Mỗi lần chạy sẽ XOÁ và sinh lại toàn bộ thư mục post/.

Cách dùng (chạy ở thư mục gốc của blog):
    python3 scripts/build_static_posts.py                 # dùng scripts/static-post-ids.txt
    python3 scripts/build_static_posts.py --refresh-ids   # quét lại repo cha để cập nhật danh sách id
    python3 scripts/build_static_posts.py --all           # sinh cho tất cả bài có dữ liệu
"""
import argparse
import csv
import html
import json
import re
import shutil
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


def build_post(pid, row):
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

    body = """<main><div class="wrap"><article>
<h1>{h1}</h1>
<div class="meta"><time datetime="{iso}">{ds}</time> · {site}</div>
<div class="body">
{content}
</div>
{media}
<div class="cta">
<a class="btn primary" href="/#post/{pid}">Xem trên blog (kèm bình luận)</a>
<a class="btn" href="{main}/">Dùng Social AIO tại fbaio.org</a>
</div>
</article></div></main>""".format(h1=esc(h1), iso=iso, ds=dstr, site=SITE_NAME,
                                  content=render_md(body_md), media=media_html, pid=pid, main=MAIN_SITE)

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
<p class="meta">{n} bài viết hướng dẫn sử dụng các tính năng của Social AIO. Xem toàn bộ {site} (tìm kiếm, bình luận) tại <a href="/">trang chủ blog</a>.</p>
<ul class="posts">
{items}
</ul></div></main>""".format(n=len(pages), site=SITE_NAME, items='\n'.join(items))
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


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--refresh-ids', action='store_true', help='quét repo cha để cập nhật scripts/static-post-ids.txt')
    ap.add_argument('--all', action='store_true', help='sinh cho mọi bài trong posts.min.csv có dữ liệu')
    args = ap.parse_args()

    rows = load_rows()
    if args.refresh_ids:
        ids = scan_ids()
        IDS_FILE.write_text('\n'.join(ids) + '\n', encoding='utf-8')
        print('Đã quét repo cha: %d id -> %s' % (len(ids), IDS_FILE.relative_to(ROOT)))
    if args.all:
        ids = sorted(rows)
    else:
        if not IDS_FILE.exists():
            sys.exit('Thiếu %s, chạy với --refresh-ids' % IDS_FILE)
        ids = [x.strip() for x in IDS_FILE.read_text().split() if x.strip()]

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
        res = build_post(pid, row)
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
