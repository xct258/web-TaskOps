"""访问密码：单密码登录 + HMAC 签名会话 Cookie。

配置（环境变量）：
    APP_PASSWORD     访问密码；未设置或为空 = 不启用鉴权（兼容旧部署）
    APP_SECRET       可选，Cookie 签名密钥；不设置则由密码派生
    APP_SESSION_DAYS 会话有效天数，默认 7

行为：
    - 未登录访问任何接口返回 401，前端据此显示登录页；
    - 登录成功写入 HttpOnly Cookie，HTTPS（含反代 X-Forwarded-Proto）下自动加 Secure；
    - 同一 IP 连续输错 5 次锁定 60 秒，避免在线暴力尝试。
"""
import hashlib
import hmac
import os
import time
from typing import Dict, Tuple

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware

PASSWORD = os.environ.get("APP_PASSWORD", "")
SESSION_MAX_AGE = int(os.environ.get("APP_SESSION_DAYS", "7")) * 86400
COOKIE_NAME = "taskops_session"
PUBLIC_PATHS = {
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/logout",
    # 登录页之前就要加载壁纸，配置接口必须公开。
    "/api/config",
}
# 登录页和前端静态资源必须公开，否则未登录时连登录页都加载不出来。
PUBLIC_STATIC_PATHS = {"/", "/index.html", "/favicon.svg", "/favicon.ico"}
PUBLIC_STATIC_PREFIXES = ("/assets/",)
SECRET = (
    os.environ.get("APP_SECRET")
    or hashlib.sha256(f"taskops-session|{PASSWORD}".encode("utf-8")).hexdigest()
).encode("utf-8")

MAX_FAILURES = 5
LOCK_SECONDS = 60
_failures: Dict[str, Tuple[int, float]] = {}

router = APIRouter(prefix="/api/auth", tags=["auth"])


def auth_enabled() -> bool:
    return bool(PASSWORD)


def _sign(payload: str) -> str:
    return hmac.new(SECRET, payload.encode("utf-8"), hashlib.sha256).hexdigest()


def create_token() -> str:
    payload = f"v1.{int(time.time()) + SESSION_MAX_AGE}"
    return f"{payload}.{_sign(payload)}"


def verify_token(token: str | None) -> bool:
    if not token or not auth_enabled():
        return False
    try:
        version, expires, signature = token.split(".")
    except ValueError:
        return False
    if version != "v1":
        return False
    if not hmac.compare_digest(signature, _sign(f"v1.{expires}")):
        return False
    try:
        return int(expires) > int(time.time())
    except ValueError:
        return False


def is_authenticated(request: Request) -> bool:
    return (not auth_enabled()) or verify_token(request.cookies.get(COOKIE_NAME))


def _is_https(request: Request) -> bool:
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return proto == "https" or request.url.scheme == "https"


def _set_session_cookie(response: JSONResponse, request: Request) -> JSONResponse:
    response.set_cookie(
        COOKIE_NAME,
        create_token(),
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=_is_https(request),
        path="/",
    )
    return response


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class AuthMiddleware(BaseHTTPMiddleware):
    """除登录接口和前端静态资源外，所有请求都要求会话 Cookie。"""

    async def dispatch(self, request, call_next):
        path = request.url.path
        if (
            not auth_enabled()
            or request.method == "OPTIONS"
            or path in PUBLIC_PATHS
            or path in PUBLIC_STATIC_PATHS
            or path.startswith(PUBLIC_STATIC_PREFIXES)
        ):
            return await call_next(request)
        if is_authenticated(request):
            return await call_next(request)
        return JSONResponse({"detail": "未登录或登录已过期"}, status_code=401)


class LoginPayload(BaseModel):
    password: str = ""


@router.get("/status")
def auth_status(request: Request):
    return {"enabled": auth_enabled(), "authenticated": is_authenticated(request)}


@router.post("/login")
def auth_login(payload: LoginPayload, request: Request):
    if not auth_enabled():
        return {"ok": True, "enabled": False}

    ip = _client_ip(request)
    now = time.time()
    count, locked_until = _failures.get(ip, (0, 0.0))
    if locked_until > now:
        raise HTTPException(status_code=429, detail="尝试次数过多，请稍后再试")

    if not hmac.compare_digest(payload.password.encode("utf-8"), PASSWORD.encode("utf-8")):
        count += 1
        if count >= MAX_FAILURES:
            _failures[ip] = (0, now + LOCK_SECONDS)
        else:
            _failures[ip] = (count, 0.0)
        raise HTTPException(status_code=401, detail="密码错误")

    _failures.pop(ip, None)
    return _set_session_cookie(JSONResponse({"ok": True, "enabled": True}), request)


@router.post("/logout")
def auth_logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie(COOKIE_NAME, path="/")
    return response
