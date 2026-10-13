"""提醒日、MQTT 推送时间和推迟回调回归测试。"""
import unittest
from datetime import date
from pathlib import Path
import sys
from unittest.mock import patch

from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "后端"))

from models import Todo
from push_sync import parse_mqtt_at
from routers import todos


class ReminderTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine, tables=[Todo.__table__])
        self.session = Session(self.engine)
        self.upsert = patch.object(todos, "upsert_push_task", return_value=7).start()
        self.addCleanup(patch.stopall)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.session.close)

    def make_todo(self, **kwargs):
        fields = dict(
            title="测试待办", content="测试内容", due_time=date(2026, 10, 15),
            remind_time=date(2026, 10, 12), mqtt_enabled=True,
            mqtt_at=parse_mqtt_at("2026-10-12T20:30:00+08:00"), push_task_id=7,
        )
        fields.update(kwargs)
        todo = Todo(**fields)
        self.session.add(todo)
        self.session.commit()
        self.session.refresh(todo)
        return todo

    def test_mqtt_callback_updates_only_mqtt_schedule(self):
        todo = self.make_todo()
        result = todos.snooze_todo(todo.id, {
            "mqtt_at": "2026-10-12T21:30:00+08:00", "callback_ref": "snooze-1",
        }, self.session)
        self.assertEqual(parse_mqtt_at(result.mqtt_at), parse_mqtt_at("2026-10-12T21:30:00+08:00"))
        self.assertEqual(result.due_time, date(2026, 10, 15))
        self.assertEqual(result.remind_time, date(2026, 10, 12))
        self.assertEqual(result.last_callback_ref, "snooze-1")
        self.upsert.assert_not_called()

    def test_manual_snooze_shifts_due_and_reminder_dates(self):
        todo = self.make_todo()
        result = todos.snooze_todo(todo.id, None, self.session)
        self.assertEqual(result.due_time, date(2026, 10, 16))
        self.assertEqual(result.remind_time, date(2026, 10, 13))
        self.assertEqual(parse_mqtt_at(result.mqtt_at), parse_mqtt_at("2026-10-13T20:30:00+08:00"))
        self.upsert.assert_called_with(result)

    def test_mqtt_requires_exact_time(self):
        todo = self.make_todo(mqtt_enabled=False, mqtt_at=None)
        with self.assertRaises(HTTPException) as error:
            todos.update_todo(todo.id, {"mqtt_enabled": True}, self.session)
        self.assertEqual(error.exception.status_code, 400)

    def test_done_and_cancelled_are_stored_separately(self):
        done = self.make_todo(mqtt_enabled=False, mqtt_at=None, push_task_id=None)
        todos.mark_processed(done.id, {}, self.session)
        self.session.refresh(done)
        self.assertTrue(done.processed)
        self.assertEqual(done.closed_reason, "done")

        cancelled = self.make_todo(mqtt_enabled=False, mqtt_at=None, push_task_id=None)
        todos.mark_processed(cancelled.id, {"action": "cancelled"}, self.session)
        self.session.refresh(cancelled)
        self.assertTrue(cancelled.processed)
        self.assertEqual(cancelled.closed_reason, "cancelled")

    def test_page_done_syncs_done_instead_of_cancel(self):
        todo = self.make_todo()
        with patch.object(todos, "finish_push_task") as finish, patch.object(todos, "cancel_push_task") as cancel:
            result = todos.mark_processed(todo.id, {"action": "done"}, self.session)
            finish.assert_called_once_with(7, "done")
            cancel.assert_not_called()
            self.assertEqual(result.closed_reason, "done")

    def test_recurring_done_ends_old_period_and_registers_next(self):
        todo = self.make_todo(recurring=True, cycle_mode="weekly", due_time=date(2099, 10, 15))
        with patch.object(todos, "finish_push_task") as finish:
            todos.mark_processed(todo.id, {"action": "done"}, self.session)
            finish.assert_called_once_with(7, "done")
            self.upsert.assert_called_once()
            self.assertFalse(todo.processed)

    def test_invalid_mqtt_callback_does_not_change_schedule(self):
        todo = self.make_todo()
        previous = todo.mqtt_at
        with self.assertRaises(HTTPException) as error:
            todos.snooze_todo(todo.id, {"mqtt_at": "invalid"}, self.session)
        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(todo.mqtt_at, previous)


if __name__ == "__main__":
    unittest.main()
