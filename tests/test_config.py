"""运行时配置：壁纸接口地址从环境变量读取。"""
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "后端"))

from routers import config


class ConfigTests(unittest.TestCase):
    def test_reads_wallpaper_api_url_from_env(self):
        with mock.patch.dict(os.environ, {"WALLPAPER_API_URL": "https://img.example.com"}):
            self.assertEqual(
                config.get_config(), {"wallpaperApiUrl": "https://img.example.com"}
            )

    def test_falls_back_to_random_image_when_unset(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("WALLPAPER_API_URL", None)
            self.assertEqual(
                config.get_config(),
                {"wallpaperApiUrl": "https://random-image.xct258.top/"},
            )

    def test_blank_value_falls_back_to_default(self):
        with mock.patch.dict(os.environ, {"WALLPAPER_API_URL": "   "}):
            self.assertEqual(
                config.get_config(),
                {"wallpaperApiUrl": "https://random-image.xct258.top/"},
            )


if __name__ == "__main__":
    unittest.main()
