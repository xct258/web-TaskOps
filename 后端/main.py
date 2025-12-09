# 导入必要的库
from fastapi import FastAPI                # FastAPI 核心类，用于创建 API 应用
from pydantic import BaseModel            # 用于定义数据模型和数据验证
from typing import List                    # 用于标注返回类型为列表
from datetime import datetime  # 用于获取当前时间
from fastapi.middleware.cors import CORSMiddleware  # 用于处理跨域请求
import json                                # 用于读取和保存 JSON 文件
from zoneinfo import ZoneInfo
import os                                  # 用于检查文件是否存在

# -----------------------------
# 创建 FastAPI 实例
# -----------------------------
app = FastAPI()  # 通过 FastAPI() 创建一个 web 应用对象，后续所有路由都挂载在 app 上

# -----------------------------
# 定义数据模型
# -----------------------------
class Todo(BaseModel):
    """
    待办事项的数据模型
    BaseModel 提供类型检查和数据验证
    """
    id: int              # 每个待办事项的唯一 ID
    title: str           # 待办事项标题
    completed: bool = False  # 是否完成，默认 False
    created_at: str = datetime.now(ZoneInfo("Asia/Shanghai")).isoformat()

# -----------------------------
# JSON 文件路径和初始化
# -----------------------------
DATA_FILE = "todos.json"  # 存储待办事项的 JSON 文件名

# 初始化 todos 列表
# 如果文件存在，就读取内容，否则创建空列表
if os.path.exists(DATA_FILE):
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        todos = json.load(f)  # 从文件加载 JSON 数据到列表
else:
    todos = []  # 文件不存在时，初始化为空列表

# -----------------------------
# 保存数据到 JSON 文件的函数
# -----------------------------
def save_todos():
    """
    将内存中的 todos 列表保存到 JSON 文件
    使用 ensure_ascii=False 保证中文不被转义
    indent=2 让 JSON 格式美观可读
    """
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(todos, f, ensure_ascii=False, indent=2)

# -----------------------------
# CORS 配置（允许跨域请求）
# -----------------------------
# 跨域问题：浏览器前端和后端端口/域名不同，默认会被阻止
# 需要使用 CORS 中间件允许特定前端访问
origins = [
    "http://138.2.7.127:5173",  # 你的前端地址，公网或本地开发地址
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,      # 允许的前端域名
    allow_credentials=True,      # 是否允许携带 Cookie
    allow_methods=["*"],         # 允许的 HTTP 方法，* 表示全部
    allow_headers=["*"],         # 允许的请求头
)

# -----------------------------
# 路由：获取待办事项列表
# -----------------------------
@app.get("/todos", response_model=List[Todo])
def get_todos():
    """
    GET /todos
    返回当前所有待办事项
    response_model=List[Todo] 指定返回类型是 Todo 列表，FastAPI 会自动验证和生成文档
    """
    return todos  # 直接返回内存中的 todos 列表

# -----------------------------
# 路由：添加新的待办事项
# -----------------------------
@app.post("/todos", response_model=Todo)
def add_todo(todo: Todo):
    """
    POST /todos
    接收一个 Todo 对象（自动验证类型），并添加到 todos 列表
    """
    todos.append(todo.dict())  # 将 Pydantic 对象转换为字典存储
    save_todos()               # 保存到 JSON 文件，实现持久化
    return todo                # 返回添加的待办事项给前端

# -----------------------------
# 路由：删除待办事项
# -----------------------------
@app.delete("/todos/{todo_id}")
def delete_todo(todo_id: int):
    """
    DELETE /todos/{todo_id}
    根据 ID 删除待办事项
    """
    global todos  # 因为要修改全局变量 todos，所以声明 global
    todos = [t for t in todos if t["id"] != todo_id]  # 过滤掉要删除的 ID
    save_todos()  # 保存修改
    return {"message": "Deleted"}  # 返回简单信息给前端

# -----------------------------
# 路由：更新待办事项
# -----------------------------
@app.put("/todos/{todo_id}", response_model=Todo)
def update_todo(todo_id: int, updated: Todo):
    """
    PUT /todos/{todo_id}
    更新指定 ID 的待办事项
    updated 是前端发送过来的 Todo 对象
    """
    for i, t in enumerate(todos):         # 遍历 todos 列表
        if t["id"] == todo_id:            # 找到对应 ID
            todos[i] = updated.dict()     # 更新数据
            save_todos()                  # 保存到文件
            return updated                # 返回更新后的数据
    return {"error": "Todo not found"}    # 如果没找到，返回错误信息
