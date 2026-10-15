from datetime import datetime

# ---- ASSUMPTIONS ----
# TARIFF: PLACEHOLDER. Replace with the energy charge (Rs/unit) from the college's
# electricity bill or the KERC tariff order for the correct category.
TARIFF_INR_PER_KWH = 8.0
# CO2: CEA CO2 Baseline Database v21.0, all-India weighted average, FY 2024-25
# = 0.710 tCO2/MWh = 0.710 kg CO2/kWh (marked provisional in v21; check v22).
# https://cea.nic.in/wp-content/uploads/baseline/2025/12/User_Guide_V_21.0.pdf
EMISSION_KG_PER_KWH = 0.710
POWER_LOW = 0.6                # real draw may be 60% of rated power...
POWER_HIGH = 1.0               # ...up to 100%, so we give a range
CONF_MIN = 0.6                 # readings below this confidence are not trusted
MIN_OBS = 3                    # need at least this many readings to judge a room
INCIDENTS_PER_DAY = 3          # ASSUMPTION: how often a flagged room repeats this per day
WORKING_DAYS_PER_MONTH = 26    # ASSUMPTION: days per month the pattern applies
PHANTOM_MIN = 20               # ASSUMPTION: booked, nobody seen this long into the slot -> unused booking
# ASSUMPTION: effort to act on each issue type (label, weight). Higher weight = ranked lower.
EFFORT = {
    "probable_waste":     ("low", 1.0),
    "booking_unused":     ("medium", 1.5),
    "needs_verification": ("medium", 1.5),
}
RECURRENCE_STEP = 0.25         # ASSUMPTION: each repeat of an issue raises its score by 25%...
RECURRENCE_CAP = 4             # ...up to 4 repeats
# ---------------------

# The "building": rated light power (watts) and booked hours (start, end) per room
ROOMS = {
    "R204": {"name": "Lab 204",     "light_watts": 360, "schedule": [(9, 11)]},
    "R205": {"name": "Class 205",   "light_watts": 240, "schedule": [(9, 11)]},
    "R206": {"name": "Hall 206",    "light_watts": 480, "schedule": [(14, 16)]},
    "R207": {"name": "Seminar 207", "light_watts": 480, "schedule": [(9, 11)]},
}

# Memory of every reading the camera/simulator has sent, per room
observations = {room_id: [] for room_id in ROOMS}

# The evidence ledger: one entry per issue, tracked from detection to observed response
ledger = []
OPEN = ("detected", "recommended", "action_taken")
FLAGGED = ("probable_waste", "booking_unused")


def reset():
    """Clear all readings and the ledger (used by the simulator / tests)."""
    for readings in observations.values():
        readings.clear()
    ledger.clear()


def add_observation(obs):
    """Store one reading: people count, confidence, light on/off."""
    observations[obs["room_id"]].append(obs)


def to_time(obs):
    """Turn the text timestamp into a real time we can subtract."""
    return datetime.fromisoformat(obs["ts"])


def _slot_start(room, now):
    """Start time of the booking slot that contains 'now' (None if not booked)."""
    for start, end in room["schedule"]:
        if start <= now.hour < end:
            return now.replace(hour=start, minute=0, second=0, microsecond=0)
    return None


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
    slot_start = _slot_start(room, now)

    # Rule 2: classify the room
    if vacant_min == 0 or not light_on:
        status, evidence = "ok", ["room in use or light off"]
    elif slot_start is not None:
        # Room is booked right now. Was anyone trusted-seen since the slot began?
        seen_in_slot = any(to_time(o) >= slot_start for o in seen)
        into_slot = (now - slot_start).total_seconds() / 60
        if not seen_in_slot and into_slot >= PHANTOM_MIN:
            status = "booking_unused"
            evidence = [f"booked since {slot_start:%H:%M}, nobody seen for {into_slot:.0f} min",
                        "light on"]
        else:
            status, evidence = "reserved_vacant", ["vacant but booked, do not auto-flag"]
    elif vacant_min >= threshold_min:
        status = "probable_waste"
        evidence = [f"no person for {vacant_min:.0f} min", "light on"]
    else:
        status = "watching"
        evidence = [f"vacant {vacant_min:.0f} min, below {threshold_min} min threshold"]

    # Rule 3: avoidable energy = rated kW x hours beyond the threshold.
    # This is an ESTIMATE under assumptions, never a measurement.
    hours = max(0, vacant_min - threshold_min) / 60 if status in FLAGGED else 0
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
    """Rooms flagged as probable waste, biggest priority first (v1, kept for compatibility)."""
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


