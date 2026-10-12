"""待办接口（原提醒改名，路由 /todos；字段 remind_time 等历史列名保留）。

输入口径：标题(title)/内容(content)/到期日(due_time)/是否提醒(need_remind)/提醒日(remind_time)/循环模式(cycle_mode)。
- ``need_remind`` 显式传入为准；false 时日期置空、循环写 none（免提醒标记）。
- ``remind_time`` 显式传入为准；不传时按 ``due_time - advance_days`` 兜底。
- 循环模式：``once``（或不传）= 一次性；``daily/weekly/monthly/month_start/yearly/days``
  = 循环（``recurring`` 自动置 True，``days`` 模式再配 ``cycle_days``）。

核心概念：
- 一次性任务：``PUT /todos/{rid}/processed`` 后 ``processed=True``，不再出现。
- 循环任务（``recurring=True``）：完成后按 ``cycle_mode`` 算出下一次 ``due_time``，
  ``processed`` 保持 False；下一次保证**严格晚于今天**（daily 即明天，其余跳过已错过的周期）。
- 完成前会把旧状态存到 ``undo_snapshot``，``POST /todos/{rid}/undo`` 可回滚上一次完成。

MQTT 提醒（push-server 双向同步，逻辑在 push_sync.py）：
- 新字段：``push_enabled``（独立开关）/``push_at``（排期展示）/``push_task_id``（回执）；
  开提醒必须给 ``push_at``（否则 400）。
- 内存改完→先同步→再 commit，同步失败 rollback + 502（两边一致，无孤儿任务）。
- ``processed``/``snooze`` 接受可选 ``callback_ref``（回调幂等，重放跳过推进）。

调试速查::

    $ curl localhost:8481/todos
    $ curl -X POST localhost:8481/todos -H 'Content-Type: application/json' \\
        -d '{"title":"交电费","content":"主卧电表","due_time":"2026-09-15","remind_time":"2026-09-14"}'
    $ curl -X POST localhost:8481/todos -H 'Content-Type: application/json' \\
        -d '{"title":"浇花","content":"阳台","cycle_mode":"daily"}'
    $ curl -X PUT localhost:8481/todos/1/processed
    $ curl -X POST localhost:8481/todos/1/undo
    $ curl -X POST localhost:8481/todos/1/snooze
    $ curl -X DELETE localhost:8481/todos/1
"""
import logging
from datetime import date, datetime, timedelta
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlmodel import Session, select

