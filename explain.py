"""
explain.py - Digital Twin Room Explanation Service (FastAPI APIRouter)

Part of Track 4 (Green Building Digital Twin) - DSU Code Clash 2.0.
Responsible for:
- Querying room state from Teammate B's engine (engine.room_state).
- Generating plain-language explanations using Google Gemini (google-genai SDK).
- Gracefully falling back to rule-based templates if the Gemini API key is missing,
  rate-limited, or when working offline.
"""

import json
import logging
import os
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Query

# Load environment variables from .env file (if present)
load_dotenv()

# Set up logging for fallback tracing and diagnostics
logger = logging.getLogger("explain_router")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

# Router instance required by the system spec.
# Teammate B includes this in main.py via:
#   from explain import router as explain_router
#   app.include_router(explain_router)
router = APIRouter(tags=["explain"])

# Attempt to import engine created by Teammate B
try:
    import engine
except ImportError:
    logger.warning("engine.py not found in Python path; standalone fallback active.")
    engine = None

# Known fallback sample rooms used ONLY if engine.py is not yet available during standalone testing
_STANDALONE_FALLBACK_ROOMS: Dict[str, Dict[str, Any]] = {
    "R204": {
        "room_id": "R204",
        "name": "Lab 204",
        "status": "probable_waste",
        "vacant_min": 25,
        "confidence": 0.9,
        "evidence": ["no person for 25 min", "light on"],
        "kwh_low": 0.036,
        "kwh_high": 0.06,
        "cost_inr": 0.48,
        "co2_kg": 0.042,
        "priority": 0.054,
    },
    "R205": {
        "room_id": "R205",
        "name": "Class 205",
        "status": "needs_verification",
        "evidence": ["light sensor active", "inconclusive PIR count"],
        "priority": 0.032,
        "kwh": 0.045,
    },
    "R206": {
        "room_id": "R206",
        "name": "Hall 206",
        "status": "reserved_vacant",
        "vacant_min": 10,
        "confidence": 0.95,
        "evidence": ["calendar reserved 11:00-12:00", "no occupancy detected", "fixtures in standby"],
        "kwh_low": 0.0,
        "kwh_high": 0.0,
        "cost_inr": 0.0,
        "co2_kg": 0.0,
        "priority": 0.0,
    },
}


