# Posts Tool

Script chính bây giờ là `posts_tool.py`. Nó gom toàn bộ workflow vào một chỗ và có cả:

- menu interactive từng bước
- subcommand CLI để chạy thẳng
- wrapper tương thích cho các script cũ

## Chạy menu interactive

```bash
python3 scripts/posts_tool.py
```

Menu hiện có:

1. Download post detail info
2. Download post media
3. Build compact CSV from `posts.json` + `data/details`
4. Backup single post into full pipeline

## 1. Download post detail info

Input:

- path tới `posts.json`
- output dir cho detail json, mặc định `data/details`
- API config: `endpoint`, `client_id`

`api_name` được cố định nội bộ là `get_fb_post_info`.

CLI tương đương:

```bash
python3 scripts/posts_tool.py details \
  --posts-path data/posts.json \
  --out-dir data/details \
  --api-endpoint https://api.fbaio.xyz/call \
  --client-id YOUR_CLIENT_ID
```

Kết quả:

- tạo file `data/details/<post_id>.json`
- cập nhật manifest `data/details/_manifest.json`

## 2. Download post media

Input:

- path tới `posts.json`
- path tới `data/details` là optional
- media output dir, mặc định `media/`
- API config: `endpoint`, `client_id`

`api_name` được cố định nội bộ là `get_fb_video_info`.

Rule:

- nếu có `data/details/<post_id>.json` thì ưu tiên lấy attachment từ detail file
- nếu không có detail file thì fallback sang `posts.json`
- tên file output luôn theo format `<post_id>_<attachment_id>.<ext>`

CLI tương đương:

```bash
python3 scripts/posts_tool.py media \
  --posts-path data/posts.json \
  --details-dir data/details \
  --output-dir media \
  --api-endpoint https://api.fbaio.xyz/call \
  --client-id YOUR_CLIENT_ID \
  --mode all
```

Nếu muốn bỏ qua detail folder:

```bash
python3 scripts/posts_tool.py media \
  --posts-path data/posts.json \
  --skip-details \
  --output-dir media
```

`--mode` hỗ trợ:

- `images`: chỉ tải ảnh và thumbnail
- `videos`: chỉ tải video
- `all`: tải cả hai

## 3. Build compact CSV

Input:

- path tới `posts.json`
- path tới `data/details` là optional
- output csv, mặc định `data/posts.min.csv`

CSV output sẽ:

- compact dữ liệu từ `posts.json`
- inject `reactions`, `comments`, `shares`, `hashtags` từ detail file nếu có
- sync ngược attachment từ `data/details` vào `posts.json` trước khi build CSV
- bỏ field `url`

CLI tương đương:

```bash
python3 scripts/posts_tool.py csv \
  --posts-path data/posts.json \
  --details-dir data/details \
  --output-csv data/posts.min.csv
```

## 4. Backup single post

Input:

- `post_id`
- path tới `posts.json`
- details dir
- media output dir
- csv output path
- shared API config: `endpoint`, `client_id`

Flow này sẽ:

1. fetch/sync `data/details/<post_id>.json`
2. dựng hoặc update record tương ứng trong `posts.json`
3. tải media của riêng post đó vào `media/`
4. regenerate `posts.min.csv`

CLI tương đương:

```bash
python3 scripts/posts_tool.py backup-post 1893793864608626 \
  --posts-path data/posts.json \
  --details-dir data/details \
  --media-output-dir media \
  --output-csv data/posts.min.csv \
  --api-endpoint https://api.fbaio.xyz/call \
  --client-id YOUR_CLIENT_ID
```

Use case:

- có bài mới ngoài `posts.json`
- chỉ cần biết `post_id`
- chạy một lệnh là website có thể đọc được ngay sau khi `posts.min.csv` được regenerate
