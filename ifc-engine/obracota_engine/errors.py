"""Engine errors with a stable code (H1-ESPECIFICACION §5.2).

The body is ``{"detail": "<Spanish message>", "code": "<CODE>"}``. ``detail`` stays a plain string, so the
backend reads it the same way it reads the errors of /inspect.

The pre-H1 route /inspect keeps their exact contract: they turn an ``EngineError`` back into
a FastAPI ``HTTPException`` with the same status and message, without ``code``.
"""
import logging
from contextlib import contextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

log = logging.getLogger(__name__)

# What IfcOpenShell (or IfcDiff) can raise on a malformed or unusual model.
LIBRARY_FAILURES = (RuntimeError, ValueError, AttributeError, IndexError, TypeError, KeyError, RecursionError)


class EngineError(Exception):
    """An expected failure that maps to an HTTP status, a stable code and a message for the person."""

    def __init__(self, status: int, code: str, detail: str, **extra):
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail
        # Additional fields of the body, e.g. the ``report`` of a /build that failed its verification.
        self.extra = extra

    def body(self) -> dict:
        return {"detail": self.detail, "code": self.code, **self.extra}


@contextmanager
def library(detail: str):
    """One call into IfcOpenShell or IfcDiff during a preview: if the library fails on this model, 422
    ``MODEL_UNREADABLE`` with ``detail``, logged with its traceback.

    It wraps only the library calls (open, write, reopen, validate, IfcDiff). A failure of the engine's own
    logic is not the file's fault: it stays a 500, which the backend reads as a contract error (502).
    """
    try:
        yield
    except LIBRARY_FAILURES as exc:
        log.exception("IFC library failed: %s", detail)
        raise EngineError(422, "MODEL_UNREADABLE", detail) from exc


async def engine_error_handler(_request: Request, exc: EngineError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content=exc.body())


def install(app: FastAPI) -> None:
    app.add_exception_handler(EngineError, engine_error_handler)
