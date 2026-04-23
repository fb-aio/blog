# blog

FB AIO blog

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