def monthly_projection(threshold_min=15):
    """Scale the current probable-waste findings to a month.
    ILLUSTRATIVE: assumes today's pattern repeats. Not a forecast, not a measurement."""
    flagged = [s for s in twin(threshold_min) if s["status"] == "probable_waste"]
    factor = INCIDENTS_PER_DAY * WORKING_DAYS_PER_MONTH
    return {
        "threshold_min": threshold_min,
        "rooms_flagged": len(flagged),
        "incidents_per_day": INCIDENTS_PER_DAY,
        "working_days": WORKING_DAYS_PER_MONTH,
        "kwh_low": round(sum(r["kwh_low"] for r in flagged) * factor, 3),
        "kwh_high": round(sum(r["kwh_high"] for r in flagged) * factor, 3),
        "cost_inr": round(sum(r["cost_inr"] for r in flagged) * factor, 2),
        "co2_kg": round(sum(r["co2_kg"] for r in flagged) * factor, 3),
        "note": "Illustrative projection under stated assumptions, not measured savings.",
    }


# ======================= EVIDENCE LEDGER =======================
# Every issue moves through: detected -> recommended -> action_taken -> response_observed.
# Savings are ALWAYS "estimated". We never mark savings as verified without a meter.

def _missing(status):
    """What evidence is still missing, given where the issue is in its life."""
    missing = ["no sub-meter reading of actual power draw",
               "rated power only; real draw assumed 60-100%",
               "no metered before/after comparison"]
    if status in ("detected", "recommended"):
        missing.insert(0, "no action taken yet")
    elif status == "action_taken":
        missing.insert(0, "no response observed after the action yet")
    return missing


def _open_entry(room_id):
    """The newest ledger entry for this room that is not finished yet."""
    for entry in reversed(ledger):
        if entry["room_id"] == room_id and entry["status"] in OPEN:
            return entry
    return None


def sync_ledger(threshold_min=15):
    """Bring the ledger up to date with the twin. Safe to call repeatedly."""
    # 1. Open a new entry for each flagged room that has none; refresh open estimates
    for s in twin(threshold_min):
        if s["status"] not in FLAGGED:
            continue
        entry = _open_entry(s["room_id"])
        if entry is None:
            prior = sum(1 for e in ledger if e["room_id"] == s["room_id"])
            ledger.append({
                "id": f"L{len(ledger) + 1}",
                "room_id": s["room_id"],
                "name": s["name"],
                "issue": s["status"],
                "detected_ts": observations[s["room_id"]][-1]["ts"],
                "status": "detected",
                "evidence_status": "estimated",
                "action": None, "action_ts": None,
                "response": None, "response_ts": None,
                "est_kwh_low": s["kwh_low"], "est_kwh_high": s["kwh_high"],
                "savings_verified": False,
                "recurrence": prior,
                "evidence_missing": _missing("detected"),
            })
        elif entry["status"] in ("detected", "recommended"):
            entry["est_kwh_low"], entry["est_kwh_high"] = s["kwh_low"], s["kwh_high"]
            entry["issue"] = s["status"]

    # 2. Did we SEE a response after a recorded action? (trusted reading, light now off)
    for entry in ledger:
        if entry["status"] != "action_taken":
            continue
        t0 = datetime.fromisoformat(entry["action_ts"])
        for o in observations[entry["room_id"]]:
            if to_time(o) > t0 and o["confidence"] >= CONF_MIN and not o["light_on"]:
                entry["status"] = "response_observed"
                entry["evidence_status"] = "observed"
                entry["response"] = "light observed off in a trusted reading"
                entry["response_ts"] = o["ts"]
                entry["evidence_missing"] = _missing("response_observed")
                break


def record_action(room_id, action, ts):
    """Record that a person acted on an issue (e.g. 'switched_off')."""
    if room_id not in ROOMS:
        raise ValueError(f"unknown room {room_id}")
    sync_ledger()
    entry = _open_entry(room_id)
    if entry is None:
        raise ValueError(f"no open issue for {room_id}")
    if entry["status"] == "action_taken":
        raise ValueError(f"action already recorded for {room_id}")
    entry["status"] = "action_taken"
    entry["action"] = action
    entry["action_ts"] = ts
    entry["evidence_missing"] = _missing("action_taken")
    sync_ledger()          # a response may already be visible in later readings
    return entry


def get_ledger(threshold_min=15):
    """All ledger entries (oldest first)."""
    sync_ledger(threshold_min)
    return list(ledger)


# ====================== FIX-FIRST PRIORITY QUEUE ======================
# score = avoidable kWh (high) x confidence x recurrence factor / effort weight.
# The weights are ASSUMPTIONS shown to the user; the queue explains each ranking.