from db import get_todo_session
from models import Todo
from push_sync import PushSyncError, cancel_push_task, parse_push_at, upsert_push_task
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
    data.need_remind = bool(data.need_remind)

    if not (data.title or "").strip() or not (data.content or "").strip():
        raise HTTPException(400, "title and content are required")

    if not data.need_remind:
        # 不提醒：日期置空、循环写 none，只留标题内容
        data.due_time = None
        data.remind_time = None
        data.recurring = False
        data.cycle_mode = NO_CYCLE
    else:
        if not data.due_time:
            data.due_time = today
        else:
            # 字符串写法容错：解析失败则落到今天
            try:
                data.due_time = _parse_date_field(data.due_time)
            except Exception:
                data.due_time = today

        if data.remind_time:
            # 显式传入的提醒日为准
            try:
                data.remind_time = _parse_date_field(data.remind_time)
            except Exception:
                data.remind_time = data.due_time
        else:
            adv = data.advance_days or 0
            data.remind_time = data.due_time - timedelta(days=adv)
        _normalize_cycle(data)

    # MQTT 提醒：开关独立于 need_remind；开提醒必须给时间；先入库拿 id 再投递
    data.push_enabled = bool(data.push_enabled)
    data.push_task_id = None
    data.last_callback_ref = None
    if data.push_enabled:
        if not data.push_at:
            raise HTTPException(400, "push_at is required when push_enabled")
        try:
            data.push_at = parse_push_at(data.push_at)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid push_at format")
    else:
        data.push_at = None

    session.add(data)
    session.flush()  # 拿 id 投递（未 commit，失败可回滚，不留孤儿任务）
    if data.push_enabled:
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

    if "need_remind" in payload:
        r.need_remind = bool(payload["need_remind"])

    if not r.need_remind:
        # 不提醒：日期置空、循环写 none，只留标题内容
        r.due_time = None
        r.remind_time = None
        r.recurring = False
        r.cycle_mode = NO_CYCLE
    else:
        if not r.due_time:
            r.due_time = today
        for field in ["advance_days", "recurring", "cycle_mode", "cycle_days"]:
            if field in payload:
                setattr(r, field, payload[field])

        if "due_time" in payload and payload["due_time"]:
            try:
                r.due_time = _parse_date_field(payload["due_time"])
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid due_time format")

        if "remind_time" in payload and payload["remind_time"]:
            # 显式传入的提醒日为准
            try:
                r.remind_time = _parse_date_field(payload["remind_time"])
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid remind_time format")
        elif r.due_time and ("due_time" in payload or "advance_days" in payload or not r.remind_time):
            # 只在改到期日/提前天数、或提醒日本来缺失时重算；无关编辑不再覆盖显式提醒日
            adv = r.advance_days or 0
            r.remind_time = r.due_time - timedelta(days=adv)

        if "cycle_mode" in payload:
            _normalize_cycle(r)
        elif r.recurring and not r.cycle_mode:
            r.cycle_mode = "daily"

    # MQTT 提醒同步（内存改完→先同步→再 commit，失败回滚+502；每次编辑都重投递保鲜）
    if "push_enabled" in payload:
        r.push_enabled = bool(payload["push_enabled"])
    if "push_at" in payload:
        if payload["push_at"]:
            try:
                r.push_at = parse_push_at(payload["push_at"])
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid push_at format")
        else:
            r.push_at = None
    if r.push_enabled and not r.push_at:
        raise HTTPException(400, "push_at is required when push_enabled")
    if r.push_enabled and not (r.processed and not r.recurring):
        _sync_upsert_or_502(session, r)
    else:
        if r.push_task_id:
            _sync_cancel_or_502(session, r.id)
            r.push_task_id = None
        r.push_at = None

    session.commit()
    session.refresh(r)
    return r


def _snapshot(r: Todo) -> dict:
    """完成前的状态快照（日期转 ISO 字符串，便于存 JSON 列 / 撤销回滚）。"""
    return {
        "due_time": r.due_time.isoformat() if r.due_time else None,
        "remind_time": r.remind_time.isoformat() if r.remind_time else None,
        "processed": r.processed,
        "last_completed_date": r.last_completed_date.isoformat() if r.last_completed_date else None,
    }


@router.put("/todos/{rid}/processed")
def mark_processed(
    rid: int = Path(...),
    body: Optional[dict] = None,
    session: Session = Depends(get_todo_session),
):
    """完成打卡；body 可带 callback_ref（push-server 回调幂等：重放只跳过推进，不跳过同步）。

    循环+开推送：push_at 按 due 偏移同步平移并 upsert 建下一期（先同步后 commit）；
    一次性+开推送：cancel 对端任务（best-effort，失败只记日志，不拦完成）。
    """
    r = session.get(Todo, rid)
    if not r:
        raise HTTPException(404, "Todo not found")

    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    callback_ref = (body or {}).get("callback_ref")
    replay = bool(callback_ref and r.last_callback_ref == callback_ref)

    if not replay:
        r.undo_snapshot = _snapshot(r)  # 供 /undo 回滚
        r.last_completed_date = today
        if callback_ref:
            r.last_callback_ref = callback_ref

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
            if r.push_enabled and r.push_at and old_due and next_due:
                try:
                    r.push_at = parse_push_at(r.push_at) + (next_due - old_due)
                except ValueError:
                    r.push_at = None
            r.due_time = next_due
            adv = r.advance_days or 0
            r.remind_time = next_due - timedelta(days=adv)
            r.processed = False
        else:
            r.processed = True

    # 推送同步：循环建下一期（失败回滚+502）；一次性取消对端（best-effort）
    if r.push_enabled and r.push_at and not (r.processed and not r.recurring):
        _sync_upsert_or_502(session, r)
    elif not r.recurring and (r.push_task_id or r.push_enabled):
        try:
            cancel_push_task(r.id)
        except PushSyncError as e:
            logger.error(f"待办 #{r.id} 完成但取消提醒失败（稍后幽灵推送将打空回调）：{e}")

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

    r.due_time = _parse_date_field(snap["due_time"]) if snap.get("due_time") else None
    r.remind_time = _parse_date_field(snap["remind_time"]) if snap.get("remind_time") else None
    r.last_completed_date = (
        _parse_date_field(snap["last_completed_date"]) if snap.get("last_completed_date") else None
    )
    r.processed = bool(snap.get("processed"))
    r.undo_snapshot = None

    session.commit()
    session.refresh(r)
    return r


