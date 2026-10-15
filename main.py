# main.py
# FastAPI server for the Green Building Digital Twin (api-cv branch)
# Teammate B's file — DO NOT edit engine.py, only call it.

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
# Pydantic model: what a valid observation POST body looks like
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
    Accept a JSON observation body, validate the room_id, then store it
    in the engine's in-memory history.

    Returns a simple confirmation dict so Teammate C can see it worked.
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
    Ask the engine for the current state of every room.
    threshold = minutes of vacancy before we flag probable_waste.
    Returns the list exactly as engine.twin() produces it — no reshaping.
    """
    return engine.twin(threshold_min=threshold)


# -----------------------------------------------------------------------
# Endpoint: GET /recommendations
# -----------------------------------------------------------------------

@app.get("/recommendations", summary="Rooms with probable lighting waste, top priority first")
def get_recommendations(threshold: int = 15):
    """
    Returns only the probable_waste rooms, sorted highest priority first.
    These are ESTIMATES under stated assumptions — not measured savings.
    Passes engine output through unchanged.
    """
    return engine.recommendations(threshold_min=threshold)


# -----------------------------------------------------------------------
# Endpoint: GET /whatif
# -----------------------------------------------------------------------

# NOTE: engine.py does not expose a whatif() function.
# We implement it here without touching engine.py.
# Logic: compare total estimated kWh across all rooms at different
# "act after N minutes" thresholds to show how policy aggressiveness
# changes savings estimates.

@app.get("/whatif", summary="What-if policy comparison (savings ESTIMATES only)")
def get_whatif():
    """
    Show how total estimated avoidable kWh changes if we respond to vacant
    rooms after 5, 15, 30, or 60 minutes.

    These are ESTIMATES under stated assumptions, not measured savings.
    """
    thresholds = (5, 15, 30, 60)
    results = []

    for t in thresholds:
        # Get all room states at this threshold
        states = engine.twin(threshold_min=t)

        # Add up kwh_high from every probable_waste room.
        # kwh_low/high are only present on probable_waste rooms.
        total_kwh_low = sum(
            s.get("kwh_low", 0) for s in states if s["status"] == "probable_waste"
        )
        total_kwh_high = sum(
            s.get("kwh_high", 0) for s in states if s["status"] == "probable_waste"
        )

        results.append({
            "threshold_min": t,
            "probable_waste_rooms": [
                s["room_id"] for s in states if s["status"] == "probable_waste"
            ],
            "total_kwh_low_estimate": round(total_kwh_low, 3),
            "total_kwh_high_estimate": round(total_kwh_high, 3),
            "note": "ESTIMATE under stated assumptions, not a measured saving",
        })

    return results


# -----------------------------------------------------------------------
# Endpoint: POST /reset
# -----------------------------------------------------------------------

@app.post("/reset", summary="Clear all stored observations (use before each demo run)")
def post_reset():
    """
    Wipe every room's history so we can run the simulator fresh.
    Clears engine.observations[room_id] for every known room.
    """
    for room_id in engine.observations:
        engine.observations[room_id].clear()   # clear the list in-place
    return {"reset": True, "rooms_cleared": list(engine.observations.keys())}
