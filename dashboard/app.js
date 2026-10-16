/**
 * Green Building Digital Twin - Dashboard Client Script
 * Track 4: DSU Code Clash 2.0
 * Teammate C (Dashboard & GenAI Explanation)
 */

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

// Switch between sample data and live backend API.
// Set to false for live integration with Teammate B's API at http://localhost:8000
const USE_SAMPLE = false;

// Backend API Base URL
const API_BASE = "http://localhost:8000";

// Polling interval in milliseconds (polling GET /twin every 2 seconds)
const POLL_INTERVAL_MS = 2000;

// Embedded sample data fallback: ensures the app NEVER crashes even when opened
// directly via file:// where fetch() may be blocked by browser file security.
const EMBEDDED_SAMPLE_ROOMS = [
  {
    room_id: "R204",
    name: "Lab 204",
    status: "probable_waste",
    vacant_min: 25,
    confidence: 0.9,
    evidence: ["no person for 25 min", "light on"],
    kwh_low: 0.036,
    kwh_high: 0.06,
    cost_inr: 0.48,
    co2_kg: 0.042,
    priority: 0.054
  },
  {
    room_id: "R205",
    name: "Class 205",
    status: "needs_verification",
    evidence: ["light sensor active", "inconclusive PIR count"],
    priority: 0.032,
    kwh: 0.045
  },
  {
    room_id: "R206",
    name: "Hall 206",
    status: "reserved_vacant",
    vacant_min: 10,
    confidence: 0.95,
    evidence: ["calendar reserved 11:00-12:00", "no occupancy detected", "fixtures in standby"],
    kwh_low: 0.0,
    kwh_high: 0.0,
    cost_inr: 0.0,
    co2_kg: 0.0,
    priority: 0.0
  },
  {
    room_id: "R207",
    name: "Seminar 207",
    status: "watching",
    vacant_min: 8,
    confidence: 0.85,
    evidence: ["no person for 8 min", "threshold 15 min not met", "lighting fixture engaged"],
    kwh_low: 0.0,
    kwh_high: 0.0,
    cost_inr: 0.0,
    co2_kg: 0.0,
    priority: 0.012
  },
  {
    room_id: "R208",
    name: "Office 208",
    status: "ok",
    vacant_min: 0,
    confidence: 0.98,
    evidence: ["2 persons detected", "scheduled occupancy active"],
    kwh_low: 0.0,
    kwh_high: 0.0,
    cost_inr: 0.0,
    co2_kg: 0.0,
    priority: 0.0
  }
];

const EMBEDDED_SAMPLE_WHATIF = [
  { threshold_min: 5, rooms_flagged: 3, kwh_low: 0.095, kwh_high: 0.160, cost_inr: 1.28, co2_kg: 0.112 },
  { threshold_min: 10, rooms_flagged: 2, kwh_low: 0.065, kwh_high: 0.110, cost_inr: 0.88, co2_kg: 0.077 },
  { threshold_min: 15, rooms_flagged: 1, kwh_low: 0.036, kwh_high: 0.060, cost_inr: 0.48, co2_kg: 0.042 },
  { threshold_min: 30, rooms_flagged: 0, kwh_low: 0.0, kwh_high: 0.0, cost_inr: 0.0, co2_kg: 0.0 },
  { threshold_min: 45, rooms_flagged: 0, kwh_low: 0.0, kwh_high: 0.0, cost_inr: 0.0, co2_kg: 0.0 },
  { threshold_min: 60, rooms_flagged: 0, kwh_low: 0.0, kwh_high: 0.0, cost_inr: 0.0, co2_kg: 0.0 }
];

// ============================================================================
// APPLICATION STATE
// ============================================================================

const state = {
  // Can be toggled interactively via UI button while preserving the constant default
  useSample: USE_SAMPLE,
  threshold: 15,
  rooms: [],
  recommendations: [],
  queue: [],
  ledger: [],
  whatifRows: [],
  selectedRoomId: null,
  isApiReachable: true,
  pollTimer: null,
  isExplaining: false,
  viewMode: "2d", // "2d" or "3d"
  explanations: {}, // Room-level GenAI explanation cache (room_id -> {text, source})
};

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const dom = {
  thresholdSlider: document.getElementById("thresholdSlider"),
  thresholdVal: document.getElementById("thresholdVal"),
  presetBtns: document.querySelectorAll(".preset-btn[data-threshold]"),
  connectionStatus: document.getElementById("connectionStatus"),
  connectionText: document.getElementById("connectionText"),
  toggleModeBtn: document.getElementById("toggleModeBtn"),
  apiUnreachableBanner: document.getElementById("apiUnreachableBanner"),
  retryApiBtn: document.getElementById("retryApiBtn"),

  // View Mode & 3D Twin Elements
  view2dBtn: document.getElementById("view2dBtn"),
  view3dBtn: document.getElementById("view3dBtn"),
  floor3dContainer: document.getElementById("floor3dContainer"),
  threeCanvasWrapper: document.getElementById("threeCanvasWrapper"),
  btnIsoView: document.getElementById("btnIsoView"),
  btnTopView: document.getElementById("btnTopView"),
  btnFocusWaste: document.getElementById("btnFocusWaste"),

  // KPIs
  kpiTotalRooms: document.getElementById("kpiTotalRooms"),
  kpiFlaggedRooms: document.getElementById("kpiFlaggedRooms"),
  kpiTotalKwh: document.getElementById("kpiTotalKwh"),
  kpiTotalCost: document.getElementById("kpiTotalCost"),

  // Floor Grid & Meta
  floorGrid: document.getElementById("floorGrid"),
  gridLastUpdated: document.getElementById("gridLastUpdated"),

  // Evidence Panel
  evidencePanelSection: document.getElementById("evidencePanelSection"),
  evidenceRoomName: document.getElementById("evidenceRoomName"),
  evidenceRoomId: document.getElementById("evidenceRoomId"),
  evidenceStatusPill: document.getElementById("evidenceStatusPill"),
  evidenceStatusText: document.getElementById("evidenceStatusText"),
  evidenceContentPlaceholder: document.getElementById("evidenceContentPlaceholder"),
  evidenceContent: document.getElementById("evidenceContent"),
  evidenceConfidence: document.getElementById("evidenceConfidence"),
  evidenceVacantMin: document.getElementById("evidenceVacantMin"),
  evidenceKwhRange: document.getElementById("evidenceKwhRange"),
  evidenceCostInr: document.getElementById("evidenceCostInr"),
  evidenceCo2Kg: document.getElementById("evidenceCo2Kg"),
  evidencePriority: document.getElementById("evidencePriority"),
  evidenceList: document.getElementById("evidenceList"),

  // Explain Button & Output
  explainBtn: document.getElementById("explainBtn"),
  explainBtnText: document.getElementById("explainBtnText"),
  explainBtnIcon: document.getElementById("explainBtnIcon"),
  explainOutput: document.getElementById("explainOutput"),
  explainTextContent: document.getElementById("explainTextContent"),
  explainSourceBadge: document.getElementById("explainSourceBadge"),

  // Queue, Ledger & What-If
  recommendationsList: document.getElementById("recommendationsList"),
  queueList: document.getElementById("recommendationsList"),
  queueActionAlert: document.getElementById("queueActionAlert"),
  ledgerList: document.getElementById("ledgerList"),
  whatifTableBody: document.getElementById("whatifTableBody"),
};

