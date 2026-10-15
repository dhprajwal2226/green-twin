# simulator.py
# Scripted scenario runner for the Green Twin demo (api-cv branch).
# Posts fake-but-realistic observations to the local API.
# Use this as a live-demo fallback if the webcam/YOLO pipeline is unreliable.

import sys
import json
import requests  # pip install requests

API = "http://localhost:8000"  # default server address


# -----------------------------------------------------------------------
# Helper: post one observation and show a one-line summary
# -----------------------------------------------------------------------

def post_obs(room_id, ts, person_count, confidence, light_on):
    """
    Build an observation dict and POST it to /observation.
    Prints a short line so we can watch progress in the terminal.
    Raises SystemExit with a friendly message if the server is not running.
    """
    obs = {
        "room_id": room_id,
        "ts": ts,
        "person_count": person_count,
        "confidence": confidence,
        "light_on": light_on,
    }
    try:
        resp = requests.post(f"{API}/observation", json=obs, timeout=5)
        resp.raise_for_status()
        print(f"  [OK] {room_id} {ts}  persons={person_count}  conf={confidence}  light={light_on}")
    except requests.exceptions.ConnectionError:
        print("\n[ERROR] Cannot reach the API server.")
        print("   Start it first with:  python -m uvicorn main:app --reload --port 8000")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        # Show server's validation message (e.g. unknown room_id)
        print(f"  [FAIL] HTTP {e.response.status_code}: {e.response.text}")


def reset():
    """
    Clear all stored observations via POST /reset.
    Always called first so each simulator run starts clean.
    """
    try:
        r = requests.post(f"{API}/reset", timeout=5)
        r.raise_for_status()
        print("[OK] Reset -- all observations cleared\n")
    except requests.exceptions.ConnectionError:
        print("\n[ERROR] Cannot reach the API server.")
        print("   Start it first with:  python -m uvicorn main:app --reload --port 8000")
        sys.exit(1)


def print_twin():
    """
    GET /twin and pretty-print the JSON.
    Called at the end so we can verify all rooms at a glance.
    """
    r = requests.get(f"{API}/twin", timeout=5)
    r.raise_for_status()
    rooms = r.json()
    print("\n-- /twin result --------------------------------------------------")
    print(json.dumps(rooms, indent=2))
    print("------------------------------------------------------------------")
    return rooms


# -----------------------------------------------------------------------
# Scenario helpers - groups of readings that tell a story
# -----------------------------------------------------------------------

def scenario_a():
    """
    Scenario A - R204 (Lab 204, booked 9-11)
    Timeline: 12:00 two people arrive; 12:10/12:20/12:25 they leave, light stays on.
    Hour 12 is outside the booking window (9-11), so after 15 minutes vacant
    the engine should flag this as PROBABLE_WASTE.

    Expected status: probable_waste
    """
    print("Scenario A: R204 - probable_waste expected")
    post_obs("R204", "2026-10-15T12:00:00", 2, 0.9, True)   # people present
    post_obs("R204", "2026-10-15T12:10:00", 0, 0.9, True)   # left, light still on
    post_obs("R204", "2026-10-15T12:20:00", 0, 0.9, True)   # still empty
    post_obs("R204", "2026-10-15T12:25:00", 0, 0.9, True)   # 25 min vacant -> flag
    print()


def scenario_b():
    """
    Scenario B - R205 (Class 205)
    Three readings with confidence=0.3 (below CONF_MIN=0.6).
    Low-confidence sensor data -- the engine should refuse to make a claim.

    Expected status: needs_verification
    """
    print("Scenario B: R205 - needs_verification expected")
    post_obs("R205", "2026-10-15T12:00:00", 0, 0.3, True)
    post_obs("R205", "2026-10-15T12:10:00", 0, 0.3, True)
    post_obs("R205", "2026-10-15T12:20:00", 0, 0.3, True)
    print()


