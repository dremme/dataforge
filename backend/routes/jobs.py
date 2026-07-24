from fastapi import APIRouter, HTTPException, Query

from automation.jobs import job_manager
from routes._helpers import job_response, resolve_folder
from schemas import JobDeleteResponse, JobResponse, JobsResponse

router = APIRouter()


@router.get("/jobs", response_model=JobsResponse)
def list_jobs(
    limit: int = Query(100, ge=1, le=100, description="Maximum number of jobs to return"),
) -> JobsResponse:
    jobs = job_manager.list_jobs(limit=limit)
    active_count = sum(1 for job in jobs if job.status in {"queued", "running"})
    return JobsResponse(
        jobs=[job_response(job) for job in jobs],
        active_count=active_count,
    )


@router.delete("/jobs", response_model=JobDeleteResponse)
def delete_all_jobs() -> JobDeleteResponse:
    deleted_count = job_manager.delete_all_jobs()
    return JobDeleteResponse(deleted_count=deleted_count)


@router.get("/jobs/folder-latest", response_model=JobResponse | None)
def read_latest_job_for_folder(
    path: str = Query(..., description="Absolute path to folder"),
) -> JobResponse | None:
    folder = resolve_folder(path)
    job = job_manager.get_latest_job_for_folder(str(folder))
    if job is None:
        return None
    return job_response(job)


@router.get("/jobs/{job_id}", response_model=JobResponse)
def read_job(job_id: str) -> JobResponse:
    job = job_manager.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job_response(job)


@router.post("/jobs/{job_id}/cancel", response_model=JobResponse)
def cancel_job(job_id: str) -> JobResponse:
    job = job_manager.cancel_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job_response(job)


@router.delete("/jobs/{job_id}", response_model=JobDeleteResponse)
def delete_job(job_id: str) -> JobDeleteResponse:
    if not job_manager.delete_job(job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    return JobDeleteResponse(deleted_count=1)
