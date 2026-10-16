# validate.py
# Automated validation runner for the Green Twin Digital Twin API.
# Replays all test scenarios (A-F + error cases) against the live API,
# verifies the exact responses, prints a markdown validation table,
# and saves it to validation_table.md.
#
# Exit code: 0 if ALL checks pass, non-zero (1) if any check fails.

import sys
import os
import requests

# Re-use helpers and scenario definitions from simulator.py to keep
# a single source of truth across the codebase.
from simulator import (
    API,
    reset,
    scenario_d,
    scenario_a,
    scenario_b,
    scenario_c,
    scenario_e,
    scenario_f,
    record_action,
)


def check_server_running():
    """
    Check if the API server is reachable before attempting the test run.
    Provides a clear, friendly error message if it is not running.
    """
    try:
        r = requests.get(f"{API}/twin", timeout=3)
        r.raise_for_status()
    except requests.exceptions.ConnectionError:
        print("\n[ERROR] Cannot reach the Green Twin API server at " + API)
        print("Please ensure the server is running in another terminal:")
        print("    python -m uvicorn main:app --port 8000\n")
        sys.exit(1)
    except Exception as e:
        print(f"\n[ERROR] Unexpected error connecting to {API}: {e}\n")
        sys.exit(1)


def get_twin_rooms():
    """Fetch current room states from GET /twin."""
    r = requests.get(f"{API}/twin", timeout=5)
    r.raise_for_status()
    return {room["room_id"]: room for room in r.json()}


def get_ledger_entries():
    """Fetch current action ledger entries from GET /ledger."""
    r = requests.get(f"{API}/ledger", timeout=5)
    r.raise_for_status()
    return r.json()