def build_template_explanation(room: Dict[str, Any]) -> str:
    """
    Builds a reliable, 3 to 4 sentence plain English explanation from the validated room dict.
    Guaranteed to work across ALL statuses, including 'needs_verification' which has
    fewer fields (only room_id, name, status, evidence, priority, kwh).

    Ensures no invented figures and clearly states that figures are estimates under
    assumptions, not physical meter measurements.
    """
    room_id = room.get("room_id", "Unknown Room")
    name = room.get("name", room_id)
    status = str(room.get("status", "unknown")).lower()
    evidence_list = room.get("evidence", [])
    evidence_str = "; ".join(str(e) for e in evidence_list) if evidence_list else "no direct evidence recorded"

    # Safely extract optional fields
    vacant_min = room.get("vacant_min")
    confidence = room.get("confidence")
    kwh_low = room.get("kwh_low")
    kwh_high = room.get("kwh_high")
    cost_inr = room.get("cost_inr")
    co2_kg = room.get("co2_kg")
    priority = room.get("priority")
    single_kwh = room.get("kwh")

    # Format confidence percentage string
    if confidence is not None:
        try:
            c_val = float(confidence)
            conf_str = f"{c_val * 100:.0f}%" if c_val <= 1.0 else f"{c_val:.0f}%"
        except (ValueError, TypeError):
            conf_str = f"{confidence}"
    else:
        conf_str = "unspecified"

    # Format energy and cost phrase
    if kwh_low is not None and kwh_high is not None and (kwh_low > 0 or kwh_high > 0):
        energy_phrase = f"{kwh_low:.3f} to {kwh_high:.3f} kWh"
        cost_phrase = f" (approx. Rs {cost_inr:.2f} and {co2_kg:.3f} kg CO2)" if (cost_inr is not None and co2_kg is not None) else ""
        est_str = f"{energy_phrase}{cost_phrase}"
    elif single_kwh is not None and float(single_kwh) > 0:
        est_str = f"{float(single_kwh):.3f} kWh"
    else:
        est_str = "0.000 kWh"

    # Build status-specific 3-4 sentence response
    if status == "probable_waste":
        vacant_desc = f"unoccupied for approximately {vacant_min} minutes" if vacant_min is not None else "unoccupied"
        sentence_1 = f"In {name} ({room_id}), lighting appears active while the space has been {vacant_desc}, supported by observed evidence: {evidence_str}."
        sentence_2 = f"The digital twin calculates a detection confidence of {conf_str} from real-time occupancy sensor feeds."
        sentence_3 = f"The estimated avoidable energy is {est_str}, calculated under rated power and idle-time assumptions rather than direct meter measurements."
        sentence_4 = "Facility managers are advised to verify the room on site and switch off idle fixtures or reconfigure schedules."
        return f"{sentence_1} {sentence_2} {sentence_3} {sentence_4}"

    elif status == "needs_verification":
        sentence_1 = f"In {name} ({room_id}), sensor telemetry reported conflicting or incomplete occupancy evidence ({evidence_str})."
        sentence_2 = "Confidence cannot be definitively established due to partial or ambiguous sensor inputs."
        sentence_3 = f"The baseline avoidable energy estimate is {est_str} under nominal idle load assumptions, not a verified meter reading."
        sentence_4 = "A physical walk-through is recommended to inspect actual room occupancy and check sensor placement."
        return f"{sentence_1} {sentence_2} {sentence_3} {sentence_4}"

    elif status == "booking_unused":
        sentence_1 = f"In {name} ({room_id}), a booking exists but no occupancy was detected (evidence: {evidence_str})."
        sentence_2 = f"The system reports {conf_str} confidence in this reading."
        sentence_3 = f"The estimated avoidable energy is {est_str}, calculated under stated assumptions rather than direct meter measurements."
        sentence_4 = "Facility staff should verify on site whether the booking was actually used before switching anything off."
        return f"{sentence_1} {sentence_2} {sentence_3} {sentence_4}"

    elif status in ("reserved_vacant", "reserved"):
        sentence_1 = f"In {name} ({room_id}), a calendar reservation is active but no physical occupants are detected (evidence: {evidence_str})."
        sentence_2 = f"The system has {conf_str} confidence that the space is currently unoccupied."
        sentence_3 = f"Avoidable energy draw is evaluated as {est_str} assuming baseline setback or standby fixtures."
        sentence_4 = "Facility staff should confirm if the booking has concluded early and ensure lights are not left running unnecessarily."
        return f"{sentence_1} {sentence_2} {sentence_3} {sentence_4}"

    elif status == "watching":
        vacant_desc = f"{vacant_min} minutes" if vacant_min is not None else "a brief duration"
        sentence_1 = f"In {name} ({room_id}), the room has been vacant for {vacant_desc}, which remains below the policy threshold for actionable waste (evidence: {evidence_str})."
        sentence_2 = f"The system reports {conf_str} confidence and keeps the space under active observation."
        sentence_3 = f"Estimated avoidable energy remains at {est_str} under stated assumptions until the idle threshold is exceeded."
        sentence_4 = "No immediate physical action is needed; continue monitoring room telemetry."
        return f"{sentence_1} {sentence_2} {sentence_3} {sentence_4}"

    elif status == "ok":
        sentence_1 = f"In {name} ({room_id}), space utilization and lighting were observed to be operating normally (evidence: {evidence_str})."
        sentence_2 = f"The system reports {conf_str} confidence in normal room operation."
        sentence_3 = f"Estimated avoidable energy draw is {est_str} under current operational parameters."
        sentence_4 = "No facility intervention is required at this time."
        return f"{sentence_1} {sentence_2} {sentence_3} {sentence_4}"

    else:
        sentence_1 = f"In {name} ({room_id}), current operational telemetry reported status '{status}' with evidence: {evidence_str}."
        sentence_2 = f"Detection confidence is {conf_str} based on available sensor inputs."
        sentence_3 = f"Avoidable energy impact is estimated at {est_str} under stated baseline assumptions, not a physical measurement."
        sentence_4 = "Facility managers should perform an on-site check to verify conditions."
        return f"{sentence_1} {sentence_2} {sentence_3} {sentence_4}"


