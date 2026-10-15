"""提醒日、MQTT 推送时间和推迟回归测试。"""
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
            title="测试待办", content="测试内容", due_time=date(2099, 10, 15),
            remind_time=date(2099, 10, 12), mqtt_enabled=True,
            mqtt_at=parse_mqtt_at("2099-10-12T20:30:00+08:00"), push_task_id=7,
        )
        fields.update(kwargs)
        todo = Todo(**fields)
        self.session.add(todo)
        self.session.commit()
        self.session.refresh(todo)
        return todo

    def test_manual_snooze_shifts_due_and_reminder_dates(self):
        todo = self.make_todo()
        result = todos.snooze_todo(todo.id, self.session)
        self.assertEqual(result.due_time, date(2099, 10, 16))
        self.assertEqual(result.remind_time, date(2099, 10, 13))
        self.assertEqual(parse_mqtt_at(result.mqtt_at), parse_mqtt_at("2099-10-13T20:30:00+08:00"))
        self.upsert.assert_called_with(result)

    def test_mqtt_requires_exact_time(self):
        todo = self.make_todo(mqtt_enabled=False, mqtt_at=None)
        with self.assertRaises(HTTPException) as error:
            todos.update_todo(todo.id, {"mqtt_enabled": True}, self.session)
        self.assertEqual(error.exception.status_code, 400)

    def test_done_is_stored(self):
        done = self.make_todo(mqtt_enabled=False, mqtt_at=None, push_task_id=None)
        todos.mark_processed(done.id, self.session)
        self.session.refresh(done)
        self.assertTrue(done.processed)
        self.assertEqual(done.closed_reason, "done")


if __name__ == "__main__":
    unittest.main()
