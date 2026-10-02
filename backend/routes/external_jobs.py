from fastapi import APIRouter, HTTPException

from external.ostris_jobs import OstrisJobStopError, stop_ostris_job_with_checkpoint
from external.ostris_training import fetch_training_samples, validate_lora_name
from external_jobs_feed import read_external_jobs
from schemas import (
    ExternalOstrisJobsResponse,
    ExternalOstrisJobStopResponse,
    OstrisTrainingSample,
    OstrisTrainingSamplesResponse,
)

router = APIRouter()


@router.get("/external/ostris/jobs", response_model=ExternalOstrisJobsResponse)
def list_active_ostris_jobs() -> ExternalOstrisJobsResponse:
    return ExternalOstrisJobsResponse.model_validate(read_external_jobs())


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


@router.get(
    "/external/ostris/training/{name}/samples",
    response_model=OstrisTrainingSamplesResponse,
)
def list_ostris_training_samples(name: str) -> OstrisTrainingSamplesResponse:
    try:
        validate_lora_name(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    samples, step, available = fetch_training_samples(name)
    return OstrisTrainingSamplesResponse(
        samples=[OstrisTrainingSample.model_validate(sample) for sample in samples],
        step=step,
        available=available,
    )
