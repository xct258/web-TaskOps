from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel, Field, Session, create_engine, select, or_, and_
from sqlalchemy import Column, JSON
from typing import Optional, List, Dict
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
from sqlalchemy.exc import OperationalError

# =====================================================
# 数据库配置
# =====================================================
# main.py 所在目录
BASE_DIR = Path(__file__).resolve().parent

# 数据库存放在 data 子文件夹
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)  # 如果不存在就创建

# SQLite 数据库路径
TODO_DB_URL = f"sqlite:///{DATA_DIR / 'todos.db'}"
REMINDER_DB_URL = f"sqlite:///{DATA_DIR / 'reminders.db'}"
BOOKMARK_DB_URL = f"sqlite:///{DATA_DIR / 'bookmarks.db'}"
SERVER_STATUS_DB_URL = f"sqlite:///{DATA_DIR / 'server_status_v2.db'}"
LEDGER_DB_URL = f"sqlite:///{DATA_DIR / 'ledger.db'}"

todo_engine = create_engine(TODO_DB_URL, connect_args={"check_same_thread": False})
reminder_engine = create_engine(REMINDER_DB_URL, connect_args={"check_same_thread": False})
bookmark_engine = create_engine(BOOKMARK_DB_URL, connect_args={"check_same_thread": False})
server_status_engine = create_engine(SERVER_STATUS_DB_URL, connect_args={"check_same_thread": False})
ledger_engine = create_engine(LEDGER_DB_URL, connect_args={"check_same_thread": False})

def get_todo_session():
    try:
        with Session(todo_engine) as session:
            yield session
    except OperationalError:
        SQLModel.metadata.create_all(todo_engine, tables=[Todo.__table__])
        with Session(todo_engine) as session:
            yield session

def get_reminder_session():
    try:
        with Session(reminder_engine) as session:
            yield session
    except OperationalError:
        SQLModel.metadata.create_all(reminder_engine, tables=[Reminder.__table__])
        with Session(reminder_engine) as session:
            yield session

def get_bookmark_session():
    try:
        with Session(bookmark_engine) as session:
            yield session
    except OperationalError:
        SQLModel.metadata.create_all(bookmark_engine, tables=[Bookmark.__table__])
        with Session(bookmark_engine) as session:
            yield session

def get_server_status_session():
    try:
        with Session(server_status_engine) as session:
            yield session
    except OperationalError:
        SQLModel.metadata.create_all(server_status_engine, tables=[ServerStatus.__table__])
        with Session(server_status_engine) as session:
            yield session

def get_ledger_session():
    try:
        with Session(ledger_engine) as session:
            yield session
    except OperationalError:
        SQLModel.metadata.create_all(ledger_engine, tables=[Ledger.__table__])
        with Session(ledger_engine) as session:
            yield session


# =====================================================
# 数据模型（字段与原功能保持一致）
# =====================================================

