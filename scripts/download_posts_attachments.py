#!/usr/bin/env python3
"""Download attachment media from a Facebook-style posts export JSON."""

from __future__ import annotations

import argparse
import json
import mimetypes
import random
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen


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
DEFAULT_API_ENDPOINT = "https://api.fbaio.xyz/call"
DEFAULT_API_CLIENT_ID = "YOUR_CLIENT_ID"
DEFAULT_MANIFEST_NAME = "download_manifest.json"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "media"
LEGACY_OUTPUT_DIR = PROJECT_ROOT / "data" / "posts_attachments"
IMAGE_FILE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif", ".avif"}
VIDEO_FILE_EXTENSIONS = {".mp4", ".mov", ".webm", ".m4v"}


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
    manifest_path: Path
    jobs: dict[str, dict[str, str]] = field(default_factory=dict)
    files_by_stem: dict[str, set[str]] = field(default_factory=dict)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Download image/video attachments from a posts JSON export into a "
            "media directory in this repo."
        )
    )
    parser.add_argument(
        "input_json",
        nargs="?",
        default="./data/posts.json",
        help="Path to the posts JSON export.",
    )
    parser.add_argument(
        "--output-dir",
        help="Optional destination directory. Defaults to the repo media directory.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N attachments after deduplication.",
    )
    parser.add_argument(
        "--mode",
        choices=("images", "videos", "all"),
        default="images",
        help="Download only image/thumbnail files, only video files, or both.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned downloads without downloading anything.",
    )
    parser.add_argument(
        "--api-endpoint",
        default=DEFAULT_API_ENDPOINT,
        help="Video info API endpoint.",
    )
    parser.add_argument(
        "--api-client-id",
        default=DEFAULT_API_CLIENT_ID,
        help="Client id sent to the video info API.",
    )
    parser.add_argument(
        "--api-delay-min",
        type=float,
        default=2.0,
        help="Minimum random delay in seconds before each video API call.",
    )
    parser.add_argument(
        "--api-delay-max",
        type=float,
        default=5.0,
        help="Maximum random delay in seconds before each video API call.",
    )
    parser.add_argument(
        "--manifest-name",
        default=DEFAULT_MANIFEST_NAME,
        help="Manifest file used to remember already-downloaded files inside the output directory.",
    )
    return parser.parse_args()


def ensure_output_dir(explicit_dir: str | None, create: bool = True) -> Path:
    if explicit_dir:
        output_dir = Path(explicit_dir).expanduser().resolve()
        if create:
            output_dir.mkdir(parents=True, exist_ok=True)
        return output_dir

    output_dir = DEFAULT_OUTPUT_DIR
    if create:
        output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def load_posts(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict) and isinstance(data.get("posts"), list):
        return [item for item in data["posts"] if isinstance(item, dict)]
    raise ValueError("Expected a top-level list of posts or an object with a 'posts' list.")


def normalize_id(value: object, fallback: str) -> str:
    text = str(value).strip() if value is not None else ""
    return text or fallback


def as_http_url(value: object) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("http://") or text.startswith("https://"):
            return text
    return None


def iter_attachment_jobs(posts: Iterable[dict]) -> Iterable[AttachmentJob]:
    for post_index, post in enumerate(posts, start=1):
        post_id = normalize_id(post.get("id") or post.get("post_id"), f"post-{post_index}")
        post_url = as_http_url(post.get("url"))
        content = post.get("content")
        attachments = content.get("attachments") if isinstance(content, dict) else None
        if not isinstance(attachments, list):
            continue

        seen_attachment_ids: set[str] = set()
        for attachment_index, attachment in enumerate(attachments, start=1):
            if not isinstance(attachment, dict):
                continue
            attachment_id = normalize_id(attachment.get("id"), f"attachment-{attachment_index}")
            if attachment_id in seen_attachment_ids:
                continue
            seen_attachment_ids.add(attachment_id)

            yield AttachmentJob(
                post_id=post_id,
                attachment_id=attachment_id,
                attachment_type=normalize_id(
                    attachment.get("type"),
                    f"unknown-{attachment_index}",
                ),
                attachment_index=attachment_index,
                post_url=post_url,
                thumbnail_url=as_http_url(attachment.get("thumbnail")),
                title_url=as_http_url(attachment.get("title")),
            )


def load_manifest_jobs(manifest_path: Path) -> dict[str, dict[str, str]]:
    jobs: dict[str, dict[str, str]] = {}
    if not manifest_path.exists():
        return jobs

    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return jobs

    raw_jobs = payload.get("jobs", {}) if isinstance(payload, dict) else {}
    if not isinstance(raw_jobs, dict):
        return jobs

    for stem, artifacts in raw_jobs.items():
        if isinstance(stem, str) and isinstance(artifacts, dict):
            jobs[stem] = {
                kind: filename
                for kind, filename in artifacts.items()
                if isinstance(kind, str) and isinstance(filename, str)
            }
    return jobs


