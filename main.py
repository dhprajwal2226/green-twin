# main.py
# FastAPI server for the Green Building Digital Twin (api-cv branch)
# Teammate B's file — DO NOT edit engine.py, only call it as thin wrappers.

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import engine  # our team-lead's module

# -----------------------------------------------------------------------
# App setup
# -----------------------------------------------------------------------

app = FastAPI(
    title="Green Twin API",
    description="Room-level occupancy-based lighting-waste estimator. "
                "All savings figures are ESTIMATES under stated assumptions.",
)

# Allow all origins so Teammate C's dashboard can call us from any port.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # "*" = any origin, safe for a local hackathon demo
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------------------------------------------------
# Pydantic models: validation for POST bodies
# -----------------------------------------------------------------------

class Observation(BaseModel):
    """
    One sensor reading from a camera or the simulator.
    FastAPI validates this automatically and gives a clean 422 on bad input.
    """
    room_id: str           # e.g. "R204"
    ts: str                # ISO-8601 timestamp, e.g. "2026-10-15T11:30:00"
    person_count: int      # how many people were detected (0 or more)
    confidence: float      # model confidence 0-1
    light_on: bool         # True if camera sees the light on


class ActionRequest(BaseModel):
    """
    Action taken on an issue, recorded into the evidence ledger.
    FastAPI validates this automatically and gives a clean 422 on bad input.
    """
    room_id: str           # e.g. "R204"
    action: str            # e.g. "switched_off"
    ts: str                # ISO-8601 timestamp, e.g. "2026-10-15T12:30:00"


# -----------------------------------------------------------------------
# Helper: validate room_id early so we never crash inside engine.py
# -----------------------------------------------------------------------

def require_valid_room(room_id: str):
    """
    Raise HTTP 400 with a friendly message if the room_id is not in ROOMS.
    Called before every engine call that takes a room_id.
    """
    if room_id not in engine.ROOMS:
        known = list(engine.ROOMS.keys())
        raise HTTPException(
            status_code=400,
            detail=f"Unknown room_id '{room_id}'. Known rooms: {known}",
        )


# -----------------------------------------------------------------------
# Endpoint: POST /observation
# -----------------------------------------------------------------------

@app.post("/observation", summary="Submit one sensor reading")
def post_observation(obs: Observation):
    """
    Thin wrapper: validates room_id, then stores the reading in engine history.
    """
    require_valid_room(obs.room_id)               # 400 if unknown
    engine.add_observation(obs.model_dump())       # store as plain dict
    return {"stored": True, "room_id": obs.room_id, "ts": obs.ts}


# -----------------------------------------------------------------------
# Endpoint: GET /twin
# -----------------------------------------------------------------------

@app.get("/twin", summary="Current state of every room")
def get_twin(threshold: int = 15):
    """
    Thin wrapper: returns current state of every room directly from engine.twin().
    """
    return engine.twin(threshold_min=threshold)


# -----------------------------------------------------------------------
# Endpoint: GET /recommendations
# -----------------------------------------------------------------------

@app.get("/recommendations", summary="Rooms with probable lighting waste, top priority first")
def get_recommendations(threshold: int = 15):
    """
    Thin wrapper: returns engine.recommendations() for backwards compatibility.
    """
    return engine.recommendations(threshold_min=threshold)


# -----------------------------------------------------------------------
# Endpoint: GET /whatif
# -----------------------------------------------------------------------

@app.get("/whatif", summary="What-if policy comparison (savings ESTIMATES only)")
def get_whatif():
    """
    Thin wrapper: returns policy comparison across thresholds from engine.whatif().
    """
    return engine.whatif()


# -----------------------------------------------------------------------
# Endpoint: GET /queue (engine v2)
# -----------------------------------------------------------------------

@app.get("/queue", summary="Ranked issue queue for prioritized actions")
def get_queue(threshold: int = 15):
    """
    Thin wrapper: returns the engine's ranked issue list with rank, score, why, and effort.
    """
    return engine.queue(threshold_min=threshold)


# -----------------------------------------------------------------------
# Endpoint: POST /ledger/action (engine v2)
# -----------------------------------------------------------------------

@app.post("/ledger/action", summary="Record a response action in the evidence ledger")
def post_ledger_action(act: ActionRequest):
    """
    Thin wrapper: validates room_id against ROOMS, calls engine.record_action(),
    and returns the updated ledger entry. Returns HTTP 400 if room is unknown or no open issue.
    """
    require_valid_room(act.room_id)
    try:
        return engine.record_action(act.room_id, act.action, act.ts)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# -----------------------------------------------------------------------
# Endpoint: GET /ledger (engine v2)
# -----------------------------------------------------------------------

@app.get("/ledger", summary="All evidence ledger entries")
def get_ledger(threshold: int = 15):
    """
    Thin wrapper: returns all ledger entries directly from engine.get_ledger().
    """
    return engine.get_ledger(threshold_min=threshold)


# -----------------------------------------------------------------------
# Endpoint: POST /reset
# -----------------------------------------------------------------------

@app.post("/reset", summary="Clear all stored observations and the ledger")
def post_reset():
    """
    Thin wrapper: calls engine.reset() to wipe observation history and the ledger.
    """
    engine.reset()
    return {
        "reset": True,
        "rooms_cleared": list(engine.ROOMS.keys()),
        "ledger_cleared": True,
    }
