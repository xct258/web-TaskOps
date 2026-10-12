"""push-server 投递同步：待办建/改/删/顺延时同步提醒任务（urllib，免新增依赖）。

说明：
- 配置全走环境变量；PUSH_SERVER_URL 默认生产 push-server（调其 /api/task，注意不是 /push）。
- 同步策略（与 routers 约定）：内存改完 → 先同步 → 再 commit；同步失败抛 PushSyncError，
  调用方 rollback + 502，保证两边不 divergent（TaskOps 行存在但 push-server 没任务，或反之）。
- 删除是例外：先 cancel（失败也抛，见 delete_todo），再删行，避免幽灵推送。
- 调试：同步没生效先 curl 直调对端：POST $PUSH_SERVER_URL/api/task 看通不通。
"""
import json
import logging
import os
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

logger = logging.getLogger("taskops.push_sync")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)


class PushSyncError(RuntimeError):
    """同步失败（网络/对端 4xx/5xx），调用方一律 rollback + 502。"""


def get_push_sync_config() -> dict:
    return {
        "base_url": os.environ.get("PUSH_SERVER_URL", "https://push-server.o1-1.xct258.top").rstrip("/"),
        "token": os.environ.get("PUSH_SERVER_TOKEN", ""),
        "server_name": os.environ.get("PUSH_SERVER_NAME", "taskops"),
        "topic": os.environ.get("PUSH_TOPIC", "taskops/todo"),
    }


def _request(method: str, url: str, body: dict | None, token: str, timeout: int = 15) -> dict:
    """同步 HTTP（调用方放线程里也行；待办量小，直接调不阻塞大局，失败抛 PushSyncError）。"""
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if token:
        headers["X-Push-Token"] = token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            code, text = res.status, res.read().decode("utf-8") or "{}"
    except Exception as e:
        raise PushSyncError(f"push-server 连接失败：{e}")
    if not (200 <= code < 300):
        raise PushSyncError(f"push-server HTTP {code}：{text[:200]}")
    try:
        payload = json.loads(text)
    except Exception:
        raise PushSyncError("push-server 返回非 JSON")
    if isinstance(payload, dict) and payload.get("code", 200) != 200:
        raise PushSyncError(f"push-server 拒绝：{text[:200]}")
    return payload


def _to_iso(dt) -> str:
    """排期转北京时间 ISO，投递与页面返回的时区口径一致。"""
    return parse_mqtt_at(dt).isoformat()


def build_task_payload(todo, config: dict) -> dict:
    """待办 → /api/task 请求体（message 只带内容/到期；标题走 title 字段，
    push-server 下行拼成【待办提醒】标题+正文，避免标题重复两遍）。"""
    lines = []
    if (todo.content or "").strip():
        lines.append(todo.content.strip())
    if todo.due_time:
        lines.append(f"到期：{todo.due_time.isoformat()}")
    return {
        "server_name": config["server_name"],
        "client_ref": f"todo-{todo.id}",
        "topic": config["topic"],
        "title": todo.title or "",
        "message": "\n".join(lines),
        "schedule_at": _to_iso(todo.mqtt_at),
        "recurring": bool(todo.recurring),
    }


def upsert_push_task(todo, config: dict | None = None) -> int:
    """建/改提醒任务，返回对端 task_id；失败抛 PushSyncError。

    前置：todo.id 与 todo.mqtt_at 必须就位（新建时先 flush 拿 id）。
    """
    config = config or get_push_sync_config()
    if not todo.mqtt_at:
        raise PushSyncError("mqtt_at 为空，无法投递")
    res = _request("POST", f"{config['base_url']}/api/task",
                   build_task_payload(todo, config), config["token"])
    task_id = res.get("task_id")
    logger.info(f"待办 #{todo.id} 已同步提醒任务（对端 task #{task_id}）")
    return task_id


def cancel_push_task(todo_id: int, config: dict | None = None) -> int:
    """取消提醒任务，返回取消条数；失败抛 PushSyncError（调用方决定拦不拦）。

    调试：删了待办还推送，先查对端 GET /api/tasks?status=pending 有没有残留。
    """
    config = config or get_push_sync_config()
    ref = f"todo-{todo_id}"
    res = _request("DELETE",
                   f"{config['base_url']}/api/task/ref/{ref}?server_name={config['server_name']}",
                   None, config["token"])
    n = int(res.get("cancelled", 0))
    logger.info(f"待办 #{todo_id} 取消提醒任务 {n} 条")
    return n


def parse_mqtt_at(raw) -> datetime:
    """MQTT 推送时间统一解析（无时区按上海；结果一律上海 aware）。

    失败抛 ValueError，调用方转 400。
    """
    if isinstance(raw, datetime):
        dt = raw
    else:
        text = str(raw or "").strip().replace("Z", "+00:00")
        if not text:
            raise ValueError("empty mqtt_at")
        try:
            dt = datetime.fromisoformat(text)
        except Exception:
            raise ValueError(f"invalid mqtt_at: {raw!r}")
    if dt.tzinfo is None:
        return dt.replace(tzinfo=ZoneInfo("Asia/Shanghai"))
    return dt.astimezone(ZoneInfo("Asia/Shanghai"))
