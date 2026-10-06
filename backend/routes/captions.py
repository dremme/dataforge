from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from captions import build_caption_response, load_backup_caption, save_caption
from comfy_editor_workflow import workflow_for_output
from comfy_metadata import media_has_comfy_workflow
from comfy_prompts import (
    MapNode,
    Parameter,
    PromptText,
    SamplingStage,
    extract_workflow_prompts,
    read_editor_workflow,
)
from constants import COMFY_WORKFLOW_EXTENSIONS
from routes._helpers import resolve_media_file
from schemas import (
    CaptionBackupResponse,
    CaptionSaveResponse,
    CaptionUpdate,
    ComfyEditorWorkflowResponse,
    ComfyMapNode,
    ComfyOutputBranch,
    ComfyParameter,
    ComfyPromptText,
    ComfySamplingStage,
    ComfyWorkflowPromptsResponse,
    PngWorkflowResponse,
)

router = APIRouter()


def _resolve_comfy_media(path: str) -> Path:
    file_path = resolve_media_file(path)
    if file_path.suffix.lower() not in COMFY_WORKFLOW_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="ComfyUI workflow metadata is only supported for PNG, MP4, MOV, and M4V files",
        )
    return file_path


def _prompt_text(prompt: PromptText) -> ComfyPromptText:
    return ComfyPromptText(
        role=prompt.role,
        text=prompt.text,
        node_id=prompt.node_id,
        node_title=prompt.node_title,
        input_name=prompt.input_name,
    )


def _parameters(parameters: list[Parameter]) -> list[ComfyParameter]:
    return [
        ComfyParameter(label=parameter.label, value=parameter.value) for parameter in parameters
    ]


def _map_node(node: MapNode) -> ComfyMapNode:
    return ComfyMapNode(
        id=node.id,
        kind=node.kind,
        label=node.label,
        detail=node.detail,
        status=node.status,
        feeds=node.feeds,
        role=node.role,
        media=node.media,
        source=node.source,
    )


def _sampling_stage(stage: SamplingStage) -> ComfySamplingStage:
    return ComfySamplingStage(
        node_id=stage.node_id,
        label=stage.label,
        group=stage.group,
        status=stage.status,
        parameters=_parameters(stage.parameters),
        loras=stage.loras,
    )


@router.get("/caption", response_model=CaptionSaveResponse)
def read_caption(
    path: str = Query(..., description="Absolute path to image or video file"),
) -> CaptionSaveResponse:
    file_path = resolve_media_file(path)
    return CaptionSaveResponse.model_validate(build_caption_response(file_path))


@router.get("/caption/backup", response_model=CaptionBackupResponse)
def read_caption_backup(
    path: str = Query(..., description="Absolute path to image or video file"),
) -> CaptionBackupResponse:
    file_path = resolve_media_file(path)
    description = load_backup_caption(file_path)
    return CaptionBackupResponse(exists=description is not None, description=description)


@router.get("/comfy-workflow", response_model=PngWorkflowResponse)
def read_comfy_workflow(
    path: str = Query(..., description="Absolute path to image or video file"),
) -> PngWorkflowResponse:
    return PngWorkflowResponse(has_workflow=media_has_comfy_workflow(_resolve_comfy_media(path)))


@router.get("/comfy-workflow/prompts", response_model=ComfyWorkflowPromptsResponse)
def read_comfy_workflow_prompts(
    path: str = Query(..., description="Absolute path to image or video file"),
) -> ComfyWorkflowPromptsResponse:
    file_path = _resolve_comfy_media(path)
    extracted = extract_workflow_prompts(file_path)

    return ComfyWorkflowPromptsResponse(
        has_workflow=extracted.has_workflow,
        branches=[
            ComfyOutputBranch(
                node_id=branch.node_id,
                class_type=branch.class_type,
                label=branch.label,
                filename_prefix=branch.filename_prefix,
                filename=branch.filename,
                is_preview=branch.is_preview,
                matches_filename=branch.matches_filename,
                prompts=[_prompt_text(prompt) for prompt in branch.prompts],
                parameters=_parameters(branch.parameters),
                loras=branch.loras,
                stages=[_sampling_stage(stage) for stage in branch.stages],
                map=[_map_node(node) for node in branch.map],
            )
            for branch in extracted.branches
        ],
        matched_node_id=extracted.matched_node_id,
        orphan_prompts=[_prompt_text(prompt) for prompt in extracted.orphan_prompts],
        has_editor_workflow=extracted.has_editor_workflow,
        matched_by_size=extracted.matched_by_size,
    )


@router.get("/comfy-workflow/editor", response_model=ComfyEditorWorkflowResponse)
def read_comfy_editor_workflow(
    path: str = Query(..., description="Absolute path to image or video file"),
    node_id: str = Query(..., description="Output node the workflow is trimmed to"),
) -> ComfyEditorWorkflowResponse:
    raw = read_editor_workflow(_resolve_comfy_media(path))
    if raw is None:
        raise HTTPException(
            status_code=404,
            detail="This file carries no editor workflow that ComfyUI can load from a paste",
        )
    workflow = workflow_for_output(raw, node_id)
    if workflow is None:
        raise HTTPException(
            status_code=404, detail=f"Output node {node_id} is not in the editor workflow"
        )
    return ComfyEditorWorkflowResponse(workflow=workflow)


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
            resolve_issue=body.resolve_issue,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to write caption file") from exc

    return CaptionSaveResponse.model_validate(result)
