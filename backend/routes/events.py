"""The push channel: one stream carrying job progress and AI-Toolkit state.

Clients hydrate over the regular endpoints and then keep up through this stream, so
nothing here has to replay history — an event is always a complete current snapshot of
whatever it describes.
"""

import json

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

import events
from schemas import HeartbeatEvent

router = APIRouter()

#: Well inside the idle timeout of any proxy in front of the API, and cheap: a
#: comment frame is two bytes of payload.
HEARTBEAT_SECONDS = 20.0


@router.get("/events")
async def stream_events(
    tab: str = Query("", description="Caller's tab id, so folder events can be addressed to it."),
) -> StreamingResponse:
    heartbeat = f"data: {HeartbeatEvent().model_dump_json()}\n\n"

    async def generate():
        with events.subscribe(tab) as subscriber:
            # Opens the response immediately, so the client's `open` fires before the
            # first real event rather than whenever work happens to start.
            yield ": connected\n\n"

            while True:
                event = await subscriber.next_event(HEARTBEAT_SECONDS)
                if event is None:
                    # A real frame rather than an SSE comment: comments never reach
                    # `onmessage`, so a client cannot tell a quiet stream from a dead one.
                    yield heartbeat
                    continue
                yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            # Stops nginx-style proxies buffering the stream into uselessness.
            "X-Accel-Buffering": "no",
        },
    )
