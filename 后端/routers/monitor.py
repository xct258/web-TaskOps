"""服务信息：读取 push-server 的脚本上报记录。

服务器脚本把状态消息 ``POST`` 到 push-server 的 ``/api/push``
（``title`` 必填，``status`` 必填：ok / warn / error / info），
push-server 落到 ``push_records/{server_name}.json``，并可同时转发 MQTT。
本模块不再自建上报入口，只做只读代理，避免两套上报链路：

    GET /api/monitor/servers   # 按 server_name 分组：最新一条 + 全部记录（弹窗按项目/脚本分组分页）
    GET /api/monitor/records   # 原样透传 push-server /records（调试/分页）
    GET /api/monitor/health    # 探测 push-server 连通性

配置：``PUSH_SERVER_URL``（默认与 push_sync.py 一致）。

调试速查::

    $ curl "localhost:8481/api/monitor/servers"
    $ curl "localhost:8481/api/monitor/records?limit=5"
"""
import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from db import get_monitor_session
from models import MonitorRecordAck, shanghai_now

router = APIRouter()

PUSH_SERVER_URL = os.environ.get(
    "PUSH_SERVER_URL", "https://push-server.o1-1.xct258.top"
).rstrip("/")
PUSH_TIMEOUT = float(os.environ.get("PUSH_SERVER_TIMEOUT", "10"))

# /records 单页上限 500；上限兜底防止对端异常时无限翻页。
PAGE_SIZE = 500
MAX_RECORDS = 5000

SEVERITY_RANK = {"error": 0, "warn": 1, "ok": 2, "info": 3}
VALID_STATUS = {"ok", "warn", "error", "info"}


class AckPayload(BaseModel):
    """记录 id 缺失时用上报时间兜底，避免误消除别的消息。"""

    created_at: str = ""


def _push_get(path: str, params: Optional[Dict[str, Any]] = None) -> dict:
    """请求 push-server 的 GET 接口，失败统一转成 502。"""
    url = f"{PUSH_SERVER_URL}{path}"
    if params:
        url = f"{url}?{urlencode(params)}"

    request = Request(url, headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=PUSH_TIMEOUT) as response:
            body = response.read().decode("utf-8")
    except HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"push-server 返回 HTTP {exc.code}")
    except (URLError, TimeoutError, OSError) as exc:
        raise HTTPException(status_code=502, detail=f"无法连接 push-server：{exc}")

    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="push-server 返回的不是 JSON") from exc


def fetch_records(
    server_name: Optional[str] = None,
    topic: Optional[str] = None,
) -> List[dict]:
    """拉取 push-server 记录，自动翻页（/records 单页最多 500 条）。"""
    records: List[dict] = []
    offset = 0

    while offset < MAX_RECORDS:
        params: Dict[str, Any] = {"limit": PAGE_SIZE, "offset": offset}
        if server_name:
            params["server_name"] = server_name
        if topic:
            params["topic"] = topic

        page = _push_get("/records", params)
        batch = page.get("records") or []
        if not isinstance(batch, list):
            raise HTTPException(status_code=502, detail="push-server records 字段格式错误")

        records.extend(batch)
        offset += len(batch)

        try:
            total = int(page.get("total") or 0)
        except (TypeError, ValueError):
            total = 0
        if not batch or offset >= total:
            break

    return records


def detect_severity(record: dict) -> str:
    """push-server 的 status 必填；异常数据按 info 兜底。"""
    status = str(record.get("status") or "").strip().lower()
    return status if status in VALID_STATUS else "info"


def _created_at(record: dict) -> str:
    return str(record.get("created_at") or "")


def _record_sort_key(record: dict):
    """时间倒序；同一秒内用自增 id 兜底，保证后写入的排前面。"""
    try:
        record_id = int(record.get("id") or 0)
    except (TypeError, ValueError):
        record_id = 0
    return (_created_at(record), record_id)


def _record_id(record: dict) -> int:
    try:
        return int(record.get("id") or 0)
    except (TypeError, ValueError):
        return 0


def _ack_key(server_name: str, record: dict) -> tuple:
    """单条记录的消除键：有 id 用 id，没有 id 才退回上报时间。"""
    record_id = _record_id(record)
    if record_id:
        return (server_name, record_id, "")
    return (server_name, 0, _created_at(record))


def _ack_row_key(row: MonitorRecordAck) -> tuple:
    if row.record_id:
        return (row.server_name, row.record_id, "")
    return (row.server_name, 0, row.record_created_at)


