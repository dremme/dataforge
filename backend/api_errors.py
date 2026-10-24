"""HTTP errors the client tells apart by ``code`` instead of by reading the message."""

from __future__ import annotations

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from schemas import ApiErrorCode, ApiErrorResponse


class ApiError(HTTPException):
    def __init__(self, status_code: int, code: ApiErrorCode, detail: str) -> None:
        super().__init__(status_code=status_code, detail=detail)
        self.code: ApiErrorCode = code


class ConflictError(Exception):
    """A domain refusal the client can resolve; answered as a 409 with ``code`` by one handler.

    Domain modules raise it without knowing about HTTP, and jobs catch it like any other error.
    """

    code: ApiErrorCode


def folder_not_found() -> ApiError:
    return ApiError(404, "folder_not_found", "Folder not found")


async def api_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, ApiError):
        raise exc
    body = ApiErrorResponse(detail=str(exc.detail), code=exc.code)
    return JSONResponse(status_code=exc.status_code, content=body.model_dump(), headers=exc.headers)


async def conflict_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, ConflictError):
        raise exc
    body = ApiErrorResponse(detail=str(exc), code=exc.code)
    return JSONResponse(status_code=409, content=body.model_dump())
