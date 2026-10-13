"""数据模型：各业务域的表结构（字段与原功能保持一致，勿随意改列名）。

说明：
- 每个模型独占一个 SQLite 文件（见 db.py 的映射关系）。
- 时间统一存 Asia/Shanghai。
- 调试：改模型后删掉 data/ 下对应 .db 重启即重建（会丢数据，先备份）。
- 文档：字段的 title/description 会原样进 Swagger Schemas，统一中文。
"""
from datetime import date, datetime
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import Column, JSON
from pydantic import field_serializer
from sqlmodel import Field, SQLModel


def shanghai_now() -> datetime:
    """上海时区当前时间（展示/记录用，避免服务器时区不一致）。"""
    return datetime.now(ZoneInfo("Asia/Shanghai"))


# 待办事项，支持一次性与循环两种。
# 输入字段包括标题、内容、到期日期、提醒日期、循环模式和 MQTT 推送时间。
# remind_time 是可选的页面提醒日期；mqtt_at 是可选的精确 MQTT 推送时间。
class Todo(SQLModel, table=True):

    id: Optional[int] = Field(default=None, primary_key=True)

    title: str
    content: str

    processed: bool = Field(default=False)
    closed_reason: Optional[str] = Field(default=None)  # done / cancelled
    due_time: Optional[date] = Field(default=None)
    remind_time: Optional[date] = Field(default=None)

    # MQTT 开启后 mqtt_at 必须是完整的北京时间日期时间。
    mqtt_enabled: bool = Field(default=False)
    mqtt_at: Optional[datetime] = Field(default=None)
    push_task_id: Optional[int] = Field(default=None)
    last_callback_ref: Optional[str] = Field(default=None)

    priority: int = Field(default=0)  # 优先级：0 无 / 1 低 / 2 中 / 3 高
    catch_up: bool = Field(default=False)  # 循环逾期后：False 跳过到未来，True 逐期补做

    recurring: bool = Field(default=False)
    cycle_mode: Optional[str] = Field(
        default=None
    )
    cycle_days: Optional[int] = Field(default=None)

    last_completed_date: Optional[date] = Field(default=None)

    # 完成前的快照（供 /undo 回滚循环顺延）：{due_time, remind_time, processed, last_completed_date}
    undo_snapshot: Optional[Dict] = Field(default=None, sa_column=Column(JSON))

    created_at: date = Field(default_factory=date.today)

    @field_serializer("mqtt_at", when_used="json")
    def serialize_mqtt_at(self, value: Optional[datetime]) -> Optional[str]:
        """SQLite 读取后无时区的排期仍是北京时间；接口始终返回明确的 +08:00。"""
        if value is None:
            return None
        timezone = ZoneInfo("Asia/Shanghai")
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone)
        return value.astimezone(timezone).isoformat()


# 书签。tags 存 JSON 数组；PUT 支持逗号字符串自动转数组。
class Bookmark(SQLModel, table=True):

    id: Optional[int] = Field(default=None, primary_key=True)

    title: str
    url: str
    description: Optional[str] = Field(default=None)
    tags: List[str] = Field(
        default_factory=list, sa_column=Column(JSON)
    )
    visit_count: int = Field(default=0)
    created_at: date = Field(default_factory=date.today)


# 服务状态上报：同一 (server_name, service_name) 只保留一条（UPSERT 语义）。
# extra 兜底收纳所有非标准字段，探针想加什么字段直接塞，不用改表。
class ServerStatus(SQLModel, table=True):

    id: Optional[int] = Field(default=None, primary_key=True)

    server_name: str
    service_name: str
    content: str
    is_success: bool
    time: str

    extra: Dict = Field(default_factory=dict, sa_column=Column(JSON))

    received_at: datetime = Field(default_factory=shanghai_now)


# 账本流水。写操作会自动同步 Asset/Liability，见 utils.ledger_effect。
class Ledger(SQLModel, table=True):

    __tablename__ = "ledger_items"

    id: Optional[int] = Field(default=None, primary_key=True)
    item: str
    amount: float
    interest: float = Field(default=0.0)
    record_type: str = Field(default="expense")
    record_date: date = Field(default_factory=date.today)
    category: Optional[str] = Field(default=None)
    notes: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=shanghai_now)


# 资产总额，单行（id=1），由流水自动维护，也可 POST /asset 直接覆写。
class Asset(SQLModel, table=True):

    id: Optional[int] = Field(default=None, primary_key=True)
    amount: float = Field(default=0.0)
    updated_at: datetime = Field(default_factory=shanghai_now)


# 负债总额，单行（id=1），规则同 Asset。
class Liability(SQLModel, table=True):

    id: Optional[int] = Field(default=None, primary_key=True)
    amount: float = Field(default=0.0)
    updated_at: datetime = Field(default_factory=shanghai_now)


# 笔记：正文为 Markdown 原文（前端渲染，后端不解析），tags 存 JSON 数组。
# updated_at 用于卡片按最近编辑排序，PUT 时前端不带、由后端刷新。
class Note(SQLModel, table=True):

    id: Optional[int] = Field(default=None, primary_key=True)

    title: str
    content: str = Field(default="")
    tags: List[str] = Field(
        default_factory=list, sa_column=Column(JSON)
    )

    created_at: date = Field(default_factory=date.today)
    updated_at: datetime = Field(default_factory=shanghai_now)


# 思维导图：outline 为缩进大纲文本（每行一个节点，缩进层级表示父子关系），
# 前端解析成树并按层级自动布局渲染；后端只存原文。
class MindMap(SQLModel, table=True):

    id: Optional[int] = Field(default=None, primary_key=True)

    title: str
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    outline: str = Field(default="")

    created_at: date = Field(default_factory=date.today)
    updated_at: datetime = Field(default_factory=shanghai_now)


class InventoryItem(SQLModel, table=True):
    """家庭库存物品。"""

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    quantity: float = Field(default=0.0)
    unit: str = Field(default="件")
    location: Optional[str] = Field(default=None)
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    note: Optional[str] = Field(default=None)
    created_at: date = Field(default_factory=date.today)
    updated_at: datetime = Field(default_factory=shanghai_now)


class InventoryMovement(SQLModel, table=True):
    """库存数量变动记录。"""

    id: Optional[int] = Field(default=None, primary_key=True)
    item_id: int = Field(index=True)
    quantity_delta: float
    reason: str = Field(default="调整")
    note: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=shanghai_now)
