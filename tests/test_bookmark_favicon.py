"""书签图标：抓取解析逻辑与路由行为回归测试（不联网）。"""
import sys
import unittest
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "后端"))

import favicon
from models import Bookmark
from routers import bookmarks


class IconParseTests(unittest.TestCase):
    def test_pick_icon_prefers_regular_icon_over_apple_touch(self):
        html = """
        <head>
          <link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
          <link rel="icon" type="image/png" href="/icon-32.png">
        </head>
        """
        self.assertEqual(favicon._pick_icon_href(html, "https://example.com/a/b"), "https://example.com/icon-32.png")

    def test_pick_icon_resolves_relative_and_skips_data_uri(self):
        html = '<head><link rel="icon" href="data:image/png;base64,AAA"><link rel="shortcut icon" href="fav.ico"></head>'
        self.assertEqual(favicon._pick_icon_href(html, "https://example.com/dir/page.html"), "https://example.com/dir/fav.ico")

    def test_pick_icon_returns_none_without_links(self):
        self.assertIsNone(favicon._pick_icon_href("<head><title>x</title></head>", "https://example.com"))

    def test_sniff_accepts_images_and_rejects_html(self):
        self.assertEqual(favicon._sniff(b"\x89PNG\r\n\x1a\n" + b"0" * 16)[1], "png")
        self.assertEqual(favicon._sniff(b"\x00\x00\x01\x00" + b"0" * 16)[1], "ico")
        self.assertEqual(favicon._sniff(b'<svg xmlns="http://www.w3.org/2000/svg"></svg>')[1], "svg")
        self.assertIsNone(favicon._sniff(b"<!DOCTYPE html><html><body>403</body></html>"))
        self.assertIsNone(favicon._sniff(b""))

    def test_fetch_rejects_unsupported_scheme(self):
        self.assertIsNone(favicon.fetch_favicon("ftp://example.com"))


class BookmarkRouterFaviconTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine, tables=[Bookmark.__table__])
        self.session = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.session.close)

    def _patch_save(self, result):
        original = bookmarks.save_favicon
        bookmarks.save_favicon = lambda directory, bookmark_id, url: result
        self.addCleanup(setattr, bookmarks, "save_favicon", original)

    def test_create_bookmark_caches_icon_when_found(self):
        self._patch_save({"favicon_file": "1.png", "favicon_mime": "image/png"})
        b = bookmarks.create_bookmark(Bookmark(title="GitHub", url="github.com"), self.session)
        self.assertEqual(b.url, "https://github.com")
        self.assertEqual(b.favicon_file, "1.png")
        self.assertEqual(b.favicon_mime, "image/png")
        self.assertIsNotNone(b.favicon_updated_at)
        self.assertIn("/api/favicons/1.png?v=", b.favicon_url)

    def test_create_bookmark_survives_missing_icon(self):
        self._patch_save(None)
        b = bookmarks.create_bookmark(Bookmark(title="内网", url="http://10.0.0.1"), self.session)
        self.assertIsNone(b.favicon_file)
        self.assertIsNone(b.favicon_url)

    def test_changing_url_drops_old_icon_without_refetching(self):
        self._patch_save({"favicon_file": "1.png", "favicon_mime": "image/png"})
        b = bookmarks.create_bookmark(Bookmark(title="站点", url="a.com"), self.session)

        removed = []
        original = bookmarks.remove_favicon_files
        bookmarks.remove_favicon_files = lambda directory, bookmark_id: removed.append(bookmark_id)
        self.addCleanup(setattr, bookmarks, "remove_favicon_files", original)
        calls = []
        bookmarks.save_favicon = lambda *args, **kwargs: calls.append(args) or None

        updated = bookmarks.update_bookmark(b.id, {"url": "https://b.com"}, self.session)
        self.assertIsNone(updated.favicon_file)
        self.assertEqual(removed, [b.id])
        self.assertEqual(calls, [], "换 URL 不应自动重新抓取，只有手动更新图标才抓")

    def test_refresh_endpoint_refetches_icon(self):
        b = bookmarks.create_bookmark(Bookmark(title="站点", url="a.com"), self.session)
        self._patch_save({"favicon_file": f"{b.id}.svg", "favicon_mime": "image/svg+xml"})
        refreshed = bookmarks.refresh_bookmark_favicon(b.id, self.session)
        self.assertEqual(refreshed.favicon_file, f"{b.id}.svg")


if __name__ == "__main__":
    unittest.main()