// ============================================================================
// DATA FORMATTING & SAFETY UTILITIES
// ============================================================================

/**
 * Formats energy as a range (e.g., "0.036 to 0.060 kWh") or single value.
 * Safely handles missing fields (such as 'needs_verification' which only has 'kwh').
 */
function formatEnergyRange(room) {
  if (!room) return "0.000 kWh";

  // Task D: needs_verification must show "No estimate: readings not trusted yet", never a kWh figure
  if (room.status === "needs_verification") {
    return "No estimate: readings not trusted yet";
  }

  const low = room.kwh_low;
  const high = room.kwh_high;
  const single = room.kwh;

  if (low !== undefined && high !== undefined && low !== null && high !== null) {
    if (low === 0 && high === 0) return "0.000 kWh";
    return `${Number(low).toFixed(3)} to ${Number(high).toFixed(3)} kWh`;
  } else if (single !== undefined && single !== null) {
    return `${Number(single).toFixed(3)} kWh (nominal)`;
  }
  return "0.000 kWh";
}

/**
 * Formats cost in INR (Rupees).
 */
function formatCost(cost) {
  if (cost === undefined || cost === null) return "₹0.00";
  return `₹${Number(cost).toFixed(2)}`;
}

/**
 * Formats CO2 in kg.
 */
function formatCo2(co2) {
  if (co2 === undefined || co2 === null) return "0.000 kg";
  return `${Number(co2).toFixed(3)} kg`;
}

/**
 * Formats confidence percentage.
 */
function formatConfidence(conf) {
  if (conf === undefined || conf === null) return "Unspecified";
  const num = Number(conf);
  if (isNaN(num)) return String(conf);
  const pct = num <= 1.0 ? num * 100 : num;
  return `${Math.round(pct)}%`;
}

/**
 * Formats human-readable status labels.
 */
function formatStatusLabel(status) {
  if (!status) return "Unknown";
  switch (status.toLowerCase()) {
    case "probable_waste":
      return "Probable Waste";
    case "booking_unused":
      return "Booking Unused";
    case "needs_verification":
      return "Needs Verification";
    case "reserved_vacant":
    case "reserved":
      return "Reserved";
    case "watching":
      return "Watching";
    case "ok":
      return "OK";
    default:
      return status.replace(/_/g, " ");
  }
}

/**
 * Sanitizes status string into CSS class identifier.
 */
function getStatusCssClass(status) {
  if (!status) return "status-unknown";
  const s = status.toLowerCase();
  if (s === "reserved") return "status-reserved_vacant";
  return `status-${s}`;
}

// ============================================================================
// TEMPLATE EXPLANATION FALLBACK (FOR SAMPLE MODE OR OFFLINE BACKUP)
// ============================================================================

function generateLocalTemplateExplanation(room) {
  const room_id = room.room_id || "Unknown";
  const name = room.name || room_id;
  const status = (room.status || "unknown").toLowerCase();
  const evidence = (room.evidence || []).join("; ") || "no direct sensor telemetry recorded";
  const vacant_min = room.vacant_min;
  const conf_str = formatConfidence(room.confidence);
  const energy_range = formatEnergyRange(room);

  if (status === "probable_waste") {
    const vStr = vacant_min !== undefined ? `approximately ${vacant_min} minutes` : "an extended duration";
    return {
      room_id,
      explanation: `In ${name} (${room_id}), lights remain active while the space has been unoccupied for ${vStr}, supported by evidence: ${evidence}. The digital twin calculates a detection confidence of ${conf_str} from real-time occupancy sensor feeds. The estimated avoidable energy is ${energy_range} (approx. ${formatCost(room.cost_inr)} and ${formatCo2(room.co2_kg)} CO2), which is an estimate under rated power and idle-time assumptions, not a measured quantity. Facility managers are advised to verify the room on site and switch off idle fixtures or reconfigure schedules.`,
      source: "template"
    };
  } else if (status === "needs_verification") {
    return {
      room_id,
      explanation: `In ${name} (${room_id}), sensor telemetry reported conflicting or ambiguous occupancy signals (${evidence}). System confidence cannot be definitively confirmed due to incomplete sensor data. Baseline estimated avoidable energy is ${energy_range} under nominal idle load assumptions, not a physical meter measurement. A physical walk-through is recommended to inspect actual room occupancy and check sensor placement.`,
      source: "template"
    };
  } else if (status === "reserved_vacant" || status === "reserved") {
    return {
      room_id,
      explanation: `In ${name} (${room_id}), a calendar reservation is active but no physical occupants are detected (evidence: ${evidence}). The system has ${conf_str} confidence that the space is currently unoccupied. Avoidable energy draw is evaluated as ${energy_range} assuming setback or fixtures in standby. Facility staff should confirm if the booking has concluded early and ensure lights are not left running unnecessarily.`,
      source: "template"
    };
  } else if (status === "watching") {
    const vStr = vacant_min !== undefined ? `${vacant_min} minutes` : "a brief period";
    return {
      room_id,
      explanation: `In ${name} (${room_id}), the space has been vacant for ${vStr}, which remains below the policy threshold for actionable waste (evidence: ${evidence}). System confidence is ${conf_str} and the space remains under observation. Avoidable energy impact is evaluated at ${energy_range} pending threshold breach under stated assumptions, not a measured loss. No immediate physical intervention is required; continue monitoring room telemetry.`,
      source: "template"
    };
  } else {
    return {
      room_id,
      explanation: `In ${name} (${room_id}), normal space utilization and lighting operations were observed (evidence: ${evidence}). The system reports ${conf_str} confidence in optimal room efficiency. Estimated avoidable energy draw is ${energy_range} under current operational parameters. No facility intervention is required at this time.`,
      source: "template"
    };
  }
}

// ============================================================================
// DATA FETCHING (LIVE API & SAMPLE FALLBACK)
// ============================================================================

/**
 * Loads sample twin data from sample_twin.json or embedded fallback.
 */
async function fetchSampleTwinData(threshold) {
  try {
    const res = await fetch("sample_twin.json");
    if (res.ok) {
      const data = await res.json();
      return adjustSampleDataForThreshold(data, threshold);
    }
  } catch (err) {
    console.warn("Could not fetch sample_twin.json via network; using embedded sample data.", err);
  }
  return adjustSampleDataForThreshold(EMBEDDED_SAMPLE_ROOMS, threshold);
}

/**
 * Dynamically adjusts sample room status based on threshold for realism in sample mode.
 */
function adjustSampleDataForThreshold(rooms, threshold) {
  return rooms.map(room => {
    const copy = { ...room };
    // If room is R204 (vacant 25 min)
    if (copy.room_id === "R204") {
      if (copy.vacant_min >= threshold) {
        copy.status = "probable_waste";
      } else {
        copy.status = "watching";
      }
    }
    return copy;
  });
}

/**
 * Primary sync function that polls or fetches twin data, recommendations, and whatif.
 */
