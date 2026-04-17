# Posts Attachment Downloader

Script `download_posts_attachments.py` dùng để tải attachment từ file `posts.json`.

## Yêu cầu

- Python 3
- File `posts.json`

## Cách chạy

Nếu bạn đang đứng trong thư mục này, ví dụ file JSON nằm trong thư mục `Downloads`, có thể chạy bằng đường dẫn tương đối:

```bash
python3 download_posts_attachments.py ../../Downloads/posts.json --mode images
```

## Các mode

### 1. Chỉ tải ảnh và thumbnail

```bash
python3 download_posts_attachments.py ../../Downloads/posts.json --mode images
```

Mode này:

- Tải `Photo`
- Tải `ProfilePicAttachmentMedia`
- Tải thumbnail của `GenericAttachmentMedia`
- Tải thumbnail của `Video`
- Không gọi video API

### 2. Chỉ tải video

```bash
python3 download_posts_attachments.py ../../Downloads/posts.json --mode videos
```

Mode này:

- Chỉ xử lý attachment có `type = Video`
- Gọi API `get_fb_video_info` bằng `attachment id`
- Tải file video từ field `source`
- Nếu thumbnail của video chưa có, script sẽ dùng thumbnail từ export JSON hoặc fallback sang `thumbnail` trong response API

### 3. Tải cả ảnh lẫn video

```bash
python3 download_posts_attachments.py ../../Downloads/posts.json --mode all
```

Mode này:

- Tải toàn bộ ảnh trước
- Dồn toàn bộ video xuống cuối
- Với mỗi video, tải thumbnail trước rồi mới gọi API để tải video

## Xem trước không tải

```bash
python3 download_posts_attachments.py ../../Downloads/posts.json --mode images --dry-run
python3 download_posts_attachments.py ../../Downloads/posts.json --mode videos --dry-run
```

## Điều chỉnh delay khi gọi video API

```bash
python3 download_posts_attachments.py ../../Downloads/posts.json --mode videos --api-delay-min 3 --api-delay-max 8
```

Script sẽ random delay trong khoảng này trước mỗi lần gọi API video.

## Resume và skip file đã tải

Mặc định script lưu file vào:

```text
../../Downloads/posts_attachments
```

Trong thư mục output, script sẽ tạo file manifest:

```text
download_manifest.json
```

Khi chạy lại:

- Nếu file đã tồn tại, script sẽ skip
- Nếu manifest đã ghi nhận file đó là hoàn tất, script sẽ skip
- Thumbnail video và file video được track riêng, nên có thể tải tiếp phần còn thiếu

## Đổi thư mục output

```bash
python3 download_posts_attachments.py ../../Downloads/posts.json --mode images --output-dir ./posts_attachments
```

## Tên file output

Mỗi attachment được lưu theo format:

```text
<post-id>_<attachment-id>.<ext>
```

Ví dụ:

```text
1889428528378493_3179438865561025.jpg
1790263114961702_861118999837838.mp4
```

## Ghi chú

- `images` mode phù hợp khi chưa gọi được video API
- `videos` mode phù hợp để resume video sau
- Nếu API bị chặn bởi network/web filter, chỉ `videos` mode bị ảnh hưởng
