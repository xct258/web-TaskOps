"""前端运行时配置：从容器环境变量读取，改 docker-compose 后重启容器即可生效。

    GET /api/config

配置（环境变量）：
    WALLPAPER_API_URL  壁纸图片接口地址，默认 https://random-image.xct258.top/
                       - 直接返回图片的接口：原样使用（可带查询参数）
                       - 需要随机种子的接口：支持 {seed} / {width} / {height} 占位符，
                         例如 https://picsum.photos/seed/{seed}/1920/1080

注意：壁纸在登录页之前就要加载，因此该接口在 auth.py 里属于公开路径。
"""
import os

from fastapi import APIRouter

router = APIRouter(tags=["config"])

DEFAULT_WALLPAPER_API_URL = "https://random-image.xct258.top/"


@router.get("/config")
def get_config():
    return {
        "wallpaperApiUrl": os.environ.get(
            "WALLPAPER_API_URL", DEFAULT_WALLPAPER_API_URL
        ).strip()
        or DEFAULT_WALLPAPER_API_URL,
    }