async function syncDashboardData() {
  const currentThreshold = state.threshold;

  if (state.useSample) {
    // SAMPLE MODE
    setConnectionState("sample", "Sample Mode (Offline)");
    hideApiUnreachableBanner();

    state.rooms = await fetchSampleTwinData(currentThreshold);
    // Filter probable_waste rooms sorted by priority descending
    state.recommendations = state.rooms
      .filter(r => r.status === "probable_waste")
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    state.whatifRows = EMBEDDED_SAMPLE_WHATIF;

    renderDashboard();
    return;
  }

  // LIVE API MODE (Teammate B's backend at http://localhost:8000)
  try {
    const [twinRes, queueRes, whatifRes, ledgerRes] = await Promise.all([
      fetch(`${API_BASE}/twin?threshold=${currentThreshold}`),
      fetch(`${API_BASE}/queue?threshold=${currentThreshold}`),
      fetch(`${API_BASE}/whatif`),
      fetch(`${API_BASE}/ledger`)
    ]);

    if (!twinRes.ok) throw new Error(`GET /twin failed: ${twinRes.statusText}`);

    const twinData = await twinRes.json();
    const queueData = queueRes.ok ? await queueRes.json() : [];
    const whatifData = whatifRes.ok ? await whatifRes.json() : EMBEDDED_SAMPLE_WHATIF;
    const ledgerData = ledgerRes.ok ? await ledgerRes.json() : [];

    state.rooms = Array.isArray(twinData) ? twinData : [];
    state.queue = Array.isArray(queueData) ? queueData : [];
    state.recommendations = state.queue; // for backwards compatibility
    state.whatifRows = Array.isArray(whatifData) ? whatifData : EMBEDDED_SAMPLE_WHATIF;
    state.ledger = Array.isArray(ledgerData) ? ledgerData : [];

    state.isApiReachable = true;
    setConnectionState("connected", "Live Twin Connected (localhost:8000)");
    hideApiUnreachableBanner();

    renderDashboard();

  } catch (error) {
    console.warn("API fetch error:", error);
    state.isApiReachable = false;
    setConnectionState("disconnected", "API Not Reachable");
    showApiUnreachableBanner();

    // If rooms list is empty, populate with embedded fallback so UI remains functional
    if (!state.rooms || state.rooms.length === 0) {
      state.rooms = adjustSampleDataForThreshold(EMBEDDED_SAMPLE_ROOMS, currentThreshold);
      state.recommendations = state.rooms.filter(r => r.status === "probable_waste");
      state.queue = [];
      state.ledger = [];
      state.whatifRows = EMBEDDED_SAMPLE_WHATIF;
      renderDashboard();
    }
  }
}

// ============================================================================
// UI RENDERING FUNCTIONS
// ============================================================================

function renderDashboard() {
  updateKpis();
  renderFloorGrid();
  renderQueue();
  renderLedger();
  renderWhatIfTable();
  updateEvidencePanelIfSelected();
  update3DDigitalTwin();

  const now = new Date();
  dom.gridLastUpdated.textContent = `Updated ${now.toLocaleTimeString()}`;
}

/**
 * Updates top KPI summary metrics.
 * Counts both probable_waste AND booking_unused as flagged issues (Task D).
 */
function updateKpis() {
  const rooms = state.rooms || [];
  const flagged = rooms.filter(r => r.status === "probable_waste" || r.status === "booking_unused");

  dom.kpiTotalRooms.textContent = rooms.length;
  dom.kpiFlaggedRooms.textContent = flagged.length;

  let minKwh = 0;
  let maxKwh = 0;
  let totalCost = 0;

  flagged.forEach(r => {
    if (r.kwh_low !== undefined) minKwh += Number(r.kwh_low) || 0;
    if (r.kwh_high !== undefined) maxKwh += Number(r.kwh_high) || 0;
    if (r.cost_inr !== undefined) totalCost += Number(r.cost_inr) || 0;
  });

  if (flagged.length > 0 && maxKwh > 0) {
    dom.kpiTotalKwh.textContent = `${minKwh.toFixed(3)} - ${maxKwh.toFixed(3)}`;
    dom.kpiTotalCost.textContent = `₹${totalCost.toFixed(2)}`;
  } else {
    dom.kpiTotalKwh.textContent = "0.000";
    dom.kpiTotalCost.textContent = "₹0.00";
  }
}

/**
 * Renders the floor grid of room cards.
 * Color-codes cards by status and displays room name, status label, vacant min.
 */
function renderFloorGrid() {
  const container = dom.floorGrid;
  const rooms = state.rooms || [];

  if (rooms.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-icon">🏢</div>
        <div class="empty-text">No room telemetry available.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = "";

  rooms.forEach(room => {
    const card = document.createElement("article");
    const statusClass = getStatusCssClass(room.status);
    const isSelected = state.selectedRoomId === room.room_id;

    card.className = `room-card ${statusClass} ${isSelected ? "selected" : ""}`;
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Room ${room.name || room.room_id}, status: ${formatStatusLabel(room.status)}`);

    // Click handler to select room and open evidence panel
    card.addEventListener("click", () => selectRoom(room.room_id));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectRoom(room.room_id);
      }
    });

    const vacantText = (room.vacant_min !== undefined && room.vacant_min !== null)
      ? `${room.vacant_min} min vacant`
      : "Vacant time: --";

    const energyText = formatEnergyRange(room);

    card.innerHTML = `
      <div class="room-card-header">
        <div class="room-info">
          <span class="room-name">${escapeHtml(room.name || room.room_id)}</span>
          <span class="room-id-tag">${escapeHtml(room.room_id || "")}</span>
        </div>
        <span class="status-pill">
          <span class="status-dot"></span>
          <span>${escapeHtml(formatStatusLabel(room.status))}</span>
        </span>
      </div>

      <div class="room-card-body">
        <div class="card-stat">
          <span class="card-stat-label">Inactivity:</span>
          <span class="card-stat-val">${escapeHtml(vacantText)}</span>
        </div>
        <div class="card-stat">
          <span class="card-stat-label">Est. Avoidable:</span>
          <span class="card-stat-val">${escapeHtml(energyText)}</span>
        </div>
      </div>

      <div class="room-card-footer">
        <span>${isSelected ? "● Inspected" : "Inspect Evidence"}</span>
        <span>➔</span>
      </div>
    `;

    container.appendChild(card);
  });
}

/**
 * Selects a room, highlights card, and updates evidence panel.
 */
function selectRoom(roomId) {
  state.selectedRoomId = roomId;

  // Re-highlight room cards without full DOM rebuild
  document.querySelectorAll(".room-card").forEach(el => el.classList.remove("selected"));
  const cards = dom.floorGrid.querySelectorAll(".room-card");
  const roomIndex = state.rooms.findIndex(r => r.room_id === roomId);
  if (roomIndex >= 0 && cards[roomIndex]) {
    cards[roomIndex].classList.add("selected");
  }

  // Populate evidence panel
  populateEvidencePanel(roomId);

  // Update 3D selection highlight
  update3DSelection(roomId);

  // Smooth scroll evidence panel into view on mobile
  if (window.innerWidth <= 1024) {
    dom.evidencePanelSection.scrollIntoView({ behavior: "smooth" });
  }
}

/**
 * Populates the Evidence Panel with selected room telemetry.
 */
function populateEvidencePanel(roomId) {
  const room = state.rooms.find(r => r.room_id === roomId);
  if (!room) return;

  dom.evidenceContentPlaceholder.style.display = "none";
  dom.evidenceContent.style.display = "block";

  dom.evidenceRoomName.textContent = room.name || room.room_id;
  dom.evidenceRoomId.textContent = `Room ID: ${room.room_id}`;

  // Status Pill
  dom.evidenceStatusPill.style.display = "inline-flex";
  dom.evidenceStatusPill.className = `status-pill ${getStatusCssClass(room.status)}`;
  dom.evidenceStatusText.textContent = formatStatusLabel(room.status);

  // Stats Grid (Handles missing fields safely!)
  dom.evidenceConfidence.textContent = formatConfidence(room.confidence);
  dom.evidenceVacantMin.textContent = (room.vacant_min !== undefined && room.vacant_min !== null)
    ? `${room.vacant_min} minutes`
    : "Not recorded";

  dom.evidenceKwhRange.textContent = formatEnergyRange(room);
  dom.evidenceCostInr.textContent = formatCost(room.cost_inr);
  dom.evidenceCo2Kg.textContent = formatCo2(room.co2_kg);
  dom.evidencePriority.textContent = (room.priority !== undefined && room.priority !== null)
    ? Number(room.priority).toFixed(3)
    : "N/A";

  // Evidence List
  dom.evidenceList.innerHTML = "";
  const evidenceArr = Array.isArray(room.evidence) ? room.evidence : [];
  if (evidenceArr.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No specific telemetry evidence listed.";
    dom.evidenceList.appendChild(li);
  } else {
    evidenceArr.forEach(item => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="evidence-bullet-icon">●</span> <span>${escapeHtml(String(item))}</span>`;
      dom.evidenceList.appendChild(li);
    });
  }

  // Preserve or reset explanation state based on whether an explanation exists for this room
  if (state.isExplaining && state.selectedRoomId === roomId) {
    dom.explainBtn.disabled = true;
    dom.explainBtnText.textContent = "Analyzing with GenAI...";
    dom.explainBtnIcon.innerHTML = `<span class="spinner"></span>`;
    dom.explainOutput.style.display = "none";
  } else if (state.explanations && state.explanations[roomId]) {
    const cachedExplain = state.explanations[roomId];
    dom.explainOutput.style.display = "block";
    dom.explainTextContent.textContent = cachedExplain.text;
    if (cachedExplain.source === "gemini") {
      dom.explainSourceBadge.className = "source-badge source-gemini";
      dom.explainSourceBadge.textContent = "Gemini AI";
    } else {
      dom.explainSourceBadge.className = "source-badge source-template";
      dom.explainSourceBadge.textContent = "Rule Template";
    }
    dom.explainBtn.disabled = false;
    dom.explainBtnText.textContent = "Re-explain with GenAI";
    dom.explainBtnIcon.textContent = "✨";
  } else {
    dom.explainBtn.disabled = false;
    dom.explainBtnText.textContent = "Explain with GenAI";
    dom.explainBtnIcon.textContent = "✨";
    dom.explainOutput.style.display = "none";
  }
}