def run_validation():
    """
    Executes the full test pipeline:
      1. Reset state (clean slate)
      2. Run Scenario D (brief absence on R204 at 11:15-11:25) -> verify 'ok'
      3. Run Scenarios A, B, C, E
      4. Verify /twin room statuses and /queue
      5. Test validation error paths (unknown room, no open issue)
      6. Record action on R204 (12:30)
      7. Run Scenario F (R204 light off at 12:35) -> verify /ledger
      8. Compile and return results table
    """
    rows = []

    # 1. Reset state
    print("[1/6] Resetting engine state via POST /reset...")
    reset()

    # 2. Scenario D: Brief absence
    print("[2/6] Running Scenario D (brief absence)...")
    scenario_d()
    rooms_d = get_twin_rooms()
    r204_d = rooms_d.get("R204", {})
    d_status = r204_d.get("status")
    d_pass = (d_status == "ok")
    rows.append({
        "scenario": "D",
        "tests": "R204 brief absence (5 min)",
        "expected": "status: ok",
        "actual": f"status: {d_status}",
        "result": "PASS" if d_pass else "FAIL"
    })

    # 3. Scenarios A, B, C, E
    print("[3/6] Running Scenarios A, B, C, E...")
    scenario_a()
    scenario_b()
    scenario_c()
    scenario_e()

    # Query /twin and check results
    rooms = get_twin_rooms()

    # Scenario A: R204 probable_waste
    r204_a = rooms.get("R204", {})
    a_status = r204_a.get("status")
    a_pass = (a_status == "probable_waste")
    rows.append({
        "scenario": "A",
        "tests": "R204 vacant 25 min, light on, booked 9-11 reading 12:xx",
        "expected": "status: probable_waste",
        "actual": f"status: {a_status}",
        "result": "PASS" if a_pass else "FAIL"
    })

    # Scenario B: R205 needs_verification (conf 0.3, no kWh claimed)
    r205_b = rooms.get("R205", {})
    b_status = r205_b.get("status")
    b_kwh = r205_b.get("kwh", 0)
    b_pass = (b_status == "needs_verification" and b_kwh == 0)
    rows.append({
        "scenario": "B",
        "tests": "R205 confidence 0.3 (below 0.6 threshold)",
        "expected": "status: needs_verification, kwh: 0",
        "actual": f"status: {b_status}, kwh: {b_kwh}",
        "result": "PASS" if b_pass else "FAIL"
    })

    # Scenario C: R206 reserved_vacant (booked slot, person was seen)
    r206_c = rooms.get("R206", {})
    c_status = r206_c.get("status")
    c_pass = (c_status == "reserved_vacant")
    rows.append({
        "scenario": "C",
        "tests": "R206 booked 14-16, person seen at start, now empty",
        "expected": "status: reserved_vacant",
        "actual": f"status: {c_status}",
        "result": "PASS" if c_pass else "FAIL"
    })

    # Scenario E: R207 booking_unused (booked slot, nobody seen >=20 min)
    r207_e = rooms.get("R207", {})
    e_status = r207_e.get("status")
    e_pass = (e_status == "booking_unused")
    rows.append({
        "scenario": "E",
        "tests": "R207 booked 9-11, nobody seen 25 min, light on",
        "expected": "status: booking_unused",
        "actual": f"status: {e_status}",
        "result": "PASS" if e_pass else "FAIL"
    })

    # 4. Extra error paths
    print("[4/6] Testing error paths (unknown room & no open issue)...")
    # Unknown room error check
    r_unknown = requests.post(
        f"{API}/ledger/action",
        json={"room_id": "R999", "action": "test", "ts": "2026-10-15T12:00:00"},
        timeout=5
    )
    err_unknown_pass = (r_unknown.status_code == 400)
    rows.append({
        "scenario": "Extra 1",
        "tests": "POST /ledger/action with unknown room R999",
        "expected": "HTTP 400",
        "actual": f"HTTP {r_unknown.status_code}",
        "result": "PASS" if err_unknown_pass else "FAIL"
    })

    # Room with no open issue check
    r_no_issue = requests.post(
        f"{API}/ledger/action",
        json={"room_id": "R206", "action": "test", "ts": "2026-10-15T14:35:00"},
        timeout=5
    )
    err_no_issue_pass = (r_no_issue.status_code == 400)
    rows.append({
        "scenario": "Extra 2",
        "tests": "POST /ledger/action on R206 (no open issue)",
        "expected": "HTTP 400",
        "actual": f"HTTP {r_no_issue.status_code}",
        "result": "PASS" if err_no_issue_pass else "FAIL"
    })

    # 5. Record action on R204 and run Scenario F
    print("[5/6] Recording action on R204 and running Scenario F...")
    record_action("R204", "switched_off", "2026-10-15T12:30:00")
    scenario_f()

    # 6. Verify Scenario F in /ledger
    print("[6/6] Verifying Scenario F in /ledger...")
    ledger_entries = get_ledger_entries()
    r204_ledger = None
    for entry in ledger_entries:
        if entry.get("room_id") == "R204":
            r204_ledger = entry
            break

    if r204_ledger:
        f_status = r204_ledger.get("status")
        f_evidence = r204_ledger.get("evidence_status")
        f_verified = r204_ledger.get("savings_verified")
        f_pass = (
            f_status == "response_observed"
            and f_evidence == "observed"
            and f_verified is False
        )
        f_actual = f"status: {f_status}, evidence: {f_evidence}, savings_verified: {f_verified}"
    else:
        f_pass = False
        f_actual = "No ledger entry found for R204"

    rows.append({
        "scenario": "F",
        "tests": "R204 action recorded, then trusted reading with light off",
        "expected": "status: response_observed, evidence: observed, savings_verified: False",
        "actual": f_actual,
        "result": "PASS" if f_pass else "FAIL"
    })

    return rows


def format_markdown_table(rows):
    """
    Format list of row dicts into a standard GitHub Flavored Markdown table.
    """
    headers = ["Scenario", "What it tests", "Expected", "Actual", "Result"]
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |"
    ]
    for r in rows:
        lines.append(f"| {r['scenario']} | {r['tests']} | {r['expected']} | {r['actual']} | {r['result']} |")
    return "\n".join(lines)


def main():
    check_server_running()

    rows = run_validation()
    table_md = format_markdown_table(rows)

    print("\n" + "=" * 80)
    print("VALIDATION SUMMARY TABLE")
    print("=" * 80)
    print(table_md)
    print("=" * 80 + "\n")

    # Save to validation_table.md
    out_path = os.path.join(os.path.dirname(__file__), "validation_table.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("# Green Twin Validation Results\n\n")
        f.write(table_md)
        f.write("\n")
    print(f"[OK] Table saved to {out_path}")

    # Check overall success
    all_passed = all(r["result"] == "PASS" for r in rows)
    if all_passed:
        print("\n[PASS] All validation tests passed successfully.\n")
        sys.exit(0)
    else:
        print("\n[FAIL] One or more validation tests failed.\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
