#!/usr/bin/env python3
"""Unified interactive tool for downloading post details, media, and compact CSV exports."""

from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import random
import sys
import time
from collections import OrderedDict
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_POSTS_PATH = ROOT_DIR / "data" / "posts.json"
DEFAULT_DETAILS_DIR = ROOT_DIR / "data" / "details"
DEFAULT_MEDIA_DIR = ROOT_DIR / "media"
DEFAULT_CSV_PATH = ROOT_DIR / "data" / "posts.min.csv"
DEFAULT_DETAILS_MANIFEST = DEFAULT_DETAILS_DIR / "_manifest.json"
DEFAULT_API_ENDPOINT = "https://api.fbaio.xyz/call"
DEFAULT_DETAIL_API_ENDPOINT = DEFAULT_API_ENDPOINT
DEFAULT_DETAIL_API_NAME = "get_fb_post_info"
DEFAULT_MEDIA_API_ENDPOINT = DEFAULT_API_ENDPOINT
DEFAULT_MEDIA_API_NAME = "get_fb_video_info"
DEFAULT_PHOTO_API_NAME = "get_largest_photo"
DEFAULT_CLIENT_ID = "YOUR_CLIENT_ID"
CSV_FIELDS = [
    "post_id",
    "creation_time",
    "message",
    "title",
    "summary",
    "attachments",
    "content_text",
    "reactions",
    "comments",
    "shares",
    "hashtags",
]

COMMON_CONTENT_TYPE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/avif": ".avif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/x-m4v": ".m4v",
}

IMAGE_TYPES = {"photo", "profilepicattachmentmedia"}
VIDEO_TYPES = {"video"}
GENERIC_MEDIA_TYPES = {"genericattachmentmedia"}
IMAGE_FILE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".bmp",
    ".heic",
    ".heif",
    ".avif",
}
VIDEO_FILE_EXTENSIONS = {".mp4", ".mov", ".webm", ".m4v"}


@dataclass(frozen=True)
class APIConfig:
    endpoint: str
    client_id: str
    api_name: str


@dataclass(frozen=True)
class AttachmentJob:
    post_id: str
    attachment_id: str
    attachment_type: str
    attachment_index: int
    post_url: str | None
    thumbnail_url: str | None
    title_url: str | None

    @property
    def stem(self) -> str:
        return f"{self.post_id}_{self.attachment_id}"


@dataclass
class ResumeState:
    output_dir: Path
    files_by_stem: dict[str, set[str]] = field(default_factory=dict)


def build_detail_api_config(endpoint: str, client_id: str) -> APIConfig:
    return APIConfig(endpoint, client_id, DEFAULT_DETAIL_API_NAME)


def build_media_api_config(endpoint: str, client_id: str) -> APIConfig:
    return APIConfig(endpoint, client_id, DEFAULT_MEDIA_API_NAME)


def read_posts_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return load_posts_export(path)


def log_info(message: str) -> None:
    print(f"[INFO] {message}", flush=True)


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


def as_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def as_http_url(value: Any) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("http://") or text.startswith("https://"):
            return text
    return None


def first_http_url(*values: Any) -> str | None:
    for value in values:
        url = as_http_url(value)
        if url:
            return url
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


def normalize_post_ids(raw_values: Iterable[str]) -> set[str]:
    normalized: set[str] = set()
    for raw in raw_values:
        for part in str(raw).split(","):
            value = part.strip()
            if value:
                normalized.add(value)
    return normalized


def normalize_post_id(post: dict[str, Any], fallback_index: int) -> str:
    return as_str(post.get("post_id") or post.get("id")) or f"post-{fallback_index}"


def load_posts_export(path: Path) -> list[dict[str, Any]]:
    payload = load_json(path)
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict) and isinstance(payload.get("posts"), list):
        return [item for item in payload["posts"] if isinstance(item, dict)]
    raise ValueError("Expected a list of posts or an object with a 'posts' list.")


def load_optional_detail_payload(details_dir: Path | None, post_id: str) -> Any | None:
    if not details_dir:
        return None
    detail_path = details_dir / f"{post_id}.json"
    if not detail_path.exists():
        return None
    return load_json(detail_path)


def unwrap_response(payload: Any) -> Any:
    if isinstance(payload, dict):
        for key in ("data", "result"):
            candidate = payload.get(key)
            if isinstance(candidate, dict) and any(
                field in candidate for field in ("post_id", "media", "attached_post", "url")
            ):
                return candidate
    return payload


def infer_attachment_type(node: dict[str, Any], hinted_type: str | None = None) -> str:
    if hinted_type:
        return hinted_type

    url_candidates = (
        node.get("url"),
        get_nested(node, "video", "url"),
        get_nested(node, "video", "playable_url"),
    )
    for candidate in url_candidates:
        text = as_http_url(candidate)
        if text and "/videos/" in text.lower():
            return "Video"

    raw_type = first_text(node.get("type"), node.get("__typename"))
    if raw_type:
        lowered = raw_type.lower()
        if "video" in lowered:
            return "Video"
        if "photo" in lowered or "image" in lowered:
            return "Photo"

    if any(
        node.get(key)
        for key in ("playable_url", "browser_native_hd_url", "browser_native_sd_url")
    ):
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
        "source_post_id": source_post_id,
        "source_path": source_path,
    }
    return {key: value for key, value in attachment.items() if value not in (None, "", [], {})}


