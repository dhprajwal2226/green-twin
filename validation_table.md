# Green Twin Validation Results

| Scenario | What it tests | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| D | R204 brief absence (5 min) | status: ok | status: ok | PASS |
| A | R204 vacant 25 min, light on, booked 9-11 reading 12:xx | status: probable_waste | status: probable_waste | PASS |
| B | R205 confidence 0.3 (below 0.6 threshold) | status: needs_verification, kwh: 0 | status: needs_verification, kwh: 0 | PASS |
| C | R206 booked 14-16, person seen at start, now empty | status: reserved_vacant | status: reserved_vacant | PASS |
| E | R207 booked 9-11, nobody seen 25 min, light on | status: booking_unused | status: booking_unused | PASS |
| Extra 1 | POST /ledger/action with unknown room R999 | HTTP 400 | HTTP 400 | PASS |
| Extra 2 | POST /ledger/action on R206 (no open issue) | HTTP 400 | HTTP 400 | PASS |
| F | R204 action recorded, then trusted reading with light off | status: response_observed, evidence: observed, savings_verified: False | status: response_observed, evidence: observed, savings_verified: False | PASS |
