from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR / "scripts"))

import posts_tool  # noqa: E402


class PostsToolTests(unittest.TestCase):
    def test_extract_unique_detail_attachments_reads_nested_media(self) -> None:
        payload = {
            "result": {
                "post_id": "post-1",
                "media": {
                    "photo": {
                        "id": "photo-main",
                        "uri": "https://cdn.example.com/photo-main.jpg",
                    },
                    "subAttachments": [
                        {
                            "id": "video-main",
                            "playable_url": "https://cdn.example.com/video-main.mp4",
                            "thumbnail": "https://cdn.example.com/video-main.jpg",
                        }
                    ],
                },
                "attached_post": {
                    "post_id": "post-attached",
                    "media": {
                        "photo": {
                            "id": "photo-attached",
                            "uri": "https://cdn.example.com/photo-attached.jpg",
                        }
                    },
                },
            }
        }

        attachments = posts_tool.extract_unique_detail_attachments(payload)

        self.assertEqual(
            [attachment["id"] for attachment in attachments],
            ["photo-main", "video-main", "photo-attached"],
        )

    def test_build_attachment_jobs_prefers_detail_payload_then_falls_back_to_posts_json(self) -> None:
        posts = [
            {
                "post_id": "p1",
                "url": "https://www.facebook.com/groups/fbaio/permalink/p1/",
                "content": {
                    "attachments": [
                        {
                            "id": "fallback-a",
                            "type": "Photo",
                            "thumbnail": "https://cdn.example.com/fallback-a.jpg",
                        }
                    ]
                },
            },
            {
                "post_id": "p2",
                "content": {
                    "attachments": [
                        {
                            "id": "fallback-b",
                            "type": "Photo",
                            "thumbnail": "https://cdn.example.com/fallback-b.jpg",
                        }
                    ]
                },
            },
        ]

        detail_payload = {
            "result": {
                "post_id": "p1",
                "url": "https://www.facebook.com/groups/fbaio/permalink/p1/",
                "media": {
                    "photo": {
                        "id": "detail-a",
                        "uri": "https://cdn.example.com/detail-a.jpg",
                    }
                },
            }
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            details_dir = Path(temp_dir)
            (details_dir / "p1.json").write_text(
                json.dumps(detail_payload),
                encoding="utf-8",
            )

            jobs = posts_tool.build_attachment_jobs(posts, details_dir=details_dir)

        self.assertEqual(
            [(job.post_id, job.attachment_id) for job in jobs],
            [("p1", "detail-a"), ("p2", "fallback-b")],
        )

    def test_build_csv_row_injects_detail_metrics_and_omits_url(self) -> None:
        post = {
            "post_id": "p1",
            "creation_time": 123,
            "url": "https://fb.com/example",
            "message": "Xin chao",
            "title": "Xin chao",
            "summary": "Mo ta them",
            "content": {
                "attachments": [{"id": "att-1", "type": "Photo"}],
                "text": "Noi dung",
            },
        }
        detail_payload = {
            "result": {
                "reactions": {"total": 12},
                "comments": {"total_count": 3},
                "shares": 4,
                "hashtags": ["#fbaio", "#tools"],
            }
        }

        row = posts_tool.build_csv_row(post, detail_payload)

        self.assertNotIn("url", row)
        self.assertNotIn("title", row)
        self.assertNotIn("summary", row)
        self.assertEqual(row["message"], "Xin chao\\n\\nMo ta them")
        self.assertEqual(row["attachments"], "Photo:att-1")
        self.assertEqual(row["thumbhash"], "")
        self.assertEqual(row["reactions"], "12")
        self.assertEqual(row["comments"], "3")
        self.assertEqual(row["shares"], "4")
        self.assertEqual(row["hashtags"], "#fbaio #tools")

    def test_build_csv_row_prefers_detail_attachments_when_present(self) -> None:
        post = {
            "post_id": "p1",
            "content": {
                "attachments": [{"id": "old-att", "type": "Photo"}],
            },
        }
        detail_payload = {
            "result": {
                "post_id": "p1",
                "media": {
                    "photo": {
                        "id": "new-att",
                        "uri": "https://cdn.example.com/new-att.jpg",
                    }
                },
            }
        }

        row = posts_tool.build_csv_row(post, detail_payload)

        self.assertEqual(row["attachments"], "Photo:new-att")

    def test_update_csv_thumbhashes_merges_message_columns_and_rewrites_schema(self) -> None:
        original_generate_thumbhash = posts_tool.generate_thumbhash

        def fake_generate_thumbhash(path):
            return f"hash:{path.name}"

        posts_tool.generate_thumbhash = fake_generate_thumbhash

        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                base = Path(temp_dir)
                csv_path = base / "posts.min.csv"
                media_dir = base / "media"
                media_dir.mkdir()
                (media_dir / "p1_att-1.jpg").write_bytes(b"fake-image")
                csv_path.write_text(
                    "\n".join(
                        [
                            "post_id,creation_time,message,title,summary,attachments,content_text,reactions,comments,shares,hashtags",
                            'p1,123,"Xin chao","Xin chao","Mo ta them",Photo:att-1,,1,2,3,#tag',
                        ]
                    )
                    + "\n",
                    encoding="utf-8",
                )

                rows, hashed_rows = posts_tool.update_csv_thumbhashes(
                    csv_path,
                    media_dir=media_dir,
                )
                saved_rows = posts_tool.load_csv_rows(csv_path)
        finally:
            posts_tool.generate_thumbhash = original_generate_thumbhash

        self.assertEqual(hashed_rows, 1)
        self.assertEqual(rows[0]["message"], "Xin chao\\n\\nMo ta them")
        self.assertEqual(rows[0]["thumbhash"], "hash:p1_att-1.jpg")
        self.assertNotIn("title", saved_rows[0])
        self.assertNotIn("summary", saved_rows[0])
        self.assertEqual(saved_rows[0]["thumbhash"], "hash:p1_att-1.jpg")

    def test_build_post_from_detail_payload_creates_posts_json_shape(self) -> None:
        payload = {
            "result": {
                "id": "story-123",
                "post_id": "p9",
                "url": "https://www.facebook.com/groups/fbaio/permalink/p9/",
                "text": "Message text",
                "actors": [
                    {
                        "id": "actor-1",
                        "name": "Hoang Tran",
                        "url": "https://www.facebook.com/9999.hoangtran",
                    }
                ],
                "comments": {"total_count": 7},
                "reactions": {
                    "total": 11,
                    "top": [{"id": "like", "count": 9, "name": "Thích"}],
                },
                "shares": 2,
                "created_time": 1770000000000,
                "media": {
                    "photo": {
                        "id": "media-1",
                        "uri": "https://cdn.example.com/media-1.jpg",
                    }
                },
                "attached_post": {
                    "text": "Attached text",
                },
            }
        }

        post = posts_tool.build_post_from_detail_payload("p9", payload)

        self.assertEqual(post["post_id"], "p9")
        self.assertEqual(post["story_id"], "story-123")
        self.assertEqual(post["message"], "Message text")
        self.assertEqual(post["content"]["text"], "Attached text")
        self.assertEqual(post["comments"]["total"], 7)
        self.assertEqual(post["reactions"]["total"], 11)
        self.assertEqual(post["shares"]["total"], 2)
        self.assertEqual(post["content"]["attachments"][0]["id"], "media-1")

    def test_sync_posts_with_details_merges_existing_and_detail_attachments(self) -> None:
        posts = [
            {
                "post_id": "p1",
                "content": {
                    "attachments": [
                        {
                            "id": "old-att",
                            "type": "Photo",
                            "thumbnail": "https://cdn.example.com/old-att.jpg",
                        }
                    ]
                },
            }
        ]
        detail_payload = {
            "result": {
                "post_id": "p1",
                "media": {
                    "photo": {
                        "id": "new-att",
                        "uri": "https://cdn.example.com/new-att.jpg",
                    }
                },
            }
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            details_dir = Path(temp_dir)
            (details_dir / "p1.json").write_text(json.dumps(detail_payload), encoding="utf-8")

            synced_posts, changed_posts, added_attachments = posts_tool.sync_posts_with_details(
                posts,
                details_dir,
            )

        self.assertEqual(changed_posts, 1)
        self.assertEqual(added_attachments, 1)
        self.assertEqual(
            [item["id"] for item in synced_posts[0]["content"]["attachments"]],
            ["old-att", "new-att"],
        )

    def test_run_backup_post_upserts_post_and_regenerates_csv(self) -> None:
        payload = {
            "result": {
                "id": "story-backup",
                "post_id": "p-new",
                "url": "https://www.facebook.com/groups/fbaio/permalink/p-new/",
                "text": "New message",
                "actors": [{"id": "actor-1", "name": "Admin", "url": "https://example.com"}],
                "comments": {"total_count": 1},
                "reactions": {"total": 2, "top": []},
                "shares": 3,
                "created_time": 200,
                "media": {
                    "photo": {"id": "media-x", "uri": "https://cdn.example.com/media-x.jpg"}
                },
            }
        }

        captured = {"media_called": False, "csv_called": False}
        original_fetch_single = posts_tool.fetch_single_detail_to_cache
        original_run_download_media = posts_tool.run_download_media
        original_run_export_csv = posts_tool.run_export_csv

        def fake_fetch_single_detail_to_cache(**kwargs):
            return payload, "api"

        def fake_run_download_media(**kwargs):
            captured["media_called"] = True
            captured["media_post_ids"] = {post["post_id"] for post in kwargs["posts_override"]}
            return 0

        def fake_run_export_csv(**kwargs):
            captured["csv_called"] = True
            return 0

        posts_tool.fetch_single_detail_to_cache = fake_fetch_single_detail_to_cache
        posts_tool.run_download_media = fake_run_download_media
        posts_tool.run_export_csv = fake_run_export_csv

        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                base = Path(temp_dir)
                posts_path = base / "posts.json"
                posts_path.write_text(
                    json.dumps(
                        [
                            {
                                "post_id": "older",
                                "id": "older",
                                "creation_time": 100,
                                "content": {"attachments": []},
                            }
                        ]
                    ),
                    encoding="utf-8",
                )

                result = posts_tool.run_backup_post(
                    post_id="p-new",
                    posts_path=posts_path,
                    details_dir=base / "details",
                    media_output_dir=base / "media",
                    csv_output_path=base / "posts.min.csv",
                    detail_api_config=posts_tool.APIConfig("detail", "client", "get_fb_post_info"),
                    media_api_config=posts_tool.APIConfig("media", "client", "get_fb_video_info"),
                )

                saved_posts = json.loads(posts_path.read_text(encoding="utf-8"))
        finally:
            posts_tool.fetch_single_detail_to_cache = original_fetch_single
            posts_tool.run_download_media = original_run_download_media
            posts_tool.run_export_csv = original_run_export_csv

        self.assertEqual(result, 0)
        self.assertEqual(saved_posts[0]["post_id"], "p-new")
        self.assertEqual(saved_posts[1]["post_id"], "older")
        self.assertTrue(captured["media_called"])
        self.assertEqual(captured["media_post_ids"], {"p-new"})
        self.assertTrue(captured["csv_called"])


if __name__ == "__main__":
    unittest.main()
