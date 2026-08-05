"""The push channel: one stream carrying job progress and AI-Toolkit state.

Clients hydrate over the regular endpoints and then keep up through this stream, so
nothing here has to replay history — an event is always a complete current snapshot of
whatever it describes.
"""

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

import events

router = APIRouter()

#: Well inside the idle timeout of any proxy in front of the API, and cheap: a
#: comment frame is two bytes of payload.
HEARTBEAT_SECONDS = 20.0


@router.get("/events")
async def stream_events() -> StreamingResponse:
    async def generate():
        with events.subscribe() as subscriber:
            # Opens the response immediately, so the client's `open` fires before the
            # first real event rather than whenever work happens to start.
            yield ": connected\n\n"

            while True:
                event = await subscriber.next_event(HEARTBEAT_SECONDS)
                if event is None:
                    yield ": keep-alive\n\n"
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
