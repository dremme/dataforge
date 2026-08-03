from fastapi import APIRouter, HTTPException, Query

from captions import build_caption_response, save_caption
from comfy_metadata import media_has_comfy_workflow
from constants import VIDEO_EXTENSIONS
from routes._helpers import resolve_media_file, resolve_sysprompt_target
from schemas import CaptionSaveResponse, CaptionUpdate, PngWorkflowResponse, SysPromptSaveResponse
from sysprompt import save_sysprompt

router = APIRouter()


@router.get("/caption", response_model=CaptionSaveResponse)
def read_caption(
    path: str = Query(..., description="Absolute path to image or video file"),
) -> CaptionSaveResponse:
    file_path = resolve_media_file(path)
    return CaptionSaveResponse(**build_caption_response(file_path))


@router.get("/comfy-workflow", response_model=PngWorkflowResponse)
def read_comfy_workflow(
    path: str = Query(..., description="Absolute path to image or video file"),
) -> PngWorkflowResponse:
    file_path = resolve_media_file(path)
    suffix = file_path.suffix.lower()
    if suffix != ".png" and suffix not in VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="ComfyUI workflow metadata is only supported for PNG and MP4 files",
        )

    return PngWorkflowResponse(has_workflow=media_has_comfy_workflow(file_path))


@router.put("/caption", response_model=CaptionSaveResponse)
def update_caption(
    path: str = Query(..., description="Absolute path to image or video file"),
    body: CaptionUpdate = ...,
) -> CaptionSaveResponse:
    file_path = resolve_media_file(path)

    try:
        result = save_caption(
            file_path,
            body.text,
            json_content=body.json_content,
            resolve_issue=body.resolve_issue,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to write caption file") from exc

    return CaptionSaveResponse(**result)


@router.put("/sysprompt", response_model=SysPromptSaveResponse)
def update_sysprompt(
    path: str = Query(..., description="Absolute path to folder or .sysprompt file"),
    body: CaptionUpdate = ...,
) -> SysPromptSaveResponse:
    folder = resolve_sysprompt_target(path)

    try:
        result = save_sysprompt(folder, body.text)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to write .sysprompt file") from exc

    return SysPromptSaveResponse(**result)
