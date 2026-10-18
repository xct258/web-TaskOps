"""待办接口：到期日期、提醒日期和可选 MQTT 精确推送时间。

- ``due_time`` 是到期日期，``remind_time`` 是页面提醒日期。
- ``mqtt_enabled`` 开启后必须提供 ``mqtt_at``，由 push-server 投递 MQTT。
- 循环模式：``once``（或不传）= 一次性；``daily/weekly/monthly/month_start/yearly/days``
  = 循环（``recurring`` 自动置 True，``days`` 模式再配 ``cycle_days``）。

核心概念：
- 一次性任务：``PUT /todos/{rid}/processed`` 后 ``processed=True``，不再出现。
- 循环任务（``recurring=True``）：完成后按 ``cycle_mode`` 算出下一次 ``due_time``，
  ``processed`` 保持 False；下一次保证**严格晚于今天**（daily 即明天，其余跳过已错过的周期）。
- 完成前会把旧状态存到 ``undo_snapshot``，``POST /todos/{rid}/undo`` 可回滚上一次完成。

MQTT 提醒（TaskOps → push-server 单向投递，逻辑在 push_sync.py）：
- ``mqtt_enabled`` 控制开关，``mqtt_at`` 保存精确排期，``push_task_id`` 保存回执。
- 内存改完→先同步→再 commit，同步失败 rollback + 502（两边一致，无孤儿任务）。
- 客户端反馈只改 push-server 自身任务状态，不再回调回写待办。

调试速查::

    $ curl localhost:8481/todos
    $ curl -X POST localhost:8481/todos -H 'Content-Type: application/json' \\
        -d '{"title":"交电费","content":"主卧电表","due_time":"2026-09-15","remind_time":"2026-09-14"}'
    $ curl -X POST localhost:8481/todos -H 'Content-Type: application/json' \\
        -d '{"title":"浇花","content":"阳台","cycle_mode":"daily"}'
    $ curl -X PUT localhost:8481/todos/1/processed
    $ curl -X POST localhost:8481/todos/1/undo
    $ curl -X POST localhost:8481/todos/1/snooze
    $ curl localhost:8481/todos/1/history
    $ curl -X DELETE localhost:8481/todos/1
"""
import logging
from datetime import date, datetime, timedelta
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlmodel import Session, select

from db import get_todo_session
from models import Todo, TodoCompletion
from push_sync import PushSyncError, cancel_push_task, parse_mqtt_at, upsert_push_task
from utils import calc_next_due, calc_next_due_after, parse_due_date

logger = logging.getLogger(__name__)

router = APIRouter()

# 免提醒标记：循环写 none（区别于一次性的空值）；日期直接置空
NO_CYCLE = "none"


def _sync_upsert_or_502(session: Session, r: Todo) -> None:
    """投递提醒任务（内存改完→先同步→再 commit）；失败记日志 + rollback + 502，保证两边一致。"""
    try:
        r.push_task_id = upsert_push_task(r)
    except PushSyncError as e:
        logger.error(f"待办 #{r.id} 投递提醒失败：{e}")
        session.rollback()
        raise HTTPException(status_code=502, detail=str(e))


def _sync_cancel_or_502(session: Session, todo_id: int) -> None:
    """取消提醒任务；失败记日志 + rollback + 502（防幽灵推送）。"""
    try:
        cancel_push_task(todo_id)
    except PushSyncError as e:
        logger.error(f"待办 #{todo_id} 取消提醒失败：{e}")
        session.rollback()
        raise HTTPException(status_code=502, detail=str(e))


def _normalize_cycle(data) -> None:
    """统一循环语义：传了有效 cycle_mode 即循环；once/空即一次性。"""
    mode = data.cycle_mode.strip() if isinstance(data.cycle_mode, str) else data.cycle_mode
    if mode and mode not in ("once", "none"):
        data.recurring = True
        data.cycle_mode = mode
    else:
        data.recurring = False
        data.cycle_mode = None
    if data.recurring and not data.cycle_mode:
        data.cycle_mode = "daily"


