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
    Clear all stored observations and ledger entries via POST /reset.
    Always called first so each simulator run starts clean.
    """
    try:
        r = requests.post(f"{API}/reset", timeout=5)
        r.raise_for_status()
        print("[OK] Reset -- all observations and ledger entries cleared\n")
    except requests.exceptions.ConnectionError:
        print("\n[ERROR] Cannot reach the API server.")
        print("   Start it first with:  python -m uvicorn main:app --reload --port 8000")
        sys.exit(1)


def print_twin():
    """
    GET /twin and pretty-print the JSON.
    Called so we can verify all rooms at a glance.
    """
    r = requests.get(f"{API}/twin", timeout=5)
    r.raise_for_status()
    rooms = r.json()
    print("\n-- /twin result --------------------------------------------------")
    print(json.dumps(rooms, indent=2))
    print("------------------------------------------------------------------")
    return rooms


def print_queue():
    """
    GET /queue?threshold=15 and pretty-print the ranked issue list.
    """
    r = requests.get(f"{API}/queue?threshold=15", timeout=5)
    r.raise_for_status()
    items = r.json()
    print("\n-- /queue result -------------------------------------------------")
    print(json.dumps(items, indent=2))
    print("------------------------------------------------------------------")
    return items


def record_action(room_id, action, ts):
    """
    POST /ledger/action to record a response action in the evidence ledger.
    """
    payload = {"room_id": room_id, "action": action, "ts": ts}
    r = requests.post(f"{API}/ledger/action", json=payload, timeout=5)
    r.raise_for_status()
    entry = r.json()
    print(f"\n[OK] Recorded action for {room_id}: '{action}' at {ts} -> ledger status: {entry.get('status')}")
    return entry


def print_ledger():
    """
    GET /ledger and pretty-print all evidence ledger entries.
    """
    r = requests.get(f"{API}/ledger", timeout=5)
    r.raise_for_status()
    entries = r.json()
    print("\n-- /ledger result ------------------------------------------------")
    print(json.dumps(entries, indent=2))
    print("------------------------------------------------------------------")
    return entries


# -----------------------------------------------------------------------
# Scenario helpers - groups of readings that tell a story
# -----------------------------------------------------------------------

def scenario_d():
    """
    Scenario D - R204 brief-absence test (run at 11:15-11:25)
    ----------------------------------------------------------------
    Why R204 at 11:15-11:25?
      - R204 is booked 9-11, so 11:15 is outside the booked window (no
        reserved_vacant masking).
      - Timeline: 11:15 one person; 11:20 zero people (5 min brief gap);
        11:25 person returns.
      - At 11:20 vacant_min=5 < 15 min threshold -> 'watching'
      - At 11:25 person back -> vacant_min=0 -> 'ok' (NOT flagged).
      - Running this before Scenario A (12:00) keeps timestamps strictly
        increasing (11:15 -> 11:20 -> 11:25 -> 12:00...) and leaves R204
        available for Scenario A to put it in 'probable_waste'.

    Expected status right after 11:25: ok (NOT flagged)
    """
    print("Scenario D: R204 at 11:xx - brief absence, expect status=ok (not flagged)")
    post_obs("R204", "2026-10-15T11:15:00", 1, 0.9, True)   # person present
    post_obs("R204", "2026-10-15T11:20:00", 0, 0.9, True)   # briefly empty
    post_obs("R204", "2026-10-15T11:25:00", 1, 0.9, True)   # person back
    print()


def scenario_a():
    """
    Scenario A - R204 (Lab 204, booked 9-11)
    Timeline: 12:00 two people; 12:10/12:20/12:25 zero people, light stays on.
    Hour 12 is outside booking window (9-11). After 25 min vacancy (>15 min threshold),
    the engine flags this as PROBABLE_WASTE.

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
    Low-confidence sensor data -- the engine refuses to make a strong claim.

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
    Timeline: 14:00 three people; 14:10/14:20/14:30 zero people, light on.
    Someone was seen at slot start (14:00), and the room is still within its
    booked window, so the engine does NOT flag it as waste -- it's reserved_vacant.

    Expected status: reserved_vacant
    """
    print("Scenario C: R206 - reserved_vacant expected")
    post_obs("R206", "2026-10-15T14:00:00", 3, 0.9, True)   # people present at start
    post_obs("R206", "2026-10-15T14:10:00", 0, 0.9, True)   # empty but booked
    post_obs("R206", "2026-10-15T14:20:00", 0, 0.9, True)
    post_obs("R206", "2026-10-15T14:30:00", 0, 0.9, True)
    print()


def scenario_e():
    """
    Scenario E (engine v2) - R207 (Seminar 207, booked 9-11)
    ----------------------------------------------------------------
    Why R207 at 09:00-09:25?
      - R207 is booked for the 09:00-11:00 slot.
      - We feed readings at 09:00, 09:10, 09:20, 09:25 with person_count=0,
        confidence=0.9, light_on=True.
      - At 09:25, into_slot = 25 min (>= PHANTOM_MIN of 20 min).
      - No trusted person was EVER seen since slot start, but lights are on.
      - The engine flags this as 'booking_unused' (phantom booking).

    Expected status: booking_unused
    """
    print("Scenario E (engine v2): R207 - booking_unused expected")
    post_obs("R207", "2026-10-15T09:00:00", 0, 0.9, True)
    post_obs("R207", "2026-10-15T09:10:00", 0, 0.9, True)
    post_obs("R207", "2026-10-15T09:20:00", 0, 0.9, True)
    post_obs("R207", "2026-10-15T09:25:00", 0, 0.9, True)
    print()


# -----------------------------------------------------------------------
# Main: run all scenarios, verify /twin, /queue, /ledger, and actions
# -----------------------------------------------------------------------

if __name__ == "__main__":
    print("=== Green Twin Simulator (engine v2) ===\n")

    # 1. Wipe any previous run so results are clean
    reset()

    # 2. Run Scenario D first to verify brief absence on R204 (11:15 - 11:25)
    scenario_d()
    r_d = requests.get(f"{API}/twin", timeout=5).json()
    d_status = {r["room_id"]: r["status"] for r in r_d}.get("R204")
    icon_d = "[OK]" if d_status == "ok" else "[FAIL]"
    print(f"Scenario D verification: {icon_d} R204 brief absence status: {d_status} (expected ok)\n")

    # 3. Run Scenarios A, B, C, and E (strictly increasing per room)
    scenario_a()
    scenario_b()
    scenario_c()
    scenario_e()

    # 4. Verify all 4 rooms in /twin
    rooms = print_twin()
    statuses = {r["room_id"]: r["status"] for r in rooms}
    checks = {
        "R204": "probable_waste",
        "R205": "needs_verification",
        "R206": "reserved_vacant",
        "R207": "booking_unused",
    }
    all_ok = (d_status == "ok")
    print("Room status verification (/twin):")
    for room_id, expected in checks.items():
        actual = statuses.get(room_id, "?")
        icon = "[OK]" if actual == expected else "[FAIL]"
        print(f"  {icon} {room_id}: {actual}  (expected {expected})")
        if actual != expected:
            all_ok = False

    # 5. Verify /queue
    queue_items = print_queue()
    print(f"\n[OK] Queue returned {len(queue_items)} ranked items")

    # 6. Verify POST /ledger/action with valid room (R204)
    action_entry = record_action("R204", "switched_off", "2026-10-15T12:30:00")

    # 7. Verify POST /ledger/action error paths (unknown room & no open issue) return HTTP 400
    try:
        bad_unknown = requests.post(
            f"{API}/ledger/action",
            json={"room_id": "R999", "action": "test", "ts": "2026-10-15T12:00:00"},
            timeout=5
        )
        if bad_unknown.status_code == 400:
            print(f"[OK] Unknown room 'R999' returned HTTP 400: {bad_unknown.json().get('detail')}")
        else:
            print(f"[FAIL] Expected HTTP 400 for unknown room, got {bad_unknown.status_code}")
            all_ok = False

        bad_no_issue = requests.post(
            f"{API}/ledger/action",
            json={"room_id": "R206", "action": "test", "ts": "2026-10-15T14:35:00"},
            timeout=5
        )
        if bad_no_issue.status_code == 400:
            print(f"[OK] Room with no open issue 'R206' returned HTTP 400: {bad_no_issue.json().get('detail')}")
        else:
            print(f"[FAIL] Expected HTTP 400 for room with no open issue, got {bad_no_issue.status_code}")
            all_ok = False
    except Exception as e:
        print(f"[FAIL] Error testing action error paths: {e}")
        all_ok = False

    # 8. Verify /ledger shows entries with status and evidence_missing
    ledger_entries = print_ledger()
    print(f"\n[OK] Ledger returned {len(ledger_entries)} entries")

    print()
    if all_ok:
        print("[PASS] All scenarios and engine v2 checks passed successfully.")
    else:
        print("[WARN] One or more checks failed.")
        sys.exit(1)
