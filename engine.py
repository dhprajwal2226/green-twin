from datetime import datetime

# ---- ASSUMPTIONS: placeholders, replace with cited values before presenting ----
TARIFF_INR_PER_KWH = 8.0     # illustrative, NOT a real tariff
EMISSION_KG_PER_KWH = 0.7    # illustrative, check the official grid factor
POWER_LOW = 0.6              # real draw may be 60% of rated power...
POWER_HIGH = 1.0             # ...up to 100%, so we give a range
CONF_MIN = 0.6               # readings below this confidence are not trusted
MIN_OBS = 3                  # need at least this many readings to judge a room
# --------------------------------------------------------------------------------

# The "building": rated light power (watts) and booked hours (start, end) per room
ROOMS = {
    "R204": {"name": "Lab 204",   "light_watts": 360, "schedule": [(9, 11)]},
    "R205": {"name": "Class 205", "light_watts": 240, "schedule": [(9, 11)]},
    "R206": {"name": "Hall 206",  "light_watts": 480, "schedule": [(14, 16)]},
}

# Memory of every reading the camera/simulator has sent, per room
observations = {room_id: [] for room_id in ROOMS}


def add_observation(obs):
    """Store one reading: people count, confidence, light on/off."""
    observations[obs["room_id"]].append(obs)


def to_time(obs):
    """Turn the text timestamp into a real time we can subtract."""
    return datetime.fromisoformat(obs["ts"])


def room_state(room_id, threshold_min=15):
    """Decide the status of one room and estimate the avoidable energy."""
    room = ROOMS[room_id]
    history = observations[room_id]
    base = {"room_id": room_id, "name": room["name"]}

    # Rule 1: too little or untrustworthy data -> do not make a claim
    if len(history) < MIN_OBS or history[-1]["confidence"] < CONF_MIN:
        return {**base, "status": "needs_verification",
                "evidence": ["low confidence or too few readings"],
                "priority": 0, "kwh": 0}

    latest = history[-1]
    now = to_time(latest)

    # Last time a person was seen in a trusted reading
    seen = [o for o in history
            if o["person_count"] > 0 and o["confidence"] >= CONF_MIN]
    last_seen = to_time(seen[-1]) if seen else to_time(history[0])
    vacant_min = (now - last_seen).total_seconds() / 60

    light_on = latest["light_on"]
    scheduled = any(start <= now.hour < end for start, end in room["schedule"])

    # Rule 2: classify the room
    if vacant_min == 0 or not light_on:
        status, evidence = "ok", ["room in use or light off"]
    elif scheduled:
        status, evidence = "reserved_vacant", ["vacant but booked, do not auto-flag"]
    elif vacant_min >= threshold_min:
        status = "probable_waste"
        evidence = [f"no person for {vacant_min:.0f} min", "light on"]
    else:
        status = "watching"
        evidence = [f"vacant {vacant_min:.0f} min, below {threshold_min} min threshold"]

    # Rule 3: avoidable energy = rated kW x hours beyond the threshold.
    # This is an ESTIMATE under assumptions, never a measurement.
    hours = max(0, vacant_min - threshold_min) / 60 if status == "probable_waste" else 0
    kw = room["light_watts"] / 1000
    kwh_high = kw * hours * POWER_HIGH
    kwh_low = kw * hours * POWER_LOW
    conf = latest["confidence"]

    return {**base,
            "status": status,
            "vacant_min": round(vacant_min),
            "confidence": conf,
            "evidence": evidence,
            "kwh_low": round(kwh_low, 3),
            "kwh_high": round(kwh_high, 3),
            "cost_inr": round(kwh_high * TARIFF_INR_PER_KWH, 2),
            "co2_kg": round(kwh_high * EMISSION_KG_PER_KWH, 3),
            "priority": round(kwh_high * conf, 3)}   # impact x confidence


def twin(threshold_min=15):
    """The Digital Twin view: the state of every room."""
    return [room_state(room_id, threshold_min) for room_id in ROOMS]


def recommendations(threshold_min=15):
    """Rooms flagged as probable waste, biggest priority first."""
    flagged = [s for s in twin(threshold_min) if s["status"] == "probable_waste"]
    return sorted(flagged, key=lambda s: s["priority"], reverse=True)


def whatif(thresholds=(5, 15, 30, 60)):
    """Compare policies: switch lights off after N minutes of vacancy."""
    results = []
    for t in thresholds:
        flagged = [s for s in twin(t) if s["status"] == "probable_waste"]
        results.append({
            "threshold_min": t,
            "rooms_flagged": len(flagged),
            "kwh_low": round(sum(r["kwh_low"] for r in flagged), 3),
            "kwh_high": round(sum(r["kwh_high"] for r in flagged), 3),
            "cost_inr": round(sum(r["cost_inr"] for r in flagged), 2),
            "co2_kg": round(sum(r["co2_kg"] for r in flagged), 3),
        })
    return results


# ------------------------------ tests ------------------------------
def feed(room_id, hour, minutes, count, conf, light):
    for m in minutes:
        add_observation({"room_id": room_id,
                         "ts": f"2026-10-15T{hour:02d}:{m:02d}:00",
                         "person_count": count, "confidence": conf,
                         "light_on": light})


if __name__ == "__main__":
    # 1. Seen at 12:00, then empty with light on until 12:25 -> probable waste
    feed("R204", 12, [0], 2, 0.9, True)
    feed("R204", 12, [10, 20, 25], 0, 0.9, True)
    assert room_state("R204")["status"] == "probable_waste"

    # 2. Low-confidence readings -> never a strong claim
    feed("R205", 15, [0, 10, 20], 0, 0.3, True)
    assert room_state("R205")["status"] == "needs_verification"

    # 3. Empty but booked (14:00-16:00) -> not flagged
    feed("R206", 14, [0], 3, 0.9, True)
    feed("R206", 14, [10, 20, 30], 0, 0.9, True)
    assert room_state("R206")["status"] == "reserved_vacant"

    # 4. What-if: shorter threshold -> more avoidable energy
    w = whatif()
    assert w[0]["kwh_high"] == 0.12      # 5 min:  20 min x 0.36 kW
    assert w[1]["kwh_high"] == 0.06      # 15 min: 10 min x 0.36 kW
    assert w[2]["rooms_flagged"] == 0    # 30 min: room only vacant 25 min

    print(room_state("R204"))
    print("Recommendations:", [r["room_id"] for r in recommendations()])
    for row in whatif():
        print(row)
    print("all tests passed")