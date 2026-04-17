#!/usr/bin/env python3
"""Enrich posts.json with attachments extracted from cached/API post info responses."""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from collections import OrderedDict
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_POSTS_PATH = ROOT_DIR / "data" / "posts.json"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "data" / "details"
DEFAULT_MANIFEST_PATH = DEFAULT_OUTPUT_DIR / "_manifest.json"
DEFAULT_API_ENDPOINT = "http://localhost:3000/call"
DEFAULT_CLIENT_ID = "YOUR_CLIENT_ID"
DEFAULT_API_NAME = "get_fb_post_info"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch/cached-replay post info responses, extract every attachment/"
            "subattachment/attached_post media, and merge them into posts.json."
        )
    )
    parser.add_argument(
        "--posts-path",
        default=str(DEFAULT_POSTS_PATH),
        help="Path to posts.json.",
    )
    parser.add_argument(
        "--out-dir",
        "--apis-dir",
        dest="out_dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory that stores <post_id>.json API responses.",
    )
    parser.add_argument(
        "--api-endpoint",
        default=DEFAULT_API_ENDPOINT,
        help="POST endpoint for get_fb_post_info.",
    )
    parser.add_argument(
        "--client-id",
        default=DEFAULT_CLIENT_ID,
        help="Client id sent in the API payload.",
    )
    parser.add_argument(
        "--api-name",
        default=DEFAULT_API_NAME,
        help="API name sent in the request payload.",
    )
    parser.add_argument(
        "--post-id",
        action="append",
        default=[],
        help="Only process these post ids. Can be passed multiple times or comma-separated.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N matched posts.",
    )
    parser.add_argument(
        "--force-refresh",
        action="store_true",
        help="Ignore cached <post_id>.json files and call the API again.",
    )
    parser.add_argument(
        "--api-delay-min",
        type=float,
        default=1.0,
        help="Minimum random delay in seconds between live API calls.",
    )
    parser.add_argument(
        "--api-delay-max",
        type=float,
        default=5.0,
        help="Maximum random delay in seconds between live API calls.",
    )
    parser.add_argument(
        "--cache-only",
        action="store_true",
        help="Only replay cached responses. Posts without cache will be skipped.",
    )
    parser.add_argument(
        "--include-single-media",
        action="store_true",
        help="Also fetch post detail for posts whose expected total_count is 1 or lower.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not write posts.json, cached responses, or manifest changes.",
    )
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def dump_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=4, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def load_posts(path: Path) -> list[dict[str, Any]]:
    payload = load_json(path)
    if not isinstance(payload, list):
        raise ValueError(f"Expected a list in {path}")
    return [item for item in payload if isinstance(item, dict)]


def load_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"updated_at": None, "posts": {}}

    try:
        payload = load_json(path)
    except json.JSONDecodeError:
        return {"updated_at": None, "posts": {}}

    if not isinstance(payload, dict):
        return {"updated_at": None, "posts": {}}

    posts = payload.get("posts")
    if not isinstance(posts, dict):
        payload["posts"] = {}
    return payload


def normalize_post_ids(raw_values: list[str]) -> set[str]:
    normalized: set[str] = set()
    for raw in raw_values:
        for part in str(raw).split(","):
            value = part.strip()
            if value:
                normalized.add(value)
    return normalized


