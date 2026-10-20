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
```

Kết quả: `post/<id>/index.html`, `post/index.html` (mục lục), `post/post.css`, `sitemap.xml`, `robots.txt`. Mỗi lần chạy xoá và tạo lại thư mục `post/` - không sửa tay. Khi thêm/sửa bài hoặc thêm link `blog.fbaio.org/#post/<id>` mới trong app: chạy lại rồi commit các file sinh ra.
