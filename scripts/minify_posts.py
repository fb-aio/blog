#!/usr/bin/env python3
"""
Minify Facebook posts data — extract only essential fields.

Outputs:
  posts.min.json  — compact JSON (no indent, nulls stripped)
  posts.min.csv    — flat CSV (attachments as "type:id,type:id,...")
"""

import csv
import json
import sys
from pathlib import Path


INPUT_DIR  = Path(__file__).parent.parent / "data"
INPUT_PATH  = INPUT_DIR / "posts.json"
JSON_PATH   = INPUT_DIR / "posts.min.json"
CSV_PATH    = INPUT_DIR / "posts.min.csv"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _compact_url(url: str) -> str:
    """Shorten common Facebook URL prefixes."""
    return url.replace("https://www.facebook.com", "https://fb.com")


def _compact_attachments(content: dict) -> list[dict]:
    """Return list of {type, id} from content.attachments."""
    out = []
    for att in content.get("attachments", []):
        att_id   = att.get("id", "")
        att_type = att.get("type", "")
        if att_id or att_type:
            out.append({"type": att_type, "id": att_id})
    return out


def _compact_post(post: dict) -> dict:
    """Extract essential fields, drop null/empty."""
    result = {
        "post_id":       post.get("post_id"),
        "creation_time": post.get("creation_time"),
        "url":           _compact_url(post.get("url", "")),
    }

    msg = post.get("message")
    if msg:
        result["message"] = msg

    title = post.get("title")
    if title:
        result["title"] = title

    summary = post.get("summary")
    if summary:
        result["summary"] = summary

    attachments = _compact_attachments(post.get("content", {}))
    if attachments:
        result["attachments"] = attachments

    content_text = post.get("content", {}).get("text", "")
    if content_text:
        result["content_text"] = content_text

    return result


def _attachments_csv_str(attachments: list[dict]) -> str:
    """Compact attachments into a single string: Photo:123,Video:456."""
    return ",".join(f"{a['type']}:{a['id']}" for a in attachments) if attachments else ""


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------

def _write_json(posts: list[dict]) -> int:
    """Compact JSON — no indent, separators compact."""
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(posts, f, ensure_ascii=False, separators=(",", ":"))
    return JSON_PATH.stat().st_size


def _write_csv(posts: list[dict]) -> int:
    """Flat CSV — attachments as type:id string."""
    fieldnames = [
        "post_id", "creation_time", "url", "message", "title",
        "summary", "attachments", "content_text",
    ]
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for p in posts:
            row = {k: p.get(k, "") for k in fieldnames}
            row["attachments"] = _attachments_csv_str(p.get("attachments", []))
            # escape newlines in message and content_text for CSV readability
            for field in ("message", "content_text"):
                if row[field]:
                    row[field] = row[field].replace("\n", "\\n")
            writer.writerow(row)
    return CSV_PATH.stat().st_size


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if not INPUT_PATH.exists():
        print(f"[ERROR] Input file not found: {INPUT_PATH}")
        sys.exit(1)

    print(f"[INFO] Loading {INPUT_PATH} ...")
    with open(INPUT_PATH, encoding="utf-8") as f:
        posts_raw = json.load(f)

    if not isinstance(posts_raw, list):
        print("[ERROR] Expected posts.json to be a list of posts.")
        sys.exit(1)

    print(f"[INFO] Minifying {len(posts_raw)} posts ...")
    posts = [_compact_post(p) for p in posts_raw]

    orig_size = INPUT_PATH.stat().st_size

    # print(f"[INFO] Writing compact JSON → {JSON_PATH} ...")
    # json_size = _write_json(posts)
    # json_saved = orig_size - json_size

    print(f"[INFO] Writing CSV          → {CSV_PATH} ...")
    csv_size = _write_csv(posts)
    csv_saved = orig_size - csv_size

    print(f"""
[OK] Done — original: {orig_size/1024:.1f} KB
  CSV   : {csv_size/1024:.1f} KB  (saved {csv_saved/1024:.1f} KB / {csv_saved/orig_size*100:.1f}%)
""")
# JSON  : {json_size/1024:.1f} KB  (saved {json_saved/1024:.1f} KB / {json_saved/orig_size*100:.1f}%)


if __name__ == "__main__":
    main()
