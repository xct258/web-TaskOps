"""网站图标（favicon）抓取与本地缓存。

只依赖标准库：容器里只装了 fastapi / sqlmodel / uvicorn，不额外引入 httpx、bs4。

抓取顺序（任一成功即返回）：

1. 页面 HTML 里声明的 ``<link rel="...icon...">``（含 apple-touch-icon）
2. 站点根 ``/favicon.ico``

设计取舍：

- 全程有总时限 ``TOTAL_BUDGET``，慢站点/内网地址不会把接口拖很久；
- 只接受真正的图片（按文件头判断），避免把 HTML 错误页当成图标存下来；
- 任何异常都返回 ``None``，调用方按「没有图标」处理，不影响书签本身的增删改。

调试::

    $ python -c "from favicon import fetch_favicon; print(fetch_favicon('https://github.com'))"
    $ python -c "from favicon import save_favicon; print(save_favicon(__import__('pathlib').Path('data/favicons'), 1, 'https://github.com'))"
"""
import re
import time
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import urljoin, urlparse

# 有些站点会对非浏览器 UA 直接 403，这里伪装成普通浏览器。
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 TaskOpsFavicon/1.0"
)
REQUEST_TIMEOUT = 2.5  # 单次请求超时（秒）
TOTAL_BUDGET = 5.0  # 一次抓取的总时限（秒）：页面 + 兜底 ico 都在这个预算内
MAX_HTML_BYTES = 256 * 1024  # 只读页面开头一段，够解析 <head> 即可
MAX_ICON_BYTES = 128 * 1024  # 图标体积上限，超过直接丢弃

# 文件头 → (mime, 扩展名)。顺序有意义：ICO 头必须最先判断。
_MAGIC = (
    (b"\x00\x00\x01\x00", "image/x-icon", "ico"),
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
    (b"GIF87a", "image/gif", "gif"),
    (b"GIF89a", "image/gif", "gif"),
    (b"BM", "image/bmp", "bmp"),
)

_SIZE_RE = re.compile(r"(\d+)x(\d+)", re.IGNORECASE)


def _sniff(data: bytes) -> Optional[Tuple[str, str]]:
    """按文件头识别图片类型，返回 (mime, 扩展名)；不是图片返回 None。"""
    if not data:
        return None
    for magic, mime, ext in _MAGIC:
        if data.startswith(magic):
            return mime, ext
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    head = data[:2048].lstrip().lower()
    if head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in head):
        return "image/svg+xml", "svg"
    return None


def _fetch_prefix(
    url: str, max_bytes: int, deadline: float
) -> Tuple[Optional[bytes], bool]:
    """读 URL 的前 max_bytes 字节，返回 (内容, 是否被截断)。

    超时、DNS 失败、403/404、证书错误等一律返回 (None, False)，不抛异常。
    """
    remaining = deadline - time.monotonic()
    if remaining <= 0.2:
        return None, False

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,image/*,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(
            request, timeout=min(REQUEST_TIMEOUT, remaining)
        ) as response:
            data = response.read(max_bytes + 1)
    except Exception:
        return None, False

    if len(data) > max_bytes:
        return data[:max_bytes], True
    return data, False


class _IconLinkParser(HTMLParser):
    """从 <head> 里收集候选图标链接。

    rel 含 "icon" 的都算（``icon`` / ``shortcut icon`` / ``apple-touch-icon`` /
    ``mask-icon``），按「越适合当站点图标越靠前」打分。
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.candidates: List[Tuple[int, str]] = []
        self._closed = False

    def handle_starttag(self, tag, attrs):
        if tag != "link" or self._closed:
            return
        attr = {key.lower(): (value or "") for key, value in attrs}
        rel = attr.get("rel", "").lower()
        if "icon" not in rel:
            return
        href = attr.get("href", "").strip()
        # data: / javascript: / 纯锚点都不是可下载的图片地址
        if not href or href.startswith(("data:", "javascript:", "#")):
            return
        self.candidates.append((self._score(rel, attr.get("sizes", ""), href), href))

    def handle_endtag(self, tag):
        if tag == "head":
            self._closed = True

    @staticmethod
    def _score(rel: str, sizes: str, href: str) -> int:
        """候选排序分：常规图标 > apple-touch-icon > mask-icon；尺寸大的略优先。"""
        score = 100
        if "apple-touch-icon" in rel:
            score -= 40  # 苹果触屏图标常是带底色的方块，作站点图标偏笨重
        if "mask-icon" in rel:
            score -= 80  # Safari 的单色模板图标，不能直接当彩色图标用
        if href.lower().endswith(".svg"):
            score += 20  # SVG 任意缩放都清晰
        best = 0
        for match in _SIZE_RE.finditer(sizes):
            best = max(best, int(match.group(1)))
        if best:
            score += min(best, 180) // 8
        return score


def _pick_icon_href(html: str, base_url: str) -> Optional[str]:
    parser = _IconLinkParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        pass
    if not parser.candidates:
        return None
    _, href = max(parser.candidates, key=lambda item: item[0])
    return urljoin(base_url, href)


def _download_icon(url: str, deadline: float) -> Optional[Tuple[bytes, str, str]]:
    data, truncated = _fetch_prefix(url, MAX_ICON_BYTES, deadline)
    # 太大的图标没必要存（多半是 1024px 的触屏图标），截断的直接丢
    if not data or truncated:
        return None
    sniffed = _sniff(data)
    if not sniffed:
        return None
    mime, ext = sniffed
    return data, mime, ext


def fetch_favicon(page_url: str) -> Optional[Tuple[bytes, str, str]]:
    """抓取 page_url 对应站点的图标，返回 (内容, mime, 扩展名)；拿不到返回 None。"""
    parsed = urlparse(page_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None

    deadline = time.monotonic() + TOTAL_BUDGET

    # 1) 页面里声明的图标
    html_bytes, _ = _fetch_prefix(page_url, MAX_HTML_BYTES, deadline)
    if html_bytes:
        href = _pick_icon_href(html_bytes.decode("utf-8", "ignore"), page_url)
        if href:
            icon = _download_icon(href, deadline)
            if icon:
                return icon

    # 2) 兜底：站点根 /favicon.ico（浏览器同款约定）
    root_icon = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
    if root_icon != page_url:
        icon = _download_icon(root_icon, deadline)
        if icon:
            return icon
    return None


def remove_favicon_files(directory: Path, bookmark_id: int) -> None:
    """删掉该书的全部图标文件：扩展名可能变，按 ``<id>.*`` 一并清理。"""
    if not directory.exists():
        return
    for path in directory.glob(f"{bookmark_id}.*"):
        try:
            path.unlink()
        except OSError:
            pass


def save_favicon(directory: Path, bookmark_id: int, page_url: str) -> Optional[dict]:
    """抓取并落盘，返回 ``{"favicon_file": ..., "favicon_mime": ...}``；失败返回 None。

    文件名固定为 ``<id>.<ext>``，同一书签刷新时直接覆盖，不留垃圾文件。
    """
    result = fetch_favicon(page_url)
    if not result:
        return None

    data, mime, ext = result
    try:
        directory.mkdir(parents=True, exist_ok=True)
        # 先清旧文件：换扩展名（如 ico → png）时不会留下两份
        remove_favicon_files(directory, bookmark_id)
        name = f"{bookmark_id}.{ext}"
        (directory / name).write_bytes(data)
    except OSError:
        return None

    return {"favicon_file": name, "favicon_mime": mime}
