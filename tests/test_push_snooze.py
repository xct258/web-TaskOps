"""回归验证：MQTT 分钟级推迟回写，与 TaskOps 日期级推迟独立。

运行：python3 -m unittest discover -s tests -v
"""
import asyncio
import importlib.util
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "后端"))

from models import Todo
from push_sync import parse_push_at
from routers import todos


class PushSnoozeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", poolclass=StaticPool,
            connect_args={"check_same_thread": False},
        )
        SQLModel.metadata.create_all(self.engine, tables=[Todo.__table__])
        self.session = Session(self.engine)
        self.upsert = patch.object(todos, "upsert_push_task", return_value=7).start()
        self.addCleanup(patch.stopall)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.session.close)

    def make_todo(self, **kwargs):
        fields = dict(
            title="测试待办", content="测试内容", push_enabled=True,
            push_at=parse_push_at("2026-10-12T20:30:00+08:00"), push_task_id=7,
        )
        fields.update(kwargs)
        todo = Todo(**fields)
        self.session.add(todo)
        self.session.commit()
        self.session.refresh(todo)
        return todo

    def snooze(self, todo, body=None):
        return todos.snooze_todo(todo.id, body, self.session)

    def test_mqtt_only_callback_persists_schedule(self):
        todo = self.make_todo()
        result = self.snooze(todo, {
            "push_at": "2026-10-12T21:30:00+08:00", "callback_ref": "snooze-1",
        })
        self.session.expire_all()
        stored = self.session.get(Todo, result.id)
        self.assertEqual(parse_push_at(stored.push_at), parse_push_at("2026-10-12T21:30:00+08:00"))
        self.assertEqual(stored.last_callback_ref, "snooze-1")
        self.assertIsNone(stored.due_time)
        self.assertIsNone(stored.remind_time)
        self.assertFalse(stored.processed)
        self.upsert.assert_not_called()

    def test_callback_preserves_reminder_dates_and_recurring_cycle(self):
        for recurring in (False, True):
            with self.subTest(recurring=recurring):
                todo = self.make_todo(
                    need_remind=True, due_time=date(2026, 10, 15),
                    remind_time=date(2026, 10, 12), recurring=recurring,
                    cycle_mode="daily" if recurring else None,
                )
                result = self.snooze(todo, {"push_at": "2026-10-12T21:30:00+08:00"})
                self.assertEqual(result.due_time, date(2026, 10, 15))
                self.assertEqual(result.remind_time, date(2026, 10, 12))
                self.assertEqual(result.recurring, recurring)
        self.upsert.assert_not_called()

    def test_callback_replay_does_not_overwrite_schedule(self):
        todo = self.make_todo()
        body = {"push_at": "2026-10-12T21:30:00+08:00", "callback_ref": "snooze-1"}
        self.snooze(todo, body)
        todo.push_at = parse_push_at("2026-10-12T22:30:00+08:00")
        self.session.commit()
        result = self.snooze(todo, body)
        self.assertEqual(parse_push_at(result.push_at), parse_push_at("2026-10-12T22:30:00+08:00"))
        self.upsert.assert_not_called()

    def test_invalid_callback_schedule_is_rejected_without_changes(self):
        todo = self.make_todo()
        previous = todo.push_at
        with self.assertRaises(HTTPException) as error:
            self.snooze(todo, {"push_at": "invalid", "callback_ref": "snooze-1"})
        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(todo.push_at, previous)
        self.assertIsNone(todo.last_callback_ref)

    def test_callback_does_not_enable_disabled_push(self):
        todo = self.make_todo(push_enabled=False, push_at=None)
        with self.assertRaises(HTTPException) as error:
            self.snooze(todo, {"push_at": "2026-10-12T21:30:00+08:00"})
        self.assertEqual(error.exception.status_code, 400)
        self.assertIsNone(todo.push_at)

    def test_manual_snooze_still_requires_date_reminder(self):
        todo = self.make_todo()
        with self.assertRaises(HTTPException) as error:
            self.snooze(todo)
        self.assertEqual(error.exception.status_code, 400)

    def test_manual_snooze_advances_dates_and_syncs_push(self):
        for recurring in (False, True):
            with self.subTest(recurring=recurring):
                todo = self.make_todo(
                    need_remind=True, due_time=date(2099, 10, 15),
                    remind_time=date(2099, 10, 12), recurring=recurring,
                    cycle_mode="daily" if recurring else None,
                )
                previous = parse_push_at(todo.push_at)
                result = self.snooze(todo)
                self.assertEqual(result.due_time, date(2099, 10, 16))
                self.assertEqual(result.remind_time, date(2099, 10, 13))
                self.assertEqual(parse_push_at(result.push_at), previous + timedelta(days=1))
                self.upsert.assert_called_with(result)

    def test_push_feedback_calls_taskops_and_completes_callback(self):
        for source in ("容器相关脚本/main.py", "data/main.py"):
            with self.subTest(source=source):
                spec = importlib.util.spec_from_file_location(
                    "push_snooze_test", PROJECT.parent / "push-server" / source,
                )
                push = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(push)
                todo = self.make_todo()
                task = {
                    "task_id": 7, "client_ref": f"todo-{todo.id}", "status": "sent",
                    "schedule_at": "2026-10-12T20:30:00+08:00",
                }
                data = {"tasks": [task]}
                callbacks = []

                def callback_http(method, url, body):
                    self.assertEqual(method, "POST")
                    self.assertTrue(url.endswith(f"/api/todos/{todo.id}/snooze"))
                    self.assertTrue(body["callback_ref"])
                    with Session(self.engine) as session:
                        todos.snooze_todo(todo.id, body, session)
                    return {}

                async def feedback():
                    with patch.object(push, "load_tasks", return_value=data), \
                         patch.object(push, "save_tasks"), \
                         patch.object(push, "_callback_http", side_effect=callback_http), \
                         patch.object(push.asyncio, "create_task", side_effect=callbacks.append):
                        result = await push.apply_feedback(7, "snooze", 60)
                        self.assertEqual(result["code"], 200)
                        self.assertEqual(result["status"], "pending")
                        self.assertEqual(result["schedule_at"], "2026-10-12T21:30:00+08:00")
                        for callback in callbacks:
                            await callback

                asyncio.run(feedback())
                self.assertEqual(task["callback"], "done")
                self.assertEqual(task["retry"], 0)
                self.session.refresh(todo)
                self.assertEqual(parse_push_at(todo.push_at), parse_push_at(task["schedule_at"]))
                self.assertIsNone(todo.due_time)
                self.upsert.assert_not_called()


if __name__ == "__main__":
    unittest.main()
