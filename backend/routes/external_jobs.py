from fastapi import APIRouter, HTTPException

from external.ostris_jobs import (
    OstrisJobStopError,
    fetch_active_ostris_jobs,
    stop_ostris_job_with_checkpoint,
)
from schemas import (
    ExternalOstrisJobResponse,
    ExternalOstrisJobsResponse,
    ExternalOstrisJobStopResponse,
)

router = APIRouter()


@router.get("/external/ostris/jobs", response_model=ExternalOstrisJobsResponse)
def list_active_ostris_jobs() -> ExternalOstrisJobsResponse:
    jobs, available = fetch_active_ostris_jobs()
    return ExternalOstrisJobsResponse(
        jobs=[ExternalOstrisJobResponse.model_validate(job) for job in jobs],
        active_count=len(jobs),
        available=available,
    )


@router.post("/external/ostris/jobs/{job_id}/stop", response_model=ExternalOstrisJobStopResponse)
def stop_active_ostris_job(job_id: str) -> ExternalOstrisJobStopResponse:
    try:
        stop_ostris_job_with_checkpoint(job_id)
    except OstrisJobStopError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return ExternalOstrisJobStopResponse(
        success=True,
        message="Checkpoint saved and job stopped.",
    )