class Todo(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    title: str
    completed: bool = False
    priority: str = "medium"
    details: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None


class Reminder(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    service: str
    content: str

    type: str = "once"
    processed: bool = False

    due_time: Optional[date] = None
    remind_time: Optional[date] = None
    advance_days: Optional[int] = 30

    recurring: bool = False
    cycle_mode: Optional[str] = None     # days / month_start / next_month_same_day
    cycle_days: Optional[int] = None

    last_completed_date: Optional[date] = None
    created_at: date = Field(default_factory=date.today)


class Bookmark(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    title: str
    url: str
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: date = Field(default_factory=date.today)

class ServerStatus(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    server_name: str          # 服务器名称
    service_name: str         # 服务名称
    content: str              # 服务内容
    is_success: bool          # True 表示服务正常，False 表示异常
    time: str
    
    extra: Dict = Field(default_factory=dict, sa_column=Column(JSON)) # 其余任意字段

    received_at: datetime = Field(default_factory=lambda: datetime.now(ZoneInfo("Asia/Shanghai")))

class Ledger(SQLModel, table=True):
    __tablename__ = "ledger_items"
    id: Optional[int] = Field(default=None, primary_key=True)
    item: str
    amount: float
    interest: float = 0.0
    record_type: str = "expense" # expense | income
    record_date: date = Field(default_factory=date.today)
    category: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(ZoneInfo("Asia/Shanghai")))

class Asset(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    amount: float = 0.0
    updated_at: datetime = Field(default_factory=lambda: datetime.now(ZoneInfo("Asia/Shanghai")))

class Liability(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    amount: float = 0.0
    updated_at: datetime = Field(default_factory=lambda: datetime.now(ZoneInfo("Asia/Shanghai")))

# Ensure table exists
SQLModel.metadata.create_all(ledger_engine, tables=[Ledger.__table__, Asset.__table__, Liability.__table__])


# =====================================================
# 工具函数（时间解析）
# =====================================================

def parse_due_date(raw: str) -> date:
    if not raw:
        raise ValueError("due_time is empty")

    raw = raw.strip()
    if raw.endswith("Z"):
        raw = raw.replace("Z", "+00:00")

    if len(raw) == 10:
        return date.fromisoformat(raw)

    dt = datetime.fromisoformat(raw)
    if dt.tzinfo:
        dt = dt.astimezone(ZoneInfo("Asia/Shanghai"))
    else:
        dt = dt.replace(tzinfo=ZoneInfo("Asia/Shanghai"))

    return dt.date()


# =====================================================
# 循环提醒核心逻辑（重构后）
# =====================================================

def calc_next_due(reminder: Reminder, base_date: date) -> date:
    mode = reminder.cycle_mode
    
    # 兼容旧的 daily 类型
    if reminder.type == 'daily' and not mode:
        mode = 'daily'

    if mode == 'daily':
        return base_date + timedelta(days=1)
    
    elif mode == 'weekly':
        return base_date + timedelta(weeks=1)
    
    elif mode == 'monthly' or mode == 'month_start':
        # 简单的月份增加逻辑
        year = base_date.year + (1 if base_date.month == 12 else 0)
        month = 1 if base_date.month == 12 else base_date.month + 1
        try:
            return date(year, month, base_date.day)
        except ValueError:
            # 处理 1月31日 -> 2月28日 的情况：跳到下个月最后一天
            import calendar
            last_day = calendar.monthrange(year, month)[1]
            return date(year, month, last_day)
            
    elif mode == 'yearly':
        try:
            return date(base_date.year + 1, base_date.month, base_date.day)
        except ValueError:
            # 闰年 2月29日 -> 平年 2月28日
            return date(base_date.year + 1, 2, 28)
            
    elif mode == 'days': # 自定义天数
        days = reminder.cycle_days or 1
        return base_date + timedelta(days=days)
        
    # 默认 fallback
    return base_date + timedelta(days=1)


# =====================================================
# FastAPI 初始化
# =====================================================

app = FastAPI(docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup():
    SQLModel.metadata.create_all(todo_engine, tables=[Todo.__table__])
    SQLModel.metadata.create_all(reminder_engine, tables=[Reminder.__table__])
    SQLModel.metadata.create_all(bookmark_engine, tables=[Bookmark.__table__])
    SQLModel.metadata.create_all(server_status_engine, tables=[ServerStatus.__table__])
    SQLModel.metadata.create_all(ledger_engine, tables=[Ledger.__table__])


# =====================================================
# Todo 接口
# =====================================================

@app.get("/todos", response_model=List[Todo])
def get_todos(session: Session = Depends(get_todo_session)):
    return session.exec(select(Todo)).all()


@app.post("/todos", response_model=Todo)
def create_todo(todo: Todo, session: Session = Depends(get_todo_session)):
    todo.created_at = datetime.now(ZoneInfo("Asia/Shanghai"))
    session.add(todo)
    session.commit()
    session.refresh(todo)
    return todo


@app.put("/todos/{todo_id}", response_model=Todo)
def update_todo(todo_id: int, updated: Todo, session: Session = Depends(get_todo_session)):
    todo = session.get(Todo, todo_id)
    if not todo:
        raise HTTPException(404, "Todo not found")

    # 仅在请求中显式包含对应字段时才更新，避免未包含字段被意外清空（例如完成操作未包含 details）
    fields_set = getattr(updated, '__fields_set__', None)

    if fields_set is None or 'title' in fields_set:
        todo.title = updated.title

    if fields_set is None or 'completed' in fields_set:
        todo.completed = updated.completed

    if fields_set is None or 'priority' in fields_set:
        todo.priority = updated.priority

    if fields_set is None or 'details' in fields_set:
        # 支持显式设置为 None 来清空 details
        todo.details = updated.details

    # completed_at 由完成状态决定；如果前端提供 completed_at，尝试解析并使用它
    if (fields_set is None or 'completed' in fields_set) and updated.completed:
        todo.completed_at = datetime.now(ZoneInfo("Asia/Shanghai"))
    elif (fields_set is None or 'completed' in fields_set) and not updated.completed:
        todo.completed_at = None

    session.commit()
    return todo


@app.delete("/todos/{todo_id}")
def delete_todo(todo_id: int, session: Session = Depends(get_todo_session)):
    todo = session.get(Todo, todo_id)
    if not todo:
        raise HTTPException(404, "Todo not found")
    session.delete(todo)
    session.commit()
    return {"message": "Deleted"}


# =====================================================
# Reminder 接口
# =====================================================

@app.get("/reminders", response_model=List[Reminder])
def get_reminders(session: Session = Depends(get_reminder_session)):
    # 移除自动刷新逻辑，保持数据纯净
    # 仅做一次性数据清洗：确保所有 recurring 任务都有 due_time
    today = datetime.now(ZoneInfo('Asia/Shanghai')).date()
    reminders = session.exec(select(Reminder)).all()
    
    changed = False
    for r in reminders:
        # 迁移旧数据：daily 类型转为 recurring
        if r.type == 'daily':
            r.type = 'once' # 逻辑上统一为 once + recurring=True
            r.recurring = True
            r.cycle_mode = 'daily'
            if not r.due_time:
                r.due_time = today
            if not r.remind_time:
                r.remind_time = today
            changed = True
        
        # 确保所有 recurring 任务都有 due_time
        if r.recurring and not r.due_time:
            r.due_time = today
            changed = True
            
    if changed:
        session.commit()
        
    return reminders


@app.post("/reminders", response_model=Reminder)
def create_reminder(data: Reminder, session: Session = Depends(get_reminder_session)):
    today = datetime.now(ZoneInfo('Asia/Shanghai')).date()
    
    # 强制设置 created_at
    data.created_at = today
    
    # 确保 due_time 存在
    if not data.due_time:
        data.due_time = today
        
    # 如果是 recurring，确保 cycle_mode 存在
    if data.recurring and not data.cycle_mode:
        data.cycle_mode = 'daily' # 默认每天
        
    # 计算 remind_time
    adv = data.advance_days or 0
    # 如果 due_time 是 date 类型，直接计算
    if isinstance(data.due_time, date):
        data.remind_time = data.due_time - timedelta(days=adv)
    else:
        # 尝试解析字符串
        try:
            data.due_time = parse_due_date(str(data.due_time))
            data.remind_time = data.due_time - timedelta(days=adv)
        except Exception:
            # 如果解析失败，默认设为今天
            today = datetime.now(ZoneInfo('Asia/Shanghai')).date()
            data.due_time = today
            data.remind_time = today

    session.add(data)
    session.commit()
    session.refresh(data)
    return data


@app.put("/reminders/{rid}", response_model=Reminder)
def update_reminder(rid: int, payload: dict, session: Session = Depends(get_reminder_session)):
    r = session.get(Reminder, rid)
    if not r:
        raise HTTPException(404, "Reminder not found")

    # 基础字段更新
    for field in ['service', 'content', 'advance_days', 'recurring', 'cycle_mode', 'cycle_days']:
        if field in payload:
            setattr(r, field, payload[field])
            
    # 日期字段特殊处理
    if 'due_time' in payload and payload['due_time']:
        try:
            r.due_time = parse_due_date(str(payload['due_time']))
        except Exception:
            raise HTTPException(status_code=400, detail='Invalid due_time format')
            
    # 重新计算 remind_time
    if r.due_time:
        adv = r.advance_days or 0
        r.remind_time = r.due_time - timedelta(days=adv)
        
    session.commit()
    session.refresh(r)
    return r


@app.put("/reminders/{rid}/processed")
def mark_processed(rid: int, session: Session = Depends(get_reminder_session)):
    r = session.get(Reminder, rid)
    if not r:
        raise HTTPException(404, "Reminder not found")

    today = datetime.now(ZoneInfo('Asia/Shanghai')).date()
    r.last_completed_date = today

    if r.recurring:
        # 循环任务：计算下一次时间
        # 基础时间：使用当前的 due_time。如果 due_time 为空，使用 today
        base_due = r.due_time or today
        
        # 如果 base_due 已经过期（小于今天），我们是否要基于“今天”来计算下一次？
        # 场景：任务是每周一。今天是周三。上周一的任务没做。
        # 选项1：基于上周一 -> 变成这周一（仍然过期）。用户得再点一次。
        # 选项2：基于今天 -> 变成下周三（破坏了“周一”的规则）。
        # 选项3：基于上周一，但一直加直到 > 今天。
        
        # 简单起见，我们基于 base_due 计算一次。如果用户拖延了很久，让他们多点几次也是一种“惩罚”/回顾。
        # 或者，对于 daily 任务，直接设为明天。
        
        if r.cycle_mode == 'daily':
            # 每日任务特殊优化：直接设为明天（不管之前拖欠了多少天）
            # 这样符合“每日打卡”的直觉
            next_due = today + timedelta(days=1)
        else:
            next_due = calc_next_due(r, base_due)
            
        r.due_time = next_due
        
        # 更新提醒时间
        adv = r.advance_days or 0
        r.remind_time = next_due - timedelta(days=adv)
        
        r.processed = False # 保持未完成状态
        
    else:
        # 一次性任务
        r.processed = True

    session.commit()
    session.refresh(r)
    return r


@app.delete("/reminders/{rid}")
def delete_reminder(rid: int, session: Session = Depends(get_reminder_session)):
    r = session.get(Reminder, rid)
    if not r:
        raise HTTPException(404, "Reminder not found")
    session.delete(r)
    session.commit()
    return {"message": "Deleted"}


# =====================================================
# Bookmark 接口
# =====================================================

@app.get("/bookmarks", response_model=List[Bookmark])
def get_bookmarks(session: Session = Depends(get_bookmark_session)):
    return session.exec(select(Bookmark)).all()


@app.post("/bookmarks", response_model=Bookmark)
def create_bookmark(bm: Bookmark, session: Session = Depends(get_bookmark_session)):
    if not bm.url.startswith(("http://", "https://")):
        bm.url = "https://" + bm.url

    session.add(bm)
    session.commit()
    session.refresh(bm)
    return bm


@app.put("/bookmarks/{bid}", response_model=Bookmark)
def update_bookmark(bid: int, payload: dict, session: Session = Depends(get_bookmark_session)):
    b = session.get(Bookmark, bid)
    if not b:
        raise HTTPException(404, "Bookmark not found")

    if 'title' in payload:
        b.title = payload['title']
    if 'url' in payload:
        url = payload['url']
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        b.url = url
    if 'description' in payload:
        b.description = payload['description']
    if 'tags' in payload:
        tags = payload['tags']
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(',') if t.strip()]
        b.tags = tags

    session.commit()
    session.refresh(b)
    return b


@app.delete("/bookmarks/{bid}")
def delete_bookmark(bid: int, session: Session = Depends(get_bookmark_session)):
    b = session.get(Bookmark, bid)
    if not b:
        raise HTTPException(404, "Bookmark not found")
    session.delete(b)
    session.commit()
    return {"message": "Deleted"}

# =====================================================
# # 服务器状态上报 接口
# =====================================================

@app.post("/server/status", response_model=ServerStatus)
def receive_server_status(payload: dict, session: Session = Depends(get_server_status_session)):
    """
    接收服务器状态上报
    必填：
      - server_name
      - service_name
      - content (服务内容)
      - is_success
    可选：
      - time（不传则默认当前时间）
      - 任意其他字段（存入 extra）
    """
    # 必填字段检查
    required_fields = ["server_name", "service_name", "content", "is_success"]
    for field in required_fields:
        if field not in payload:
            raise HTTPException(status_code=400, detail=f"Missing field: {field}")
    
    # 提取标准字段
    server_name = payload.pop("server_name")
    service_name = payload.pop("service_name")
    content = payload.pop("content")
    
    raw_is_success = payload.pop("is_success")
    if isinstance(raw_is_success, bool):
        is_success = raw_is_success
    elif isinstance(raw_is_success, str) and raw_is_success.lower() in ("true", "false"):
        is_success = raw_is_success.lower() == "true"
    else:
        raise HTTPException(status_code=400, detail="is_success must be true or false (case-insensitive)")

    time_val = payload.pop("time", datetime.now(ZoneInfo("Asia/Shanghai")).isoformat())

    # 剩余字段作为 extra
    extra_info = payload

    # Check for existing record with same server_name and service_name
    stmt = select(ServerStatus).where(
        ServerStatus.server_name == server_name,
        ServerStatus.service_name == service_name
    )
    
    existing_status = session.exec(stmt).first()

    if existing_status:
        existing_status.content = content
        existing_status.is_success = is_success
        existing_status.time = time_val
        existing_status.extra = extra_info
        existing_status.received_at = datetime.now(ZoneInfo("Asia/Shanghai"))
        session.add(existing_status)
        session.commit()
        session.refresh(existing_status)
        return existing_status

    status = ServerStatus(
        server_name=server_name,
        service_name=service_name,
        content=content,
        is_success=is_success,
        time=time_val,
        extra=extra_info
    )

    session.add(status)
    session.commit()
    session.refresh(status)
    return status



@app.get("/server/status", response_model=List[ServerStatus])
def list_server_status(
    server_name: Optional[str] = None,
    limit: int = 100,
    session: Session = Depends(get_server_status_session)
):
    stmt = select(ServerStatus)

    if server_name:
        stmt = stmt.where(ServerStatus.server_name == server_name)


    stmt = stmt.order_by(ServerStatus.received_at.desc()).limit(limit)
    return session.exec(stmt).all()


@app.get("/ledger", response_model=List[Ledger])
def get_ledger(session: Session = Depends(get_ledger_session)):
    return session.exec(select(Ledger).order_by(Ledger.record_date.desc(), Ledger.id.desc())).all()

@app.post("/ledger", response_model=Ledger)
def create_ledger(ledger: Ledger, session: Session = Depends(get_ledger_session)):
    if isinstance(ledger.record_date, str):
        ledger.record_date = date.fromisoformat(ledger.record_date)
    
    session.add(ledger)
    
    # Update Asset
    asset = session.get(Asset, 1)
    if not asset:
        asset = Asset(id=1, amount=0.0)
        session.add(asset)
        
    # Update Liability
    liability = session.get(Liability, 1)
    if not liability:
        liability = Liability(id=1, amount=0.0)
        session.add(liability)
    
    if ledger.record_type == "income":
        asset.amount += ledger.amount
    elif ledger.record_type == "expense":
        asset.amount -= ledger.amount
    elif ledger.record_type == "debt_in": # Borrowing: Asset+, Liability+
        asset.amount += ledger.amount
        liability.amount += ledger.amount
    elif ledger.record_type == "debt_out": # Repayment: Asset-, Liability- (Principal only)
        # User Request: Amount is Principal. Interest is Extra.
        interest_val = float(ledger.interest) if ledger.interest else 0.0
        asset.amount -= (ledger.amount + interest_val)
        liability.amount -= ledger.amount
        
    asset.updated_at = datetime.now(ZoneInfo("Asia/Shanghai"))
    liability.updated_at = datetime.now(ZoneInfo("Asia/Shanghai"))
    
    session.add(asset)
    session.add(liability)
    session.commit()
    session.refresh(ledger)
    return ledger

@app.put("/ledger/{ledger_id}", response_model=Ledger)
def update_ledger(ledger_id: int, updated: Ledger, session: Session = Depends(get_ledger_session)):
    item = session.get(Ledger, ledger_id)
    if not item:
        raise HTTPException(404, "Ledger item not found")

    # Revert old asset/liability impact
    asset = session.get(Asset, 1)
    if not asset:
        asset = Asset(id=1, amount=0.0)
        session.add(asset)
        
    liability = session.get(Liability, 1)
    if not liability:
        liability = Liability(id=1, amount=0.0)
        session.add(liability)
    
    if item.record_type == "income":
        asset.amount -= item.amount
    elif item.record_type == "expense":
        asset.amount += item.amount
    elif item.record_type == "debt_in":
        asset.amount -= item.amount
        liability.amount -= item.amount
    elif item.record_type == "debt_out":
        interest_val = float(item.interest) if item.interest else 0.0
        asset.amount += (item.amount + interest_val)
        liability.amount += item.amount
        
    # Update fields
    if isinstance(updated.record_date, str):
        updated.record_date = date.fromisoformat(updated.record_date)

    item.item = updated.item
    item.amount = updated.amount
    item.interest = updated.interest
    item.record_type = updated.record_type
    item.record_date = updated.record_date
    item.category = updated.category
    item.notes = updated.notes
    
    # Apply new asset/liability impact
    if item.record_type == "income":
        asset.amount += item.amount
    elif item.record_type == "expense":
        asset.amount -= item.amount
    elif item.record_type == "debt_in":
        asset.amount += item.amount
        liability.amount += item.amount
    elif item.record_type == "debt_out":
        interest_val = float(item.interest) if item.interest else 0.0
        asset.amount -= (item.amount + interest_val)
        liability.amount -= item.amount
        
    asset.updated_at = datetime.now(ZoneInfo("Asia/Shanghai"))
    liability.updated_at = datetime.now(ZoneInfo("Asia/Shanghai"))
    
    session.add(asset)
    session.add(liability)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item

@app.delete("/ledger/{ledger_id}")
def delete_ledger(ledger_id: int, session: Session = Depends(get_ledger_session)):
    ledger = session.get(Ledger, ledger_id)
    if not ledger:
        raise HTTPException(404, "Ledger item not found")
    
    # Revert Asset/Liability
    asset = session.get(Asset, 1)
    if not asset:
        asset = Asset(id=1, amount=0.0)
        session.add(asset)
        
    liability = session.get(Liability, 1)
    if not liability:
        liability = Liability(id=1, amount=0.0)
        session.add(liability)

    if ledger.record_type == "income":
        asset.amount -= ledger.amount
    elif ledger.record_type == "expense":
        asset.amount += ledger.amount
    elif ledger.record_type == "debt_in":
        asset.amount -= ledger.amount
        liability.amount -= ledger.amount
    elif ledger.record_type == "debt_out":
        interest_val = float(ledger.interest) if ledger.interest else 0.0
        asset.amount += (ledger.amount + interest_val)
        liability.amount += ledger.amount
        
    asset.updated_at = datetime.now(ZoneInfo("Asia/Shanghai"))
    liability.updated_at = datetime.now(ZoneInfo("Asia/Shanghai"))
    session.add(asset)
    session.add(liability)

    session.delete(ledger)
    session.commit()
    return {"message": "Deleted"}

@app.get("/asset", response_model=Asset)
def get_asset(session: Session = Depends(get_ledger_session)):
    asset = session.get(Asset, 1)
    if not asset:
        asset = Asset(id=1, amount=0.0)
        session.add(asset)
        session.commit()
        session.refresh(asset)
    return asset

@app.post("/asset", response_model=Asset)
def update_asset(payload: dict, session: Session = Depends(get_ledger_session)):
    amount = payload.get("amount")
    if amount is None:
        raise HTTPException(400, "amount is required")
    
    asset = session.get(Asset, 1)
    if not asset:
        asset = Asset(id=1, amount=0.0)
    
    asset.amount = float(amount)
    asset.updated_at = datetime.now(ZoneInfo("Asia/Shanghai"))
    session.add(asset)
    session.commit()
    session.refresh(asset)
    return asset

@app.get("/liability", response_model=Liability)
def get_liability(session: Session = Depends(get_ledger_session)):
    liability = session.get(Liability, 1)
    if not liability:
        liability = Liability(id=1, amount=0.0)
        session.add(liability)
        session.commit()
        session.refresh(liability)
    return liability

@app.post("/liability", response_model=Liability)
def update_liability(payload: dict, session: Session = Depends(get_ledger_session)):
    amount = payload.get("amount")
    if amount is None:
        raise HTTPException(400, "amount is required")
    
    liability = session.get(Liability, 1)
    if not liability:
        liability = Liability(id=1, amount=0.0)
    
    liability.amount = float(amount)
    liability.updated_at = datetime.now(ZoneInfo("Asia/Shanghai"))
    session.add(liability)
    session.commit()
    session.refresh(liability)
    return liability

