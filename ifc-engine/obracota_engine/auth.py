"""Shared token between the backend and the engine (R3, R9 of H1-ESPECIFICACION).

The engine only listens on Compose's internal network, but anything else attached to it could still call it.
With ``ENGINE_TOKEN`` set, every route except ``/health`` (Compose's healthcheck) needs
``Authorization: Bearer <token>``; otherwise it answers 401 ``ENGINE_UNAUTHORIZED`` with the usual
``{"detail", "code"}`` body. Without the variable the engine stays open, as the tests and a bare
``docker run`` expect; compose.yaml makes the variable mandatory.

It is plain ASGI middleware, not ``BaseHTTPMiddleware``, so the streamed ``FileResponse`` of /build and
/apply passes through untouched.
"""
import hmac

from starlette.responses import JSONResponse

from obracota_engine import settings

OPEN_PATHS = frozenset({"/health"})
UNAUTHORIZED = "El motor IFC solo atiende al backend de ObraCota."


class TokenGuard:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        token = settings.ENGINE_TOKEN
        if scope["type"] != "http" or not token or scope["path"] in OPEN_PATHS:
            await self.app(scope, receive, send)
            return
        sent = dict(scope.get("headers") or []).get(b"authorization", b"")
        if hmac.compare_digest(sent, b"Bearer " + token.encode("utf-8")):
            await self.app(scope, receive, send)
            return
        response = JSONResponse(status_code=401, content={"detail": UNAUTHORIZED, "code": "ENGINE_UNAUTHORIZED"},
                                headers={"WWW-Authenticate": "Bearer"})
        await response(scope, receive, send)
