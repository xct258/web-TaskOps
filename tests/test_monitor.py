"""服务信息代理回归测试（push-server 用 mock，不依赖网络）。"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "后端"))

from routers import monitor


def record(rid, server, message, created, status="ok", topic=None, title=None):
    return {
        "id": rid,
        "server_name": server,
        "topic": topic or f"server/{server}",
        "title": title or message[:24],
        "message": message,
        "status": status,
        "created_at": created,
        "push_result": "success",
        "msg_type": "markdown",
        "mode": "append",
    }


class SeverityTests(unittest.TestCase):
    def test_valid_status(self):
        for status in ("ok", "warn", "error", "info"):
            self.assertEqual(monitor.detect_severity({"status": status}), status)

    def test_status_is_normalized(self):
        self.assertEqual(monitor.detect_severity({"status": " WARN "}), "warn")

    def test_missing_or_invalid_falls_back_to_info(self):
        for status in (None, "", "maybe"):
            self.assertEqual(monitor.detect_severity({"status": status}), "info")


class GroupTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            record(3, "nas", "docker.7z 失败", "2026-10-20 04:21:00", status="error"),
            record(1, "nas", "docker.7z 成功", "2026-10-18 04:21:00", status="ok"),
            record(2, "vps", "登陆提醒", "2026-10-20 04:22:00", status="warn"),
            record(4, "router", "运行正常", "2026-10-20 04:20:00", status="ok"),
            record(5, "disk", "硬盘休眠", "2026-10-20 04:19:00", status="info"),
        ]

    def test_groups_latest_and_records(self):
        groups = monitor.group_records(self.rows)

        # 先按级别（error → warn → ok → info），同级别内新消息在前。
        self.assertEqual(
            [group["server_name"] for group in groups],
            ["nas", "vps", "router", "disk"],
        )

        nas = groups[0]
        self.assertEqual(nas["count"], 2)
        self.assertEqual(nas["severity"], "error")
        self.assertEqual(nas["latest"]["id"], 3)
        self.assertEqual(nas["latest"]["title"], "docker.7z 失败")
        self.assertEqual([row["id"] for row in nas["records"]], [3, 1])
        self.assertEqual([row["severity"] for row in nas["records"]], ["error", "ok"])

    def test_empty(self):
        self.assertEqual(monitor.group_records([]), [])

    def test_input_records_are_not_mutated(self):
        monitor.group_records(self.rows)
        self.assertNotIn("severity", self.rows[0])

    def test_status_drives_severity_not_message(self):
        groups = monitor.group_records(
            [record(1, "nas", "docker.7z 失败", "2026-10-20 04:21:00", status="ok")]
        )
        self.assertEqual(groups[0]["severity"], "ok")

    def test_same_timestamp_uses_id_as_newest(self):
        rows = [
            record(1, "nas", "旧消息", "2026-10-20 04:21:00", status="warn"),
            record(2, "nas", "新消息", "2026-10-20 04:21:00", status="error"),
        ]

        groups = monitor.group_records(rows)

        self.assertEqual(groups[0]["latest"]["id"], 2)
        self.assertEqual(groups[0]["latest"]["message"], "新消息")
        self.assertEqual(groups[0]["severity"], "error")
        self.assertEqual([row["id"] for row in groups[0]["records"]], [2, 1])


class FetchTests(unittest.TestCase):
    def test_fetch_pages_until_total(self):
        pages = [
            {
                "total": 3,
                "records": [
                    record(1, "nas", "成功", "2026-10-20 04:21:00"),
                    record(2, "vps", "成功", "2026-10-20 04:22:00"),
                ],
            },
            {
                "total": 3,
                "records": [record(3, "router", "成功", "2026-10-20 04:23:00")],
            },
        ]
        calls = []

        def fake_get(path, params=None):
            calls.append((path, dict(params)))
            return pages[len(calls) - 1]

        with patch.object(monitor, "_push_get", side_effect=fake_get):
            rows = monitor.fetch_records()

        self.assertEqual(len(rows), 3)
        self.assertEqual(calls[0], ("/records", {"limit": monitor.PAGE_SIZE, "offset": 0}))
        self.assertEqual(calls[1], ("/records", {"limit": monitor.PAGE_SIZE, "offset": 2}))

    def test_fetch_empty(self):
        with patch.object(monitor, "_push_get", return_value={"total": 0, "records": []}):
            self.assertEqual(monitor.fetch_records(), [])


class ListServersTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            record(1, "nas", "docker.7z 失败", "2026-10-20 04:21:00", status="error"),
            record(2, "vps", "登陆提醒", "2026-10-20 04:22:00", status="warn"),
            record(3, "router", "运行正常", "2026-10-20 04:23:00", status="ok"),
            record(4, "disk", "硬盘休眠", "2026-10-20 04:24:00", status="info"),
        ]

    def test_filter_by_severity(self):
        with patch.object(monitor, "fetch_records", return_value=self.rows):
            result = monitor.list_servers(severity="error", q=None)
            self.assertEqual(result["servers_total"], 1)
            self.assertEqual(result["servers"][0]["server_name"], "nas")

    def test_filter_by_info(self):
        with patch.object(monitor, "fetch_records", return_value=self.rows):
            result = monitor.list_servers(severity="info", q=None)
            self.assertEqual(result["servers_total"], 1)
            self.assertEqual(result["servers"][0]["server_name"], "disk")

    def test_search_matches_message(self):
        with patch.object(monitor, "fetch_records", return_value=self.rows):
            result = monitor.list_servers(severity=None, q="登陆")
            self.assertEqual(result["servers_total"], 1)
            self.assertEqual(result["servers"][0]["server_name"], "vps")

    def test_search_matches_title(self):
        rows = [
            record(
                1,
                "nas",
                "正文没有关键词",
                "2026-10-20 04:21:00",
                title="备份失败",
            )
        ]
        with patch.object(monitor, "fetch_records", return_value=rows):
            result = monitor.list_servers(severity=None, q="备份失败")
            self.assertEqual(result["servers_total"], 1)
            self.assertEqual(result["servers"][0]["server_name"], "nas")

    def test_all_and_counts(self):
        with patch.object(monitor, "fetch_records", return_value=self.rows):
            result = monitor.list_servers(severity=None, q=None)
            self.assertEqual(result["servers_total"], 4)
            self.assertEqual(result["records_total"], 4)

    def test_invalid_severity(self):
        with patch.object(monitor, "fetch_records", return_value=self.rows):
            with self.assertRaises(HTTPException) as ctx:
                monitor.list_servers(severity="maybe", q=None)
            self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