/**
 * Smoothly refreshes evidence panel if currently selected room data changes during polling.
 */
function updateEvidencePanelIfSelected() {
  if (state.selectedRoomId) {
    const roomExists = state.rooms.some(r => r.room_id === state.selectedRoomId);
    if (roomExists) {
      populateEvidencePanel(state.selectedRoomId);
    }
  }
}

/**
 * Computes an appropriate action timestamp for a room.
 * If a ledger entry exists with detected_ts, adds 5 minutes so it is strictly
 * after detected_ts (e.g. 12:25:00 -> 12:30:00) and harmonizes with both
 * scripted dates (2026-10-15) and live webcam runs.
 */
function getActionTimestamp(roomId) {
  const ledgerItem = (state.ledger || []).find(e => e.room_id === roomId);
  if (ledgerItem && ledgerItem.detected_ts) {
    const d = new Date(ledgerItem.detected_ts);
    if (!isNaN(d.getTime())) {
      const actionDate = new Date(d.getTime() + 5 * 60 * 1000);
      return actionDate.toISOString().split(".")[0];
    }
  }
  return new Date().toISOString().split(".")[0];
}

/**
 * Handles the "Record action: switched off" button click (Task E).
 * Sends POST /ledger/action with { room_id, action: "switched_off", ts }.
 * Displays HTTP 400 detail message on error, refreshes panels on success.
 */