def queue(threshold_min=15):
    """Ranked list of what to deal with first, and why."""
    sync_ledger(threshold_min)
    ranked, verify = [], []

    for s in twin(threshold_min):
        rid = s["room_id"]
        if s["status"] in FLAGGED:
            entry = _open_entry(rid)
            if entry["status"] == "detected":
                entry["status"] = "recommended"
                entry["evidence_missing"] = _missing("recommended")
            effort_label, weight = EFFORT[s["status"]]
            factor = 1 + RECURRENCE_STEP * min(entry["recurrence"], RECURRENCE_CAP)
            score = s["kwh_high"] * s["confidence"] * factor / weight
            if s["status"] == "probable_waste":
                action = f"Switch off lights in {s['name']} (confirm it is empty first)"
            else:
                action = f"Check with the booking owner, release the slot, switch off lights in {s['name']}"
            repeat = ("first occurrence" if entry["recurrence"] == 0
                      else f"repeat issue (seen {entry['recurrence']} time(s) before)")
            ranked.append({
                "room_id": rid, "name": s["name"], "status": s["status"],
                "action": action, "score": round(score, 4),
                "why": s["evidence"] + [
                    f"estimated avoidable {s['kwh_low']:.3f} to {s['kwh_high']:.3f} kWh (rated power x idle time)",
                    f"confidence {s['confidence']:.2f}", repeat, f"effort to act: {effort_label}"],
                "effort": effort_label,
                "evidence_status": entry["evidence_status"],
                "est_kwh_low": s["kwh_low"], "est_kwh_high": s["kwh_high"],
                "ledger_id": entry["id"],
            })
        elif s["status"] == "needs_verification" and observations[rid]:
            verify.append({
                "room_id": rid, "name": s["name"], "status": s["status"],
                "action": f"Verify on site: {s['name']} has low-confidence or too few readings",
                "score": 0, "why": s["evidence"] + ["no claim made until readings are trusted"],
                "effort": EFFORT["needs_verification"][0],
                "evidence_status": "unverified",
                "est_kwh_low": 0, "est_kwh_high": 0, "ledger_id": None,
            })

    ranked.sort(key=lambda item: item["score"], reverse=True)
    items = ranked + verify
    for i, item in enumerate(items, start=1):
        item["rank"] = i
    return items


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

    # 3. Empty but booked (14:00-16:00), someone seen at slot start -> not flagged
    feed("R206", 14, [0], 3, 0.9, True)
    feed("R206", 14, [10, 20, 30], 0, 0.9, True)
    assert room_state("R206")["status"] == "reserved_vacant"

    # 4. What-if: shorter threshold -> more avoidable energy
    w = whatif()
    assert w[0]["kwh_high"] == 0.12      # 5 min:  20 min x 0.36 kW
    assert w[1]["kwh_high"] == 0.06      # 15 min: 10 min x 0.36 kW
    assert w[2]["rooms_flagged"] == 0    # 30 min: room only vacant 25 min

    # 5. Monthly projection: 0.06 kWh x 3 incidents x 26 days = 4.68 kWh
    m = monthly_projection()
    assert m["kwh_high"] == 4.68
    assert m["kwh_low"] == 2.808

    # 6. CO2 uses the CEA factor: 0.06 kWh x 0.710 = 0.0426 kg -> 0.043
    assert room_state("R204")["co2_kg"] == 0.043

    # 7. NEW: booked 9-11, nobody ever seen, light on for 40 min -> booking_unused
    feed("R207", 9, [0, 10, 20, 30, 40], 0, 0.9, True)
    s7 = room_state("R207")
    assert s7["status"] == "booking_unused"
    assert s7["kwh_high"] == 0.2         # 25 min beyond threshold x 0.48 kW

    # 8. NEW: queue ranks by score; low-confidence room goes last as "verify"
    q = queue()
    assert [i["room_id"] for i in q] == ["R207", "R204", "R205"]
    assert q[0]["score"] == 0.12         # 0.2 x 0.9 / 1.5
    assert q[1]["score"] == 0.054        # 0.06 x 0.9 / 1.0
    assert q[2]["evidence_status"] == "unverified"

    # 9. NEW: ledger starts as "recommended", savings never verified
    l204 = [e for e in get_ledger() if e["room_id"] == "R204"][0]
    assert l204["status"] == "recommended" and l204["savings_verified"] is False

    # 10. NEW: record an action, then a trusted reading shows light off -> observed
    record_action("R204", "switched_off", "2026-10-15T12:30:00")
    assert [e for e in get_ledger() if e["room_id"] == "R204"][0]["status"] == "action_taken"
    feed("R204", 12, [35], 0, 0.9, False)
    l204 = [e for e in get_ledger() if e["room_id"] == "R204"][0]
    assert l204["status"] == "response_observed"
    assert l204["evidence_status"] == "observed"
    assert l204["savings_verified"] is False      # observed response is NOT metered savings

    # 11. NEW: no open issue -> clean error, not a crash
    try:
        record_action("R206", "switched_off", "2026-10-15T14:35:00")
        raise SystemExit("expected ValueError")
    except ValueError:
        pass

    print("QUEUE:")
    for item in queue():
        print(" ", item["rank"], item["room_id"], item["status"], item["score"], "|", item["action"])
    print("LEDGER:")
    for e in get_ledger():
        print(" ", e["id"], e["room_id"], e["status"], e["evidence_status"],
              (e["est_kwh_low"], e["est_kwh_high"]), "verified:", e["savings_verified"])
    print("all tests passed")