def _parse_date_field(raw) -> date:
    """到期/提醒日统一解析：date 直接用，字符串走 parse_due_date。"""
    if isinstance(raw, date):
        return raw
    return parse_due_date(str(raw))


@router.get("/todos", response_model=List[Todo])
def get_todos(
    limit: int = Query(200, ge=1, le=2000),
    session: Session = Depends(get_todo_session),
):
    return session.exec(select(Todo).order_by(Todo.id).limit(limit)).all()


@router.post("/todos", response_model=Todo)
def create_todo(data: Todo, session: Session = Depends(get_todo_session)):
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()

    data.created_at = today
    if not (data.title or "").strip() or not (data.content or "").strip():
        raise HTTPException(400, "title and content are required")

    if not data.due_time:
        data.remind_time = None
        data.recurring = False
        data.cycle_mode = NO_CYCLE
    else:
        try:
            data.due_time = _parse_date_field(data.due_time)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid due_time format")

        if data.remind_time:
            try:
                data.remind_time = _parse_date_field(data.remind_time)
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid remind_time format")
        _normalize_cycle(data)

    data.mqtt_enabled = bool(data.mqtt_enabled)
    data.push_task_id = None
    if data.mqtt_enabled:
        if not data.mqtt_at:
            raise HTTPException(400, "mqtt_at is required when mqtt_enabled")
        try:
            data.mqtt_at = parse_mqtt_at(data.mqtt_at)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid mqtt_at format")
    else:
        data.mqtt_at = None

    session.add(data)
    session.flush()  # 拿 id 投递（未 commit，失败可回滚，不留孤儿任务）
    if data.mqtt_enabled:
        _sync_upsert_or_502(session, data)
    session.commit()
    session.refresh(data)
    return data


@router.put("/todos/{rid}", response_model=Todo)
def update_todo(
    rid: int = Path(...),
    payload: dict = ...,
    session: Session = Depends(get_todo_session),
):
    r = session.get(Todo, rid)
    if not r:
        raise HTTPException(404, "Todo not found")

    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    r.undo_snapshot = None  # 编辑后「撤销上一次完成」失效

    for field in ["title", "content"]:
        if field in payload:
            setattr(r, field, payload[field])

    for field in ["priority", "catch_up"]:
        if field in payload:
            setattr(r, field, payload[field])

    if "processed" in payload:
        # 允许重新打开（误触完成可撤销；循环行打卡后也可回退）
        r.processed = bool(payload["processed"])
        r.closed_reason = payload.get("closed_reason", "done") if r.processed else None

    for field in ["recurring", "cycle_mode", "cycle_days"]:
        if field in payload:
            setattr(r, field, payload[field])

    if "due_time" in payload:
        if payload["due_time"]:
            try:
                r.due_time = _parse_date_field(payload["due_time"])
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid due_time format")
        else:
            r.due_time = None
    if r.due_time:
        # 提醒日期只认显式传来的值：没传就不动，传空就是「不设提醒」。
        if "remind_time" in payload:
            if payload["remind_time"]:
                try:
                    r.remind_time = _parse_date_field(payload["remind_time"])
                except Exception:
                    raise HTTPException(status_code=400, detail="Invalid remind_time format")
            else:
                r.remind_time = None
        if "cycle_mode" in payload:
            _normalize_cycle(r)
        elif r.recurring and not r.cycle_mode:
            r.cycle_mode = "daily"
    else:
        r.remind_time = None
        r.recurring = False
        r.cycle_mode = NO_CYCLE

    # MQTT 提醒同步（内存改完→先同步→再 commit，失败回滚+502；每次编辑都重投递保鲜）
    if "mqtt_enabled" in payload:
        r.mqtt_enabled = bool(payload["mqtt_enabled"])
    if "mqtt_at" in payload:
        if payload["mqtt_at"]:
            try:
                r.mqtt_at = parse_mqtt_at(payload["mqtt_at"])
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid mqtt_at format")
        else:
            r.mqtt_at = None
    if r.mqtt_enabled and not r.mqtt_at:
        raise HTTPException(400, "mqtt_at is required when mqtt_enabled")
    if r.mqtt_enabled and not (r.processed and not r.recurring):
        _sync_upsert_or_502(session, r)
    else:
        if r.push_task_id:
            _sync_cancel_or_502(session, r.id)
            r.push_task_id = None
        r.mqtt_at = None

    session.commit()
    session.refresh(r)
    return r


