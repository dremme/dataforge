"""HTTP errors the client tells apart by ``code`` instead of by reading the message."""

from __future__ import annotations

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from schemas import ApiErrorCode, ApiErrorResponse


class ApiError(HTTPException):
    def __init__(self, status_code: int, code: ApiErrorCode, detail: str) -> None:
        super().__init__(status_code=status_code, detail=detail)
        self.code: ApiErrorCode = code


def folder_not_found() -> ApiError:
    return ApiError(404, "folder_not_found", "Folder not found")


async def api_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, ApiError):
        raise exc
    body = ApiErrorResponse(detail=str(exc.detail), code=exc.code)
    return JSONResponse(status_code=exc.status_code, content=body.model_dump(), headers=exc.headers)
