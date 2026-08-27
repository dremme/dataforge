"""The push channel: one stream carrying job progress and AI-Toolkit state."""

import json

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

import events
from schemas import HeartbeatEvent

router = APIRouter()

HEARTBEAT_SECONDS = 20.0


@router.get("/events")
async def stream_events(
    tab: str = Query("", description="Caller's tab id, so folder events can be addressed to it."),
) -> StreamingResponse:
    heartbeat = f"data: {HeartbeatEvent().model_dump_json()}\n\n"

    async def generate():
        with events.subscribe(tab) as subscriber:
            yield ": connected\n\n"

            while True:
                event = await subscriber.next_event(HEARTBEAT_SECONDS)
                if event is None:
                    # A data frame, not an SSE comment: comments never reach `onmessage`.
                    yield heartbeat
                    continue
                yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
        },
    )
