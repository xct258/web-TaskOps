"""MQTT 时间在新增、持久化、编辑和列表接口中保持北京时间。"""
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.encoders import jsonable_encoder
from sqlmodel import Session, SQLModel, create_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "后端"))

from models import Todo
from push_sync import build_task_payload
from routers import todos


class PushTimeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine, tables=[Todo.__table__])
        self.session = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.session.close)

    def test_create_reload_and_edit_preserve_shanghai_schedule(self):
        for input_time in ("2026-10-12T20:30:00+08:00", "2026-10-12T12:30:00Z", "2026-10-12T20:30"):
            with self.subTest(input_time=input_time):
                todo = Todo.model_validate({
                    "title": "MQTT 时间测试", "content": "测试", "mqtt_enabled": True,
                    "mqtt_at": input_time,
                })
                with patch.object(todos, "upsert_push_task", return_value=7):
                    created = todos.create_todo(todo, self.session)
                    self.assertEqual(jsonable_encoder(created)["mqtt_at"], "2026-10-12T20:30:00+08:00")
                    payload = build_task_payload(created, {"server_name": "taskops", "topic": "taskops/todo"})
                    self.assertEqual(payload["schedule_at"], "2026-10-12T20:30:00+08:00")
                    self.session.expire_all()
                    reloaded = todos.get_todos(limit=200, session=self.session)
                    row = next(item for item in reloaded if item.id == created.id)
                    self.assertEqual(jsonable_encoder(row)["mqtt_at"], "2026-10-12T20:30:00+08:00")
                    updated = todos.update_todo(created.id, {"mqtt_at": "2026-10-12T16:00:00Z"}, self.session)
                    self.assertEqual(jsonable_encoder(updated)["mqtt_at"], "2026-10-13T00:00:00+08:00")

    def test_serializer_converts_aware_time_and_preserves_empty(self):
        todo = Todo(title="测试", content="测试", mqtt_at=datetime(2026, 10, 12, 12, 30, tzinfo=timezone.utc))
        self.assertEqual(jsonable_encoder(todo)["mqtt_at"], "2026-10-12T20:30:00+08:00")
        todo.mqtt_at = None
        self.assertIsNone(jsonable_encoder(todo)["mqtt_at"])


if __name__ == "__main__":
    unittest.main()