def merge_manifest_jobs(*job_maps: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    merged: dict[str, dict[str, str]] = {}
    for job_map in job_maps:
        for stem, artifacts in job_map.items():
            bucket = merged.setdefault(stem, {})
            for kind, filename in artifacts.items():
                bucket[kind] = filename
    return merged


def resolve_legacy_manifest_path(output_dir: Path, manifest_name: str) -> Path | None:
    if output_dir.resolve() == LEGACY_OUTPUT_DIR.resolve():
        return None
    return LEGACY_OUTPUT_DIR / manifest_name


def load_resume_state(output_dir: Path, manifest_name: str) -> ResumeState:
    manifest_path = output_dir / manifest_name
    legacy_manifest_path = resolve_legacy_manifest_path(output_dir, manifest_name)
    jobs = merge_manifest_jobs(
        load_manifest_jobs(legacy_manifest_path) if legacy_manifest_path else {},
        load_manifest_jobs(manifest_path),
    )

    files_by_stem: dict[str, set[str]] = {}
    if output_dir.exists():
        for path in output_dir.iterdir():
            if not path.is_file() or path.name == manifest_name:
                continue
            files_by_stem.setdefault(path.stem, set()).add(path.suffix.lower())

    return ResumeState(
        output_dir=output_dir,
        manifest_path=manifest_path,
        jobs=jobs,
        files_by_stem=files_by_stem,
    )


def persist_resume_state(state: ResumeState) -> None:
    payload = {"jobs": state.jobs}
    state.manifest_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def artifact_exists(state: ResumeState, stem: str, kind: str) -> bool:
    manifest_file = state.jobs.get(stem, {}).get(kind)
    if manifest_file and (state.output_dir / manifest_file).exists():
        return True

    suffixes = state.files_by_stem.get(stem, set())
    if kind in {"image", "thumbnail"}:
        return bool(suffixes & IMAGE_FILE_EXTENSIONS)
    if kind == "video":
        return bool(suffixes & VIDEO_FILE_EXTENSIONS)
    return False


def record_artifact(state: ResumeState, stem: str, kind: str, path: Path) -> None:
    state.jobs.setdefault(stem, {})[kind] = path.name
    state.files_by_stem.setdefault(stem, set()).add(path.suffix.lower())
    persist_resume_state(state)


def infer_extension_from_url(url: str) -> str | None:
    path = unquote(urlparse(url).path)
    suffix = Path(path).suffix.lower()
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

    ext = infer_extension(content_type, url, default_ext)
    destination = output_dir / f"{stem}{ext}"
    destination.write_bytes(payload)
    return destination


def api_request_json(url: str, payload: dict) -> object:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
        method="POST",
    )
    with urlopen(request) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        body = response.read().decode(charset)
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        snippet = " ".join(body.strip().split())[:240]
        raise RuntimeError(f"API returned invalid JSON: {exc}. Body starts with: {snippet}") from exc


def extract_video_api_fields(api_payload: object) -> tuple[str, str | None, str | None]:
    if not isinstance(api_payload, dict):
        raise RuntimeError("API response is not an object.")

    payload = api_payload
    nested_result = api_payload.get("result")
    if isinstance(nested_result, dict):
        payload = nested_result

    source = as_http_url(payload.get("source"))
    if not source:
        raise RuntimeError("API response does not contain a usable 'source' URL.")

    thumbnail = as_http_url(payload.get("thumbnail"))
    page_url = as_http_url(payload.get("url"))
    return source, thumbnail, page_url


def fetch_video_api_fields(job: AttachmentJob, args: argparse.Namespace) -> tuple[str, str | None, str | None]:
    low = max(0.0, min(args.api_delay_min, args.api_delay_max))
    high = max(0.0, max(args.api_delay_min, args.api_delay_max))
    delay = random.uniform(low, high)
    print(f"{'WAITING':>20} {job.stem} [Video] {delay:.2f}s before API call")
    time.sleep(delay)

    payload = {
        "id": args.api_client_id,
        "apiname": "get_fb_video_info",
        "apiparams": {"url": job.attachment_id},
    }
    api_payload = api_request_json(args.api_endpoint, payload)
    return extract_video_api_fields(api_payload)


def build_video_headers(page_url: str | None, video_url: str) -> dict[str, str]:
    parsed = urlparse(page_url or video_url)
    origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else "https://www.facebook.com"
    headers = {
        "Referer": page_url or origin + "/",
        "Origin": origin,
        "Accept": "*/*",
    }
    if urlparse(video_url).netloc.endswith("fbcdn.net"):
        headers["Range"] = "bytes=0-"
    return headers


def reorder_jobs_for_download(jobs: list[AttachmentJob]) -> list[AttachmentJob]:
    non_videos = [job for job in jobs if job.attachment_type.lower() not in VIDEO_TYPES]
    videos = [job for job in jobs if job.attachment_type.lower() in VIDEO_TYPES]
    return non_videos + videos


