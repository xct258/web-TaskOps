"""书签接口：GET(列表) POST(新建) PUT(更新) DELETE(删除) POST visit(访问计数+1)。

站点图标：新建时后端试抓一次存到 data/favicons/（抓不到就算了，前端回退首字母）；
之后只有右键「更新图标」调 POST /bookmarks/{bid}/favicon 才会重新抓取。

调试速查::

    $ curl localhost:8481/bookmarks
    $ curl -X POST localhost:8481/bookmarks -H 'Content-Type: application/json' \\
        -d '{"title":"OpenWrt","url":"openwrt.org","tags":["路由"]}'
    $ curl -X PUT localhost:8481/bookmarks/1 -H 'Content-Type: application/json' \\
        -d '{"tags":"路由, 内网"}'
    $ curl -X POST localhost:8481/bookmarks/1/visit
    $ curl -X POST localhost:8481/bookmarks/1/favicon
    $ curl -X DELETE localhost:8481/bookmarks/1
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlmodel import Session, select

from db import FAVICON_DIR, get_bookmark_session
from favicon import remove_favicon_files, save_favicon
from models import Bookmark, shanghai_now

router = APIRouter()


def _ensure_scheme(url: str) -> str:
    """缺协议头自动补 https://（浏览器地址栏同款直觉）。"""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


def _refresh_favicon(b: Bookmark) -> None:
    """尝试抓取站点图标并写入缓存字段。

    拿不到（超时/404/不是图片）就清空字段，前端自动回退到首字母样式。
    任何异常都吞掉：图标只是锦上添花，不能让书签的增改失败。
    """
    cached = None
    try:
        cached = save_favicon(FAVICON_DIR, b.id, b.url)
    except Exception:
        cached = None

    if cached:
        b.favicon_file = cached["favicon_file"]
        b.favicon_mime = cached["favicon_mime"]
        b.favicon_updated_at = shanghai_now()
    else:
        b.favicon_file = None
        b.favicon_mime = None
        b.favicon_updated_at = None


def _clear_favicon(session: Session, b: Bookmark) -> None:
    """丢掉已有图标（换 URL 时用）：字段清空 + 文件删除。"""
    b.favicon_file = None
    b.favicon_mime = None
    b.favicon_updated_at = None
    session.add(b)
    remove_favicon_files(FAVICON_DIR, b.id)


@router.get("/bookmarks", response_model=List[Bookmark])
def get_bookmarks(
    limit: int = Query(200, ge=1, le=2000),
    session: Session = Depends(get_bookmark_session),
):
    return session.exec(select(Bookmark).order_by(Bookmark.id).limit(limit)).all()


@router.post("/bookmarks", response_model=Bookmark)
def create_bookmark(bm: Bookmark, session: Session = Depends(get_bookmark_session)):
    bm.url = _ensure_scheme(bm.url)
    # 图标只由后端抓，忽略请求里可能带进来的缓存字段
    bm.favicon_file = None
    bm.favicon_mime = None
    bm.favicon_updated_at = None

    session.add(bm)
    session.commit()
    session.refresh(bm)

    # 添加时顺手试抓一次图标：抓不到就保持无图标，不影响书签创建
    _refresh_favicon(bm)
    session.add(bm)
    session.commit()
    session.refresh(bm)
    return bm


@router.put("/bookmarks/{bid}", response_model=Bookmark)
def update_bookmark(
    bid: int = Path(...),
    payload: dict = ...,
    session: Session = Depends(get_bookmark_session),
):
    b = session.get(Bookmark, bid)
    if not b:
        raise HTTPException(404, "Bookmark not found")

    url_changed = False
    if "title" in payload:
        b.title = payload["title"]
    if "url" in payload:
        new_url = _ensure_scheme(payload["url"])
        url_changed = new_url != b.url
        b.url = new_url
    if "description" in payload:
        b.description = payload["description"]
    if "tags" in payload:
        tags = payload["tags"]
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        b.tags = tags

    if url_changed:
        # 换了地址，旧图标肯定不对：直接丢掉，等用户右键「更新图标」再抓
        _clear_favicon(session, b)

    session.commit()
    session.refresh(b)
    return b


@router.post("/bookmarks/{bid}/visit", response_model=Bookmark)
def visit_bookmark(
    bid: int = Path(...),
    session: Session = Depends(get_bookmark_session),
):
    """书签被点击一次，访问计数 +1（前端点击链接时顺手调，不阻塞跳转）。"""
    b = session.get(Bookmark, bid)
    if not b:
        raise HTTPException(404, "Bookmark not found")

    b.visit_count = (b.visit_count or 0) + 1

    session.commit()
    session.refresh(b)
    return b


@router.post("/bookmarks/{bid}/favicon", response_model=Bookmark)
def refresh_bookmark_favicon(
    bid: int = Path(...),
    session: Session = Depends(get_bookmark_session),
):
    """右键「更新图标」：重新抓一次站点图标；抓不到就清空，前端回退首字母。"""
    b = session.get(Bookmark, bid)
    if not b:
        raise HTTPException(404, "Bookmark not found")

    _refresh_favicon(b)

    session.add(b)
    session.commit()
    session.refresh(b)
    return b


@router.delete("/bookmarks/{bid}")
def delete_bookmark(
    bid: int = Path(...),
    session: Session = Depends(get_bookmark_session),
):
    b = session.get(Bookmark, bid)
    if not b:
        raise HTTPException(404, "Bookmark not found")
    remove_favicon_files(FAVICON_DIR, b.id)
    session.delete(b)
    session.commit()
    return {"message": "Deleted"}
