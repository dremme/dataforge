from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from file_import import import_uploaded_files, preview_import
from routes._helpers import resolve_folder
from schemas import FileImportPreviewRequest, FileImportPreviewResponse, FileImportResponse

router = APIRouter()


@router.post("/files/import/preview", response_model=FileImportPreviewResponse)
def preview_file_import(
    path: str = Query(..., description="Absolute path to destination folder"),
    body: FileImportPreviewRequest = ...,
) -> FileImportPreviewResponse:
    folder = resolve_folder(path)
    result = preview_import(folder, body.filenames)
    return FileImportPreviewResponse(**result)


@router.post("/files/import", response_model=FileImportResponse)
async def import_files(
    path: str = Query(..., description="Absolute path to destination folder"),
    overwrite: bool = Query(False, description="Replace files that already exist in the folder"),
    files: list[UploadFile] = File(..., description="Files to copy into the folder"),
) -> FileImportResponse:
    folder = resolve_folder(path)

    if not files:
        raise HTTPException(status_code=400, detail="No files were provided")

    uploads: list[tuple[str, object]] = []
    for upload in files:
        if not upload.filename:
            continue
        uploads.append((upload.filename, upload.file))

    if not uploads:
        raise HTTPException(status_code=400, detail="No valid files were provided")

    try:
        result = import_uploaded_files(folder, uploads, overwrite=overwrite)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to import files: {exc}") from exc

    return FileImportResponse(**result)