def call_gemini_api(room: Dict[str, Any], api_key: str, model_name: str) -> str:
    """
    Invokes the Google Gemini API using the google-genai SDK.
    Passes ONLY the validated room dictionary and exact prompt guidelines.
    """
    from google import genai

    client = genai.Client(api_key=api_key)

    prompt = (
        "You are assisting a facility manager. Using ONLY the JSON below, "
        "explain in 3 to 4 plain sentences what was observed, how confident the system "
        "is, the estimated avoidable energy (state it is an estimate under assumptions, "
        "not a measurement), and one suggested next step such as verifying on site. Do "
        "not invent any numbers, rooms or facts not in the JSON.\n\n"
        f"{json.dumps(room, indent=2)}"
    )

    response = client.models.generate_content(
        model=model_name,
        contents=prompt,
    )

    if response and getattr(response, "text", None):
        return response.text.strip()

    raise ValueError("Gemini API returned an empty or invalid response.")


@router.get("/explain/{room_id}")
def explain_room(
    room_id: str,
    threshold: int = Query(default=15, ge=1, le=180, description="Inactivity threshold in minutes"),
) -> Dict[str, Any]:
    """
    GET /explain/{room_id}?threshold=15
    - Queries Teammate B's engine.room_state(room_id, threshold).
    - If unknown room id -> returns HTTP 404.
    - Sends ONLY that validated room dict to Gemini API.
    - If GEMINI_API_KEY is missing, call fails, or offline -> falls back to rule template.
    - Returns JSON: {"room_id": ..., "explanation": ..., "source": "gemini"|"template"}
    """
    room_data: Optional[Dict[str, Any]] = None

    # 1. Fetch room state from engine (owned by Teammate B)
    if engine is not None and hasattr(engine, "room_state"):
        try:
            room_data = engine.room_state(room_id, threshold)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"Room '{room_id}' not found")
        except Exception as exc:
            err = str(exc).lower()
            if "not found" in err or "unknown" in err:
                raise HTTPException(status_code=404, detail=f"Room '{room_id}' not found")
            logger.error("Engine error for room %s: %s", room_id, exc)
            raise HTTPException(status_code=500, detail=f"Error querying engine: {exc}")
    else:
        # Standalone development fallback when engine.py is not yet loaded
        if room_id in _STANDALONE_FALLBACK_ROOMS:
            room_data = _STANDALONE_FALLBACK_ROOMS[room_id]
        else:
            raise HTTPException(
                status_code=404,
                detail=f"Room '{room_id}' not found (standalone mode; known: {list(_STANDALONE_FALLBACK_ROOMS.keys())})",
            )

    # 2. Validate room_data presence
    if not room_data:
        raise HTTPException(status_code=404, detail=f"Room '{room_id}' not found")

    # 3. Read environment configuration
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"

    # 4. Attempt Gemini GenAI explanation if API key is provided
    if api_key:
        try:
            logger.info("Requesting Gemini explanation for room %s with model %s", room_id, model_name)
            explanation_text = call_gemini_api(room_data, api_key=api_key, model_name=model_name)
            return {
                "room_id": room_id,
                "explanation": explanation_text,
                "source": "gemini",
            }
        except Exception as err:
            logger.warning("Gemini API call failed for room %s; triggering template fallback: %s", room_id, err)

    # 5. Fallback: generate high-fidelity template explanation
    logger.info("Using template explanation for room %s", room_id)
    template_text = build_template_explanation(room_data)
    return {
        "room_id": room_id,
        "explanation": template_text,
        "source": "template",
    }
