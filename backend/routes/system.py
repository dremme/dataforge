from fastapi import APIRouter

from schemas import SystemSpecsResponse
from system_specs import get_system_specs

router = APIRouter()


@router.get("/system/specs", response_model=SystemSpecsResponse)
def read_system_specs() -> SystemSpecsResponse:
    specs = get_system_specs()
    return SystemSpecsResponse(
        cpu_name=specs.cpu_name,
        cpu_cores=specs.cpu_cores,
        memory_total_bytes=specs.memory_total_bytes,
        memory_available_bytes=specs.memory_available_bytes,
        gpu_name=specs.gpu_name,
        gpu_memory_bytes=specs.gpu_memory_bytes,
        gpu_available=specs.gpu_available,
    )