def scenario_c():
    """
    Scenario C - R206 (Hall 206, booked 14-16)
    Timeline: 14:00 three people; 14:10/14:20/14:30 empty, light on.
    Even though the room is vacant, it is still within its booked window,
    so the engine should NOT flag it as waste -- it's reserved_vacant.

    Expected status: reserved_vacant
    """
    print("Scenario C: R206 - reserved_vacant expected")
    post_obs("R206", "2026-10-15T14:00:00", 3, 0.9, True)   # people present
    post_obs("R206", "2026-10-15T14:10:00", 0, 0.9, True)   # empty but booked
    post_obs("R206", "2026-10-15T14:20:00", 0, 0.9, True)
    post_obs("R206", "2026-10-15T14:30:00", 0, 0.9, True)
    print()


def scenario_d():
    """
    Scenario D - R204 brief-absence test (uses R204 at hour 13)
    ----------------------------------------------------------------
    Why R204 at 13:xx?
      - Scenarios A-C use R204 at 12:xx, R205 at 12:xx, R206 at 14:xx.
      - We need a room that already has the engine aware of it (valid room_id),
        but a NEW set of timestamps that come AFTER scenario A so they are
        strictly increasing and do not disturb A's 12:25 final reading.
      - Hour 13 is outside R204's booking window (9-11), so there is no
        'reserved_vacant' protection, which means if the room WERE vacant
        long enough it would be flagged -- making this a true test that the
        engine correctly does NOT flag a brief absence.

    Timeline: 13:00 one person; 13:05 zero people (brief gap); 13:10 person back.
    The last trusted reading with a person (13:10) is the same as the latest
    reading, so vacant_min=0 -> engine says "ok", not probable_waste.

    Expected status: ok (NOT flagged)
    """
    print("Scenario D: R204 at 13:xx - brief absence, expect status=ok (not flagged)")
    post_obs("R204", "2026-10-15T13:00:00", 1, 0.9, True)   # person present
    post_obs("R204", "2026-10-15T13:05:00", 0, 0.9, True)   # briefly empty
    post_obs("R204", "2026-10-15T13:10:00", 1, 0.9, True)   # person came back
    print()

# -----------------------------------------------------------------------
# Main: run all scenarios then show the twin
# -----------------------------------------------------------------------

if __name__ == "__main__":
    print("=== Green Twin Simulator ===\n")

    # 1. Wipe any previous run so results are clean
    reset()

    # 2. Run scenarios A, B, C first.
    #    Timestamps are strictly increasing within each room, which matters
    #    because the engine uses timestamps to find when a person was last seen.
    scenario_a()
    scenario_b()
    scenario_c()

    # 3. Check intermediate state: A/B/C should show their expected statuses.
    #    We check NOW before scenario D alters R204's state.
    print("\n-- Intermediate /twin (after A, B, C) ----------------------------")
    r_abc = requests.get(f"{API}/twin", timeout=5).json()
    print(json.dumps(r_abc, indent=2))
    print("------------------------------------------------------------------\n")

    statuses_abc = {r["room_id"]: r["status"] for r in r_abc}
    checks_abc = {
        "R204": "probable_waste",
        "R205": "needs_verification",
        "R206": "reserved_vacant",
    }
    all_ok = True
    print("Phase A/B/C status check:")
    for room_id, expected in checks_abc.items():
        actual = statuses_abc.get(room_id, "?")
        icon = "[OK]" if actual == expected else "[FAIL]"
        print(f"  {icon} {room_id}: {actual}  (expected {expected})")
        if actual != expected:
            all_ok = False

    # 4. Now run scenario D (brief absence on R204 at hour 13).
    #    This overwrites R204's state -- the person returns, so it becomes "ok".
    print()
    scenario_d()

    # 5. Check D: R204 must now be "ok" (not flagged) because a person came back.
    r_d = requests.get(f"{API}/twin", timeout=5).json()
    statuses_d = {r["room_id"]: r["status"] for r in r_d}
    d_status = statuses_d.get("R204", "?")
    icon = "[OK]" if d_status == "ok" else "[FAIL]"
    print(f"Scenario D check:")
    print(f"  {icon} R204 after brief-absence: {d_status}  (expected ok)")
    if d_status != "ok":
        all_ok = False

    # 6. Print the FINAL /twin for judge presentation
    print()
    rooms = print_twin()

    print()
    if all_ok:
        print("[PASS] All scenarios passed -- twin is working correctly.")
    else:
        print("[WARN] One or more scenarios did not match expected status.")
        import sys
        sys.exit(1)
