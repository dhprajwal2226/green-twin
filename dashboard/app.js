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
const USE_SAMPLE = true;

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
  whatifRows: [],
  selectedRoomId: null,
  isApiReachable: true,
  pollTimer: null,
  isExplaining: false,
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

  // Recommendations & What-If
  recommendationsList: document.getElementById("recommendationsList"),
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
    case "needs_verification":
      return "Needs Verification";
    case "reserved_vacant":
    case "reserved":
      return "Reserved";
    case "booking_unused":
      return "Booked, Unused";  
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
    if (status === "booking_unused") {
    return {
      room_id,
      explanation: `In ${name} (${room_id}), a booking exists but no occupancy was detected (evidence: ${evidence}). The estimated avoidable energy is ${energy_range}, which is an estimate under stated assumptions, not a measurement. Suggested next step: verify on site whether the booking was actually used before switching anything off.`,
      source: "template"
    };
  }
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
    const [twinRes, recsRes, whatifRes] = await Promise.all([
      fetch(`${API_BASE}/twin?threshold=${currentThreshold}`),
      fetch(`${API_BASE}/recommendations?threshold=${currentThreshold}`),
      fetch(`${API_BASE}/whatif`)
    ]);

    if (!twinRes.ok) throw new Error(`GET /twin failed: ${twinRes.statusText}`);

    const twinData = await twinRes.json();
    const recsData = recsRes.ok ? await recsRes.json() : [];
    const whatifData = whatifRes.ok ? await whatifRes.json() : EMBEDDED_SAMPLE_WHATIF;

    state.rooms = Array.isArray(twinData) ? twinData : [];
    state.recommendations = Array.isArray(recsData) ? recsData : [];
    state.whatifRows = Array.isArray(whatifData) ? whatifData : EMBEDDED_SAMPLE_WHATIF;

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
  renderRecommendations();
  renderWhatIfTable();
  updateEvidencePanelIfSelected();

  const now = new Date();
  dom.gridLastUpdated.textContent = `Updated ${now.toLocaleTimeString()}`;
}

/**
 * Updates top KPI summary metrics.
 */
