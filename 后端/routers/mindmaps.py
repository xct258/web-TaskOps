"""思维导图接口：GET(列表) POST(新建) PUT(更新) DELETE(删除)。

outline 为缩进大纲文本（每行一个节点，缩进层级表示父子关系），后端只存原文，
解析与自动布局由前端完成。

调试速查::

    $ curl localhost:8481/mindmaps
    $ curl -X POST localhost:8481/mindmaps -H 'Content-Type: application/json' \\
        -d '{"title":"知识体系","outline":"根节点\\n  分支一\\n    叶子"}'
    $ curl -X PUT localhost:8481/mindmaps/1 -H 'Content-Type: application/json' \\
        -d '{"title":"改名"}'
    $ curl -X DELETE localhost:8481/mindmaps/1
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlmodel import Session, select

from db import get_mindmap_session
from models import MindMap, shanghai_now

router = APIRouter()


@router.get("/mindmaps", response_model=List[MindMap])
def get_mindmaps(
    limit: int = Query(500, ge=1, le=2000),
    session: Session = Depends(get_mindmap_session),
):
    return session.exec(
        select(MindMap).order_by(MindMap.updated_at.desc()).limit(limit)
    ).all()


@router.post("/mindmaps", response_model=MindMap)
def create_mindmap(mm: MindMap, session: Session = Depends(get_mindmap_session)):
    mm.id = None
    mm.updated_at = shanghai_now()
    session.add(mm)
    session.commit()
    session.refresh(mm)
    return mm


@router.put("/mindmaps/{mid}", response_model=MindMap)
def update_mindmap(
    mid: int = Path(...),
    payload: dict = ...,
    session: Session = Depends(get_mindmap_session),
):
    m = session.get(MindMap, mid)
    if not m:
        raise HTTPException(404, "MindMap not found")

    if "title" in payload:
        m.title = payload["title"]
    if "tags" in payload:
        m.tags = payload["tags"] or []
    if "outline" in payload:
        m.outline = payload["outline"] or ""
    m.updated_at = shanghai_now()

    session.commit()
    session.refresh(m)
    return m


@router.delete("/mindmaps/{mid}")
def delete_mindmap(
    mid: int = Path(...),
    session: Session = Depends(get_mindmap_session),
):
    m = session.get(MindMap, mid)
    if not m:
        raise HTTPException(404, "MindMap not found")
    session.delete(m)
    session.commit()
    return {"message": "Deleted"}
