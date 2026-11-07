"""服务信息代理回归测试（push-server 用 mock，不依赖网络）。"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "后端"))

from models import MonitorRecordAck
from routers import monitor


class FakeSession:
    """list_servers 的会话替身：没有消除记录。"""

    def exec(self, *args, **kwargs):
        return self

    def all(self):
        return []


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

    def test_alert_in_another_script_is_not_hidden_by_newer_ok(self):
        rows = [
            record(
                2, "nas", "备份成功", "2026-10-21 04:21:00",
                status="ok", topic="server/backup", title="备份脚本",
            ),
            record(
                1, "nas", "磁盘空间不足", "2026-10-20 04:21:00",
                status="warn", topic="server/disk", title="磁盘检查",
            ),
        ]

        groups = monitor.group_records(rows)

        # 另一个脚本的最新消息是正常，但磁盘检查脚本仍有未消除警告。
        self.assertEqual(groups[0]["severity"], "warn")
        self.assertEqual(groups[0]["latest"]["id"], 1)
        self.assertEqual(groups[0]["latest"]["title"], "磁盘检查")

    def test_newer_ok_does_not_hide_unacked_alert(self):
        rows = [
            record(
                2, "nas", "磁盘已恢复", "2026-10-21 04:21:00",
                status="ok", topic="server/disk", title="磁盘检查",
            ),
            record(
                1, "nas", "磁盘空间不足", "2026-10-20 04:21:00",
                status="warn", topic="server/disk", title="磁盘检查",
            ),
        ]

        groups = monitor.group_records(rows)

        # 没有显式消除前，后到的正常消息不会让未消除的警报消失。
        self.assertEqual(groups[0]["severity"], "warn")
        self.assertEqual(groups[0]["latest"]["id"], 1)

    def test_newer_info_does_not_hide_unacked_alert(self):
        rows = [
            record(
                2, "nas", "推送测试", "2026-10-21 04:21:00",
                status="info", topic="server/disk", title="磁盘检查",
            ),
            record(
                1, "nas", "磁盘空间不足", "2026-10-20 04:21:00",
                status="warn", topic="server/disk", title="磁盘检查",
            ),
        ]

        groups = monitor.group_records(rows)

        self.assertEqual(groups[0]["severity"], "warn")
        self.assertEqual(groups[0]["latest"]["id"], 1)

    def test_acking_alert_lets_newer_ok_show(self):
        rows = [
            record(
                2, "nas", "磁盘已恢复", "2026-10-21 04:21:00",
                status="ok", topic="server/disk", title="磁盘检查",
            ),
            record(
                1, "nas", "磁盘空间不足", "2026-10-20 04:21:00",
                status="warn", topic="server/disk", title="磁盘检查",
            ),
        ]

        groups = monitor.group_records(rows, {("nas", 1, "2026-10-20 04:21:00")})

        self.assertEqual(groups[0]["severity"], "ok")
        self.assertEqual(groups[0]["latest"]["id"], 2)

    def test_overwrite_with_new_timestamp_is_not_acked(self):
        rows = [
            record(3, "nas", "覆盖后的新报警", "2026-10-21 04:21:00", status="error"),
        ]

        groups = monitor.group_records(rows, {("nas", 3, "2026-10-20 04:21:00")})

        # 覆盖模式复用 id 但 created_at 变了，不能被上一版消除状态继承。
        self.assertFalse(groups[0]["records"][0]["acked"])
        self.assertEqual(groups[0]["severity"], "error")


class AckTests(unittest.TestCase):
    def test_acked_message_falls_back_to_previous_message(self):
        rows = [
            record(3, "nas", "docker.7z 失败", "2026-10-20 04:21:00", status="error"),
            record(1, "nas", "docker.7z 成功", "2026-10-18 04:21:00", status="ok"),
        ]

        groups = monitor.group_records(rows, {("nas", 3, "2026-10-20 04:21:00")})

        # 只消除 id=3 这条；卡片退回上一条正常消息。
        self.assertTrue(groups[0]["records"][0]["acked"])
        self.assertFalse(groups[0]["records"][1]["acked"])
        self.assertEqual(groups[0]["latest"]["id"], 1)
        self.assertEqual(groups[0]["severity"], "ok")
        self.assertFalse(groups[0]["all_acked"])

    def test_acking_one_alert_keeps_other_alerts(self):
        rows = [
            record(4, "nas", "新报警", "2026-10-21 04:21:00", status="error"),
            record(3, "nas", "旧报警", "2026-10-20 04:21:00", status="warn"),
        ]

        groups = monitor.group_records(rows, {("nas", 4, "2026-10-21 04:21:00")})

        # 消除 id=4 后，id=3 仍然是未消除的报警。
        self.assertEqual(groups[0]["latest"]["id"], 3)
        self.assertEqual(groups[0]["severity"], "warn")
        self.assertFalse(groups[0]["all_acked"])
        self.assertEqual(groups[0]["acked_count"], 1)

    def test_all_messages_acked_makes_server_normal(self):
        rows = [record(3, "nas", "备份失败", "2026-10-20 04:21:00", status="error")]

        groups = monitor.group_records(rows, {("nas", 3, "2026-10-20 04:21:00")})

        self.assertEqual(groups[0]["severity"], "ok")
        self.assertTrue(groups[0]["all_acked"])
        self.assertEqual(groups[0]["latest"]["id"], 3)

    def test_new_record_after_ack_shows_again(self):
        rows = [record(4, "nas", "备份又失败", "2026-10-21 04:21:00", status="error")]

        groups = monitor.group_records(rows, {("nas", 3, "2026-10-20 04:21:00")})

        self.assertEqual(groups[0]["severity"], "error")
        self.assertFalse(groups[0]["all_acked"])
        self.assertFalse(groups[0]["records"][0]["acked"])

    def test_ack_without_id_falls_back_to_created_at(self):
        rows = [
            record(0, "nas", "没有 id 的报警", "2026-10-20 04:21:00", status="warn"),
        ]

        groups = monitor.group_records(rows, {("nas", 0, "2026-10-20 04:21:00")})

        self.assertEqual(groups[0]["severity"], "ok")
        self.assertTrue(groups[0]["records"][0]["acked"])

    def test_ack_does_not_affect_other_servers(self):
        rows = [
            record(3, "nas", "nas 报警", "2026-10-20 04:21:00", status="error"),
            record(4, "vps", "vps 报警", "2026-10-20 04:22:00", status="error"),
        ]

        groups = monitor.group_records(rows, {("nas", 3, "2026-10-20 04:21:00")})
        by_name = {group["server_name"]: group for group in groups}

        self.assertEqual(by_name["nas"]["severity"], "ok")
        self.assertEqual(by_name["vps"]["severity"], "error")


class AckEndpointTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(
            self.engine, tables=[MonitorRecordAck.__table__]
        )
        self.session = Session(self.engine)

    def tearDown(self):
        self.session.close()

    def test_ack_and_restore_one_record(self):
        monitor.ack_record(
            "nas", 3, monitor.AckPayload(created_at="2026-10-20 04:21:00"), self.session
        )
        monitor.ack_record(
            "nas", 4, monitor.AckPayload(created_at="2026-10-21 04:21:00"), self.session
        )

        rows = self.session.exec(select(MonitorRecordAck)).all()
        self.assertEqual(
            [(row.server_name, row.record_id) for row in rows], [("nas", 3), ("nas", 4)]
        )

        monitor.restore_record("nas", 4, self.session)
        rows = self.session.exec(select(MonitorRecordAck)).all()
        self.assertEqual(
            [(row.server_name, row.record_id) for row in rows], [("nas", 3)]
        )

    def test_ack_again_updates_instead_of_duplicating(self):
        monitor.ack_record(
            "nas", 3, monitor.AckPayload(created_at="2026-10-20 04:21:00"), self.session
        )
        monitor.ack_record(
            "nas", 3, monitor.AckPayload(created_at="2026-10-20 04:21:00"), self.session
        )

        rows = self.session.exec(select(MonitorRecordAck)).all()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].record_id, 3)

    def test_overwrite_revision_ack_and_restore_are_independent(self):
        monitor.ack_record(
            "nas", 3, monitor.AckPayload(created_at="2026-10-20 04:21:00"), self.session
        )
        monitor.ack_record(
            "nas", 3, monitor.AckPayload(created_at="2026-10-21 04:21:00"), self.session
        )

        rows = self.session.exec(select(MonitorRecordAck)).all()
        self.assertEqual(
            sorted(row.record_created_at for row in rows),
            ["2026-10-20 04:21:00", "2026-10-21 04:21:00"],
        )

        monitor.restore_record("nas", 3, self.session, "2026-10-21 04:21:00")
        rows = self.session.exec(select(MonitorRecordAck)).all()
        self.assertEqual([row.record_created_at for row in rows], ["2026-10-20 04:21:00"])

    def test_ack_all_marks_only_alerts_and_is_idempotent(self):
        rows = [
            record(1, "nas", "备份失败", "2026-10-20 04:21:00", status="error"),
            record(2, "nas", "备份恢复", "2026-10-20 04:22:00", status="ok"),
            record(4, "nas", "磁盘警告", "2026-10-20 04:24:00", status="warn"),
            record(3, "vps", "登陆提醒", "2026-10-20 04:23:00", status="warn"),
        ]

        with patch.object(monitor, "fetch_records", return_value=rows):
            result = monitor.ack_all_records("nas", self.session)
        self.assertEqual(result["acked"], 2)

        acked = self.session.exec(select(MonitorRecordAck)).all()
        self.assertEqual(
            {(row.server_name, row.record_id) for row in acked},
            {("nas", 1), ("nas", 4)},
        )

        with patch.object(monitor, "fetch_records", return_value=rows):
            again = monitor.ack_all_records("nas", self.session)
        self.assertEqual(again["acked"], 0)
        self.assertEqual(len(self.session.exec(select(MonitorRecordAck)).all()), 2)


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

    def call(self, **kwargs):
        return monitor.list_servers(session=FakeSession(), **kwargs)

    def test_filter_by_severity(self):
        with patch.object(monitor, "fetch_records", return_value=self.rows):
            result = self.call(severity="error", q=None)
            self.assertEqual(result["servers_total"], 1)
            self.assertEqual(result["servers"][0]["server_name"], "nas")

    def test_filter_by_info(self):
        with patch.object(monitor, "fetch_records", return_value=self.rows):
            result = self.call(severity="info", q=None)
            self.assertEqual(result["servers_total"], 1)
            self.assertEqual(result["servers"][0]["server_name"], "disk")

    def test_search_matches_message(self):
        with patch.object(monitor, "fetch_records", return_value=self.rows):
            result = self.call(severity=None, q="登陆")
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
            result = self.call(severity=None, q="备份失败")
            self.assertEqual(result["servers_total"], 1)
            self.assertEqual(result["servers"][0]["server_name"], "nas")

    def test_all_and_counts(self):
        with patch.object(monitor, "fetch_records", return_value=self.rows):
            result = self.call(severity=None, q=None)
            self.assertEqual(result["servers_total"], 4)
            self.assertEqual(result["records_total"], 4)

    def test_invalid_severity(self):
        with patch.object(monitor, "fetch_records", return_value=self.rows):
            with self.assertRaises(HTTPException) as ctx:
                self.call(severity="maybe", q=None)
            self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