function updateKpis() {
  const rooms = state.rooms || [];
  const flagged = rooms.filter(r => r.status === "probable_waste");

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

  // Reset or preserve explanation state
  dom.explainBtn.disabled = false;
  dom.explainBtnText.textContent = "Explain with GenAI";
  dom.explainBtnIcon.textContent = "✨";
  dom.explainOutput.style.display = "none";
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
 * Renders the ranked recommendations list (GET /recommendations).
 * Empty state: "No probable waste right now".
 */
function renderRecommendations() {
  const container = dom.recommendationsList;
  const recs = state.recommendations || [];

  if (recs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✅</div>
        <div class="empty-text">No probable waste right now</div>
        <div style="font-size: 0.775rem; color: var(--text-muted); margin-top: 0.25rem;">
          All rooms are operating within normal occupancy thresholds.
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = "";

  recs.forEach((rec, idx) => {
    const item = document.createElement("div");
    item.className = "recommendation-item";
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.setAttribute("aria-label", `Recommendation ${idx + 1}: ${rec.name || rec.room_id}`);

    item.addEventListener("click", () => selectRoom(rec.room_id));
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectRoom(rec.room_id);
      }
    });

    const priorityStr = rec.priority !== undefined ? `Priority: ${Number(rec.priority).toFixed(3)}` : "High Priority";
    const costStr = formatCost(rec.cost_inr);
    const kwhStr = formatEnergyRange(rec);

    item.innerHTML = `
      <div class="rec-left">
        <span class="rec-title">#${idx + 1} ${escapeHtml(rec.name || rec.room_id)}</span>
        <span class="rec-subtitle">${escapeHtml(rec.vacant_min !== undefined ? `${rec.vacant_min}m idle` : "Unoccupied")} • ${escapeHtml(kwhStr)}</span>
      </div>
      <div class="rec-right">
        <span class="rec-priority">${escapeHtml(priorityStr)}</span>
        <span class="rec-cost">${escapeHtml(costStr)}</span>
      </div>
    `;

    container.appendChild(item);
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

    // Display Explanation Result
    dom.explainOutput.style.display = "block";
    dom.explainTextContent.textContent = explanationData.explanation || "No explanation text provided.";

    const source = (explanationData.source || "template").toLowerCase();
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
// ---------- v2: ranked queue ----------

// Makes text safe to put inside HTML
function esc(v) {
  const d = document.createElement("div");
  d.textContent = v ?? "";
  return d.innerHTML;
}

// Gets data from the sample file or from the live API
async function getData(apiPath, samplePath) {
  const url = USE_SAMPLE ? samplePath : `${API_BASE}${apiPath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

// Shows the queue in the box
// Shows the queue in the box, each item with a "Log this action" button
async function loadQueue(threshold) {
  const box = document.getElementById("queue-list");
  if (!box) return;
  try {
    const items = await getData(`/queue?threshold=${threshold}`, "sample_queue.json");
    if (items.length === 0) {
      box.innerHTML = "<p>No issues in the queue right now.</p>";
      return;
    }
    box.innerHTML = items.map(q => `
      <div>
        <strong>#${esc(q.rank)} ${esc(q.name)} (${esc(q.room_id)})</strong>
        <div>Suggested action: ${esc(q.action)}</div>
        <div>Evidence: ${esc(q.evidence_status)}</div>
        <div>Estimated avoidable: ${esc(q.est_kwh_low)} to ${esc(q.est_kwh_high)} kWh</div>
        <button class="queue-btn" data-room="${esc(q.room_id)}" data-action="${esc(q.action)}">
          Log this action
        </button>
      </div><hr>`).join("");
  } catch (err) {
    box.innerHTML = "<p>Queue unavailable.</p>";
  }
}

// Run it once when the page opens
loadQueue(15);
// ---------- v2: ledger ----------

// Shows the ledger in the box
async function loadLedger() {
  const box = document.getElementById("ledger-list");
  if (!box) return;
  try {
        let entries = await getData("/ledger", "sample_ledger.json");
        if (USE_SAMPLE) entries = entries.concat(window.extraLedger || []);
    if (entries.length === 0) {
      box.innerHTML = "<p>No actions logged yet.</p>";
      return;
    }
    box.innerHTML = entries.map(e => `
      <div>
        <strong>${esc(e.room_id)}: ${esc(e.action)}</strong>
        <div>Evidence: ${esc(e.evidence_status)}</div>
        <div>Estimated avoidable: ${esc(e.est_kwh_low)} to ${esc(e.est_kwh_high)} kWh</div>
        <div>Savings verified: ${e.savings_verified === true ? "Yes" : "No"}</div>
        <div><strong>Evidence missing:</strong>
          ${(e.evidence_missing || []).length === 0
            ? "none listed"
            : (e.evidence_missing || []).map(m => esc(m)).join(", ")}
        </div>
      </div><hr>`).join("");
  } catch (err) {
    box.innerHTML = "<p>Ledger unavailable.</p>";
  }
}

// Run it once when the page opens
loadLedger();
// ---------- v2: queue follows the threshold ----------

// When the slider moves, reload the queue with the new minutes
document.getElementById("thresholdSlider").addEventListener("input", (e) => {
  loadQueue(e.target.value);
});

// When a preset button (5m, 10m, 15m...) is clicked, do the same
document.querySelectorAll(".preset-btn[data-threshold]").forEach((btn) => {
  btn.addEventListener("click", () => {
    loadQueue(btn.dataset.threshold);
  });
});
// ---------- v2: log an action ----------

// Shows a message above the queue
function showActionMsg(text, isError) {
  const el = document.getElementById("actionMsg");
  el.textContent = text;
  el.style.color = isError ? "#b91c1c" : "#166534";
}

// Sends the action to the API (or fakes it in sample mode)
async function logAction(roomId, action) {
  try {
    if (USE_SAMPLE) {
      // Sample mode: remember the entry in the browser only
      window.extraLedger = window.extraLedger || [];
      window.extraLedger.push({
        id: 100 + window.extraLedger.length,
        room_id: roomId,
        status: "open",
        evidence_status: "unverified",
        action: action,
        response: "",
        est_kwh_low: 0,
        est_kwh_high: 0,
        savings_verified: false,
        evidence_missing: ["engine v2 not connected (sample mode)"]
      });
      showActionMsg("Logged (sample mode).", false);
    } else {
      const res = await fetch(`${API_BASE}/ledger/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId, action: action, ts: new Date().toISOString() })
      });
      if (res.status === 400) {
        // The engine refused: unknown room or no open issue
        const body = await res.json().catch(() => ({}));
        showActionMsg(body.detail || "Cannot log: unknown room or no open issue.", true);
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      showActionMsg("Action logged.", false);
    }
  } catch (err) {
    showActionMsg("Could not log the action. Is the API running?", true);
    return;
  }
  loadLedger();   // refresh the ledger box
}

// One listener for all "Log this action" buttons
document.getElementById("queue-list").addEventListener("click", (e) => {
  const btn = e.target.closest(".queue-btn");
  if (!btn) return;
  logAction(btn.dataset.room, btn.dataset.action);
});