def group_records(
    records: List[dict],
    acks: Optional[set] = None,
) -> List[dict]:
    """按 server_name 分组；最新一条在 latest，全部记录在 records 供弹窗按项目/脚本分组分页。

    ``acks`` 是已消除的单条记录集合。被消除的记录仍保留在 records 里（标记 acked），
    但不参与卡片摘要：卡片显示剩下最新的一条，避免一条报警被消除后整台服务器都变正常。
    """
    acks = acks or set()
    groups: Dict[str, dict] = {}

    for record in records:
        name = str(record.get("server_name") or "").strip() or "未命名来源"
        group = groups.setdefault(name, {"server_name": name, "records": []})
        group["records"].append(record)

    result: List[dict] = []
    for group in groups.values():
        group["records"].sort(key=_record_sort_key, reverse=True)
        group["records"] = [
            {
                **record,
                "severity": detect_severity(record),
                "acked": _ack_key(group["server_name"], record) in acks,
            }
            for record in group["records"]
        ]

        active = [record for record in group["records"] if not record["acked"]]
        all_acked = bool(group["records"]) and not active
        latest = active[0] if active else group["records"][0]
        result.append(
            {
                "server_name": group["server_name"],
                "topic": latest.get("topic") or "",
                "severity": latest["severity"] if active else "ok",
                "all_acked": all_acked,
                "acked_count": len(group["records"]) - len(active),
                "latest": latest,
                "count": len(group["records"]),
                "records": group["records"],
            }
        )

    # 先按时间倒序，再按级别稳定排序：同级别内仍是新消息在前。
    result.sort(key=lambda item: _record_sort_key(item.get("latest") or {}), reverse=True)
    result.sort(key=lambda item: SEVERITY_RANK.get(item["severity"], 9))
    return result


@router.get("/monitor/servers")
def list_servers(
    severity: Optional[str] = Query(
        None, description="按最新一条的级别筛选：error / warn / ok / info"
    ),
    q: Optional[str] = Query(None, description="按服务器名 / 主题 / 标题 / 消息搜索"),
    session: Session = Depends(get_monitor_session),
):
    """返回按服务器分组的摘要：最新一条、状态、记录数和全部记录。"""
    records = fetch_records()
    acks = {_ack_row_key(row) for row in session.exec(select(MonitorRecordAck)).all()}
    servers = group_records(records, acks)

    if severity:
        wanted = severity.strip().lower()
        if wanted not in SEVERITY_RANK:
            raise HTTPException(status_code=400, detail="severity must be one of: error, warn, ok, info")
        servers = [item for item in servers if item["severity"] == wanted]

    if q:
        keyword = q.strip().lower()
        if keyword:
            servers = [
                item
                for item in servers
                if any(
                    keyword in str(field).lower()
                    for field in (
                        item["server_name"],
                        item["topic"],
                        item["latest"].get("title", ""),
                        item["latest"].get("message", ""),
                    )
                )
            ]

    return {
        "servers": servers,
        "servers_total": len(servers),
        "records_total": len(records),
        "fetched_at": datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M:%S"),
    }


@router.post("/monitor/servers/{server_name}/records/{record_id}/ack")
def ack_record(
    server_name: str,
    record_id: int,
    payload: AckPayload,
    session: Session = Depends(get_monitor_session),
):
    """消除一条具体消息：只标记这条上报，不牵连同服务器的其他报警。"""
    name = server_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="server_name 不能为空")

    rid = max(0, record_id)
    created_at = payload.created_at.strip()
    statement = select(MonitorRecordAck).where(
        MonitorRecordAck.server_name == name,
        MonitorRecordAck.record_id == rid,
    )
    # id 缺失（0）时才用上报时间区分同服务器的多条记录。
    if not rid:
        statement = statement.where(MonitorRecordAck.record_created_at == created_at)

    row = session.exec(statement).first()
    if row is None:
        row = MonitorRecordAck(server_name=name, record_id=rid)

    if created_at:
        row.record_created_at = created_at
    row.acked_at = shanghai_now()
    session.add(row)
    session.commit()

    return {"ok": True, "server_name": name, "record_id": rid}


@router.delete("/monitor/servers/{server_name}/records/{record_id}/ack")
def restore_record(
    server_name: str,
    record_id: int,
    session: Session = Depends(get_monitor_session),
):
    """恢复一条消息：删除这条消除记录，让它重新参与卡片摘要。"""
    name = server_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="server_name 不能为空")

    rows = session.exec(
        select(MonitorRecordAck).where(
            MonitorRecordAck.server_name == name,
            MonitorRecordAck.record_id == max(0, record_id),
        )
    ).all()
    for row in rows:
        session.delete(row)
    if rows:
        session.commit()

    return {"ok": True, "server_name": name, "record_id": max(0, record_id)}


@router.get("/monitor/records")
def list_records(
    server_name: Optional[str] = Query(None, description="按服务器名称精确筛选"),
    topic: Optional[str] = Query(None, description="按主题模糊筛选"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """原样透传 push-server 的 GET /records，便于调试与分页。"""
    params: Dict[str, Any] = {"limit": limit, "offset": offset}
    if server_name:
        params["server_name"] = server_name
    if topic:
        params["topic"] = topic
    return _push_get("/records", params)


@router.get("/monitor/health")
def monitor_health():
    """服务页诊断：TaskOps 能否连上 push-server。"""
    return {
        "push_server": PUSH_SERVER_URL,
        "health": _push_get("/api/health"),
    }
