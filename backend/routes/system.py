from dataclasses import asdict

from fastapi import APIRouter

from about import describe_installation
from openai_settings import get_openai_model
from schemas import AboutResponse, SystemSpecsResponse, VisionLlmInfoResponse
from system_specs import get_system_specs

router = APIRouter()


@router.get("/system/specs", response_model=SystemSpecsResponse)
def read_system_specs() -> SystemSpecsResponse:
    return SystemSpecsResponse.model_validate(asdict(get_system_specs()))


@router.get("/system/vision-llm", response_model=VisionLlmInfoResponse)
def read_vision_llm_info() -> VisionLlmInfoResponse:
    return VisionLlmInfoResponse(model=get_openai_model())


@router.get("/system/about", response_model=AboutResponse)
def read_about() -> AboutResponse:
    return describe_installation()
