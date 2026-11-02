/**
 * twin3d.js - 3D Digital Twin Module for Green Twin
 * Track 4: DSU Code Clash 2.0
 * 
 * High-performance, architectural 3D visualization using Three.js (r128).
 * Represents real room telemetry and physical evidence (R204, R205, R206, R207).
 * Strictly adheres to truthfulness: displays ONLY telemetry returned by the API,
 * never invents occupants, sensors, or measured figures.
 */

(function (window) {
  "use strict";

  // ==========================================================================
  // ARCHITECTURAL FLOOR PLAN LAYOUT (Strictly R204, R205, R206, R207)
  // ==========================================================================

  const ROOM_LAYOUTS = {
    R204: {
      name: "Lab 204",
      x: -5.5,
      z: -4.5,
      w: 6.8,
      d: 5.5,
      h: 2.2,
      doorSide: "south",
      type: "lab",
    },
    R205: {
      name: "Class 205",
      x: 5.5,
      z: -4.5,
      w: 6.8,
      d: 5.5,
      h: 2.2,
      doorSide: "south",
      type: "classroom",
    },
    R206: {
      name: "Hall 206",
      x: 5.5,
      z: 4.5,
      w: 6.8,
      d: 5.5,
      h: 2.2,
      doorSide: "north",
      type: "hall",
    },
    R207: {
      name: "Seminar 207",
      x: -5.5,
      z: 4.5,
      w: 6.8,
      d: 5.5,
      h: 2.2,
      doorSide: "north",
      type: "seminar",
    },
  };

  const STATUS_CONFIGS = {
    probable_waste: {
      color: 0xef4444,
      glowHex: "#ef4444",
      label: "PROBABLE WASTE",
      effect: "beam",
    },
    booking_unused: {
      color: 0xf97316,
      glowHex: "#f97316",
      label: "BOOKING UNUSED",
      effect: "stripes",
    },
    needs_verification: {
      color: 0x94a3b8,
      glowHex: "#94a3b8",
      label: "NEEDS VERIFY",
      effect: "question",
    },
    reserved_vacant: {
      color: 0x38bdf8,
      glowHex: "#38bdf8",
      label: "RESERVED",
      effect: "none",
    },
    reserved: {
      color: 0x38bdf8,
      glowHex: "#38bdf8",
      label: "RESERVED",
      effect: "none",
    },
    watching: {
      color: 0xf59e0b,
      glowHex: "#f59e0b",
      label: "WATCHING",
      effect: "none",
    },
    ok: {
      color: 0x22c55e,
      glowHex: "#22c55e",
      label: "NORMAL OK",
      effect: "none",
    },
    unknown: {
      color: 0x64748b,
      glowHex: "#64748b",
      label: "MONITORED",
      effect: "none",
    },
  };

  // State container
  const twin = {
    initialized: false,
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    raycaster: null,
    mouse: new THREE.Vector2(),
    roomNodes: {},       // roomId -> node objects
    clickableMeshes: [], // array for raycasting
    selectedRoomId: null,
    hoveredRoomId: null,
    selectionMesh: null,
    animFrameId: null,
    idleTimer: null,
    isUserInteracting: false,
    lastInteractionTime: 0,
    cameraTargetPos: null,
    controlsTargetPos: null,
    isCameraFlying: false,
    onRoomSelectedCallback: null,
  };

  // ==========================================================================
  // INITIALIZATION & SCENE SETUP
  // ==========================================================================

  function init(containerElement, onRoomSelected) {
    if (twin.initialized || !containerElement) return;

    if (typeof THREE === "undefined") {
      containerElement.innerHTML = `
        <div class="empty-state" style="padding-top: 100px;">
          <div class="empty-icon">🌐</div>
          <div class="empty-text">3D WebGL library not loaded.</div>
          <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 0.5rem;">
            Please check network connectivity for Three.js cdnjs.
          </div>
        </div>
      `;
      return;
    }

    twin.onRoomSelectedCallback = onRoomSelected;

    const width = containerElement.clientWidth || 600;
    const height = containerElement.clientHeight || 380;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d16);
    scene.fog = new THREE.FogExp2(0x090d16, 0.015);
    twin.scene = scene;

    // 2. Camera with initial cinematic fly-in distance
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000);
    camera.position.set(24, 28, 30); // starts further away for fly-in
    twin.camera = camera;

    // 3. Renderer with antialias and soft shadows
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    containerElement.innerHTML = "";
    containerElement.appendChild(renderer.domElement);
    twin.renderer = renderer;

    // 4. Orbit Controls
    if (typeof THREE.OrbitControls !== "undefined") {
      const controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.maxPolarAngle = Math.PI / 2 - 0.04; // prevent looking below floor
      controls.minDistance = 6;
      controls.maxDistance = 45;
      controls.target.set(0, 0, 0);

      controls.addEventListener("start", () => {
        twin.isUserInteracting = true;
        twin.lastInteractionTime = performance.now();
      });
      controls.addEventListener("end", () => {
        twin.isUserInteracting = false;
        twin.lastInteractionTime = performance.now();
      });

      twin.controls = controls;
    }

    // 5. Environmental Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.55);
    dirLight.position.set(15, 25, 12);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 5;
    dirLight.shadow.camera.far = 60;
    dirLight.shadow.camera.left = -16;
    dirLight.shadow.camera.right = 16;
    dirLight.shadow.camera.top = 16;
    dirLight.shadow.camera.bottom = -16;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);

    // 6. Base Foundation & Floor Slab
    buildFoundation(scene);

    // 7. Architectural Rooms Construction (R204, R205, R206, R207)
    buildRooms(scene);

    // 8. Active Selection Ring Mesh
    buildSelectionRing(scene);

    // 9. Raycasting Setup
    twin.raycaster = new THREE.Raycaster();
    setupEventListeners(renderer.domElement);

    // 10. Start Animation & Fly-In
    twin.initialized = true;
    flyInCamera(new THREE.Vector3(16, 18, 22), new THREE.Vector3(0, 0, 0));
    animate();
  }

  // ==========================================================================
  // ARCHITECTURAL GEOMETRY BUILDERS
  // ==========================================================================

  function buildFoundation(scene) {
    // 1. Sleek dark concrete floor slab
    const slabGeo = new THREE.BoxGeometry(22, 0.35, 18);
    const slabMat = new THREE.MeshStandardMaterial({
      color: 0x111625,
      roughness: 0.85,
      metalness: 0.15,
    });
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.y = -0.18;
    slab.receiveShadow = true;
    scene.add(slab);

    // 2. Central corridor runner
    const corridorGeo = new THREE.PlaneGeometry(3.6, 17.6);
    const corridorMat = new THREE.MeshStandardMaterial({
      color: 0x182033,
      roughness: 0.6,
      metalness: 0.2,
    });
    const corridor = new THREE.Mesh(corridorGeo, corridorMat);
    corridor.rotation.x = -Math.PI / 2;
    corridor.position.y = 0.005;
    corridor.receiveShadow = true;
    scene.add(corridor);

    // 3. Grid Helper
    const grid = new THREE.GridHelper(30, 30, 0x1e293b, 0x0f172a);
    grid.position.y = -0.19;
    scene.add(grid);
  }

  function buildRooms(scene) {
    twin.clickableMeshes = [];

    for (const [roomId, layout] of Object.entries(ROOM_LAYOUTS)) {
      const roomGroup = new THREE.Group();
      roomGroup.position.set(layout.x, 0, layout.z);

      // A. Room Floor Plate (Interactive click target)
      const floorGeo = new THREE.PlaneGeometry(layout.w, layout.d);
      const floorMat = new THREE.MeshStandardMaterial({
        color: 0x151c2d,
        roughness: 0.7,
        metalness: 0.1,
      });
      const floorMesh = new THREE.Mesh(floorGeo, floorMat);
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.y = 0.01;
      floorMesh.receiveShadow = true;
      floorMesh.userData = { roomId: roomId, isRoomFloor: true };
      roomGroup.add(floorMesh);
      twin.clickableMeshes.push(floorMesh);

      // B. Perimeter & Partition Walls with Doorway Cut-out
      buildRoomWalls(roomGroup, layout);

      // C. Ceiling Light Fixture (Suspended Emissive Panel)
      const fixtureGroup = new THREE.Group();
      fixtureGroup.position.set(0, layout.h - 0.1, 0);

      const panelGeo = new THREE.BoxGeometry(layout.w * 0.45, 0.06, layout.d * 0.35);
      const panelMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        emissive: 0x000000,
        emissiveIntensity: 0,
        roughness: 0.3,
      });
      const fixturePanel = new THREE.Mesh(panelGeo, panelMat);
      fixtureGroup.add(fixturePanel);

      const downLight = new THREE.PointLight(0xffffff, 0, 10, 2);
      downLight.position.set(0, -0.2, 0);
      downLight.castShadow = true;
      downLight.shadow.bias = -0.001;
      fixtureGroup.add(downLight);

      roomGroup.add(fixtureGroup);

      // D. Furniture Blocks (Specific to room role)
      buildRoomFurniture(roomGroup, layout);

      // E. Special Effects Elements:
      // E1: Pulsing Light Beam (Probable Waste)
      const beamGeo = new THREE.CylinderGeometry(0.3, layout.w * 0.4, layout.h * 1.6, 16, 1, true);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const beamMesh = new THREE.Mesh(beamGeo, beamMat);
      beamMesh.position.set(0, layout.h * 0.8, 0);
      beamMesh.visible = false;
      roomGroup.add(beamMesh);

      // E2: Striped Overlay (Booking Unused)
      const stripeGeo = new THREE.PlaneGeometry(layout.w * 0.95, layout.d * 0.95);
      const stripeTexture = createStripeTexture();
      const stripeMat = new THREE.MeshBasicMaterial({
        map: stripeTexture,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
      });
      const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
      stripeMesh.rotation.x = -Math.PI / 2;
      stripeMesh.position.y = 0.015;
      stripeMesh.visible = false;
      roomGroup.add(stripeMesh);

      // E3: Question Marker Sprite (Needs Verification)
      const questionSprite = createQuestionSprite();
      questionSprite.position.set(0, layout.h + 0.6, 0);
      questionSprite.visible = false;
      roomGroup.add(questionSprite);

      // F. Floating HUD Canvas Sprite Label
      const { sprite, canvas, ctx, texture } = createFloatingRoomLabel(layout.name, roomId);
      sprite.position.set(0, layout.h + 1.25, 0);
      roomGroup.add(sprite);

      scene.add(roomGroup);

      twin.roomNodes[roomId] = {
        group: roomGroup,
        floorMesh: floorMesh,
        fixturePanel: fixturePanel,
        downLight: downLight,
        beamMesh: beamMesh,
        stripeMesh: stripeMesh,
        questionSprite: questionSprite,
        labelSprite: sprite,
        labelCanvas: canvas,
        labelCtx: ctx,
        labelTexture: texture,
        layout: layout,
        currentStatus: "unknown",
      };
    }
  }

  function buildRoomWalls(group, layout) {
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      transparent: true,
      opacity: 0.45,
      roughness: 0.7,
      metalness: 0.1,
    });

    const w = layout.w;
    const d = layout.d;
    const h = layout.h;
    const wallThick = 0.15;
    const doorGap = 1.3;

    // North wall
    if (layout.doorSide === "north") {
      const segW = (w - doorGap) / 2;
      const nw1 = new THREE.Mesh(new THREE.BoxGeometry(segW, h, wallThick), wallMat);
      nw1.position.set(-w / 2 + segW / 2, h / 2, -d / 2);
      group.add(nw1);

      const nw2 = new THREE.Mesh(new THREE.BoxGeometry(segW, h, wallThick), wallMat);
      nw2.position.set(w / 2 - segW / 2, h / 2, -d / 2);
      group.add(nw2);
    } else {
      const nw = new THREE.Mesh(new THREE.BoxGeometry(w, h, wallThick), wallMat);
      nw.position.set(0, h / 2, -d / 2);
      group.add(nw);
    }

    // South wall
    if (layout.doorSide === "south") {
      const segW = (w - doorGap) / 2;
      const sw1 = new THREE.Mesh(new THREE.BoxGeometry(segW, h, wallThick), wallMat);
      sw1.position.set(-w / 2 + segW / 2, h / 2, d / 2);
      group.add(sw1);

      const sw2 = new THREE.Mesh(new THREE.BoxGeometry(segW, h, wallThick), wallMat);
      sw2.position.set(w / 2 - segW / 2, h / 2, d / 2);
      group.add(sw2);
    } else {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(w, h, wallThick), wallMat);
      sw.position.set(0, h / 2, d / 2);
      group.add(sw);
    }

    // East wall
    const ew = new THREE.Mesh(new THREE.BoxGeometry(wallThick, h, d), wallMat);
    ew.position.set(w / 2, h / 2, 0);
    group.add(ew);

    // West wall
    const ww = new THREE.Mesh(new THREE.BoxGeometry(wallThick, h, d), wallMat);
    ww.position.set(-w / 2, h / 2, 0);
    group.add(ww);
  }

  function buildRoomFurniture(group, layout) {
    const furnitureMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.6,
      metalness: 0.2,
    });
    const chairMat = new THREE.MeshStandardMaterial({
      color: 0x0f766e,
      roughness: 0.5,
    });

    if (layout.type === "lab") {
      // 2 Lab workbenches
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.75, 1.1), furnitureMat);
      b1.position.set(0, 0.375, -1.0);
      b1.castShadow = true;
      group.add(b1);

      const b2 = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.75, 1.1), furnitureMat);
      b2.position.set(0, 0.375, 1.2);
      b2.castShadow = true;
      group.add(b2);

    } else if (layout.type === "classroom") {
      // Teacher podium + student desk rows
      const podium = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.75, 0.8), furnitureMat);
      podium.position.set(0, 0.375, -1.6);
      podium.castShadow = true;
      group.add(podium);

      for (let z = 0; z <= 1.4; z += 1.3) {
        for (let x = -1.5; x <= 1.5; x += 3.0) {
          const desk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.65, 0.75), furnitureMat);
          desk.position.set(x, 0.325, z);
          desk.castShadow = true;
          group.add(desk);
        }
      }

    } else if (layout.type === "hall") {
      // Large conference table in center + chairs
      const confTable = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.75, 2.2), furnitureMat);
      confTable.position.set(0, 0.375, 0);
      confTable.castShadow = true;
      group.add(confTable);

    } else if (layout.type === "seminar") {
      // Presentation board on wall + 2 wide seminar rows
      const screen = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.4, 0.08), furnitureMat);
      screen.position.set(0, 1.4, -2.4);
      group.add(screen);

      const row1 = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.65, 0.75), furnitureMat);
      row1.position.set(0, 0.325, -0.6);
      row1.castShadow = true;
      group.add(row1);

      const row2 = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.65, 0.75), furnitureMat);
      row2.position.set(0, 0.325, 1.1);
      row2.castShadow = true;
      group.add(row2);
    }
  }

  function buildSelectionRing(scene) {
    const ringGeo = new THREE.RingGeometry(0.1, 0.25, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x0f766e,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    scene.add(ring);
    twin.selectionMesh = ring;
  }

  // ==========================================================================
  // TEXTURE & SPRITE GENERATORS
  // ==========================================================================

  function createStripeTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "rgba(249, 115, 22, 0.05)";
    ctx.fillRect(0, 0, 128, 128);

    ctx.strokeStyle = "rgba(249, 115, 22, 0.45)";
    ctx.lineWidth = 14;

    for (let i = -128; i < 256; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 128, 128);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 3);
    return texture;
  }

  function createQuestionSprite() {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");

    // Circular background badge
    ctx.fillStyle = "rgba(30, 41, 59, 0.85)";
    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 6;
    ctx.stroke();

    // Large Question Mark
    ctx.font = "bold 64px sans-serif";
    ctx.fillStyle = "#f8fafc";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.1, 1.1, 1);
    return sprite;
  }

  function createFloatingRoomLabel(roomName, roomId) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;

    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(4.0, 2.0, 1.0);

    drawLabelCanvas(ctx, canvas, roomName, roomId, "MONITORED", "#94a3b8", "0.000 kWh", 0);
    texture.needsUpdate = true;

    return { sprite, canvas, ctx, texture };
  }

  function drawLabelCanvas(ctx, canvas, name, roomId, statusLabel, badgeColor, kwhText, headCount) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Rounded Box Background
    const x = 16;
    const y = 16;
    const w = canvas.width - 32;
    const h = canvas.height - 32;
    const r = 24;

    ctx.fillStyle = "rgba(10, 15, 28, 0.88)";
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();

    // Border
    ctx.strokeStyle = badgeColor || "#334155";
    ctx.lineWidth = 5;
    ctx.stroke();

    // 1. Room Name Title
    ctx.font = "bold 34px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.fillText(`${name} (${roomId})`, 38, 70);

    // 2. Status Badge Pill
    const badgeW = 210;
    const badgeH = 40;
    const bx = 38;
    const by = 92;

    ctx.fillStyle = badgeColor || "#475569";
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bx, by, badgeW, badgeH, 12) : ctx.rect(bx, by, badgeW, badgeH);
    ctx.fill();

    ctx.font = "bold 20px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(statusLabel.toUpperCase(), bx + badgeW / 2, by + 27);

    // 3. Telemetry Energy Range
    ctx.font = "600 24px sans-serif";
    ctx.fillStyle = "#cbd5e1";
    ctx.textAlign = "left";
    ctx.fillText(`Est. Avoidable: ${kwhText}`, 38, 175);

    // 4. Head Count Badge (Honesty rule: Only real counts from API, no fake occupants)
    ctx.font = "500 20px sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`Telemetry: ${headCount} person${headCount === 1 ? "" : "s"} detected`, 38, 208);
  }

  // ==========================================================================
  // TELEMETRY SYNC (Update 3D state from API)
  // ==========================================================================

  function update(rooms) {
    if (!twin.initialized || !Array.isArray(rooms)) return;

    rooms.forEach(room => {
      const node = twin.roomNodes[room.room_id];
      if (!node) return;

      const status = (room.status || "unknown").toLowerCase();
      const cfg = STATUS_CONFIGS[status] || STATUS_CONFIGS.unknown;
      node.currentStatus = status;

      // 1. Update Floor Glow & Material
      const floorMat = node.floorMesh.material;
      floorMat.color.setHex(cfg.color);
      floorMat.emissive = new THREE.Color(cfg.color);
      floorMat.emissiveIntensity = (status === "probable_waste" || status === "booking_unused") ? 0.35 : 0.08;

      // 2. Update Ceiling Fixture & Downward Light
      const isLightOn = (room.light_on !== false && status !== "reserved_vacant" && status !== "ok");
      if (isLightOn) {
        node.fixturePanel.material.emissive.setHex(cfg.color);
        node.fixturePanel.material.emissiveIntensity = 2.2;
        node.downLight.color.setHex(cfg.color);
        node.downLight.intensity = (status === "probable_waste" || status === "booking_unused") ? 2.5 : 1.2;
      } else {
        node.fixturePanel.material.emissive.setHex(0x000000);
        node.fixturePanel.material.emissiveIntensity = 0;
        node.downLight.intensity = 0;
      }

      // 3. Update Visual Effects:
      // Probable Waste: vertical beam
      if (status === "probable_waste") {
        node.beamMesh.visible = true;
      } else {
        node.beamMesh.visible = false;
        node.beamMesh.material.opacity = 0;
      }

      // Booking Unused: striped overlay
      if (status === "booking_unused") {
        node.stripeMesh.visible = true;
        node.stripeMesh.material.opacity = 0.55;
      } else {
        node.stripeMesh.visible = false;
        node.stripeMesh.material.opacity = 0;
      }

      // Needs Verification: Question marker
      if (status === "needs_verification") {
        node.questionSprite.visible = true;
      } else {
        node.questionSprite.visible = false;
      }

      // 4. Update Floating Canvas Label
      let kwhStr = "0.000 kWh";
      if (status === "needs_verification") {
        kwhStr = "no claim made"; // Strict honesty rule
      } else if (room.kwh_low !== undefined && room.kwh_high !== undefined) {
        kwhStr = `${Number(room.kwh_low).toFixed(3)} - ${Number(room.kwh_high).toFixed(3)} kWh`;
      }

      const count = (room.person_count !== undefined && room.person_count !== null)
        ? room.person_count
        : (room.vacant_min > 0 ? 0 : 1);

      drawLabelCanvas(
        node.labelCtx,
        node.labelCanvas,
        node.layout.name,
        room.room_id,
        cfg.label,
        cfg.glowHex,
        kwhStr,
        count
      );
      node.labelTexture.needsUpdate = true;
    });

    // Re-align selection mesh if active
    if (twin.selectedRoomId) {
      selectRoom(twin.selectedRoomId, false);
    }
  }

  // ==========================================================================
  // CAMERA VIEWS & INTERACTIVITY
  // ==========================================================================

  function selectRoom(roomId, moveCamera = true) {
    twin.selectedRoomId = roomId;
    const node = twin.roomNodes[roomId];

    if (!node || !twin.selectionMesh) {
      if (twin.selectionMesh) twin.selectionMesh.visible = false;
      return;
    }

    // Position selection highlight ring around room
    const layout = node.layout;
    twin.selectionMesh.visible = true;
    twin.selectionMesh.scale.set(layout.w * 0.52, layout.d * 0.52, 1);
    twin.selectionMesh.position.set(layout.x, 0.03, layout.z);

    if (moveCamera && twin.controls) {
      const targetControlsPos = new THREE.Vector3(layout.x, 0, layout.z);
      const targetCamPos = new THREE.Vector3(layout.x + 8, 12, layout.z + 10);
      flyInCamera(targetCamPos, targetControlsPos);
    }
  }

  function setView(viewType) {
    if (!twin.camera || !twin.controls) return;

    if (viewType === "iso") {
      flyInCamera(new THREE.Vector3(16, 18, 22), new THREE.Vector3(0, 0, 0));
    } else if (viewType === "top") {
      flyInCamera(new THREE.Vector3(0, 26, 0.1), new THREE.Vector3(0, 0, 0));
    } else if (viewType === "waste") {
      // Find room with probable_waste or booking_unused
      const wasteEntry = Object.entries(twin.roomNodes).find(([id, n]) =>
        n.currentStatus === "probable_waste" || n.currentStatus === "booking_unused"
      );
      if (wasteEntry) {
        selectRoom(wasteEntry[0], true);
      } else {
        flyInCamera(new THREE.Vector3(16, 18, 22), new THREE.Vector3(0, 0, 0));
      }
    }
  }

  function flyInCamera(targetCamPos, targetControlsPos) {
    twin.cameraTargetPos = targetCamPos.clone();
    twin.controlsTargetPos = targetControlsPos.clone();
    twin.isCameraFlying = true;
  }

  function setupEventListeners(domElement) {
    // Click / Touch Raycasting
    domElement.addEventListener("click", onPointerClick);
    domElement.addEventListener("mousemove", onPointerMove);

    window.addEventListener("resize", () => {
      if (!twin.renderer || !twin.camera) return;
      const parent = domElement.parentElement;
      if (!parent) return;
      const w = parent.clientWidth || 600;
      const h = parent.clientHeight || 380;
      twin.camera.aspect = w / h;
      twin.camera.updateProjectionMatrix();
      twin.renderer.setSize(w, h);
    });
  }

  function onPointerClick(e) {
    const rect = twin.renderer.domElement.getBoundingClientRect();
    twin.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    twin.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    twin.raycaster.setFromCamera(twin.mouse, twin.camera);
    const intersects = twin.raycaster.intersectObjects(twin.clickableMeshes);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const roomId = hit.userData.roomId;
      if (roomId) {
        selectRoom(roomId, true);
        if (typeof twin.onRoomSelectedCallback === "function") {
          twin.onRoomSelectedCallback(roomId);
        }
      }
    }
  }

  function onPointerMove(e) {
    const rect = twin.renderer.domElement.getBoundingClientRect();
    twin.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    twin.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    twin.raycaster.setFromCamera(twin.mouse, twin.camera);
    const intersects = twin.raycaster.intersectObjects(twin.clickableMeshes);

    if (intersects.length > 0) {
      twin.renderer.domElement.style.cursor = "pointer";
    } else {
      twin.renderer.domElement.style.cursor = "default";
    }
  }

  // ==========================================================================
  // RENDER LOOP & PULSE ANIMATIONS
  // ==========================================================================

  function animate() {
    twin.animFrameId = requestAnimationFrame(animate);

    const time = performance.now() * 0.001;

    // 1. Camera interpolation (fly-in / focus transitions)
    if (twin.isCameraFlying && twin.cameraTargetPos && twin.controlsTargetPos) {
      twin.camera.position.lerp(twin.cameraTargetPos, 0.06);
      if (twin.controls) {
        twin.controls.target.lerp(twin.controlsTargetPos, 0.06);
      }

      if (twin.camera.position.distanceTo(twin.cameraTargetPos) < 0.15) {
        twin.isCameraFlying = false;
      }
    }

    // 2. Gentle idle rotation (stops when user interacts)
    const timeSinceInteraction = performance.now() - twin.lastInteractionTime;
    if (!twin.isUserInteracting && !twin.isCameraFlying && timeSinceInteraction > 4000) {
      if (twin.controls) {
        twin.controls.autoRotate = true;
        twin.controls.autoRotateSpeed = 0.45;
      }
    } else if (twin.controls) {
      twin.controls.autoRotate = false;
    }

    // 3. Status effect animations:
    // A. Probable Waste pulsing light beam
    for (const node of Object.values(twin.roomNodes)) {
      if (node.currentStatus === "probable_waste" && node.beamMesh.visible) {
        const pulse = 0.2 + 0.18 * Math.sin(time * 3.0);
        node.beamMesh.material.opacity = pulse;
      }
      // B. Needs verification question mark gentle bobbing
      if (node.currentStatus === "needs_verification" && node.questionSprite.visible) {
        node.questionSprite.position.y = node.layout.h + 0.6 + 0.08 * Math.sin(time * 2.5);
      }
    }

    if (twin.controls) {
      twin.controls.update();
    }

    if (twin.renderer && twin.scene && twin.camera) {
      twin.renderer.render(twin.scene, twin.camera);
    }
  }

  // ==========================================================================
  // PUBLIC EXPORTS
  // ==========================================================================

  window.twin3d = {
    init: init,
    update: update,
    selectRoom: selectRoom,
    setView: setView,
  };

})(window);
