"""笔记接口：GET(列表) POST(新建) PUT(更新) DELETE(删除)。

正文为 Markdown 原文（渲染交给前端），tags 支持 JSON 数组或逗号字符串。

调试速查::

    $ curl localhost:8481/notes
    $ curl -X POST localhost:8481/notes -H 'Content-Type: application/json' \\
        -d '{"title":"部署记录","content":"# 步骤\\n1. 拉镜像","tags":["运维"]}'
    $ curl -X PUT localhost:8481/notes/1 -H 'Content-Type: application/json' \\
        -d '{"tags":"运维, 内网"}'
    $ curl -X DELETE localhost:8481/notes/1
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlmodel import Session, select

from db import get_note_session
from models import Note, shanghai_now

router = APIRouter()


def _normalize_tags(tags):
    """统一成字符串列表：字符串按逗号切分，其余原样（去掉空项）。"""
    if isinstance(tags, str):
        tags = tags.split(",")
    if not isinstance(tags, list):
        return []
    return [str(t).strip() for t in tags if str(t).strip()]


@router.get("/notes", response_model=List[Note])
def get_notes(
    limit: int = Query(500, ge=1, le=2000),
    session: Session = Depends(get_note_session),
):
    return session.exec(
        select(Note).order_by(Note.updated_at.desc()).limit(limit)
    ).all()


@router.post("/notes", response_model=Note)
def create_note(note: Note, session: Session = Depends(get_note_session)):
    note.id = None
    note.updated_at = shanghai_now()
    session.add(note)
    session.commit()
    session.refresh(note)
    return note


@router.put("/notes/{nid}", response_model=Note)
def update_note(
    nid: int = Path(...),
    payload: dict = ...,
    session: Session = Depends(get_note_session),
):
    n = session.get(Note, nid)
    if not n:
        raise HTTPException(404, "Note not found")

    if "title" in payload:
        n.title = payload["title"]
    if "content" in payload:
        n.content = payload["content"] or ""
    if "tags" in payload:
        n.tags = _normalize_tags(payload["tags"])
    n.updated_at = shanghai_now()

    session.commit()
    session.refresh(n)
    return n


@router.delete("/notes/{nid}")
def delete_note(
    nid: int = Path(...),
    session: Session = Depends(get_note_session),
):
    n = session.get(Note, nid)
    if not n:
        raise HTTPException(404, "Note not found")
    session.delete(n)
    session.commit()
    return {"message": "Deleted"}
