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
from pydantic import computed_field, field_serializer
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

    priority: int = Field(default=0)  # 优先级：0 无 / 1 低 / 2 中 / 3 高
    catch_up: bool = Field(default=False)  # 循环逾期后：False 跳过到未来，True 逐期补做

    recurring: bool = Field(default=False)
    cycle_mode: Optional[str] = Field(
        default=None
    )
    cycle_days: Optional[int] = Field(default=None)

    last_completed_date: Optional[date] = Field(default=None)
    # 循环任务最近一次「推迟」的日子；打卡和推迟都代表今天这一期不用做了，
    # 「已完成」靠这两个日期把「动过的」和「还没到时候、也没动过」的分开。
    last_snoozed_date: Optional[date] = Field(default=None)

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


# 循环待办的打卡记录：每完成一次记一条，供「完成历史 / 打卡日历」用。
# 只记循环任务——一次性任务完成就结束了，没有「历史」可言。
# 同一天重复打卡只留一条；undo 时按快照里的 id 精确删除。
class TodoCompletion(SQLModel, table=True):

    id: Optional[int] = Field(default=None, primary_key=True)
    todo_id: int = Field(index=True)
    completed_on: date


# 书签。tags 存 JSON 数组；PUT 支持逗号字符串自动转数组。
# 站点图标由后端抓取后缓存在 data/favicons/，这里只记文件名与类型；
# 前端通过 favicon_url（计算字段）读取，没有图标就回退到首字母样式。
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

    # 图标缓存（后端维护，前端只读）：文件名如 "3.png"，位于 data/favicons/
    favicon_file: Optional[str] = Field(default=None)
    favicon_mime: Optional[str] = Field(default=None)
    favicon_updated_at: Optional[datetime] = Field(default=None)

    @computed_field
    @property
    def favicon_url(self) -> Optional[str]:
        """图标访问路径。带版本号（毫秒），刷新后浏览器不会命中旧缓存。"""
        if not self.favicon_file:
            return None
        version = int(self.favicon_updated_at.timestamp() * 1000) if self.favicon_updated_at else 0
        return f"/api/favicons/{self.favicon_file}?v={version}"


# 账本流水。写操作会自动同步 Asset/Liability，见 utils.ledger_effect。
class Ledger(SQLModel, table=True):

    __tablename__ = "ledger_items"

    id: Optional[int] = Field(default=None, primary_key=True)
    item: str = Field(default="")
    amount: float
    interest: float = Field(default=0.0)
    agreed_interest: Optional[float] = Field(default=None)
    record_type: str = Field(default="expense")
    loan_id: Optional[int] = Field(default=None, index=True)
    purchase_id: Optional[str] = Field(default=None, index=True)
    purchase_kind: Optional[str] = Field(default=None)
    financing_source: Optional[str] = Field(default=None)
    record_date: date = Field(default_factory=date.today)
    category: Optional[str] = Field(default=None)
    notes: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=shanghai_now)


# 资金余额仅由流水维护。
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


class MonitorRecordAck(SQLModel, table=True):
    """单条报警的消除记录：只影响对应的那条上报，不牵连同服务器的其他消息。

    同一个 (server_name, record_id) 只保留一条；记录 id 缺失时用上报时间兜底。
    """

    id: Optional[int] = Field(default=None, primary_key=True)

    server_name: str = Field(index=True)
    record_id: int = Field(default=0, index=True)
    record_created_at: str = Field(default="")
    acked_at: datetime = Field(default_factory=shanghai_now)