def filter_jobs_for_mode(jobs: list[AttachmentJob], mode: str) -> list[AttachmentJob]:
    if mode == "videos":
        return [job for job in jobs if job.attachment_type.lower() in VIDEO_TYPES]
    return reorder_jobs_for_download(jobs)


def process_job(
    job: AttachmentJob,
    output_dir: Path,
    args: argparse.Namespace,
    resume_state: ResumeState,
) -> tuple[str, str]:
    attachment_type = job.attachment_type.lower()

    if attachment_type in IMAGE_TYPES:
        if artifact_exists(resume_state, job.stem, "image"):
            return "skipped-existing", "image already downloaded"
        if args.mode == "videos":
            return "skipped", "image job skipped in videos mode"
        if not job.thumbnail_url:
            return "skipped", "missing thumbnail URL"
        saved_path = download_binary(job.thumbnail_url, output_dir, job.stem, ".jpg")
        record_artifact(resume_state, job.stem, "image", saved_path)
        return "downloaded", str(saved_path)

    if attachment_type in VIDEO_TYPES:
        try:
            thumbnail_detail = "thumbnail-skip"
            thumbnail_exists = artifact_exists(resume_state, job.stem, "thumbnail")
            if args.mode == "images" and thumbnail_exists:
                return "skipped-existing", "thumbnail already downloaded"
            if args.mode in {"images", "all"} and thumbnail_exists:
                thumbnail_detail = "thumbnail already downloaded"
            elif args.mode in {"images", "all"} and job.thumbnail_url:
                thumbnail_path = download_binary(job.thumbnail_url, output_dir, job.stem, ".jpg")
                record_artifact(resume_state, job.stem, "thumbnail", thumbnail_path)
                thumbnail_detail = f"thumbnail={thumbnail_path}"

            if args.mode == "images":
                if thumbnail_detail == "thumbnail-skip" and not job.thumbnail_url:
                    return "skipped", "missing thumbnail URL"
                return "downloaded-thumbnail", thumbnail_detail

            if artifact_exists(resume_state, job.stem, "video"):
                return "skipped-existing", "video already downloaded"
            video_url, api_thumbnail_url, page_url = fetch_video_api_fields(job, args)
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
        if args.mode == "videos":
            return "skipped", "generic thumbnail job skipped in videos mode"
        if job.thumbnail_url:
            saved_path = download_binary(job.thumbnail_url, output_dir, job.stem, ".jpg")
            record_artifact(resume_state, job.stem, "image", saved_path)
            return "downloaded-thumbnail", str(saved_path)
        return "skipped", "missing usable URL"

    if args.mode == "videos":
        return "skipped", f"non-video job skipped in videos mode: {job.attachment_type}"
    if artifact_exists(resume_state, job.stem, "image"):
        return "skipped-existing", "thumbnail already downloaded"
    if job.thumbnail_url:
        saved_path = download_binary(job.thumbnail_url, output_dir, job.stem, ".jpg")
        record_artifact(resume_state, job.stem, "image", saved_path)
        return "downloaded-thumbnail", str(saved_path)
    return "skipped", f"unsupported attachment type: {job.attachment_type}"


def main() -> int:
    args = parse_args()
    input_path = Path(args.input_json).expanduser().resolve()
    if not input_path.exists():
        print(f"Input JSON not found: {input_path}", file=sys.stderr)
        return 1

    try:
        posts = load_posts(input_path)
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to parse JSON: {exc}", file=sys.stderr)
        return 1

    jobs = filter_jobs_for_mode(list(iter_attachment_jobs(posts)), args.mode)
    if args.limit is not None:
        jobs = jobs[: args.limit]

    output_dir = ensure_output_dir(args.output_dir, create=not args.dry_run)
    resume_state = load_resume_state(output_dir, args.manifest_name)
    if not args.dry_run:
        persist_resume_state(resume_state)
    print(f"Output directory: {output_dir}")
    print(f"Mode: {args.mode}")
    print(f"Attachments queued: {len(jobs)}")
    print(f"Manifest: {resume_state.manifest_path}")

    if args.dry_run:
        for job in jobs:
            thumbnail_state = "existing" if artifact_exists(resume_state, job.stem, "thumbnail") else "missing"
            image_state = "existing" if artifact_exists(resume_state, job.stem, "image") else "missing"
            video_state = "existing" if artifact_exists(resume_state, job.stem, "video") else "missing"
            print(
                f"DRY RUN {job.stem} "
                f"type={job.attachment_type} "
                f"post_url={job.post_url or '-'} "
                f"thumbnail={job.thumbnail_url or '-'} "
                f"title_url={job.title_url or '-'} "
                f"state=image:{image_state},thumbnail:{thumbnail_state},video:{video_state}"
            )
        return 0

    downloaded = 0
    downloaded_thumbnails = 0
    skipped_existing = 0
    skipped = 0

    for job in jobs:
        status, detail = process_job(job, output_dir, args, resume_state)
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


if __name__ == "__main__":
    raise SystemExit(main())