def iter_detail_attachments(
    node: Any,
    *,
    source_path: str = "root",
    inherited_post_id: str | None = None,
) -> Iterable[dict[str, Any]]:
    if isinstance(node, list):
        for index, item in enumerate(node):
            yield from iter_detail_attachments(
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
                yield from iter_detail_attachments(
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
            yield from iter_detail_attachments(
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
                yield from iter_detail_attachments(
                    item,
                    source_path=f"{source_path}.{key}[{index}]",
                    inherited_post_id=current_post_id,
                )

    attached_post = node.get("attached_post")
    if isinstance(attached_post, dict):
        yield from iter_detail_attachments(
            attached_post,
            source_path=f"{source_path}.attached_post",
            inherited_post_id=current_post_id,
        )


def extract_unique_detail_attachments(payload: Any) -> list[dict[str, Any]]:
    by_id: OrderedDict[str, dict[str, Any]] = OrderedDict()
    for attachment in iter_detail_attachments(unwrap_response(payload)):
        attachment_id = attachment["id"]
        if attachment_id not in by_id:
            by_id[attachment_id] = attachment
            continue
        merged = deepcopy(by_id[attachment_id])
        for key, value in attachment.items():
            if value not in (None, "", [], {}):
                merged[key] = value
        by_id[attachment_id] = merged
    return list(by_id.values())


def extract_post_json_attachments(post: dict[str, Any], post_id: str) -> list[dict[str, Any]]:
    content = post.get("content")
    attachments = content.get("attachments") if isinstance(content, dict) else None
    if not isinstance(attachments, list):
        return []

    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(attachments, start=1):
        if not isinstance(item, dict):
            continue
        attachment_id = as_str(item.get("id"))
        if not attachment_id:
            continue
        normalized.append(
            {
                "id": attachment_id,
                "type": first_text(item.get("type"), "Attachment") or "Attachment",
                "thumbnail": first_http_url(item.get("thumbnail"), item.get("uri"), item.get("url")),
                "url": first_http_url(item.get("url"), item.get("uri")),
                "title": first_text(item.get("title"), item.get("name")),
                "source_post_id": post_id,
                "source_path": f"posts.json.content.attachments[{index - 1}]",
            }
        )
    return normalized


def collect_preferred_attachments(post: dict[str, Any], detail_payload: Any | None) -> list[dict[str, Any]]:
    post_id = as_str(post.get("post_id") or post.get("id")) or ""
    detail_attachments = extract_unique_detail_attachments(detail_payload) if detail_payload else []
    if detail_attachments:
        return detail_attachments
    return extract_post_json_attachments(post, post_id)


def build_attachment_jobs(
    posts: Iterable[dict[str, Any]],
    *,
    details_dir: Path | None = None,
) -> list[AttachmentJob]:
    jobs: list[AttachmentJob] = []
    for index, post in enumerate(posts, start=1):
        post_id = normalize_post_id(post, index)
        detail_payload = load_optional_detail_payload(details_dir, post_id) if details_dir else None
        attachments = collect_preferred_attachments(post, detail_payload)
        post_url = first_http_url(
            get_nested(unwrap_response(detail_payload), "url") if detail_payload else None,
            post.get("url"),
        )
        seen_ids: set[str] = set()

        for attachment_index, attachment in enumerate(attachments, start=1):
            attachment_id = as_str(attachment.get("id"))
            if not attachment_id or attachment_id in seen_ids:
                continue
            seen_ids.add(attachment_id)
            jobs.append(
                AttachmentJob(
                    post_id=post_id,
                    attachment_id=attachment_id,
                    attachment_type=first_text(attachment.get("type"), "Attachment") or "Attachment",
                    attachment_index=attachment_index,
                    post_url=post_url,
                    thumbnail_url=first_http_url(
                        attachment.get("thumbnail"),
                        attachment.get("uri"),
                        attachment.get("url"),
                    ),
                    title_url=first_http_url(attachment.get("url")),
                )
            )
    return jobs


def normalize_metric(value: Any) -> str:
    try:
        parsed = int(value or 0)
    except (TypeError, ValueError):
        parsed = 0
    return str(parsed if parsed > 0 else 0)


def normalize_hashtags(tags: Any) -> str:
    if not isinstance(tags, list):
        return ""
    ordered: list[str] = []
    seen: set[str] = set()
    for item in tags:
        tag = first_text(item)
        if not tag or tag in seen:
            continue
        seen.add(tag)
        ordered.append(tag)
    return " ".join(ordered)


def compact_attachments_csv_str(attachments: list[dict[str, Any]]) -> str:
    tokens: list[str] = []
    for attachment in attachments:
        attachment_id = as_str(attachment.get("id"))
        attachment_type = first_text(attachment.get("type"))
        if attachment_id and attachment_type:
            tokens.append(f"{attachment_type}:{attachment_id}")
    return ",".join(tokens)


def compact_text_for_csv(value: Any) -> str:
    return str(value or "").replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\\n")


def detail_metadata_from_payload(payload: Any | None) -> dict[str, str]:
    if not payload:
        return {
            "reactions": "0",
            "comments": "0",
            "shares": "0",
            "hashtags": "",
        }

    result = unwrap_response(payload)
    if (
        isinstance(payload, dict)
        and isinstance(payload.get("result"), dict)
        and not isinstance(result, dict)
    ):
        result = payload["result"]
    elif (
        isinstance(payload, dict)
        and isinstance(payload.get("result"), dict)
        and isinstance(result, dict)
        and "reactions" not in result
        and "comments" not in result
        and "shares" not in result
        and "hashtags" not in result
    ):
        result = payload["result"]
    comments = result.get("comments") if isinstance(result, dict) else {}
    reactions = result.get("reactions") if isinstance(result, dict) else {}
    return {
        "reactions": normalize_metric(get_nested(reactions, "total")),
        "comments": normalize_metric(
            get_nested(comments, "total_count")
            if get_nested(comments, "total_count") is not None
            else get_nested(comments, "total")
        ),
        "shares": normalize_metric(get_nested(result, "shares")),
        "hashtags": normalize_hashtags(get_nested(result, "hashtags")),
    }


def normalize_top_reactions(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        normalized.append(
            {
                "id": as_str(item.get("id")) or "",
                "count": int(item.get("count") or 0),
                "name": first_text(item.get("name")) or "",
            }
        )
    return normalized


def build_actor_from_detail(result: dict[str, Any]) -> dict[str, Any]:
    actors = result.get("actors")
    actor = actors[0] if isinstance(actors, list) and actors and isinstance(actors[0], dict) else {}
    return {
        "id": as_str(actor.get("id")) or "",
        "name": first_text(actor.get("name")) or "",
        "url": first_http_url(actor.get("url")) or "",
        "signals": [],
    }


def build_post_from_detail_payload(post_id: str, payload: Any) -> dict[str, Any]:
    result = unwrap_response(payload)
    if not isinstance(result, dict):
        raise ValueError("Detail payload does not contain a usable result object.")

    detail_attachments = extract_unique_detail_attachments(payload)
    comments = result.get("comments") if isinstance(result.get("comments"), dict) else {}
    reactions = result.get("reactions") if isinstance(result.get("reactions"), dict) else {}
    attached_post = result.get("attached_post") if isinstance(result.get("attached_post"), dict) else None
    attached_text = first_text(get_nested(attached_post, "text"))
    rich_message = result.get("rich_message")
    rich_message_text = (
        first_text(rich_message.get("text")) if isinstance(rich_message, dict) else first_text(rich_message)
    )
    created_time = result.get("created_time")
    created_time = int(created_time) if isinstance(created_time, (int, float, str)) and str(created_time).isdigit() else 0

    return {
        "id": post_id,
        "post_id": post_id,
        "story_id": first_text(result.get("id")) or "",
        "actor": build_actor_from_detail(result),
        "creation_time": created_time,
        "cursor": "",
        "url": first_http_url(result.get("url")) or "",
        "message": first_text(result.get("text")) or "",
        "title": "",
        "summary": "",
        "privacy": {
            "id": "",
            "scope": "OPEN",
            "can_edit": False,
        },
        "can_delete": False,
        "comments": {
            "total": int(get_nested(comments, "total_count") or get_nested(comments, "total") or 0),
        },
        "reactions": {
            "total": int(get_nested(reactions, "total") or 0),
            "top": normalize_top_reactions(get_nested(reactions, "top")),
        },
        "shares": {
            "total": int(result.get("shares") or 0),
        },
        "content": {
            "text": attached_text or rich_message_text or None,
            "attachments": detail_attachments,
        },
        "recent": 0,
    }


def build_csv_row(post: dict[str, Any], detail_payload: Any | None) -> dict[str, str]:
    post_id = as_str(post.get("post_id") or post.get("id")) or ""
    content = post.get("content") if isinstance(post.get("content"), dict) else {}
    attachments = collect_preferred_attachments(post, detail_payload)
    metadata = detail_metadata_from_payload(detail_payload)
    return {
        "post_id": post_id,
        "creation_time": str(post.get("creation_time") or ""),
        "message": compact_text_for_csv(post.get("message")),
        "title": compact_text_for_csv(post.get("title")),
        "summary": compact_text_for_csv(post.get("summary")),
        "attachments": compact_attachments_csv_str(attachments),
        "content_text": compact_text_for_csv(content.get("text") if isinstance(content, dict) else ""),
        "reactions": metadata["reactions"],
        "comments": metadata["comments"],
        "shares": metadata["shares"],
        "hashtags": metadata["hashtags"],
    }


def build_csv_rows(posts: Iterable[dict[str, Any]], *, details_dir: Path | None = None) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for index, post in enumerate(posts, start=1):
        post_id = normalize_post_id(post, index)
        detail_payload = load_optional_detail_payload(details_dir, post_id) if details_dir else None
        rows.append(build_csv_row(post, detail_payload))
    return rows


def write_csv_rows(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


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


def select_posts(posts: list[dict[str, Any]], selected_ids: set[str], limit: int | None) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for index, post in enumerate(posts, start=1):
        post_id = normalize_post_id(post, index)
        if selected_ids and post_id not in selected_ids:
            continue
        selected.append(post)
        if limit is not None and len(selected) >= limit:
            break
    return selected


def api_request_json(url: str, payload: dict[str, Any]) -> Any:
    log_info(f"Calling API {payload.get('apiname')} -> {url}")
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
        method="POST",
    )
    with urlopen(request, timeout=60) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        body = response.read().decode(charset)
    log_info(f"API {payload.get('apiname')} completed")
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        snippet = " ".join(body.strip().split())[:240]
        raise RuntimeError(f"API returned invalid JSON: {exc}. Body starts with: {snippet}") from exc


def fetch_post_detail_payload(api_config: APIConfig, post_id: str) -> Any:
    payload = {
        "id": api_config.client_id,
        "apiname": api_config.api_name,
        "apiparams": {"url": post_id},
    }
    return api_request_json(api_config.endpoint, payload)


def fetch_single_detail_to_cache(
    *,
    post_id: str,
    details_dir: Path,
    api_config: APIConfig,
    force_refresh: bool = False,
    cache_only: bool = False,
    dry_run: bool = False,
) -> tuple[Any, str]:
    if not dry_run:
        details_dir.mkdir(parents=True, exist_ok=True)

    cache_path = details_dir / f"{post_id}.json"
    manifest_path = details_dir / DEFAULT_DETAILS_MANIFEST.name
    manifest = load_manifest(manifest_path)
    payload: Any | None = None
    source = "cache"

    if cache_path.exists() and not force_refresh:
        log_info(f"Loading cached detail for post {post_id} from {cache_path}")
        try:
            payload = load_json(cache_path)
        except json.JSONDecodeError:
            log_info(f"Cached detail for post {post_id} is invalid JSON, refetching")
            payload = None

    if payload is None and cache_only:
        raise RuntimeError(f"Detail cache not found for post {post_id}: {cache_path}")

    if payload is None:
        log_info(f"Fetching detail for post {post_id} from API")
        payload = fetch_post_detail_payload(api_config, post_id)
        source = "api"
        if not dry_run:
            log_info(f"Saving detail cache for post {post_id} -> {cache_path}")
            dump_json(cache_path, payload)

    manifest["posts"][post_id] = {
        "status": "success",
        "source": source,
        "response_file": cache_path.name,
        "processed_at": utc_now(),
    }
    manifest["updated_at"] = utc_now()
    if not dry_run:
        log_info(f"Updating detail manifest -> {manifest_path}")
        dump_json(manifest_path, manifest)

    return payload, source


def fetch_video_api_fields(api_config: APIConfig, attachment_id: str) -> tuple[str, str | None, str | None]:
    payload = {
        "id": api_config.client_id,
        "apiname": api_config.api_name,
        "apiparams": {"url": attachment_id},
    }
    api_payload = api_request_json(api_config.endpoint, payload)
    if not isinstance(api_payload, dict):
        raise RuntimeError("API response is not an object.")
    payload_root = api_payload.get("result") if isinstance(api_payload.get("result"), dict) else api_payload
    source = as_http_url(payload_root.get("source"))
    if not source:
        raise RuntimeError("API response does not contain a usable 'source' URL.")
    return (
        source,
        as_http_url(payload_root.get("thumbnail")),
        as_http_url(payload_root.get("url")),
    )


def fetch_photo_api_uri(
    endpoint: str,
    client_id: str,
    photo_id: str,
    api_name: str = DEFAULT_PHOTO_API_NAME,
) -> str:
    payload = {
        "id": client_id,
        "apiname": api_name,
        "apiparams": {"photo_id": photo_id},
    }
    api_payload = api_request_json(endpoint, payload)
    if not isinstance(api_payload, dict):
        raise RuntimeError("Photo API response is not an object.")

    payload_root = api_payload.get("result") if isinstance(api_payload.get("result"), dict) else api_payload
    if not isinstance(payload_root, dict):
        raise RuntimeError("Photo API response does not contain a usable result object.")

    candidates = (
        payload_root.get("uri"),
        payload_root.get("url"),
        payload_root.get("src"),
        get_nested(payload_root, "image", "uri"),
        get_nested(payload_root, "image", "url"),
        get_nested(payload_root, "photo", "uri"),
        get_nested(payload_root, "photo", "url"),
    )
    refreshed_url = first_http_url(*candidates)
    if not refreshed_url:
        raise RuntimeError("Photo API response does not contain a usable image URL.")
    return refreshed_url


def ensure_output_dir(path: Path, create: bool) -> Path:
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def load_resume_state(output_dir: Path) -> ResumeState:
    files_by_stem: dict[str, set[str]] = {}
    if output_dir.exists():
        for path in output_dir.iterdir():
            if not path.is_file():
                continue
            files_by_stem.setdefault(path.stem, set()).add(path.suffix.lower())
    return ResumeState(
        output_dir=output_dir,
        files_by_stem=files_by_stem,
    )


def artifact_exists(state: ResumeState, stem: str, kind: str) -> bool:
    suffixes = state.files_by_stem.get(stem, set())
    if kind in {"image", "thumbnail"}:
        return bool(suffixes & IMAGE_FILE_EXTENSIONS)
    if kind == "video":
        return bool(suffixes & VIDEO_FILE_EXTENSIONS)
    return False


def record_artifact(state: ResumeState, stem: str, kind: str, path: Path) -> None:
    state.files_by_stem.setdefault(stem, set()).add(path.suffix.lower())


def infer_extension_from_url(url: str) -> str | None:
    parsed_path = unquote(urlparse(url).path)
    suffix = Path(parsed_path).suffix.lower()
    return suffix if suffix else None


def infer_extension(content_type: str | None, url: str | None, default_ext: str) -> str:
    if content_type:
        normalized = content_type.split(";", 1)[0].strip().lower()
        if normalized in COMMON_CONTENT_TYPE_EXTENSIONS:
            return COMMON_CONTENT_TYPE_EXTENSIONS[normalized]
        guessed = mimetypes.guess_extension(normalized, strict=False)
        if guessed:
            return guessed
    if url:
        suffix = infer_extension_from_url(url)
        if suffix:
            return suffix
    return default_ext


def download_binary(
    url: str,
    output_dir: Path,
    stem: str,
    default_ext: str,
    extra_headers: dict[str, str] | None = None,
) -> Path:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/123.0.0.0 Safari/537.36"
        ),
        "Accept": "*/*",
    }
    if extra_headers:
        headers.update(extra_headers)
    request = Request(url, headers=headers)
    with urlopen(request) as response:
        payload = response.read()
        content_type = response.headers.get("Content-Type")
    extension = infer_extension(content_type, url, default_ext)
    destination = output_dir / f"{stem}{extension}"
    destination.write_bytes(payload)
    return destination


def build_video_headers(page_url: str | None, video_url: str) -> dict[str, str]:
    parsed = urlparse(page_url or video_url)
    origin = (
        f"{parsed.scheme}://{parsed.netloc}"
        if parsed.scheme and parsed.netloc
        else "https://www.facebook.com"
    )
    headers = {
        "Referer": page_url or origin + "/",
        "Origin": origin,
        "Accept": "*/*",
    }
    if urlparse(video_url).netloc.endswith("fbcdn.net"):
        headers["Range"] = "bytes=0-"
    return headers


def filter_jobs_for_mode(jobs: list[AttachmentJob], mode: str) -> list[AttachmentJob]:
    if mode == "videos":
        return [job for job in jobs if job.attachment_type.lower() in VIDEO_TYPES]
    if mode == "images":
        return jobs
    non_videos = [job for job in jobs if job.attachment_type.lower() not in VIDEO_TYPES]
    videos = [job for job in jobs if job.attachment_type.lower() in VIDEO_TYPES]
    return non_videos + videos


def process_media_job(
    job: AttachmentJob,
    output_dir: Path,
    resume_state: ResumeState,
    *,
    mode: str,
    api_config: APIConfig,
    api_delay_min: float,
    api_delay_max: float,
) -> tuple[str, str]:
    attachment_type = job.attachment_type.lower()

    if attachment_type in IMAGE_TYPES:
        try:
            if artifact_exists(resume_state, job.stem, "image"):
                return "skipped-existing", "image already downloaded"
            if mode == "videos":
                return "skipped", "image job skipped in videos mode"
            if not job.thumbnail_url:
                return "skipped", "missing thumbnail URL"
            image_url = job.thumbnail_url
            try:
                saved_path = download_binary(image_url, output_dir, job.stem, ".jpg")
                detail = str(saved_path)
            except Exception as exc:  # noqa: BLE001
                refreshed_url = fetch_photo_api_uri(
                    api_config.endpoint,
                    api_config.client_id,
                    job.attachment_id,
                )
                saved_path = download_binary(refreshed_url, output_dir, job.stem, ".jpg")
                detail = f"{saved_path} (refreshed via {DEFAULT_PHOTO_API_NAME} after: {exc})"
            record_artifact(resume_state, job.stem, "image", saved_path)
            return "downloaded", detail
        except Exception as exc:  # noqa: BLE001
            return "skipped", f"image download failed: {exc}"

    if attachment_type in VIDEO_TYPES:
        try:
            thumbnail_detail = "thumbnail-skip"
            thumbnail_exists = artifact_exists(resume_state, job.stem, "thumbnail")
            if mode == "images" and thumbnail_exists:
                return "skipped-existing", "thumbnail already downloaded"
            if mode in {"images", "all"} and thumbnail_exists:
                thumbnail_detail = "thumbnail already downloaded"
            elif mode in {"images", "all"} and job.thumbnail_url:
                thumbnail_path = download_binary(job.thumbnail_url, output_dir, job.stem, ".jpg")
                record_artifact(resume_state, job.stem, "thumbnail", thumbnail_path)
                thumbnail_detail = f"thumbnail={thumbnail_path}"

            if mode == "images":
                if thumbnail_detail == "thumbnail-skip" and not job.thumbnail_url:
                    return "skipped", "missing thumbnail URL"
                return "downloaded-thumbnail", thumbnail_detail

            if artifact_exists(resume_state, job.stem, "video"):
                return "skipped-existing", "video already downloaded"

            low = max(0.0, min(api_delay_min, api_delay_max))
            high = max(0.0, max(api_delay_min, api_delay_max))
            delay = random.uniform(low, high)
            log_info(f"Waiting {delay:.2f}s before video API call for {job.stem}")
            time.sleep(delay)
            video_url, api_thumbnail_url, page_url = fetch_video_api_fields(
                api_config,
                job.attachment_id,
            )
            if thumbnail_detail == "thumbnail-skip" and api_thumbnail_url and not thumbnail_exists:
                thumbnail_path = download_binary(api_thumbnail_url, output_dir, job.stem, ".jpg")
                record_artifact(resume_state, job.stem, "thumbnail", thumbnail_path)
                thumbnail_detail = f"thumbnail={thumbnail_path} (api)"
            saved_path = download_binary(
                video_url,
                output_dir,
                job.stem,
                ".mp4",
                extra_headers=build_video_headers(page_url or job.post_url, video_url),
            )
            record_artifact(resume_state, job.stem, "video", saved_path)
            return "downloaded", f"{saved_path} ({thumbnail_detail})"
        except Exception as exc:  # noqa: BLE001
            return "skipped", f"video download failed: {exc}"

    if attachment_type in GENERIC_MEDIA_TYPES:
        if artifact_exists(resume_state, job.stem, "image"):
            return "skipped-existing", "thumbnail already downloaded"
        if mode == "videos":
            return "skipped", "generic thumbnail job skipped in videos mode"
        if not job.thumbnail_url:
            return "skipped", "missing usable URL"
        saved_path = download_binary(job.thumbnail_url, output_dir, job.stem, ".jpg")
        record_artifact(resume_state, job.stem, "image", saved_path)
        return "downloaded-thumbnail", str(saved_path)

    if mode == "videos":
        return "skipped", f"non-video job skipped in videos mode: {job.attachment_type}"
    if artifact_exists(resume_state, job.stem, "image"):
        return "skipped-existing", "thumbnail already downloaded"
    if not job.thumbnail_url:
        return "skipped", f"unsupported attachment type: {job.attachment_type}"
    saved_path = download_binary(job.thumbnail_url, output_dir, job.stem, ".jpg")
    record_artifact(resume_state, job.stem, "image", saved_path)
    return "downloaded-thumbnail", str(saved_path)


def run_download_details(
    *,
    posts_path: Path,
    details_dir: Path,
    api_config: APIConfig,
    selected_ids: set[str] | None = None,
    limit: int | None = None,
    force_refresh: bool = False,
    cache_only: bool = False,
    api_delay_min: float = 1.0,
    api_delay_max: float = 5.0,
    dry_run: bool = False,
) -> int:
    posts = load_posts_export(posts_path)
    selected_posts = select_posts(posts, selected_ids or set(), limit)
    if not selected_posts:
        print("[INFO] No posts matched the current filters.")
        return 0

    if api_delay_min < 0 or api_delay_max < 0 or api_delay_max < api_delay_min:
        raise ValueError("Invalid API delay range.")

    if not dry_run:
        details_dir.mkdir(parents=True, exist_ok=True)

    manifest_path = details_dir / DEFAULT_DETAILS_MANIFEST.name
    manifest = load_manifest(manifest_path)
    stats = {
        "processed": 0,
        "api_calls": 0,
        "cache_hits": 0,
        "saved": 0,
        "skipped_missing_cache": 0,
        "errors": 0,
    }

    for index, post in enumerate(selected_posts, start=1):
        post_id = normalize_post_id(post, index)
        stats["processed"] += 1
        cache_path = details_dir / f"{post_id}.json"
        payload: Any | None = None
        source = "cache"

        if cache_path.exists() and not force_refresh:
            try:
                payload = load_json(cache_path)
                stats["cache_hits"] += 1
            except json.JSONDecodeError:
                payload = None

        if payload is None and cache_only:
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
                if stats["api_calls"] > 0 and api_delay_max > 0:
                    delay_seconds = random.uniform(api_delay_min, api_delay_max)
                    log_info(f"Waiting {delay_seconds:.2f}s before API call for {post_id}")
                    time.sleep(delay_seconds)
                log_info(f"Fetching detail for post {post_id}")
                payload = fetch_post_detail_payload(api_config, post_id)
                stats["api_calls"] += 1
                source = "api"
                if not dry_run:
                    log_info(f"Saving detail cache -> {cache_path}")
                    dump_json(cache_path, payload)
            except Exception as exc:  # noqa: BLE001
                stats["errors"] += 1
                manifest["posts"][post_id] = {
                    "status": "error",
                    "error": str(exc),
                    "response_file": cache_path.name,
                    "processed_at": utc_now(),
                }
                print(f"[WARN] Failed {post_id}: {exc}")
                continue

        manifest["posts"][post_id] = {
            "status": "success",
            "source": source,
            "response_file": cache_path.name,
            "processed_at": utc_now(),
        }
        stats["saved"] += 1

    manifest["updated_at"] = utc_now()
    if not dry_run:
        log_info(f"Writing detail manifest -> {manifest_path}")
        dump_json(manifest_path, manifest)

    print(
        "[OK] "
        f"processed={stats['processed']} "
        f"saved={stats['saved']} "
        f"api_calls={stats['api_calls']} "
        f"cache_hits={stats['cache_hits']} "
        f"skipped_missing_cache={stats['skipped_missing_cache']} "
        f"errors={stats['errors']}"
    )
    return 0 if stats["errors"] == 0 else 1


def run_download_media(
    *,
    posts_path: Path,
    details_dir: Path | None,
    output_dir: Path,
    api_config: APIConfig,
    selected_ids: set[str] | None = None,
    limit: int | None = None,
    mode: str = "all",
    api_delay_min: float = 2.0,
    api_delay_max: float = 5.0,
    dry_run: bool = False,
    posts_override: list[dict[str, Any]] | None = None,
) -> int:
    posts = posts_override if posts_override is not None else load_posts_export(posts_path)
    if selected_ids:
        posts = select_posts(posts, selected_ids, None)
    jobs = filter_jobs_for_mode(
        build_attachment_jobs(posts, details_dir=details_dir),
        mode,
    )
    if limit is not None:
        jobs = jobs[:limit]

    output_dir = ensure_output_dir(output_dir, create=not dry_run)
    resume_state = load_resume_state(output_dir)

    print(f"Output directory: {output_dir}")
    print(f"Mode: {mode}")
    print(f"Attachments queued: {len(jobs)}")

    if dry_run:
        for job in jobs:
            print(
                f"DRY RUN {job.stem} "
                f"type={job.attachment_type} "
                f"post_url={job.post_url or '-'} "
                f"thumbnail={job.thumbnail_url or '-'} "
                f"title_url={job.title_url or '-'}"
            )
        return 0

    downloaded = 0
    downloaded_thumbnails = 0
    skipped_existing = 0
    skipped = 0

    for job in jobs:
        status, detail = process_media_job(
            job,
            output_dir,
            resume_state,
            mode=mode,
            api_config=api_config,
            api_delay_min=api_delay_min,
            api_delay_max=api_delay_max,
        )
        if status == "downloaded":
            downloaded += 1
        elif status == "downloaded-thumbnail":
            downloaded_thumbnails += 1
        elif status == "skipped-existing":
            skipped_existing += 1
        else:
            skipped += 1
        print(f"{status.upper():>20} {job.stem} [{job.attachment_type}] {detail}")

    print()
    print(f"Downloaded media: {downloaded}")
    print(f"Downloaded thumbnails: {downloaded_thumbnails}")
    print(f"Skipped existing: {skipped_existing}")
    print(f"Skipped: {skipped}")
    print(f"Saved in: {output_dir}")
    return 0


def run_export_csv(
    *,
    posts_path: Path,
    details_dir: Path | None,
    output_csv: Path,
) -> int:
    posts = load_posts_export(posts_path)
    rows = build_csv_rows(posts, details_dir=details_dir)
    write_csv_rows(output_csv, rows)
    print(f"[OK] Exported {len(rows)} rows -> {output_csv}")
    return 0


def run_backup_post(
    *,
    post_id: str,
    posts_path: Path,
    details_dir: Path,
    media_output_dir: Path,
    csv_output_path: Path,
    detail_api_config: APIConfig,
    media_api_config: APIConfig,
    force_refresh_detail: bool = False,
    cache_only_detail: bool = False,
    media_mode: str = "all",
    media_api_delay_min: float = 2.0,
    media_api_delay_max: float = 5.0,
    dry_run: bool = False,
) -> int:
    normalized_post_id = post_id.strip()
    if not normalized_post_id:
        raise ValueError("post_id is required")

    log_info(f"Starting backup flow for post {normalized_post_id}")
    log_info("Step 1/4: fetch detail info")
    payload, detail_source = fetch_single_detail_to_cache(
        post_id=normalized_post_id,
        details_dir=details_dir,
        api_config=detail_api_config,
        force_refresh=force_refresh_detail,
        cache_only=cache_only_detail,
        dry_run=dry_run,
    )

    log_info("Step 2/4: build temporary post record for media/csv")
    post_record = build_post_from_detail_payload(normalized_post_id, payload)
    print(f"[OK] Cached detail for post {normalized_post_id} (source={detail_source})")

    log_info("Step 3/4: download media for this post")
    media_result = run_download_media(
        posts_path=posts_path,
        details_dir=details_dir,
        output_dir=media_output_dir,
        api_config=media_api_config,
        selected_ids={normalized_post_id},
        mode=media_mode,
        api_delay_min=media_api_delay_min,
        api_delay_max=media_api_delay_max,
        dry_run=dry_run,
        posts_override=[post_record],
    )
    if media_result != 0:
        return media_result

    if dry_run:
        print(f"[DRY RUN] Skipped writing {csv_output_path}")
        return 0

    log_info("Step 4/4: regenerate compact CSV")
    return run_export_csv(
        posts_path=posts_path,
        details_dir=details_dir,
        output_csv=csv_output_path,
    )


def prompt_text(label: str, default: str | None = None, allow_empty: bool = False) -> str:
    while True:
        suffix = f" [{default}]" if default is not None else ""
        value = input(f"{label}{suffix}: ").strip()
        if value:
            return value
        if default is not None:
            return default
        if allow_empty:
            return ""
        print("Value is required.")


def prompt_int(label: str, default: int | None = None, allow_empty: bool = True) -> int | None:
    while True:
        raw = prompt_text(label, str(default) if default is not None else None, allow_empty=allow_empty)
        if raw == "" and allow_empty:
            return None
        try:
            return int(raw)
        except ValueError:
            print("Please enter an integer.")


def prompt_float(label: str, default: float) -> float:
    while True:
        raw = prompt_text(label, str(default))
        try:
            return float(raw)
        except ValueError:
            print("Please enter a number.")


def prompt_optional_path(label: str, default: Path | None = None) -> Path | None:
    default_text = str(default) if default else None
    raw = prompt_text(label + " (Enter để dùng mặc định, '-' để bỏ qua)", default_text, allow_empty=True)
    if raw.strip() == "-":
        return None
    if not raw and default is None:
        return None
    return Path(raw).expanduser().resolve()


def prompt_required_path(label: str, default: Path) -> Path:
    return Path(prompt_text(label, str(default))).expanduser().resolve()


def prompt_shared_api_runtime(endpoint: str, client_id: str) -> tuple[str, str]:
    return (
        prompt_text("API endpoint", endpoint),
        prompt_text("API client id", client_id),
    )


def run_interactive_menu() -> int:
    print("=== Posts Tool ===")
    print("1. Download post detail info")
    print("2. Download post media")
    print("3. Build compact CSV from posts.json + details")
    print("4. Backup single post into details + media + posts.min.csv (không sửa posts.json)")
    print("0. Exit")

    choice = prompt_text("Chọn chức năng", "1")
    if choice == "0":
        print("Exit.")
        return 0

    if choice == "1":
        endpoint, client_id = prompt_shared_api_runtime(
            DEFAULT_DETAIL_API_ENDPOINT,
            DEFAULT_CLIENT_ID,
        )
        return run_download_details(
            posts_path=DEFAULT_POSTS_PATH,
            details_dir=DEFAULT_DETAILS_DIR,
            api_config=build_detail_api_config(endpoint, client_id),
            limit=prompt_int("Limit số post (để trống = tất cả)", None),
            force_refresh=prompt_text("Force refresh cache? y/N", "n").lower() == "y",
            cache_only=prompt_text("Chỉ dùng cache hiện có? y/N", "n").lower() == "y",
            api_delay_min=prompt_float("Delay min giữa API calls (seconds)", 1.0),
            api_delay_max=prompt_float("Delay max giữa API calls (seconds)", 5.0),
            dry_run=prompt_text("Dry run? y/N", "n").lower() == "y",
        )

    if choice == "2":
        endpoint, client_id = prompt_shared_api_runtime(
            DEFAULT_MEDIA_API_ENDPOINT,
            DEFAULT_CLIENT_ID,
        )
        return run_download_media(
            posts_path=DEFAULT_POSTS_PATH,
            details_dir=DEFAULT_DETAILS_DIR,
            output_dir=DEFAULT_MEDIA_DIR,
            api_config=build_media_api_config(endpoint, client_id),
            limit=prompt_int("Limit số attachment (để trống = tất cả)", None),
            mode=prompt_text("Mode images/videos/all", "all"),
            api_delay_min=prompt_float("Delay min trước video API call (seconds)", 2.0),
            api_delay_max=prompt_float("Delay max trước video API call (seconds)", 5.0),
            dry_run=prompt_text("Dry run? y/N", "n").lower() == "y",
        )

    if choice == "3":
        return run_export_csv(
            posts_path=DEFAULT_POSTS_PATH,
            details_dir=DEFAULT_DETAILS_DIR,
            output_csv=DEFAULT_CSV_PATH,
        )

    if choice == "4":
        endpoint, client_id = prompt_shared_api_runtime(
            DEFAULT_API_ENDPOINT,
            DEFAULT_CLIENT_ID,
        )
        return run_backup_post(
            post_id=prompt_text("Post id"),
            posts_path=DEFAULT_POSTS_PATH,
            details_dir=DEFAULT_DETAILS_DIR,
            media_output_dir=DEFAULT_MEDIA_DIR,
            csv_output_path=DEFAULT_CSV_PATH,
            detail_api_config=build_detail_api_config(endpoint, client_id),
            media_api_config=build_media_api_config(endpoint, client_id),
            force_refresh_detail=prompt_text("Force refresh detail cache? y/N", "n").lower() == "y",
            cache_only_detail=prompt_text("Chỉ dùng detail cache hiện có? y/N", "n").lower() == "y",
            media_mode=prompt_text("Media mode images/videos/all", "all"),
            media_api_delay_min=prompt_float("Delay min trước video API call (seconds)", 2.0),
            media_api_delay_max=prompt_float("Delay max trước video API call (seconds)", 5.0),
            dry_run=prompt_text("Dry run? y/N", "n").lower() == "y",
        )

    print(f"Unknown choice: {choice}")
    return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Unified tool for downloading post details, media, and compact CSV exports."
    )
    subparsers = parser.add_subparsers(dest="command")

    details_parser = subparsers.add_parser("details", help="Download post detail JSON files.")
    details_parser.add_argument("--posts-path", default=str(DEFAULT_POSTS_PATH))
    details_parser.add_argument("--out-dir", default=str(DEFAULT_DETAILS_DIR))
    details_parser.add_argument("--api-endpoint", default=DEFAULT_DETAIL_API_ENDPOINT)
    details_parser.add_argument("--client-id", default=DEFAULT_CLIENT_ID)
    details_parser.add_argument("--api-name", default=DEFAULT_DETAIL_API_NAME, help=argparse.SUPPRESS)
    details_parser.add_argument("--post-id", action="append", default=[])
    details_parser.add_argument("--limit", type=int, default=None)
    details_parser.add_argument("--force-refresh", action="store_true")
    details_parser.add_argument("--cache-only", action="store_true")
    details_parser.add_argument("--api-delay-min", type=float, default=1.0)
    details_parser.add_argument("--api-delay-max", type=float, default=5.0)
    details_parser.add_argument("--dry-run", action="store_true")

    media_parser = subparsers.add_parser("media", help="Download attachment media files.")
    media_parser.add_argument("--posts-path", default=str(DEFAULT_POSTS_PATH))
    media_parser.add_argument("--details-dir", default=str(DEFAULT_DETAILS_DIR))
    media_parser.add_argument("--skip-details", action="store_true")
    media_parser.add_argument("--output-dir", default=str(DEFAULT_MEDIA_DIR))
    media_parser.add_argument("--api-endpoint", default=DEFAULT_MEDIA_API_ENDPOINT)
    media_parser.add_argument("--client-id", default=DEFAULT_CLIENT_ID)
    media_parser.add_argument("--api-name", default=DEFAULT_MEDIA_API_NAME, help=argparse.SUPPRESS)
    media_parser.add_argument("--limit", type=int, default=None)
    media_parser.add_argument("--mode", choices=("images", "videos", "all"), default="all")
    media_parser.add_argument("--api-delay-min", type=float, default=2.0)
    media_parser.add_argument("--api-delay-max", type=float, default=5.0)
    media_parser.add_argument("--dry-run", action="store_true")

    csv_parser = subparsers.add_parser("csv", help="Build compact CSV from posts.json and details.")
    csv_parser.add_argument("--posts-path", default=str(DEFAULT_POSTS_PATH))
    csv_parser.add_argument("--details-dir", default=str(DEFAULT_DETAILS_DIR))
    csv_parser.add_argument("--skip-details", action="store_true")
    csv_parser.add_argument("--output-csv", default=str(DEFAULT_CSV_PATH))

    backup_parser = subparsers.add_parser(
        "backup-post",
        help="Backup one post into details, media, and posts.min.csv without modifying posts.json.",
    )
    backup_parser.add_argument("post_id")
    backup_parser.add_argument("--posts-path", default=str(DEFAULT_POSTS_PATH))
    backup_parser.add_argument("--details-dir", default=str(DEFAULT_DETAILS_DIR))
    backup_parser.add_argument("--media-output-dir", default=str(DEFAULT_MEDIA_DIR))
    backup_parser.add_argument("--output-csv", default=str(DEFAULT_CSV_PATH))
    backup_parser.add_argument("--api-endpoint", default=DEFAULT_API_ENDPOINT)
    backup_parser.add_argument("--client-id", default=DEFAULT_CLIENT_ID)
    backup_parser.add_argument("--detail-api-endpoint", default=None, help=argparse.SUPPRESS)
    backup_parser.add_argument("--detail-client-id", default=None, help=argparse.SUPPRESS)
    backup_parser.add_argument("--detail-api-name", default=DEFAULT_DETAIL_API_NAME, help=argparse.SUPPRESS)
    backup_parser.add_argument("--media-api-endpoint", default=None, help=argparse.SUPPRESS)
    backup_parser.add_argument("--media-client-id", default=None, help=argparse.SUPPRESS)
    backup_parser.add_argument("--media-api-name", default=DEFAULT_MEDIA_API_NAME, help=argparse.SUPPRESS)
    backup_parser.add_argument("--force-refresh-detail", action="store_true")
    backup_parser.add_argument("--cache-only-detail", action="store_true")
    backup_parser.add_argument("--media-mode", choices=("images", "videos", "all"), default="all")
    backup_parser.add_argument("--media-api-delay-min", type=float, default=2.0)
    backup_parser.add_argument("--media-api-delay-max", type=float, default=5.0)
    backup_parser.add_argument("--dry-run", action="store_true")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.command:
        return run_interactive_menu()

    if args.command == "details":
        return run_download_details(
            posts_path=Path(args.posts_path).expanduser().resolve(),
            details_dir=Path(args.out_dir).expanduser().resolve(),
            api_config=build_detail_api_config(args.api_endpoint, args.client_id),
            selected_ids=normalize_post_ids(args.post_id),
            limit=args.limit,
            force_refresh=args.force_refresh,
            cache_only=args.cache_only,
            api_delay_min=args.api_delay_min,
            api_delay_max=args.api_delay_max,
            dry_run=args.dry_run,
        )

    if args.command == "media":
        details_dir = None if args.skip_details else Path(args.details_dir).expanduser().resolve()
        return run_download_media(
            posts_path=Path(args.posts_path).expanduser().resolve(),
            details_dir=details_dir,
            output_dir=Path(args.output_dir).expanduser().resolve(),
            api_config=build_media_api_config(args.api_endpoint, args.client_id),
            limit=args.limit,
            mode=args.mode,
            api_delay_min=args.api_delay_min,
            api_delay_max=args.api_delay_max,
            dry_run=args.dry_run,
        )

    if args.command == "csv":
        details_dir = None if args.skip_details else Path(args.details_dir).expanduser().resolve()
        return run_export_csv(
            posts_path=Path(args.posts_path).expanduser().resolve(),
            details_dir=details_dir,
            output_csv=Path(args.output_csv).expanduser().resolve(),
        )

    if args.command == "backup-post":
        detail_endpoint = args.detail_api_endpoint or args.api_endpoint
        detail_client_id = args.detail_client_id or args.client_id
        media_endpoint = args.media_api_endpoint or args.api_endpoint
        media_client_id = args.media_client_id or args.client_id
        return run_backup_post(
            post_id=args.post_id,
            posts_path=Path(args.posts_path).expanduser().resolve(),
            details_dir=Path(args.details_dir).expanduser().resolve(),
            media_output_dir=Path(args.media_output_dir).expanduser().resolve(),
            csv_output_path=Path(args.output_csv).expanduser().resolve(),
            detail_api_config=build_detail_api_config(detail_endpoint, detail_client_id),
            media_api_config=build_media_api_config(media_endpoint, media_client_id),
            force_refresh_detail=args.force_refresh_detail,
            cache_only_detail=args.cache_only_detail,
            media_mode=args.media_mode,
            media_api_delay_min=args.media_api_delay_min,
            media_api_delay_max=args.media_api_delay_max,
            dry_run=args.dry_run,
        )

    parser.error(f"Unsupported command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