def as_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def is_http_url(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(("http://", "https://"))


def first_http_url(*values: Any) -> str | None:
    for value in values:
        if is_http_url(value):
            return value
    return None


def first_text(*values: Any) -> str | None:
    for value in values:
        text = as_str(value)
        if text:
            return text
    return None


def get_nested(mapping: Any, *keys: str) -> Any:
    current = mapping
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def infer_attachment_type(node: dict[str, Any], hinted_type: str | None = None) -> str:
    if hinted_type:
        return hinted_type

    raw_type = first_text(node.get("type"), node.get("__typename"))
    if raw_type:
        lowered = raw_type.lower()
        if "video" in lowered:
            return "Video"
        if "photo" in lowered or "image" in lowered:
            return "Photo"

    if any(node.get(key) for key in ("playable_url", "browser_native_hd_url", "browser_native_sd_url")):
        return "Video"

    if any(node.get(key) for key in ("uri", "thumbnail", "image", "accessibility_caption")):
        return "Photo"

    return "Attachment"


def normalize_attachment(
    node: dict[str, Any],
    *,
    hinted_type: str | None,
    source_path: str,
    source_post_id: str | None,
) -> dict[str, Any] | None:
    attachment_id = as_str(node.get("id"))
    if not attachment_id:
        return None

    attachment_type = infer_attachment_type(node, hinted_type)
    url = first_http_url(
        node.get("browser_native_hd_url"),
        node.get("browser_native_sd_url"),
        node.get("playable_url"),
        node.get("url"),
        node.get("uri"),
        get_nested(node, "video", "url"),
        get_nested(node, "video", "playable_url"),
    )
    thumbnail = first_http_url(
        node.get("thumbnail"),
        node.get("uri"),
        node.get("image"),
        node.get("src"),
        get_nested(node, "image", "uri"),
        get_nested(node, "image", "url"),
        get_nested(node, "preview_image", "uri"),
        get_nested(node, "thumbnailImage", "uri"),
        get_nested(node, "preferred_thumbnail", "image", "uri"),
        get_nested(node, "preferred_thumbnail", "uri"),
    )

    attachment = {
        "id": attachment_id,
        "type": attachment_type,
        "title": first_text(node.get("title"), node.get("name"), node.get("accessibility_caption")),
        "thumbnail": thumbnail or url,
        "url": url,
        "uri": first_http_url(node.get("uri")),
        "width": node.get("width"),
        "height": node.get("height"),
        "real_width": node.get("real_width"),
        "real_height": node.get("real_height"),
        "accessibility_caption": first_text(node.get("accessibility_caption")),
        "source_post_id": source_post_id,
        "source_path": source_path,
    }

    return {
        key: value
        for key, value in attachment.items()
        if value not in (None, "", [], {})
    }


def iter_media_attachments(
    node: Any,
    *,
    source_path: str = "root",
    inherited_post_id: str | None = None,
):
    if isinstance(node, list):
        for index, item in enumerate(node):
            yield from iter_media_attachments(
                item,
                source_path=f"{source_path}[{index}]",
                inherited_post_id=inherited_post_id,
            )
        return

    if not isinstance(node, dict):
        return

    current_post_id = as_str(node.get("post_id")) or inherited_post_id

    media = node.get("media")
    if isinstance(media, dict):
        photo = media.get("photo")
        if isinstance(photo, dict):
            attachment = normalize_attachment(
                photo,
                hinted_type="Photo",
                source_path=f"{source_path}.media.photo",
                source_post_id=current_post_id,
            )
            if attachment:
                yield attachment

        video = media.get("video")
        if isinstance(video, dict):
            attachment = normalize_attachment(
                video,
                hinted_type="Video",
                source_path=f"{source_path}.media.video",
                source_post_id=current_post_id,
            )
            if attachment:
                yield attachment

        subattachments = media.get("subAttachments") or media.get("subattachments")
        if isinstance(subattachments, list):
            for index, item in enumerate(subattachments):
                if not isinstance(item, dict):
                    continue
                attachment = normalize_attachment(
                    item,
                    hinted_type=None,
                    source_path=f"{source_path}.media.subAttachments[{index}]",
                    source_post_id=current_post_id,
                )
                if attachment:
                    yield attachment
                yield from iter_media_attachments(
                    item,
                    source_path=f"{source_path}.media.subAttachments[{index}]",
                    inherited_post_id=current_post_id,
                )

    for key in ("attachment", "attachments", "subattachment", "subattachments"):
        value = node.get(key)
        if isinstance(value, dict):
            attachment = normalize_attachment(
                value,
                hinted_type=None,
                source_path=f"{source_path}.{key}",
                source_post_id=current_post_id,
            )
            if attachment:
                yield attachment
            yield from iter_media_attachments(
                value,
                source_path=f"{source_path}.{key}",
                inherited_post_id=current_post_id,
            )
        elif isinstance(value, list):
            for index, item in enumerate(value):
                if not isinstance(item, dict):
                    continue
                attachment = normalize_attachment(
                    item,
                    hinted_type=None,
                    source_path=f"{source_path}.{key}[{index}]",
                    source_post_id=current_post_id,
                )
                if attachment:
                    yield attachment
                yield from iter_media_attachments(
                    item,
                    source_path=f"{source_path}.{key}[{index}]",
                    inherited_post_id=current_post_id,
                )

    attached_post = node.get("attached_post")
    if isinstance(attached_post, dict):
        yield from iter_media_attachments(
            attached_post,
            source_path=f"{source_path}.attached_post",
            inherited_post_id=current_post_id,
        )


def unwrap_response(payload: Any) -> Any:
    if isinstance(payload, dict):
        for key in ("data", "result"):
            candidate = payload.get(key)
            if isinstance(candidate, dict) and any(
                field in candidate for field in ("post_id", "media", "attached_post", "url")
            ):
                return candidate
    return payload


def merge_attachment_payloads(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = deepcopy(existing)
    for key, value in incoming.items():
        if value not in (None, "", [], {}):
            merged[key] = value
    return merged


def merge_attachments(
    existing_items: list[Any],
    extracted_items: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int, int]:
    by_id: OrderedDict[str, dict[str, Any]] = OrderedDict()
    deduped_existing = 0

    for item in existing_items:
        if not isinstance(item, dict):
            continue
        attachment_id = as_str(item.get("id"))
        if not attachment_id:
            continue
        normalized_existing = {key: value for key, value in item.items() if value is not None}
        if attachment_id in by_id:
            deduped_existing += 1
            by_id[attachment_id] = merge_attachment_payloads(by_id[attachment_id], normalized_existing)
            continue
        by_id[attachment_id] = normalized_existing

    added = 0
    for item in extracted_items:
        attachment_id = item["id"]
        if attachment_id in by_id:
            by_id[attachment_id] = merge_attachment_payloads(by_id[attachment_id], item)
        else:
            by_id[attachment_id] = deepcopy(item)
            added += 1

    total_count = len(by_id)
    merged_items: list[dict[str, Any]] = []
    for item in by_id.values():
        merged = {key: value for key, value in item.items() if value is not None}
        merged["total_count"] = total_count
        merged_items.append(merged)

    return merged_items, added, deduped_existing


def count_unique_attachment_ids(items: list[Any]) -> int:
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        attachment_id = as_str(item.get("id"))
        if attachment_id:
            seen.add(attachment_id)
    return len(seen)


def existing_attachments_complete(existing_items: list[Any]) -> tuple[bool, int, int | None]:
    total_counts: list[int] = []
    for item in existing_items:
        if not isinstance(item, dict):
            continue
        value = item.get("total_count")
        if isinstance(value, bool):
            continue
        if isinstance(value, int) and value > 0:
            total_counts.append(value)
        elif isinstance(value, str):
            text = value.strip()
            if text.isdigit():
                parsed = int(text)
                if parsed > 0:
                    total_counts.append(parsed)

    if not total_counts:
        return False, count_unique_attachment_ids(existing_items), None

    expected_total = max(total_counts)
    current_total = count_unique_attachment_ids(existing_items)
    return expected_total <= current_total, current_total, expected_total


def extract_unique_attachments(payload: Any) -> list[dict[str, Any]]:
    by_id: OrderedDict[str, dict[str, Any]] = OrderedDict()
    for attachment in iter_media_attachments(unwrap_response(payload)):
        attachment_id = attachment["id"]
        if attachment_id in by_id:
            by_id[attachment_id] = merge_attachment_payloads(by_id[attachment_id], attachment)
        else:
            by_id[attachment_id] = attachment
    return list(by_id.values())


def fetch_post_info(
    *,
    endpoint: str,
    client_id: str,
    api_name: str,
    post_id: str,
) -> Any:
    payload = {
        "id": client_id,
        "apiname": api_name,
        "apiparams": {
            "url": post_id,
        },
    }
    request = Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=60) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        body = response.read().decode(charset)
    return json.loads(body)


def select_posts(posts: list[dict[str, Any]], selected_ids: set[str], limit: int | None) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for post in posts:
        post_id = as_str(post.get("post_id") or post.get("id"))
        if not post_id:
            continue
        if selected_ids and post_id not in selected_ids:
            continue
        selected.append(post)
        if limit is not None and len(selected) >= limit:
            break
    return selected


def main() -> int:
    args = parse_args()
    posts_path = Path(args.posts_path).expanduser().resolve()
    apis_dir = Path(args.out_dir).expanduser().resolve()
    manifest_path = apis_dir / DEFAULT_MANIFEST_PATH.name

    posts = load_posts(posts_path)
    manifest = load_manifest(manifest_path)
    selected_ids = normalize_post_ids(args.post_id)
    selected_posts = select_posts(posts, selected_ids, args.limit)

    if not selected_posts:
        print("[INFO] No posts matched the current filters.")
        return 0

    if args.api_delay_min < 0 or args.api_delay_max < 0:
        raise ValueError("api delay must be >= 0")
    if args.api_delay_max < args.api_delay_min:
        raise ValueError("api-delay-max must be >= api-delay-min")

    if not args.dry_run:
        apis_dir.mkdir(parents=True, exist_ok=True)

    stats = {
        "processed": 0,
        "api_calls": 0,
        "cache_hits": 0,
        "updated_posts": 0,
        "new_attachments": 0,
        "deduped_existing": 0,
        "errors": 0,
        "skipped_missing_cache": 0,
        "skipped_complete": 0,
        "skipped_single_media": 0,
    }
    posts_changed = False

    for post in selected_posts:
        post_id = as_str(post.get("post_id") or post.get("id"))
        if not post_id:
            continue

        stats["processed"] += 1
        cache_path = apis_dir / f"{post_id}.json"
        cache_exists = cache_path.exists()
        source = "api"
        payload: Any | None = None
        error_message: str | None = None
        content = post.get("content")
        existing_items = content.get("attachments") if isinstance(content, dict) and isinstance(content.get("attachments"), list) else []
        is_complete, current_total, expected_total = existing_attachments_complete(existing_items)
        should_fetch_single_media_detail = (
            args.include_single_media
            and (expected_total is None or expected_total <= 1)
            and (args.force_refresh or not cache_exists)
        )

        if expected_total is not None and expected_total <= 1 and not args.include_single_media:
            stats["skipped_single_media"] += 1
            manifest["posts"][post_id] = {
                "status": "skipped",
                "reason": "single_media_disabled",
                "response_file": cache_path.name,
                "processed_at": utc_now(),
                "attachment_count": current_total,
                "expected_total_count": expected_total,
            }
            continue

        if is_complete and not should_fetch_single_media_detail:
            stats["skipped_complete"] += 1
            manifest["posts"][post_id] = {
                "status": "skipped",
                "reason": "attachments_complete",
                "response_file": cache_path.name,
                "processed_at": utc_now(),
                "attachment_count": current_total,
                "expected_total_count": expected_total,
            }
            continue

        if cache_exists and not args.force_refresh:
            try:
                payload = load_json(cache_path)
                source = "cache"
                stats["cache_hits"] += 1
            except json.JSONDecodeError:
                payload = None

        if payload is None and args.cache_only:
            stats["skipped_missing_cache"] += 1
            manifest["posts"][post_id] = {
                "status": "skipped",
                "reason": "missing_cache",
                "response_file": cache_path.name,
                "processed_at": utc_now(),
            }
            continue

        if payload is None:
            try:
                if stats["api_calls"] > 0 and args.api_delay_max > 0:
                    delay_seconds = random.uniform(args.api_delay_min, args.api_delay_max)
                    print(f"[INFO] Waiting {delay_seconds:.2f}s before API call for {post_id}")
                    time.sleep(delay_seconds)
                payload = fetch_post_info(
                    endpoint=args.api_endpoint,
                    client_id=args.client_id,
                    api_name=args.api_name,
                    post_id=post_id,
                )
                stats["api_calls"] += 1
                if not args.dry_run:
                    dump_json(cache_path, payload)
            except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
                error_message = str(exc)
            except Exception as exc:  # pragma: no cover - defensive fallback
                error_message = str(exc)

        if payload is None:
            stats["errors"] += 1
            manifest["posts"][post_id] = {
                "status": "error",
                "error": error_message or "unknown_error",
                "response_file": cache_path.name,
                "processed_at": utc_now(),
            }
            print(f"[WARN] Failed {post_id}: {error_message or 'unknown error'}")
            continue

        extracted = extract_unique_attachments(payload)

        content = post.setdefault("content", {})
        if not isinstance(content, dict):
            content = {}
            post["content"] = content

        merged_items, added, deduped_existing = merge_attachments(
            content.get("attachments") if isinstance(content.get("attachments"), list) else [],
            extracted,
        )

        if merged_items != content.get("attachments"):
            content["attachments"] = merged_items
            posts_changed = True
            stats["updated_posts"] += 1

        stats["new_attachments"] += added
        stats["deduped_existing"] += deduped_existing

        manifest["posts"][post_id] = {
            "status": "success",
            "source": source,
            "response_file": cache_path.name,
            "processed_at": utc_now(),
            "attachment_count": len(merged_items),
            "extracted_count": len(extracted),
            "new_attachments": added,
            "deduped_existing": deduped_existing,
        }

    manifest["updated_at"] = utc_now()

    if posts_changed and not args.dry_run:
        dump_json(posts_path, posts)

    if not args.dry_run:
        dump_json(manifest_path, manifest)

    print(
        "[OK] "
        f"processed={stats['processed']} "
        f"api_calls={stats['api_calls']} "
        f"cache_hits={stats['cache_hits']} "
        f"updated_posts={stats['updated_posts']} "
        f"new_attachments={stats['new_attachments']} "
        f"deduped_existing={stats['deduped_existing']} "
        f"skipped_missing_cache={stats['skipped_missing_cache']} "
        f"skipped_complete={stats['skipped_complete']} "
        f"skipped_single_media={stats['skipped_single_media']} "
        f"errors={stats['errors']}"
    )
    return 0 if stats["errors"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