@router.post("/todos/{rid}/snooze")
def snooze_todo(
    rid: int = Path(...),
    body: Optional[dict] = None,
    session: Session = Depends(get_todo_session),
):
    """行内推迟：循环任务顺延一个周期，一次性任务 +1 天（从 due/今天中较晚者起算）。

    body 可带 callback_ref（幂等）与 push_at（MQTT 回调只回写推送排期，不改到期/提醒日，不 upsert）；
    手动推迟+开推送：push_at 按 due 偏移平移并 upsert（先同步后 commit）。
    """
    r = session.get(Todo, rid)
    if not r:
        raise HTTPException(404, "Todo not found")
    body = body or {}
    callback_ref = body.get("callback_ref")
    replay = bool(callback_ref and r.last_callback_ref == callback_ref)

    # MQTT 提醒独立于到期提醒；对端已完成分钟级推迟，这里只回写排期。
    if body.get("push_at"):
        if not r.push_enabled:
            raise HTTPException(400, "push reminder is disabled")
        try:
            push_at = parse_push_at(body["push_at"])
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid push_at format")
        if not replay:
            r.push_at = push_at
            if callback_ref:
                r.last_callback_ref = callback_ref
            if body.get("note"):
                logger.info(f"待办 #{r.id} 推迟备注：{body['note']}")
        session.commit()
        session.refresh(r)
        return r

    if not r.need_remind:
        raise HTTPException(400, "only reminder todos can snooze")

    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    if not replay:
        if callback_ref:
            r.last_callback_ref = callback_ref
        base = r.due_time or today
        old_due = r.due_time
        anchor = base if base > today else today
        next_due = calc_next_due(r, anchor) if r.recurring else anchor + timedelta(days=1)

        if r.push_enabled:
            if r.push_at and old_due and next_due:
                # 手动推迟：推送时间按到期日偏移同步平移
                try:
                    r.push_at = parse_push_at(r.push_at) + (next_due - old_due)
                except ValueError:
                    r.push_at = None
        r.due_time = next_due
        adv = r.advance_days or 0
        r.remind_time = next_due - timedelta(days=adv)

    # 手动推迟需同步新的推送排期。
    if r.push_enabled and r.push_at:
        _sync_upsert_or_502(session, r)

    session.commit()
    session.refresh(r)
    return r


@router.delete("/todos/{rid}")
def delete_todo(
    rid: int = Path(...),
    session: Session = Depends(get_todo_session),
):
    r = session.get(Todo, rid)
    if not r:
        raise HTTPException(404, "Todo not found")
    # 先取消对端任务（失败 502，不删行，防幽灵推送）
    if r.push_task_id or r.push_enabled:
        _sync_cancel_or_502(session, r.id)
    session.delete(r)
    session.commit()
    return {"message": "Deleted"}