def _snapshot(r: Todo) -> dict:
    """完成前的状态快照（日期转 ISO 字符串，便于存 JSON 列 / 撤销回滚）。"""
    return {
        "due_time": r.due_time.isoformat() if r.due_time else None,
        "remind_time": r.remind_time.isoformat() if r.remind_time else None,
        "processed": r.processed,
        "closed_reason": r.closed_reason,
        "last_completed_date": r.last_completed_date.isoformat() if r.last_completed_date else None,
    }


def _log_completion(session: Session, todo_id: int, day: date) -> Optional[TodoCompletion]:
    """记一条循环任务的打卡历史。

    同一天重复打卡只留一条：此时返回 None，表示「这次没新增记录」，
    调用方据此决定 undo 时要不要删（不能删掉上午那次留下的那行）。
    """
    exists = session.exec(
        select(TodoCompletion).where(
            TodoCompletion.todo_id == todo_id, TodoCompletion.completed_on == day
        )
    ).first()
    if exists:
        return None
    row = TodoCompletion(todo_id=todo_id, completed_on=day)
    session.add(row)
    session.flush()  # 拿 id，供 undo 精确回滚
    return row


@router.put("/todos/{rid}/processed")
def mark_processed(
    rid: int = Path(...),
    session: Session = Depends(get_todo_session),
):
    """完成打卡。

    循环+开 MQTT：mqtt_at 按到期日变化同步平移并 upsert 建下一期（先同步后 commit）；
    一次性+开推送：cancel 对端任务（best-effort，失败只记日志，不拦完成）。
    """
    r = session.get(Todo, rid)
    if not r:
        raise HTTPException(404, "Todo not found")

    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    r.undo_snapshot = _snapshot(r)  # 供 /undo 回滚
    r.last_completed_date = today

    if r.recurring:
        base_due = r.due_time or today
        old_due = r.due_time
        if r.catch_up:
            # 逐期补做：按旧 due 只顺延一个周期（可能仍在过去，需继续完成）
            next_due = calc_next_due(r, base_due)
        else:
            # 跳过已错过的周期：下一次严格晚于今天（daily 即明天）
            next_due = calc_next_due_after(r, base_due, today)
        # 循环顺延：推送时间按到期日偏移同步平移
        if r.mqtt_enabled and r.mqtt_at and old_due and next_due:
            try:
                r.mqtt_at = parse_mqtt_at(r.mqtt_at) + (next_due - old_due)
            except ValueError:
                r.mqtt_at = None
        r.due_time = next_due
        # 提醒日期随到期日同步平移；None 表示「不设」，要保持 None，
        # 否则会被「偏移 0」兜底成到期当天，把这个状态弄丢。
        if r.remind_time:
            r.remind_time = next_due - ((old_due - r.remind_time) if old_due else timedelta(0))
        r.processed = False
        r.closed_reason = None
        # 打卡历史：同一天只记一条；记下的 id 存进快照，undo 时精确回滚
        completion = _log_completion(session, r.id, today)
        snap = dict(r.undo_snapshot or {})
        snap["completion_id"] = completion.id if completion else None
        r.undo_snapshot = snap
    else:
        r.processed = True
        r.closed_reason = "done"

    # 推送同步：循环建下一期（失败回滚+502）；一次性取消对端（best-effort）
    if r.mqtt_enabled and r.mqtt_at and not (r.processed and not r.recurring):
        _sync_upsert_or_502(session, r)
    elif not r.recurring and (r.push_task_id or r.mqtt_enabled):
        try:
            cancel_push_task(r.id)
        except PushSyncError as e:
            logger.error(f"待办 #{r.id} 完成但取消提醒失败（对端任务稍后仍会推送，需手动取消）：{e}")

    session.commit()
    session.refresh(r)
    return r


