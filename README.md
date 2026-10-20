# blog

FB AIO blog

<!-- aio-desktop-badge:start -->
[![AIO Desktop](https://img.shields.io/badge/Try-AIO_Desktop-7c3aed?style=for-the-badge&logo=googlechrome&logoColor=white)](https://fbaio.org/#/desktop)
<!-- aio-desktop-badge:end -->

## Post notes

Per-post manual notes live in [data/post-notes.json](/Users/hoangtran/Desktop/Github/facebook-all-in-one-dev/submodules/blog/data/post-notes.json), separate from `data/posts.json` and `data/posts.min.csv`.

Format:

```json
{
  "notes": {
    "1543939952927354": "Link ở comment chưa được backup. Kiểm tra lại nguồn gốc trước khi làm theo.",
    "912967938234833": "Ghi chú hỗ trợ markdown, ví dụ [link tham khảo](https://example.com)."
  }
}
```

Each key is a `post_id`. The value is markdown text and will be shown in the post detail page under `Ghi chú`.

## Thumbhash

`data/posts.min.csv` now stores a `thumbhash` column for grid placeholders. Generate or refresh it from local media files with:

```bash
python3 scripts/posts_tool.py thumbhash-csv --csv-path data/posts.min.csv --media-dir media
```

<!-- aio-desktop:start -->
### 🖥️ AIO Desktop

**EN:** Find this and many more free tools & games in **[AIO Desktop](https://fbaio.org/#/desktop)** — a Windows/macOS-style web desktop by Social AIO. [▶ Open AIO Desktop](https://fbaio.org/#/desktop)

**VI:** Xem app này cùng nhiều công cụ, trò chơi miễn phí khác trong **[AIO Desktop](https://fbaio.org/#/desktop)** — màn hình kiểu Windows/macOS của Social AIO. [▶ Mở AIO Desktop](https://fbaio.org/#/desktop)
<!-- aio-desktop:end -->

## Trang tĩnh cho SEO (`/post/<id>/`, `sitemap.xml`, `robots.txt`)

SPA dùng hash route nên Google không index từng bài. Script sinh bản HTML tĩnh cho các bài mà web app/extension trỏ tới:

```bash
python3 scripts/build_static_posts.py                # sinh lại từ scripts/static-post-ids.txt
python3 scripts/build_static_posts.py --refresh-ids  # quét repo cha (src/, submodules/extension) lấy lại danh sách id
python3 scripts/build_static_posts.py --all          # sinh cho mọi bài có dữ liệu
python3 scripts/build_static_posts.py --linked-only  # chỉ các id trong static-post-ids.txt
python3 scripts/build_static_posts.py --links        # quét lại ánh xạ bài -> route app (xem dưới)
```

Mặc định = id trong `static-post-ids.txt` ∪ mọi bài có >= 300 ký tự text (bỏ markdown); bài thông báo ngắn bị bỏ qua (tránh thin content).

**Ánh xạ bài → route app** (`--links`): (1) nguồn: file trong `src/` chứa link `blog.fbaio.org/#post/<id>` được map sang route qua `src/routes/menus.ts` (import `@screens/...` + `path:`; thư mục `BulkDownloader/<nền tảng>/` thêm `?platform=`); (2) nội dung: bài có link `fbaio.org/#/<route>`, `facebook-all-in-one.com/#/...`, `fb-aio.github.io/#/...`. Ghi ra `scripts/post-routes.json` (blog, dùng khi build) và `../../scripts/landing-pages/blog-links.json` (repo cha: `{route: [{id,title}]}`, mới nhất trước, tối đa 8/route). Route có query trong `PAGES` (vd `/bulk-downloader?platform=Facebook`) cũng nhận bài của route gốc, trừ bài đã gắn nền tảng khác. Hộp "Công cụ liên quan" (trỏ `https://fbaio.org/tinh-nang/<slug>/`) lấy từ `../../scripts/landing-pages/landing-blog.json` — chính danh sách bài mà `generate.js` của repo cha đã chọn cho mục "Bài hướng dẫn" (lọc theo `route` hoặc regex `blog` trong `pages.js`) → link luôn hai chiều. Thứ tự khi thêm landing page/bài mới: `build_static_posts.py --links` → `node scripts/landing-pages/generate.js` (repo cha) → `build_static_posts.py`.

Kết quả: `post/<id>/index.html`, `post/index.html` (mục lục), `post/post.css`, `sitemap.xml`, `robots.txt`. Mỗi lần chạy xoá và tạo lại thư mục `post/` - không sửa tay. Khi thêm/sửa bài hoặc thêm link `blog.fbaio.org/#post/<id>` mới trong app: chạy lại rồi commit các file sinh ra.