async function handleRecordAction(roomId, btnElement) {
  if (!roomId) return;
  const ts = getActionTimestamp(roomId);

  if (btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = "Recording...";
  }

  try {
    const res = await fetch(`${API_BASE}/ledger/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room_id: roomId,
        action: "switched_off",
        ts: ts,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const errorMsg = data && data.detail ? data.detail : `Error ${res.status}: Failed to record action`;
      showQueueAlert(errorMsg, "error");
      if (btnElement) {
        btnElement.disabled = false;
        btnElement.textContent = "Record action: switched off";
      }
      return;
    }

    showQueueAlert(`Action recorded for ${roomId} ('switched_off' at ${ts})`, "success");
    // Refresh live data immediately
    await syncData();

  } catch (err) {
    console.error("Failed to record action:", err);
    showQueueAlert(`Network error: ${err.message}`, "error");
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.textContent = "Record action: switched off";
    }
  }
}

function showQueueAlert(msg, type) {
  if (!dom.queueActionAlert) return;
  dom.queueActionAlert.textContent = msg;
  dom.queueActionAlert.className = `queue-action-alert ${type}`;
  dom.queueActionAlert.style.display = "block";
  setTimeout(() => {
    if (dom.queueActionAlert) {
      dom.queueActionAlert.style.display = "none";
    }
  }, 6000);
}

/**
 * Renders the ranked issue queue (GET /queue?threshold=N).
 * Task B: Shows rank, action, score, why list, effort, and evidence_status badge.
 * For needs_verification rows, shows "no claim made", never a kWh figure.
 * Task E: Provides "Record action: switched off" button per actionable issue.
 */
function renderQueue() {
  const container = dom.queueList;
  if (!container) return;
  const items = state.queue || [];

  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✅</div>
        <div class="empty-text">No open issues in queue</div>
        <div style="font-size: 0.775rem; color: var(--text-muted); margin-top: 0.25rem;">
          All rooms are operating within normal occupancy thresholds or have been addressed.
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = "";

  items.forEach(item => {
    const el = document.createElement("div");
    const statusClass = item.status ? item.status.toLowerCase() : "unknown";
    el.className = `queue-item ${statusClass}`;

    // Evidence status badge: estimated, observed, unverified
    const evStatus = (item.evidence_status || "estimated").toLowerCase();
    const evBadgeHtml = `<span class="badge-evidence ${escapeHtml(evStatus)}">${escapeHtml(evStatus)}</span>`;

    // Effort badge
    const effortStr = item.effort ? `Effort: ${item.effort}` : "Effort: low";

    // Energy claim or no claim made
    let energyClaimHtml = "";
    if (item.status === "needs_verification") {
      energyClaimHtml = `<span class="rec-claim">no claim made</span>`;
    } else if (item.est_kwh_low !== undefined && item.est_kwh_high !== undefined) {
      energyClaimHtml = `<span>Est. Avoidable: ${Number(item.est_kwh_low).toFixed(3)} - ${Number(item.est_kwh_high).toFixed(3)} kWh</span>`;
    }

    // Check if an action is already taken for this room in the ledger
    const matchingLedger = (state.ledger || []).find(e => e.room_id === item.room_id);
    const actionAlreadyTaken = matchingLedger && (matchingLedger.status === "action_taken" || matchingLedger.status === "response_observed");

    let actionBtnHtml = "";
    if (item.status !== "needs_verification") {
      if (actionAlreadyTaken) {
        actionBtnHtml = `<button class="btn-record-action action-taken" disabled>✓ Action Recorded</button>`;
      } else {
        actionBtnHtml = `<button class="btn-record-action" data-room-id="${escapeHtml(item.room_id)}">Record action: switched off</button>`;
      }
    }

    // Why list
    const whyListHtml = Array.isArray(item.why) && item.why.length > 0
      ? `<ul class="queue-why-list">${item.why.map(w => `<li>● ${escapeHtml(String(w))}</li>`).join("")}</ul>`
      : "";

    el.innerHTML = `
      <div class="queue-item-header">
        <div class="queue-rank-wrap">
          <span class="queue-rank-badge">#${escapeHtml(String(item.rank || ""))}</span>
          <span class="queue-room-title">${escapeHtml(item.name || item.room_id)}</span>
        </div>
        <div class="queue-badges-wrap">
          ${evBadgeHtml}
          <span class="status-pill ${getStatusCssClass(item.status)}">
            <span class="status-dot"></span>
            <span>${escapeHtml(formatStatusLabel(item.status))}</span>
          </span>
        </div>
      </div>

      <div class="queue-action-text">${escapeHtml(item.action || "No action specified")}</div>

      ${whyListHtml}

      <div class="queue-item-footer">
        <div class="queue-meta-text">
          <span>Score: ${item.score !== undefined ? Number(item.score).toFixed(3) : "0.000"}</span>
          <span>•</span>
          <span>${escapeHtml(effortStr)}</span>
          ${energyClaimHtml ? `<span>•</span> ${energyClaimHtml}` : ""}
        </div>
        <div>
          ${actionBtnHtml}
        </div>
      </div>
    `;

    // Click on item selects room in evidence panel
    el.addEventListener("click", (e) => {
      if (e.target.closest(".btn-record-action")) return;
      selectRoom(item.room_id);
    });

    // Wire action button
    const btn = el.querySelector(".btn-record-action:not([disabled])");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleRecordAction(item.room_id, btn);
      });
    }

    container.appendChild(el);
  });
}

/**
 * Backward compatibility alias for renderQueue.
 */
function renderRecommendations() {
  renderQueue();
}

/**
 * Renders the Evidence Ledger (GET /ledger).
 * Task C: Per entry shows id, room, issue, status progression, evidence_status,
 * est_kwh range, text "Savings not verified (no meter)" when savings_verified is false,
 * and clearly visible evidence_missing[] list.
 */
function renderLedger() {
  const container = dom.ledgerList;
  if (!container) return;
  const entries = state.ledger || [];

  if (entries.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <div class="empty-text">Ledger is clean</div>
        <div style="font-size: 0.775rem; color: var(--text-muted); margin-top: 0.25rem;">
          No active issue lifecycle entries recorded yet.
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = "";

  entries.forEach(entry => {
    const el = document.createElement("div");
    el.className = "ledger-item";

    const evStatus = (entry.evidence_status || "estimated").toLowerCase();
    const evBadgeHtml = `<span class="badge-evidence ${escapeHtml(evStatus)}">${escapeHtml(evStatus)}</span>`;

    const statusPillHtml = `<span class="ledger-status-pill status-${escapeHtml(entry.status || "detected")}">${escapeHtml(entry.status || "detected")}</span>`;

    // Energy range
    const kwhRangeStr = (entry.est_kwh_low !== undefined && entry.est_kwh_high !== undefined)
      ? `${Number(entry.est_kwh_low).toFixed(3)} to ${Number(entry.est_kwh_high).toFixed(3)} kWh`
      : "0.000 kWh";

    // Unverified savings tag: ALWAYS when savings_verified is false
    const unverifiedHtml = (entry.savings_verified === false)
      ? `<div class="ledger-unverified-tag">⚠️ Savings not verified (no meter)</div>`
      : "";

    // Action & response info if present
    const actionInfo = entry.action
      ? `<div style="margin-top: 0.25rem; font-size: 0.775rem;"><strong>Action taken:</strong> ${escapeHtml(entry.action)} <span style="color: var(--text-muted);">(${escapeHtml(entry.action_ts || "")})</span></div>`
      : "";

    const responseInfo = entry.response
      ? `<div style="margin-top: 0.2rem; font-size: 0.775rem; color: #166534;"><strong>Observed response:</strong> ${escapeHtml(entry.response)} <span style="color: var(--text-muted);">(${escapeHtml(entry.response_ts || "")})</span></div>`
      : "";

    // Missing evidence list (project credibility)
    const missingArr = Array.isArray(entry.evidence_missing) ? entry.evidence_missing : [];
    const missingListHtml = missingArr.length > 0
      ? `
        <div class="ledger-missing-section">
          <strong>Evidence Missing & Assumptions:</strong>
          <ul class="ledger-missing-list">
            ${missingArr.map(m => `<li>⚠️ ${escapeHtml(String(m))}</li>`).join("")}
          </ul>
        </div>
      `
      : "";

    el.innerHTML = `
      <div class="ledger-item-header">
        <div class="ledger-header-left">
          <span class="ledger-id-tag">${escapeHtml(entry.id || "L?")}</span>
          <span class="ledger-room-title">${escapeHtml(entry.name || entry.room_id)} (${escapeHtml(entry.room_id)})</span>
        </div>
        <div class="ledger-badges">
          ${evBadgeHtml}
          ${statusPillHtml}
        </div>
      </div>

      <div class="ledger-progression">
        Issue: <strong>${escapeHtml(formatStatusLabel(entry.issue))}</strong> • Lifecycle: 
        <span style="${entry.status === 'detected' ? 'font-weight:700; color: #92400e;' : ''}">detected</span> ➔ 
        <span style="${entry.status === 'recommended' ? 'font-weight:700; color: #9a3412;' : ''}">recommended</span> ➔ 
        <span style="${entry.status === 'action_taken' ? 'font-weight:700; color: #1e40af;' : ''}">action_taken</span> ➔ 
        <span style="${entry.status === 'response_observed' ? 'font-weight:700; color: #166534;' : ''}">response_observed</span>
      </div>

      <div class="ledger-details-grid">
        <div><span style="color:var(--text-muted);">Est. Avoidable:</span> <strong>${escapeHtml(kwhRangeStr)}</strong></div>
        <div><span style="color:var(--text-muted);">Detected at:</span> ${escapeHtml(entry.detected_ts || "N/A")}</div>
      </div>

      ${actionInfo}
      ${responseInfo}

      ${unverifiedHtml}

      ${missingListHtml}
    `;

    container.appendChild(el);
  });
}

/**
 * Renders What-If Policy Analysis Table.
 * Highlights row matching current slider threshold.
 */
function renderWhatIfTable() {
  const tbody = dom.whatifTableBody;
  const rows = state.whatifRows || [];

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No policy data available.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";

  rows.forEach(row => {
    const tr = document.createElement("tr");
    const isCurrentThreshold = Number(row.threshold_min) === Number(state.threshold);

    if (isCurrentThreshold) {
      tr.className = "highlight-active";
    }

    // Clicking a row allows setting the slider directly
    tr.addEventListener("click", () => {
      setThreshold(Number(row.threshold_min));
    });

    const kwhStr = (row.kwh_low !== undefined && row.kwh_high !== undefined)
      ? `${Number(row.kwh_low).toFixed(3)} - ${Number(row.kwh_high).toFixed(3)} kWh`
      : "0.000 kWh";

    tr.innerHTML = `
      <td>${escapeHtml(String(row.threshold_min))} min</td>
      <td><strong>${escapeHtml(String(row.rooms_flagged))}</strong> room${row.rooms_flagged === 1 ? "" : "s"}</td>
      <td>${escapeHtml(kwhStr)}</td>
      <td>${escapeHtml(formatCost(row.cost_inr))}</td>
      <td>${escapeHtml(formatCo2(row.co2_kg))}</td>
    `;

    tbody.appendChild(tr);
  });
}

// ============================================================================
// GENAI EXPLAIN ACTION HANDLER
// ============================================================================

/**
 * Handles the "Explain" button click.
 * Calls /explain/{room_id}?threshold={threshold}
 * Displays the resulting explanation and source badge (gemini or template).
 */
async function handleExplainClick() {
  if (!state.selectedRoomId || state.isExplaining) return;

  const roomId = state.selectedRoomId;
  const currentThreshold = state.threshold;
  const room = state.rooms.find(r => r.room_id === roomId);

  state.isExplaining = true;
  dom.explainBtn.disabled = true;
  dom.explainBtnText.textContent = "Analyzing with GenAI...";
  dom.explainBtnIcon.innerHTML = `<span class="spinner"></span>`;

  try {
    let explanationData = null;

    if (state.useSample) {
      // In sample mode, generate high-quality explanation from local template
      await new Promise(res => setTimeout(res, 350)); // subtle realistic delay
      explanationData = generateLocalTemplateExplanation(room || { room_id: roomId });
    } else {
      // Live API Call to GET /explain/{room_id}?threshold=15
      const url = `${API_BASE}/explain/${encodeURIComponent(roomId)}?threshold=${currentThreshold}`;
      const response = await fetch(url);

      if (response.ok) {
        explanationData = await response.json();
      } else {
        console.warn(`Explain endpoint returned ${response.status}; using local template.`);
        explanationData = generateLocalTemplateExplanation(room || { room_id: roomId });
      }
    }

    // Display and cache Explanation Result
    const text = explanationData.explanation || "No explanation text provided.";
    const source = (explanationData.source || "template").toLowerCase();
    state.explanations[roomId] = { text, source };

    dom.explainOutput.style.display = "block";
    dom.explainTextContent.textContent = text;

    if (source === "gemini") {
      dom.explainSourceBadge.className = "source-badge source-gemini";
      dom.explainSourceBadge.textContent = "Gemini AI";
    } else {
      dom.explainSourceBadge.className = "source-badge source-template";
      dom.explainSourceBadge.textContent = "Rule Template";
    }

  } catch (error) {
    console.warn("Explain request failed; rendering rule template fallback:", error);
    const fallback = generateLocalTemplateExplanation(room || { room_id: roomId });
    state.explanations[roomId] = { text: fallback.explanation, source: "template" };
    dom.explainOutput.style.display = "block";
    dom.explainTextContent.textContent = fallback.explanation;
    dom.explainSourceBadge.className = "source-badge source-template";
    dom.explainSourceBadge.textContent = "Template Fallback";

  } finally {
    state.isExplaining = false;
    dom.explainBtn.disabled = false;
    dom.explainBtnText.textContent = "Re-explain with GenAI";
    dom.explainBtnIcon.textContent = "✨";
  }
}

// ============================================================================
// CONTROLS & EVENT LISTENERS
// ============================================================================

function setThreshold(val) {
  const parsed = Math.min(60, Math.max(5, Number(val) || 15));
  state.threshold = parsed;

  dom.thresholdSlider.value = parsed;
  dom.thresholdVal.textContent = `${parsed} min`;

  // Update preset buttons active state
  dom.presetBtns.forEach(btn => {
    if (Number(btn.dataset.threshold) === parsed) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Re-fetch twin and recommendations immediately on threshold change
  syncDashboardData();
}

function setConnectionState(mode, text) {
  dom.connectionStatus.className = `connection-indicator ${mode}`;
  dom.connectionText.textContent = text;
}

function showApiUnreachableBanner() {
  dom.apiUnreachableBanner.classList.remove("hidden");
}

function hideApiUnreachableBanner() {
  dom.apiUnreachableBanner.classList.add("hidden");
}

function toggleSampleLiveMode() {
  state.useSample = !state.useSample;
  dom.toggleModeBtn.textContent = state.useSample ? "Switch to Live API" : "Switch to Sample Mode";
  syncDashboardData();
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================================
// 3D DIGITAL TWIN MODULE (Three.js Architectural Floor Plan)
// ============================================================================

const threeTwin = {
  initialized: false,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  raycaster: null,
  mouse: null,
  roomObjects: {},      // roomId -> { group, floorMesh, light, diffuser, beacon, sprite, canvas, ctx, texture }
  clickableMeshes: [],  // array of room hit meshes for raycasting
  selectionBox: null,   // active selection box/ring
  animFrameId: null,
};

const ROOM_3D_LAYOUT = {
  R204: { x: -6.0, z: -4.5, w: 5.6, d: 5.0, h: 2.2, name: "Lab 204" },
  R205: { x: 0.0,  z: -4.5, w: 5.6, d: 5.0, h: 2.2, name: "Class 205" },
  R206: { x: 6.0,  z: -4.5, w: 5.6, d: 5.0, h: 2.2, name: "Hall 206" },
  R207: { x: -3.5, z: 4.5,  w: 7.2, d: 5.0, h: 2.2, name: "Seminar 207" },
  R208: { x: 4.5,  z: 4.5,  w: 7.2, d: 5.0, h: 2.2, name: "Office 208" },
};

const STATUS_3D_CONFIG = {
  probable_waste:    { hex: 0xef4444, css: "#ef4444", intensity: 2.4, label: "PROBABLE WASTE" },
  needs_verification:{ hex: 0x94a3b8, css: "#94a3b8", intensity: 0.8, label: "NEEDS VERIFY" },
  reserved_vacant:   { hex: 0x38bdf8, css: "#38bdf8", intensity: 1.2, label: "RESERVED" },
  reserved:          { hex: 0x38bdf8, css: "#38bdf8", intensity: 1.2, label: "RESERVED" },
  watching:          { hex: 0xf59e0b, css: "#f59e0b", intensity: 1.4, label: "WATCHING" },
  ok:                { hex: 0x22c55e, css: "#22c55e", intensity: 1.0, label: "NORMAL OK" },
  unknown:           { hex: 0x64748b, css: "#64748b", intensity: 0.8, label: "MONITORED" },
};

function getStatus3dConfig(status) {
  if (!status) return STATUS_3D_CONFIG.unknown;
  const s = status.toLowerCase();
  return STATUS_3D_CONFIG[s] || STATUS_3D_CONFIG.unknown;
}

function init3DScene() {
  if (threeTwin.initialized) return;

  if (typeof THREE === "undefined") {
    if (dom.threeCanvasWrapper) {
      dom.threeCanvasWrapper.innerHTML = `
        <div class="empty-state" style="padding-top: 110px;">
          <div class="empty-icon">🌐</div>
          <div class="empty-text">3D WebGL library is loading or network is offline.</div>
          <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 0.5rem;">
            You can continue using the 2D Cards view smoothly.
          </div>
        </div>
      `;
    }
    return;
  }

  const wrapper = dom.threeCanvasWrapper;
  if (!wrapper) return;

  const width = wrapper.clientWidth || 600;
  const height = wrapper.clientHeight || 380;

  // 1. Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090d16);
  scene.fog = new THREE.FogExp2(0x090d16, 0.015);
  threeTwin.scene = scene;

  // 2. Camera
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000);
  camera.position.set(16, 18, 22);
  threeTwin.camera = camera;

  // 3. Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  wrapper.innerHTML = "";
  wrapper.appendChild(renderer.domElement);
  threeTwin.renderer = renderer;

  // 4. Orbit Controls (if available from CDN)
  if (typeof THREE.OrbitControls !== "undefined") {
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 8;
    controls.maxDistance = 50;
    controls.target.set(0, 0, 0);
    threeTwin.controls = controls;
  }

  // 5. Environmental Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.55);
  dirLight.position.set(20, 30, 15);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  scene.add(dirLight);

  // 6. Base Building Floor Slab
  buildArchitecturalBase(scene);

  // 7. Rooms & Lighting Fixtures
  buildRooms(scene);

  // 8. Selection Box Indicator
  const selGeo = new THREE.RingGeometry(1.6, 1.85, 32);
  selGeo.rotateX(-Math.PI / 2);
  const selMat = new THREE.MeshBasicMaterial({ color: 0x0f766e, side: THREE.DoubleSide });
  const selectionMesh = new THREE.Mesh(selGeo, selMat);
  selectionMesh.position.set(0, 0.04, 0);
  selectionMesh.visible = false;
  scene.add(selectionMesh);
  threeTwin.selectionBox = selectionMesh;

  // 9. Raycasting Setup
  threeTwin.raycaster = new THREE.Raycaster();
  threeTwin.mouse = new THREE.Vector2();

  renderer.domElement.addEventListener("click", onThreeCanvasClick);
  renderer.domElement.addEventListener("mousemove", onThreeCanvasMouseMove);
  window.addEventListener("resize", onThreeWindowResize);

  threeTwin.initialized = true;

  // 10. Start Animation Loop
  animate3DScene();

  // Initial Sync
  update3DDigitalTwin();
  if (state.selectedRoomId) {
    update3DSelection(state.selectedRoomId);
  }
}

function buildArchitecturalBase(scene) {
  // Main foundation slab
  const slabGeo = new THREE.BoxGeometry(24, 0.4, 18);
  const slabMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.85,
    metalness: 0.1,
  });
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.position.y = -0.2;
  slab.receiveShadow = true;
  scene.add(slab);

  // Subtle floor grid helper
  const grid = new THREE.GridHelper(24, 24, 0x1e293b, 0x1e293b);
  grid.position.y = 0.02;
  scene.add(grid);

  // Central corridor accent path
  const corridorGeo = new THREE.PlaneGeometry(22, 2.6);
  corridorGeo.rotateX(-Math.PI / 2);
  const corridorMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.9,
  });
  const corridor = new THREE.Mesh(corridorGeo, corridorMat);
  corridor.position.set(0, 0.025, 0);
  scene.add(corridor);
}

function buildRooms(scene) {
  threeTwin.roomObjects = {};
  threeTwin.clickableMeshes = [];

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    transparent: true,
    opacity: 0.55,
    roughness: 0.4,
    metalness: 0.2,
  });

  for (const [roomId, layout] of Object.entries(ROOM_3D_LAYOUT)) {
    const group = new THREE.Group();
    group.position.set(layout.x, 0, layout.z);
    group.userData = { roomId };

    // 1. Room Floor Tile
    const floorGeo = new THREE.PlaneGeometry(layout.w, layout.d);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.7,
      metalness: 0.15,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.y = 0.03;
    floorMesh.receiveShadow = true;
    floorMesh.userData = { roomId };
    group.add(floorMesh);
    threeTwin.clickableMeshes.push(floorMesh);

    // 2. Architectural Cutaway Walls
    const w = layout.w;
    const d = layout.d;
    const h = layout.h;
    const t = 0.12;

    // Back wall
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), wallMat);
    backWall.position.set(0, h / 2, -d / 2);
    group.add(backWall);

    // Left wall
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(t, h, d), wallMat);
    leftWall.position.set(-w / 2, h / 2, 0);
    group.add(leftWall);

    // Right wall
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(t, h, d), wallMat);
    rightWall.position.set(w / 2, h / 2, 0);
    group.add(rightWall);

    // Low front divider (cutaway so interior is visible)
    const frontWall = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 0.6, t), wallMat);
    frontWall.position.set(-w * 0.28, 0.3, d / 2);
    group.add(frontWall);

    // 3. Hanging Pendant Lighting Fixture
    const cordGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.9, 8);
    const cordMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8 });
    const cord = new THREE.Mesh(cordGeo, cordMat);
    cord.position.set(0, h - 0.45, 0);
    group.add(cord);

    const fixtureGeo = new THREE.BoxGeometry(1.6, 0.12, 0.45);
    const fixtureMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.7 });
    const fixture = new THREE.Mesh(fixtureGeo, fixtureMat);
    fixture.position.set(0, h - 0.9, 0);
    group.add(fixture);

    // Diffuser LED panel (colored glow)
    const diffuserGeo = new THREE.BoxGeometry(1.5, 0.06, 0.38);
    const diffuserMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xef4444,
      emissiveIntensity: 1.5,
      roughness: 0.2,
    });
    const diffuser = new THREE.Mesh(diffuserGeo, diffuserMat);
    diffuser.position.set(0, h - 0.96, 0);
    group.add(diffuser);

    // PointLight casting light onto room
    const pointLight = new THREE.PointLight(0xef4444, 1.8, 9, 2);
    pointLight.position.set(0, h - 1.05, 0);
    group.add(pointLight);

    // 4. Waste Pulsing Beacon Ring
    const beaconGeo = new THREE.TorusGeometry(1.1, 0.05, 8, 32);
    beaconGeo.rotateX(Math.PI / 2);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.85,
    });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.set(0, 0.1, 0);
    beacon.visible = false;
    group.add(beacon);

    // 5. Dynamic 3D Text Sprite Label
    const spriteObj = createRoomCanvasSprite(layout.name, "MONITORED", "#64748b");
    spriteObj.sprite.position.set(0, h + 1.2, 0);
    group.add(spriteObj.sprite);

    scene.add(group);

    threeTwin.roomObjects[roomId] = {
      group,
      floorMesh,
      light: pointLight,
      diffuser,
      beacon,
      sprite: spriteObj.sprite,
      canvas: spriteObj.canvas,
      ctx: spriteObj.ctx,
      texture: spriteObj.texture,
      layout,
    };
  }
}

function createRoomCanvasSprite(roomName, statusText, statusColorCss) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  renderSpriteCanvas(ctx, canvas, roomName, statusText, statusColorCss);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.6, 1.8, 1);

  return { sprite, canvas, ctx, texture };
}

function renderSpriteCanvas(ctx, canvas, roomName, statusText, statusColorCss) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background rounded rectangle
  ctx.fillStyle = "rgba(11, 17, 32, 0.88)";
  ctx.strokeStyle = statusColorCss;
  ctx.lineWidth = 4;

  const x = 8, y = 8, w = 240, h = 112, r = 16;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Room Name
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(roomName, 128, 48);

  // Status Badge Text
  ctx.fillStyle = statusColorCss;
  ctx.font = "bold 18px -apple-system, sans-serif";
  ctx.fillText(statusText, 128, 88);
}

function update3DDigitalTwin() {
  if (!threeTwin.initialized) return;

  const rooms = state.rooms || [];
  rooms.forEach(room => {
    const obj = threeTwin.roomObjects[room.room_id];
    if (!obj) return;

    const conf = getStatus3dConfig(room.status);

    // 1. Update point light & diffuser emissive
    obj.light.color.setHex(conf.hex);
    obj.light.intensity = conf.intensity;
    obj.diffuser.material.emissive.setHex(conf.hex);
    obj.diffuser.material.emissiveIntensity = conf.intensity;

    // 2. Floor tint
    obj.floorMesh.material.color.setHex(conf.hex).lerp(new THREE.Color(0x111827), 0.7);

    // 3. Waste beacon visibility & color
    if (room.status === "probable_waste") {
      obj.beacon.visible = true;
      obj.beacon.material.color.setHex(conf.hex);
    } else {
      obj.beacon.visible = false;
    }

    // 4. Update floating Sprite text
    const labelStatus = conf.label;
    renderSpriteCanvas(obj.ctx, obj.canvas, room.name || obj.layout.name, labelStatus, conf.css);
    obj.texture.needsUpdate = true;
  });

  // Ensure current selection stays in sync
  if (state.selectedRoomId) {
    update3DSelection(state.selectedRoomId);
  }
}

function update3DSelection(roomId) {
  if (!threeTwin.initialized || !threeTwin.selectionBox) return;

  const obj = threeTwin.roomObjects[roomId];
  if (!obj) {
    threeTwin.selectionBox.visible = false;
    return;
  }

  threeTwin.selectionBox.visible = true;
  threeTwin.selectionBox.position.set(obj.layout.x, 0.05, obj.layout.z);
}

function onThreeCanvasClick(event) {
  if (!threeTwin.renderer || !threeTwin.camera) return;

  const rect = dom.threeCanvasWrapper.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  threeTwin.raycaster.setFromCamera(mouse, threeTwin.camera);
  const intersects = threeTwin.raycaster.intersectObjects(threeTwin.clickableMeshes, true);

  if (intersects.length > 0) {
    const hitObj = intersects[0].object;
    const hitRoomId = hitObj.userData ? hitObj.userData.roomId : null;
    if (hitRoomId) {
      selectRoom(hitRoomId);
    }
  }
}

function onThreeCanvasMouseMove(event) {
  if (!threeTwin.renderer || !threeTwin.camera || !dom.threeCanvasWrapper) return;

  const rect = dom.threeCanvasWrapper.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  threeTwin.raycaster.setFromCamera(mouse, threeTwin.camera);
  const intersects = threeTwin.raycaster.intersectObjects(threeTwin.clickableMeshes, true);

  if (intersects.length > 0) {
    dom.threeCanvasWrapper.style.cursor = "pointer";
  } else {
    dom.threeCanvasWrapper.style.cursor = "grab";
  }
}

function onThreeWindowResize() {
  if (!threeTwin.renderer || !threeTwin.camera || !dom.threeCanvasWrapper) return;
  const width = dom.threeCanvasWrapper.clientWidth;
  const height = dom.threeCanvasWrapper.clientHeight || 380;
  if (width === 0 || height === 0) return;

  threeTwin.camera.aspect = width / height;
  threeTwin.camera.updateProjectionMatrix();
  threeTwin.renderer.setSize(width, height);
}

function set3DView(type) {
  if (!threeTwin.camera || !threeTwin.controls) return;

  if (type === "iso") {
    threeTwin.camera.position.set(16, 18, 22);
    threeTwin.controls.target.set(0, 0, 0);
  } else if (type === "top") {
    threeTwin.camera.position.set(0, 28, 0.01);
    threeTwin.controls.target.set(0, 0, 0);
  } else if (type === "waste") {
    // Zoom toward Lab 204
    threeTwin.camera.position.set(-6.0, 8.5, 6.0);
    threeTwin.controls.target.set(-6.0, 1.0, -4.5);
    selectRoom("R204");
  }
  threeTwin.controls.update();
}

function switchViewMode(mode) {
  state.viewMode = mode;
  if (mode === "3d") {
    dom.view2dBtn.classList.remove("active");
    dom.view3dBtn.classList.add("active");
    dom.floorGrid.style.display = "none";
    dom.floor3dContainer.style.display = "flex";

    if (!threeTwin.initialized) {
      init3DScene();
    } else {
      setTimeout(onThreeWindowResize, 50);
    }
    update3DDigitalTwin();
  } else {
    dom.view3dBtn.classList.remove("active");
    dom.view2dBtn.classList.add("active");
    dom.floor3dContainer.style.display = "none";
    dom.floorGrid.style.display = "grid";
  }
}

function animate3DScene() {
  threeTwin.animFrameId = requestAnimationFrame(animate3DScene);

  if (threeTwin.controls) {
    threeTwin.controls.update();
  }

  // Animate waste pulsing beacons
  const time = Date.now() * 0.003;
  for (const rid in threeTwin.roomObjects) {
    const obj = threeTwin.roomObjects[rid];
    if (obj.beacon && obj.beacon.visible) {
      const pulse = 1.0 + 0.15 * Math.sin(time * 3);
      obj.beacon.scale.set(pulse, pulse, pulse);
      obj.beacon.rotation.z += 0.015;
    }
  }

  if (threeTwin.renderer && threeTwin.scene && threeTwin.camera) {
    threeTwin.renderer.render(threeTwin.scene, threeTwin.camera);
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function setupEventListeners() {
  // Threshold Slider Input
  dom.thresholdSlider.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    dom.thresholdVal.textContent = `${val} min`;
  });

  dom.thresholdSlider.addEventListener("change", (e) => {
    setThreshold(e.target.value);
  });

  // Quick Preset Buttons
  dom.presetBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      setThreshold(btn.dataset.threshold);
    });
  });

  // Explain Button
  dom.explainBtn.addEventListener("click", handleExplainClick);

  // Toggle Mode Button
  dom.toggleModeBtn.addEventListener("click", toggleSampleLiveMode);

  // Retry API Button
  dom.retryApiBtn.addEventListener("click", () => {
    syncDashboardData();
  });

  // 3D View Toggles
  if (dom.view2dBtn) dom.view2dBtn.addEventListener("click", () => switchViewMode("2d"));
  if (dom.view3dBtn) dom.view3dBtn.addEventListener("click", () => switchViewMode("3d"));

  // 3D Camera Controls
  if (dom.btnIsoView) dom.btnIsoView.addEventListener("click", () => set3DView("iso"));
  if (dom.btnTopView) dom.btnTopView.addEventListener("click", () => set3DView("top"));
  if (dom.btnFocusWaste) dom.btnFocusWaste.addEventListener("click", () => set3DView("waste"));
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(syncDashboardData, POLL_INTERVAL_MS);
}

// Initial Boot
document.addEventListener("DOMContentLoaded", () => {
  dom.toggleModeBtn.textContent = state.useSample ? "Switch to Live API" : "Switch to Sample Mode";
  setupEventListeners();
  syncDashboardData().then(() => {
    // Select first flagged or first room by default to populate evidence panel
    if (state.rooms.length > 0) {
      const probable = state.rooms.find(r => r.status === "probable_waste");
      selectRoom(probable ? probable.room_id : state.rooms[0].room_id);
    }
  });
  startPolling();
});