@router.post("/todos/{rid}/undo")
def undo_processed(
    rid: int = Path(...),
    session: Session = Depends(get_todo_session),
):
    """撤销上一次完成：恢复到完成前的日期/状态。"""
    r = session.get(Todo, rid)
    if not r:
        raise HTTPException(404, "Todo not found")

    snap = r.undo_snapshot
    if not snap:
        raise HTTPException(400, "nothing to undo")

    # 这次完成记下的那条打卡历史一并撤掉（id 存在快照里，不会误删同日更早的那条）
    completion_id = snap.get("completion_id")
    if completion_id:
        row = session.get(TodoCompletion, completion_id)
        if row and row.todo_id == r.id:
            session.delete(row)

    r.due_time = _parse_date_field(snap["due_time"]) if snap.get("due_time") else None
    r.remind_time = _parse_date_field(snap["remind_time"]) if snap.get("remind_time") else None
    r.last_completed_date = (
        _parse_date_field(snap["last_completed_date"]) if snap.get("last_completed_date") else None
    )
    r.processed = bool(snap.get("processed"))
    r.closed_reason = snap.get("closed_reason")
    r.undo_snapshot = None

    session.commit()
    session.refresh(r)
    return r


@router.post("/todos/{rid}/snooze")
def snooze_todo(
    rid: int = Path(...),
    session: Session = Depends(get_todo_session),
):
    """行内推迟：循环任务顺延一个周期，一次性任务 +1 天（从 due/今天中较晚者起算）。

    手动推迟+开 MQTT：mqtt_at 按到期日偏移平移并 upsert。
    """
    r = session.get(Todo, rid)
    if not r:
        raise HTTPException(404, "Todo not found")

    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    base = r.due_time or today
    old_due = r.due_time
    anchor = base if base > today else today
    next_due = calc_next_due(r, anchor) if r.recurring else anchor + timedelta(days=1)

    if r.mqtt_enabled:
        if r.mqtt_at and old_due and next_due:
            # 手动推迟：推送时间按到期日偏移同步平移
            try:
                r.mqtt_at = parse_mqtt_at(r.mqtt_at) + (next_due - old_due)
            except ValueError:
                r.mqtt_at = None
    r.due_time = next_due
    # 同上：不设提醒日期（None）时保持不设
    if r.remind_time:
        r.remind_time = next_due - ((old_due - r.remind_time) if old_due else timedelta(0))

    # 手动推迟需同步新的推送排期。
    if r.mqtt_enabled and r.mqtt_at:
        _sync_upsert_or_502(session, r)

    session.commit()
    session.refresh(r)
    return r


@router.get("/todos/{rid}/history", response_model=List[date])
def todo_history(
    rid: int = Path(...),
    session: Session = Depends(get_todo_session),
):
    """循环任务的完成历史：按日期倒序返回打卡日（前端算连续/月度统计）。"""
    return session.exec(
        select(TodoCompletion.completed_on)
        .where(TodoCompletion.todo_id == rid)
        .order_by(TodoCompletion.completed_on.desc())
    ).all()


@router.delete("/todos/{rid}")
def delete_todo(
    rid: int = Path(...),
    session: Session = Depends(get_todo_session),
):
    r = session.get(Todo, rid)
    if not r:
        raise HTTPException(404, "Todo not found")
    # 先取消对端任务（失败 502，不删行，防幽灵推送）
    if r.push_task_id or r.mqtt_enabled:
        _sync_cancel_or_502(session, r.id)
    # 打卡历史跟着删，避免留下孤儿行
    for row in session.exec(select(TodoCompletion).where(TodoCompletion.todo_id == rid)).all():
        session.delete(row)
    session.delete(r)
    session.commit()
    return {"message": "Deleted"}
