# Green Twin: room-level digital twin for lighting waste (DSU Code Clash 2.0, Track 4)

A privacy-first room-level digital twin that ranks energy-waste issues by what to fix first,
records what was done in an evidence ledger, and keeps estimated, observed and verified
savings strictly separate.

This is a prototype and decision-support tool. It is not a BMS replacement.
All energy, cost and CO2 figures are ESTIMATES under stated assumptions, never measured savings.

## What it does
- Takes occupancy readings per room (people count, confidence, light on/off).
- Classifies each room: ok, watching, probable_waste, reserved_vacant, booking_unused,
  needs_verification. Low-confidence rooms make no energy claim.
- Ranks issues in a "fix first" queue (estimated energy x confidence x recurrence / effort).
- Records each issue in an evidence ledger: detected, recommended, action_taken,
  response_observed. Savings are never marked verified without a meter.
- Explains a room in plain language (Gemini if a key is set, otherwise a rule template).
  The explanation only uses the engine's validated output.

## Run it
    pip install -r requirements.txt
    uvicorn main:app --port 8000
    python3 simulator.py
    cd dashboard && python3 -m http.server 5500
Open http://localhost:5500 (API docs: http://127.0.0.1:8000/docs).
Optional: copy .env.example to .env and set GEMINI_API_KEY. Without a key the template is used.

## API
POST /observation, GET /twin, /recommendations, /whatif, /queue, /ledger, /explain/{room_id},
POST /ledger/action, POST /reset.

## What we tested
simulator.py replays scenarios A to F against the live API and checks the results:
A probable_waste, B needs_verification (low confidence), C reserved_vacant, D brief absence not
flagged, E booking_unused, F ledger reaches response_observed with savings_verified = false.
Unknown room and no-open-issue requests return HTTP 400. All checks pass.

## Assumptions (labelled placeholders)
- Tariff Rs 8.0 per kWh: PLACEHOLDER, not a real tariff.
- CO2 factor 0.710 kg/kWh: CEA CO2 Baseline Database v21.0 all-India grid average FY 2024-25
  (provisional). We could not open the official PDF; the value comes from secondary excerpts.
  It is a grid average, not marginal or Karnataka-specific.
- Device draw 60-100% of rated power, 15 min idle threshold, phantom-booking limit 20 min,
  effort weights, recurrence step: our own assumptions, set in engine.py.

## Privacy by design
Only people counts are used. No face recognition, no identities. The camera counter
(cv_counter.py, YOLOv8n person class) is written not to save frames. It was NOT validated on
a real webcam during the event, so the demo uses simulated scenarios.

## Limitations
- Data in the demo is simulated; there is no real campus data and no sub-meter.
- The priority queue and ledger are served by the API (/queue, /ledger); the dashboard
  integration of those panels is incomplete.
- Estimates are tiny per incident; real impact needs a pilot with a sub-meter to compare.

## Pilot plan
One block, one sub-meter, four weeks: act on the ranked list, then compare our estimate with
the metered reading before deciding whether to scale.

## Team
Engine, API and dashboard built by our 3-person team during the event.
