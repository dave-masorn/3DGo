// 3D Analytics Dashboard App

// State
let boardSize = 19;
let boardState = []; // 2D array [r][c] -> {player: 'B' | 'W' | null}
let moveHistory = [];
let currentMoveIndex = -1;
let currentRippleMesh = null; // Reused for the 3D aura system
let auraTexture = null;
let pendingMove = null;
let pendingRingMesh = null;
let hoverRingMesh = null;
let lastMoveMarkerMesh = null;
let isCameraDragging = false;

function getAuraTexture() {
  if (!auraTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.2, 'rgba(255,255,255,0.5)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,64,64);
    auraTexture = new THREE.CanvasTexture(canvas);
  }
  return auraTexture;
}
let _aiColor = 'B'; // which color the AI plays
function getAIColor() { return _aiColor; }
window.setAIColor = function(color, btn) {
  _aiColor = color;
  document.querySelectorAll('.ai-color-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
};

let capturedByBlack = 0;
let capturedByWhite = 0;
let captureHistory = [];

let fxEnabled = false;
window.toggleFx = function() {
  fxEnabled = !fxEnabled;
  const btn = document.getElementById('btn-fx');
  if (btn) btn.classList.toggle('active', fxEnabled);
};

// Cinematic Auto-Camera
let autoCamEnabled = false;
let hoshiCamEnabled = false;
let autoCamTarget = new THREE.Vector3(0, 0, 0);
let autoCamPos = new THREE.Vector3(0, 72, 46);
let manualCamOverride = false;

window.toggleHoshiCam = function() {
    hoshiCamEnabled = !hoshiCamEnabled;
    const hoshiIcon = document.getElementById('hoshi-icon');
    if (hoshiIcon) {
        if (hoshiCamEnabled) {
            hoshiIcon.style.color = 'var(--accent-cyan)';
            hoshiIcon.style.filter = 'drop-shadow(0 0 5px var(--accent-cyan))';
        } else {
            hoshiIcon.style.color = 'var(--text-muted)';
            hoshiIcon.style.filter = 'none';
        }
    }
    if (autoCamEnabled) updateAutoCamTarget(currentMoveIndex);
};

window.toggleAutoCam = function() {
  autoCamEnabled = !autoCamEnabled;
  const group = document.getElementById('btn-cam-auto-group');
  if (group) group.classList.toggle('active', autoCamEnabled);
  
  const hoshiBtn = document.getElementById('btn-cam-hoshi');
  if (hoshiBtn) {
      if (autoCamEnabled) {
          hoshiBtn.style.opacity = '1';
          hoshiBtn.style.pointerEvents = 'auto';
      } else {
          hoshiBtn.style.opacity = '0.4';
          hoshiBtn.style.pointerEvents = 'none';
          // Also forcibly turn off Hoshi if Auto-Cam is turned off
          if (hoshiCamEnabled) toggleHoshiCam();
      }
  }
  
  if (autoCamEnabled) {
      manualCamOverride = false;
      if (currentMoveIndex >= 0) {
          updateAutoCamTarget(currentMoveIndex);
      }
  }
};

function updateAutoCamTarget(moveIdx) {
  if (moveIdx < 0 || moveIdx >= moveHistory.length) return;
  
  // When reaching the end of the replay, smoothly return to the initial overview position
  if (!playModeEnabled && moveIdx === moveHistory.length - 1) {
      autoCamTarget.set(0, 0, 10);
      autoCamPos.set(0, 72, 56);
      return;
  }
  const move = moveHistory[moveIdx];
  const stoneX = move.c * STEP_SIZE - GRID_OFFSET;
  const stoneZ = move.r * STEP_SIZE - GRID_OFFSET;
  
  if (hoshiCamEnabled) {
      // Find the nearest Hoshi point (indices 3, 9, 15)
      const hoshis = [3, 9, 15];
      const hoshiC = hoshis.reduce((prev, curr) => Math.abs(curr - move.c) < Math.abs(prev - move.c) ? curr : prev);
      const hoshiR = hoshis.reduce((prev, curr) => Math.abs(curr - move.r) < Math.abs(prev - move.r) ? curr : prev);
      
      const targetX = hoshiC * STEP_SIZE - GRID_OFFSET;
      const targetZ = hoshiR * STEP_SIZE - GRID_OFFSET;
      
      // Target the Hoshi point
      autoCamTarget.set(targetX * 0.8, 0, targetZ * 0.8);
      
      // Prohibit full board flipping. Keep angle fixed at bottom edge (PI/2),
      // with a slight parallax sway based on the stone's horizontal position for smoothness.
      const sway = (stoneX / GRID_OFFSET) * 0.25; 
      const angle = (Math.PI / 2) - sway; 
      
      const dist = 48; // Pull back slightly to keep the whole quadrant in view
      const height = 40;
      
      autoCamPos.set(
        autoCamTarget.x + Math.cos(angle) * dist,
        height,
        autoCamTarget.z + Math.sin(angle) * dist
      );
  } else {
      // Target closer to the actual stone so corners expose the surrounding area
      autoCamTarget.set(stoneX * 0.85, 0, stoneZ * 0.85);
      
      // Position camera at an angle relative to the stone (causes orbiting/flipping)
      const angle = Math.atan2(stoneZ, stoneX);
      const dist = 35; // hover distance
      const height = 28; 
      
      autoCamPos.set(
        autoCamTarget.x + Math.cos(angle) * dist,
        height,
        autoCamTarget.z + Math.sin(angle) * dist
      );
  }
}
let scene, camera, renderer, controls;
let stoneMeshes = [];
let boardMesh, planeMesh;

// Board geometry constants — all derived from a single source of truth
const BOARD_UNITS = 60;                          // total world-units the board occupies
const GRID_LINES  = 19;                          // 19×19
const STEP_SIZE   = BOARD_UNITS / (GRID_LINES + 1); // gap between lines
const GRID_OFFSET = (STEP_SIZE * (GRID_LINES - 1)) / 2; // centre of line [0] to centre of line [18]

// Legacy alias kept so nothing else breaks
const BOARD_WIDTH = BOARD_UNITS;
const CELL_SIZE   = STEP_SIZE;

const NOISE_GLSL = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
vec3 fade(vec3 t) {return t*t*t*(t*(t*6.0-15.0)+10.0);}

float cnoise(vec3 P){
  vec3 Pi0 = floor(P);
  vec3 Pi1 = Pi0 + vec3(1.0);
  Pi0 = mod(Pi0, 289.0);
  Pi1 = mod(Pi1, 289.0);
  vec3 Pf0 = fract(P);
  vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;

  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);

  vec4 gx0 = ixy0 / 7.0;
  vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);

  vec4 gx1 = ixy1 / 7.0;
  vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);

  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
  vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
  vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
  vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
  vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x;
  g010 *= norm0.y;
  g100 *= norm0.z;
  g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x;
  g011 *= norm1.y;
  g101 *= norm1.z;
  g111 *= norm1.w;

  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);

  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x); 
  return 2.2 * n_xyz;
}
`;

function createStoneMatcapTexture(isBlack) {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const targetCtx = canvas.getContext('2d');
  
  const cx = S / 2;
  const cy = S / 2;
  const currentStoneRadius = S / 2 - 4;

  targetCtx.save();
  
  if (isBlack) {
      const gradient = targetCtx.createRadialGradient(
          cx - currentStoneRadius * 0.3, cy - currentStoneRadius * 0.3, currentStoneRadius * 0.1,
          cx - currentStoneRadius * 0.1, cy - currentStoneRadius * 0.1, currentStoneRadius * 1.1
      );
      gradient.addColorStop(0.0, '#5a5a5a'); 
      gradient.addColorStop(0.4, '#1a1a1a'); 
      gradient.addColorStop(1.0, '#000000'); 
      
      targetCtx.fillStyle = gradient;
      targetCtx.beginPath();
      targetCtx.arc(cx, cy, currentStoneRadius, 0, Math.PI * 2);
      targetCtx.fill();
  } else {
      const gradient = targetCtx.createRadialGradient(
          cx - currentStoneRadius * 0.3, cy - currentStoneRadius * 0.3, currentStoneRadius * 0.2,
          cx - currentStoneRadius * 0.1, cy - currentStoneRadius * 0.1, currentStoneRadius * 1.1
      );
      gradient.addColorStop(0.0, '#ffffff'); 
      gradient.addColorStop(0.5, '#e6e6e6'); 
      gradient.addColorStop(1.0, '#a0a0a0'); 
      
      targetCtx.fillStyle = gradient;
      targetCtx.beginPath();
      targetCtx.arc(cx, cy, currentStoneRadius, 0, Math.PI * 2);
      targetCtx.fill();
      
      targetCtx.shadowColor = 'transparent';
      targetCtx.lineWidth = Math.max(0.5, currentStoneRadius * 0.02);
      targetCtx.strokeStyle = '#888888';
      targetCtx.stroke();
  }
  
  targetCtx.restore();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const blackStoneMat = new THREE.MeshMatcapMaterial({
  matcap: createStoneMatcapTexture(true)
});

const whiteStoneMat = new THREE.MeshMatcapMaterial({
  matcap: createStoneMatcapTexture(false)
});

const blackStoneMatStatic = blackStoneMat;
const whiteStoneMatStatic = whiteStoneMat;

// Traditional Drop Shadow (Replaces Sci-Fi Caustics)
function createShadowTexture() {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  const cx = S/2, cy = S/2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
  grad.addColorStop(0.2, 'rgba(0,0,0,0.6)'); 
  grad.addColorStop(0.6, 'rgba(0,0,0,0.2)'); 
  grad.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,S,S);
  return new THREE.CanvasTexture(canvas);
}

const dropShadowMat = new THREE.MeshBasicMaterial({ 
  map: createShadowTexture(), 
  transparent: true, 
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1.5,
  polygonOffsetUnits: -4
});

const placeSound   = new Audio('sfx/scifi-stone-placing.wav');
const unplaceSound = new Audio('sfx/scifi-stone-unplacing.wav');

const highlightMaterials = {
  danger: new THREE.MeshBasicMaterial({ color: 0xdc2626, transparent: true, opacity: 0.6 }),
  safe:   new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.6 }),
};

let gridLines, waveTime = 0; // for breathing wave effect

function initThree() {
  const container = document.getElementById('three-container');

  scene = new THREE.Scene();
  
  // Lighting — Key, Fill, Rim
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  
  // Key Light (top-left, white, 90%)
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
  keyLight.position.set(-10, 20, -10);
  scene.add(keyLight);
  
  // Fill Light (bottom, blue, 25%)
  const fillLight = new THREE.DirectionalLight(0x0088ff, 0.25);
  fillLight.position.set(0, -10, 0);
  scene.add(fillLight);
  
  // Rim Light (back-right, white, 15%)
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.15);
  rimLight.position.set(10, 5, 10);
  scene.add(rimLight);

  const purpleGlow = new THREE.PointLight(0x8b3cf7, 1.2, 70);
  purpleGlow.position.set(-38, -1, -38);
  scene.add(purpleGlow);

  const cyanGlow = new THREE.PointLight(0x06b6d4, 1.2, 70);
  cyanGlow.position.set(38, -1, 38);
  scene.add(cyanGlow);

  camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.5, 600);
  camera.position.set(0, 72, 56);
  camera.lookAt(0, 0, 10);
  
  updateCameraFov();

  window.toggleSidebar = function() {
    const sidebar = document.getElementById('sidebar');
    if (window.innerWidth <= 768) {
        sidebar.classList.toggle('mobile-open');
    } else {
        sidebar.classList.toggle('collapsed');
    }
  };

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.domElement.id = 'three-canvas';
  renderer.setSize(container.clientWidth, container.clientHeight, false); // false = let CSS handle display size
  // Cap pixel ratio to 1.25 instead of 2.0. This slashes fragment shader load by ~60% on retina displays while remaining sharp.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 10);
  controls.enableDamping  = true;
  controls.dampingFactor  = 0.06;
  controls.minPolarAngle  = Math.PI * 0.10;
  controls.maxPolarAngle  = Math.PI * 0.46;
  controls.minDistance    = 2;
  controls.maxDistance    = 200;
  controls.enablePan = true;
  controls.screenSpacePanning = false; // Pan moves parallel to the board (XZ plane), keeping height constant
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

  controls.update();
  controls.saveState();

  const confCanvas = document.createElement('canvas');
  confCanvas.width = 128;
  confCanvas.height = 128;
  const confCtx = confCanvas.getContext('2d');
  
  confCtx.strokeStyle = '#ffffff';
  confCtx.lineWidth = 6;
  confCtx.shadowColor = 'rgba(0,0,0,0.5)';
  confCtx.shadowBlur = 4;
  confCtx.beginPath();
  confCtx.arc(64, 64, 50, 0, Math.PI * 2);
  confCtx.stroke();

  confCtx.fillStyle = '#ffffff';
  confCtx.beginPath();
  confCtx.arc(64, 64, 12, 0, Math.PI * 2);
  confCtx.fill();

  const confTex = new THREE.CanvasTexture(confCanvas);
  confTex.needsUpdate = true;
  const confMat = new THREE.MeshBasicMaterial({ map: confTex, transparent: true, depthWrite: false, depthTest: false });
  pendingRingMesh = new THREE.Mesh(new THREE.PlaneGeometry(STONE_R * 2.5, STONE_R * 2.5), confMat);
  pendingRingMesh.rotation.x = -Math.PI / 2;
  pendingRingMesh.position.y = 0.05;
  pendingRingMesh.visible = false;
  pendingRingMesh.renderOrder = 999;
  scene.add(pendingRingMesh);

  hoverRingMesh = pendingRingMesh.clone();
  hoverRingMesh.material = confMat.clone();
  hoverRingMesh.material.opacity = 0.5;
  hoverRingMesh.renderOrder = 999;
  scene.add(hoverRingMesh);

  const markerCanvas = document.createElement('canvas');
  markerCanvas.width = 64;
  markerCanvas.height = 64;
  const markerCtx = markerCanvas.getContext('2d');
  markerCtx.fillStyle = '#10b981'; // vibrant green
  markerCtx.shadowColor = 'rgba(0,0,0,0.8)';
  markerCtx.shadowBlur = 4;
  markerCtx.beginPath();
  markerCtx.arc(32, 32, 16, 0, Math.PI * 2);
  markerCtx.fill();
  
  const markerTex = new THREE.CanvasTexture(markerCanvas);
  markerTex.needsUpdate = true;
  const markerMat = new THREE.MeshBasicMaterial({ map: markerTex, transparent: true, depthWrite: false });
  lastMoveMarkerMesh = new THREE.Mesh(new THREE.PlaneGeometry(STONE_R, STONE_R), markerMat);
  lastMoveMarkerMesh.rotation.x = -Math.PI / 2;
  lastMoveMarkerMesh.position.y = STONE_R * 1.05; // Just above the stone
  lastMoveMarkerMesh.visible = false;
  scene.add(lastMoveMarkerMesh);

  let didCameraMove = false;
  controls.addEventListener('start', () => {
    manualCamOverride = true;
    didCameraMove = false;
    isCameraDragging = true;
  });
  
  controls.addEventListener('change', () => {
    didCameraMove = true;
  });
  
  controls.addEventListener('end', () => {
    isCameraDragging = false;
    if (!didCameraMove) {
      // It was just a click, don't break the auto-cam override loop
      manualCamOverride = false;
    }
  });

  let canvasLastTap = 0;
  let isMultiTouch = false;

  renderer.domElement.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) {
          isMultiTouch = true;
          canvasLastTap = 0; // Prevent next touchend from triggering double-tap
      } else {
          isMultiTouch = false;
      }
  }, { passive: true });

  function handleCanvasDblTapClick(e) {
      if (e && e.type === 'touchend') {
          if (isMultiTouch || e.changedTouches.length > 1) return;
          const currentTime = new Date().getTime();
          const tapLength = currentTime - canvasLastTap;
          if (tapLength < 400 && tapLength > 0) {
              // Valid double tap
          } else {
              canvasLastTap = currentTime;
              return;
          }
      }
      
    controls.enabled = false;
    
    const startCamPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const initialCamPos = new THREE.Vector3(0, 72, 56);
    const initialTarget = new THREE.Vector3(0, 0, 10);
    
    const duration = 800;
    const startTime = performance.now();
    
    function animateReset() {
      const now = performance.now();
      let progress = (now - startTime) / duration;
      if (progress >= 1.0) progress = 1.0;
      
      const ease = 1 - Math.pow(1 - progress, 3);
      
      camera.position.lerpVectors(startCamPos, initialCamPos, ease);
      controls.target.lerpVectors(startTarget, initialTarget, ease);
      controls.update();
      
      if (progress < 1.0) {
        requestAnimationFrame(animateReset);
      } else {
        controls.enabled = true;
      }
    }
    
    animateReset();
  }
  
  renderer.domElement.addEventListener('dblclick', handleCanvasDblTapClick);
  renderer.domElement.addEventListener('touchend', handleCanvasDblTapClick, { passive: false });

  createBoardMesh();

  window.addEventListener('resize', () => {
    if (!container || !renderer || !camera) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    updateCameraFov();
  });

  // Right-click toggle-drag to pan (following demo/right-click-move-obj.html)
  let isPanning = false;
  let lastPanPos = { x: 0, y: 0 };

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }, true);

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button === 2) {
      e.preventDefault();
      e.stopPropagation();

      if (!isPanning) {
        isPanning = true;
        controls.enabled = false;
        lastPanPos.x = e.clientX;
        lastPanPos.y = e.clientY;
        document.body.style.cursor = 'grabbing';
        renderer.domElement.style.cursor = 'grabbing';
      } else {
        isPanning = false;
        controls.enabled = true;
        document.body.style.cursor = 'default';
        renderer.domElement.style.cursor = 'default';
      }
    }
  }, { capture: true });

  window.addEventListener('pointermove', (e) => {
    if (!isPanning) return;

    const deltaX = e.clientX - lastPanPos.x;
    const deltaY = e.clientY - lastPanPos.y;
    lastPanPos.x = e.clientX;
    lastPanPos.y = e.clientY;

    const dist = camera.position.distanceTo(controls.target);
    const vFov = camera.fov * Math.PI / 180;
    const visibleHeight = 2 * Math.tan(vFov / 2) * dist;
    const visibleWidth = visibleHeight * camera.aspect;

    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    right.y = 0;
    right.normalize();

    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    up.crossVectors(camera.up, up);
    up.y = 0;
    up.normalize();

    const panX = (deltaX / container.clientWidth) * visibleWidth;
    const panY = (deltaY / container.clientHeight) * visibleHeight;

    const offset = new THREE.Vector3()
      .addScaledVector(right, -panX)
      .addScaledVector(up, panY);

    camera.position.add(offset);
    controls.target.add(offset);
    controls.update();
  });

  window.addEventListener('blur', () => {
    if (isPanning) {
      isPanning = false;
      controls.enabled = true;
      document.body.style.cursor = 'default';
      renderer.domElement.style.cursor = 'default';
    }
  });

  // Removed ResizeObserver to prevent infinite layout thrashing loops
  animate();
}

// ─── Board Texture ────────────────────────────────────────────────────────────
function generateBoardTexture() {
  const S = 3072; // Super high resolution for infinite zoom
  const RADIUS = 150; // Scaled for 3072
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y,     x + w, y + r,     r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x,     y + h, x,     y + h - r, r);
    ctx.lineTo(x,     y + r);
    ctx.arcTo(x,     y,     x + r, y,         r);
    ctx.closePath();
  }

  // Clear and setup base board shape
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  roundRect(0, 0, S, S, RADIUS);
  ctx.clip();
  
  // Base golden-yellow wood color
  const bgGrad = ctx.createLinearGradient(0, 0, S, S);
  bgGrad.addColorStop(0, '#fde047');
  bgGrad.addColorStop(0.5, '#facc15');
  bgGrad.addColorStop(1, '#eab308');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, S, S);

  // Procedural Ten-masa (Straight Grain) Texture
  ctx.save();
  const numLines = S * 0.55; 
  ctx.globalAlpha = 0.08;
  
  for (let i = 0; i < numLines; i++) {
    let x = (i / numLines) * S;
    // Add clustering and organic grouping
    x += Math.sin(i * 0.15) * (S * 0.01); 
    
    const waveFreq = 0.001 + (Math.random() * 0.003);
    const waveAmp = 2 + (Math.random() * 8);
    const phase = Math.random() * Math.PI * 2;
    
    ctx.lineWidth = 0.5 + Math.random() * 2.5; 
    ctx.strokeStyle = Math.random() > 0.5 ? '#b45309' : '#854d0e'; // Rich warm browns
    
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= S; y += 40) {
      ctx.lineTo(x + Math.sin(y * waveFreq + phase) * waveAmp, y);
    }
    ctx.stroke();
  }
  
  // Add faint sweeping color variations for wood depth
  ctx.globalAlpha = 0.035;
  for (let i = 0; i < 8; i++) {
     ctx.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#713f12';
     ctx.beginPath();
     ctx.arc(Math.random() * S, Math.random() * S, S * 0.35, 0, Math.PI * 2);
     ctx.fill();
  }
  ctx.restore();

  // Grid lines
  const PAD = S * 2 / (GRID_LINES + 3);
  const gridPx = S - PAD * 2;
  const step = gridPx / (GRID_LINES - 1);
  function lp(i) { return PAD + i * step; }

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.lineWidth = Math.max(3, S * 0.0012); 
  ctx.beginPath();
  for (let i = 0; i < GRID_LINES; i++) {
    const p = lp(i);
    ctx.moveTo(p, lp(0)); ctx.lineTo(p, lp(GRID_LINES-1));
    ctx.moveTo(lp(0), p); ctx.lineTo(lp(GRID_LINES-1), p);
  }
  ctx.stroke();

  // Hoshi
  const hoshiDots = [ [3,3], [3,9], [3,15], [9,3], [9,9], [9,15], [15,3],[15,9], [15,15] ];
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  hoshiDots.forEach(([hi, hj]) => {
    ctx.beginPath(); ctx.arc(lp(hi), lp(hj), S * 0.0045, 0, Math.PI * 2); ctx.fill();
  });

  // Coordinate labels
  ctx.save();
  ctx.font = '48px "SF Pro Display", "Inter", "Helvetica Neue", sans-serif'; 
  ctx.fillStyle = 'rgba(60, 30, 0, 0.75)'; // Dark Brown etched look
  ctx.shadowColor = 'rgba(255, 255, 255, 0.3)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  const colLetters = 'ABCDEFGHJKLMNOPQRST';
  for (let i = 0; i < GRID_LINES; i++) {
    ctx.fillText(colLetters[i], lp(i), S - PAD * 0.3);
    ctx.fillText(colLetters[i], lp(i), PAD * 0.3);
  }
  ctx.textAlign = 'right';
  for (let i = 0; i < GRID_LINES; i++) {
    ctx.fillText(String(GRID_LINES - i), PAD * 0.7, lp(i));
  }
  ctx.textAlign = 'left';
  for (let i = 0; i < GRID_LINES; i++) {
    ctx.fillText(String(GRID_LINES - i), S - PAD * 0.7, lp(i));
  }
  ctx.restore();

  // Solid warm borders
  ctx.save();
  ctx.strokeStyle = '#ca8a04'; ctx.lineWidth = 26;
  roundRect(13, 13, S-26, S-26, RADIUS - 6); ctx.stroke();
  
  ctx.strokeStyle = '#a16207'; ctx.lineWidth = 9;
  roundRect(4, 4, S-8, S-8, RADIUS); ctx.stroke();
  ctx.restore();
  
  ctx.restore(); // end clip

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
  
  return tex;
}


let activeCoordCanvas, activeCoordCtx, activeCoordTexture, activeCoordMesh;
let floatingCoordCanvas, floatingCoordCtx, floatingCoordTexture, floatingCoordSprite;
function updateActiveCoordinates(c, r, player) {
  if (!activeCoordCtx) return;
  const S = 4096;
  activeCoordCtx.clearRect(0, 0, S, S);
  
  if (c === -1 || r === -1) {
    activeCoordTexture.needsUpdate = true;
    if (floatingCoordSprite) floatingCoordSprite.visible = false;
    return;
  }
  if (floatingCoordSprite) floatingCoordSprite.visible = true;
  
  const GRID_LINES = boardSize;
  const PAD = S * 2 / (GRID_LINES + 3);
  const gridPx = S - PAD * 2;
  const step = gridPx / (GRID_LINES - 1);
  function lp(i) { return PAD + i * step; }
  
  activeCoordCtx.save();
  activeCoordCtx.font = 'bold 64px "SF Pro Display", "Inter", "Helvetica Neue", sans-serif'; 
  activeCoordCtx.fillStyle = '#4ade80'; // Bright Green
  activeCoordCtx.shadowColor = '#22c55e'; // Green glow
  activeCoordCtx.shadowBlur = 20;
  activeCoordCtx.textAlign = 'center';
  activeCoordCtx.textBaseline = 'middle';
  
  const colLetters = 'ABCDEFGHJKLMNOPQRST';
  
  const charC = colLetters[c];
  activeCoordCtx.fillText(charC, lp(c), S - PAD * 0.3);
  activeCoordCtx.fillText(charC, lp(c), PAD * 0.3);
  
  activeCoordCtx.textAlign = 'right';
  const charR = String(GRID_LINES - r);
  activeCoordCtx.fillText(charR, PAD * 0.7, lp(r));
  activeCoordCtx.textAlign = 'left';
  activeCoordCtx.fillText(charR, S - PAD * 0.7, lp(r));
  activeCoordCtx.restore();
  activeCoordTexture.needsUpdate = true;

  // Floating Sprite Update
  if (floatingCoordCtx) {
    floatingCoordCtx.clearRect(0, 0, 512, 256);
    floatingCoordCtx.font = 'bold 112px "SF Pro Display", "Inter", sans-serif'; 
    if (player === 'W') {
      floatingCoordCtx.fillStyle = '#16a34a'; 
      floatingCoordCtx.shadowColor = 'rgba(255,255,255,0.9)'; 
      floatingCoordCtx.shadowBlur = 15;
    } else {
      floatingCoordCtx.fillStyle = '#4ade80'; 
      floatingCoordCtx.shadowColor = 'rgba(0,0,0,0.9)'; 
      floatingCoordCtx.shadowBlur = 15;
    }
    floatingCoordCtx.textAlign = 'center';
    floatingCoordCtx.textBaseline = 'middle';
    
    const text = charC + charR;
    floatingCoordCtx.fillText(text, 256, 128);
    floatingCoordTexture.needsUpdate = true;
    
    const worldX = c * STEP_SIZE - GRID_OFFSET;
    const worldZ = r * STEP_SIZE - GRID_OFFSET;
    floatingCoordSprite.position.set(worldX, 5.3, worldZ);
  }
}

// ─── Board Mesh ────────────────────────────────────────────────────────────────
function createBoardMesh() {
  const SLAB_H = 2.8;
  const SLAB_W = BOARD_UNITS + STEP_SIZE * 2.0;

  // ── 1. Top surface — board grid texture, rounded corners via alphaTest ──
  // polygonOffset pushes it fractionally above the slab to prevent z-fighting
  const topMat = new THREE.MeshBasicMaterial({
    map:         generateBoardTexture(),
    transparent: true,
    alphaTest:   0.5, // High threshold discards the semi-transparent anti-aliasing aura
    depthWrite:  true,
    polygonOffset:      true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits:  -1,
  });
  planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(SLAB_W, SLAB_W, 120, 120), topMat);
  planeMesh.rotation.x = -Math.PI / 2;
  planeMesh.position.y = 0;
  scene.add(planeMesh);

  // ── 2. Slab body — Rounded ExtrudeGeometry ──
  const rad3D = (150 / 3072) * SLAB_W;
  const shape = new THREE.Shape();
  const w = SLAB_W, h = SLAB_W, r = rad3D;
  shape.moveTo(-w/2 + r, -h/2);
  shape.lineTo(w/2 - r, -h/2);
  shape.quadraticCurveTo(w/2, -h/2, w/2, -h/2 + r);
  shape.lineTo(w/2, h/2 - r);
  shape.quadraticCurveTo(w/2, h/2, w/2 - r, h/2);
  shape.lineTo(-w/2 + r, h/2);
  shape.quadraticCurveTo(-w/2, h/2, -w/2, h/2 - r);
  shape.lineTo(-w/2, -h/2 + r);
  shape.quadraticCurveTo(-w/2, -h/2, -w/2 + r, -h/2);
  
  const extrudeSettings = { depth: SLAB_H, bevelEnabled: false };
  const boardGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  boardGeom.rotateX(Math.PI / 2);
  
  const sW = 4096;
  const sH = 256;
  const sideCanvas = document.createElement('canvas');
  sideCanvas.width = sW;
  sideCanvas.height = sH;
  const sCtx = sideCanvas.getContext('2d');
  
  // Base gradient: match top board exactly but slightly darker towards bottom
  const sGrad = sCtx.createLinearGradient(0, 0, 0, sH);
  sGrad.addColorStop(0, '#facc15'); // top edge
  sGrad.addColorStop(0.5, '#eab308');
  sGrad.addColorStop(1, '#ca8a04'); // bottom edge
  sCtx.fillStyle = sGrad;
  sCtx.fillRect(0, 0, sW, sH);
  
  // Organic sweeping side grain (Itame/Masame blend)
  sCtx.save();
  sCtx.globalAlpha = 0.15;
  for (let i = 0; i < 400; i++) {
    sCtx.beginPath();
    let startY = (Math.random() * sH * 2) - (sH * 0.5); 
    
    // Calculate a perfectly repeating wavelength for seamless edges
    let cycles = 1 + Math.floor(Math.random() * 3);
    let waveLength = sW / (2 * Math.PI * cycles);
    
    let amplitude = 20 + Math.random() * 100;
    let phase = Math.random() * Math.PI * 2;
    
    sCtx.moveTo(0, startY + Math.sin(phase) * amplitude);
    for (let x = 0; x <= sW; x += 40) {
      let y = startY + Math.sin((x / waveLength) + phase) * amplitude;
      y += Math.sin(x * 0.05) * 3; // micro variations
      sCtx.lineTo(x, y);
    }
    sCtx.lineWidth = 1 + Math.random() * 4;
    sCtx.strokeStyle = Math.random() > 0.5 ? '#92400e' : '#b45309'; 
    sCtx.stroke();
  }
  
  // Soft blending loops for physical depth
  sCtx.globalAlpha = 0.05;
  for(let i = 0; i < 15; i++) {
     sCtx.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#713f12';
     sCtx.beginPath();
     sCtx.arc(Math.random() * sW, Math.random() * sH, 50 + Math.random()*200, 0, Math.PI * 2);
     sCtx.fill();
  }
  sCtx.restore();
  
  const sideTex = new THREE.CanvasTexture(sideCanvas);
  sideTex.colorSpace = THREE.SRGBColorSpace;
  sideTex.wrapS = THREE.RepeatWrapping;
  sideTex.wrapT = THREE.RepeatWrapping;
  // Repeat exactly once around the perimeter for a seamless, continuous wood block look
  sideTex.repeat.set(1, 1); 

  boardMesh = new THREE.Mesh(
    boardGeom,
    [
      new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.1, roughness: 0.8 }), 
      new THREE.MeshStandardMaterial({ 
        map: sideTex, 
        metalness: 0.0, // 0 metalness prevents neon ring from turning wood green
        roughness: 1.0  // Matte physical wood
      }) 
    ]
  );
  boardMesh.position.set(0, 0, 0);
  scene.add(boardMesh);

  // ── 3. Neon rim ring — canvas-drawn rounded-rect border on a flat plane ──
  // Sits just below the board surface; creates the purple→cyan glowing edge.
  (() => {
    const S = 1024, INSET = 14, CR = 80;
    const rc = document.createElement('canvas');
    rc.width = rc.height = S;
    const rx = rc.getContext('2d');
    rx.clearRect(0, 0, S, S);

    function rr(x, y, w, h, r) {
      rx.beginPath();
      rx.moveTo(x+r, y); rx.lineTo(x+w-r, y);
      rx.arcTo(x+w,y,   x+w,y+r,   r);
      rx.lineTo(x+w, y+h-r);
      rx.arcTo(x+w,y+h, x+w-r,y+h, r);
      rx.lineTo(x+r, y+h);
      rx.arcTo(x,y+h,   x,y+h-r,   r);
      rx.lineTo(x, y+r);
      rx.arcTo(x,y,     x+r,y,     r);
      rx.closePath();
    }

    const grad = rx.createLinearGradient(0, S, S, 0);
    grad.addColorStop(0,    '#a855f7');
    grad.addColorStop(0.3,  '#7c3aed');
    grad.addColorStop(0.5,  '#3b82f6');
    grad.addColorStop(0.7,  '#0891b2');
    grad.addColorStop(1,    '#06b6d4');

    // Outer soft bloom
    rx.globalAlpha = 0.20;
    rx.strokeStyle = grad;
    rx.lineWidth   = 55;
    rr(INSET, INSET, S-INSET*2, S-INSET*2, CR); rx.stroke();

    // Main crisp line
    rx.globalAlpha = 1.0;
    rx.lineWidth   = 14;
    rr(INSET, INSET, S-INSET*2, S-INSET*2, CR); rx.stroke();

    const rimTex = new THREE.CanvasTexture(rc);
    rimTex.colorSpace = THREE.SRGBColorSpace;
    const rim = new THREE.Mesh(
      new THREE.PlaneGeometry(SLAB_W + 0.3, SLAB_W + 0.3),
      new THREE.MeshBasicMaterial({
        map:         rimTex,
        transparent: true,
        depthWrite:  false,
        polygonOffset:      true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits:  -2,
      })
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y  = -0.04;
    scene.add(rim);
  })();

  // ── 4. Floating shadow below ──
  const sc = document.createElement('canvas');
  sc.width = sc.height = 512;
  const sx = sc.getContext('2d');
  const sg = sx.createRadialGradient(256,256,30,256,256,256);
  sg.addColorStop(0,   'rgba(4,6,18,0.70)');
  sg.addColorStop(0.5, 'rgba(4,6,18,0.20)');
  sg.addColorStop(1,   'rgba(0,0,0,0)');
  sx.fillStyle = sg; sx.fillRect(0,0,512,512);
  const shadowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(SLAB_W * 2.2, SLAB_W * 2.2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false })
  );
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = -SLAB_H - 10;
  scene.add(shadowMesh);

  // ── Active Coordinates Mesh ──
  activeCoordCanvas = document.createElement('canvas');
  activeCoordCanvas.width = activeCoordCanvas.height = 4096;
  activeCoordCtx = activeCoordCanvas.getContext('2d');
  activeCoordTexture = new THREE.CanvasTexture(activeCoordCanvas);
  activeCoordTexture.colorSpace = THREE.SRGBColorSpace;
  activeCoordTexture.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
  
  const activeCoordMat = new THREE.MeshBasicMaterial({
    map: activeCoordTexture,
    transparent: true,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3
  });
  activeCoordMesh = new THREE.Mesh(new THREE.PlaneGeometry(SLAB_W, SLAB_W), activeCoordMat);
  activeCoordMesh.renderOrder = 999;
  activeCoordMesh.rotation.x = -Math.PI / 2;
  activeCoordMesh.position.y = 0.05; // Hover just above the board
  scene.add(activeCoordMesh);

  // ── Floating Coordinate Sprite ──
  floatingCoordCanvas = document.createElement('canvas');
  floatingCoordCanvas.width = 512;
  floatingCoordCanvas.height = 256;
  floatingCoordCtx = floatingCoordCanvas.getContext('2d');
  floatingCoordTexture = new THREE.CanvasTexture(floatingCoordCanvas);
  floatingCoordTexture.colorSpace = THREE.SRGBColorSpace;
  
  const floatingMat = new THREE.SpriteMaterial({
    map: floatingCoordTexture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  floatingCoordSprite = new THREE.Sprite(floatingMat);
  floatingCoordSprite.scale.set(4, 2, 1);
  floatingCoordSprite.renderOrder = 1000;
  floatingCoordSprite.visible = false;
  scene.add(floatingCoordSprite);
}

let isMaxVFX = true;
window.toggleMaxVFX = function() {
  isMaxVFX = !isMaxVFX;
  const btn = document.getElementById('btn-max-vfx');
  if (btn) {
      btn.innerText = `Max VFX: ${isMaxVFX ? 'ON' : 'OFF'}`;
      btn.style.color = isMaxVFX ? 'var(--accent-purple)' : 'var(--text-muted)';
      btn.style.borderColor = isMaxVFX ? 'var(--accent-purple)' : 'var(--panel-border)';
  }
  
  // 1. Update pixel ratio (Retina scaling)
  const ratio = isMaxVFX ? Math.min(window.devicePixelRatio, 2.0) : Math.min(window.devicePixelRatio, 1.25);
  renderer.setPixelRatio(ratio);
  
  // 2. Re-create stone geometries
  stoneGeometry.dispose();
  stoneGeometry = new THREE.SphereGeometry(STONE_R, isMaxVFX ? 32 : 16, isMaxVFX ? 32 : 12);
  
  // 3. Re-render the board immediately
  if (boardState) renderStones3D();
};

let lastTime = performance.now();
let lastRenderTime = performance.now();
let frames = 0;
let lastFpsTime = lastTime;

function animate() {
  requestAnimationFrame(animate);
  
  const timeNow = performance.now();
  
  const isAutoCamMoving = !manualCamOverride && autoCamEnabled && currentMoveIndex >= 0;
  const isHighAction = activeWaves.length > 0 || isCameraDragging || isAutoCamMoving;
  
  const targetFPS = isHighAction ? 60 : 15;
  const fpsInterval = 1000 / targetFPS;
  
  const elapsedSinceRender = timeNow - lastRenderTime;
  if (elapsedSinceRender < fpsInterval) return;
  
  lastRenderTime = timeNow - (elapsedSinceRender % fpsInterval);

  const ms = timeNow - lastTime;
  lastTime = timeNow;
  frames++;
  
  if (timeNow > lastFpsTime + 1000) {
      const fps = Math.round((frames * 1000) / (timeNow - lastFpsTime));
      const fpsEl = document.getElementById('fps-counter');
      if (fpsEl) {
          fpsEl.innerText = fps + ' FPS';
          fpsEl.style.color = fps < 45 ? 'var(--accent-red)' : 'var(--text-muted)';
      }
      frames = 0;
      lastFpsTime = timeNow;
  }
  const msEl = document.getElementById('ms-counter');
  if (msEl) msEl.innerText = ms.toFixed(1) + ' ms';
  
  // Robust, flawless resizing that runs exactly once per frame without layout thrashing
  const container = document.getElementById('three-container');
  if (container && container.clientWidth > 0) {
      const canvas = renderer.domElement;
      const pixelRatio = renderer.getPixelRatio();
      const expectedWidth = container.clientWidth * pixelRatio;
      const expectedHeight = container.clientHeight * pixelRatio;
      
      if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
          renderer.setSize(container.clientWidth, container.clientHeight, false);
          camera.aspect = container.clientWidth / container.clientHeight;
          updateCameraFov();
      }
  }
  
  if (!manualCamOverride && autoCamEnabled && currentMoveIndex >= 0) {
    controls.target.lerp(autoCamTarget, 0.05);
    camera.position.lerp(autoCamPos, 0.05);
  }
  
  if (typeof activeCoordMesh !== 'undefined' && activeCoordMesh) {
    const pulse = Math.sin(timeNow * 0.005) * 0.3 + 0.7; // Pulse between 0.4 and 1.0
    activeCoordMesh.material.opacity = pulse;
    if (typeof floatingCoordSprite !== 'undefined' && floatingCoordSprite) {
      floatingCoordSprite.material.opacity = pulse;
    }
  }
  
  if (controls) controls.update();

  if (activeWaves.length > 0) {
    const posAttribute = planeMesh.geometry.attributes.position;
    if (!basePositions) {
      basePositions = new Float32Array(posAttribute.array);
    }
    const positions = posAttribute.array;
    
    // Reset positions
    for (let i = 0; i < positions.length; i++) {
      positions[i] = basePositions[i];
    }
    
    const getWaveHeight = (x, z) => {
      let totalH = 0;
      activeWaves.forEach(wave => {
        const oX = wave.originC * STEP_SIZE - GRID_OFFSET;
        const oZ = wave.originR * STEP_SIZE - GRID_OFFSET;
        const distToX = Math.abs(x - oX);
        const distToZ = Math.abs(z - oZ);
        
        const thickness = STEP_SIZE * 0.8;
        let distFromOrigin = -1;
        let sideDist = 0;
        
        // ONLY 4 lines from the placing stone (the cross)
        if (distToX < thickness) {
          distFromOrigin = Math.abs(z - oZ);
          sideDist = distToX;
        } else if (distToZ < thickness) {
          distFromOrigin = Math.abs(x - oX);
          sideDist = distToZ;
        }
        
        if (distFromOrigin !== -1) {
          // Boundary clamp — no ripple beyond the outermost grid lines
          const edge = GRID_OFFSET;
          const gridFade = STEP_SIZE * 1.0;
          const xFade = Math.max(0, Math.min(1, (edge - Math.abs(x)) / gridFade));
          const zFade = Math.max(0, Math.min(1, (edge - Math.abs(z)) / gridFade));
          if (xFade <= 0 || zFade <= 0) return;

          const waveFront = wave.distance;
          const waveTail = waveFront - wave.wavelength;
          if (distFromOrigin <= waveFront && distFromOrigin >= waveTail) {
            const progress = (distFromOrigin - waveTail) / wave.wavelength;
            const envelope = Math.sin(progress * Math.PI);
            
            // Positive-only bouncing ripple (1 - cos)
            const phase = (distFromOrigin - waveFront) * (Math.PI * 2 / (wave.wavelength / 4));
            const pulse = (1 - Math.cos(phase)) * 0.5; // range 0 to 1
            
            // Attenuate sideways so it blends smoothly into flat board
            const sideEnvelope = Math.cos((sideDist / thickness) * (Math.PI / 2));
            
            totalH += pulse * wave.amplitude * envelope * sideEnvelope * Math.min(xFade, zFade);
          }
        }
      });
      return totalH;
    };
    
    // Displace planeMesh vertices
    for (let j = 0; j < positions.length / 3; j++) {
      const vx = basePositions[j * 3];
      const vz = basePositions[j * 3 + 1]; // PlaneGeometry is flat on X, Y
      
      const worldX = vx;
      const worldZ = -vz; // rotation.x = -Math.PI / 2 means local Y becomes world -Z
      
      positions[j * 3 + 2] = basePositions[j * 3 + 2] + getWaveHeight(worldX, worldZ); // Displace local Z (becomes world Y)
    }
    posAttribute.needsUpdate = true;
    planeMesh.geometry.computeVertexNormals();

    // Bob stones up and down!
    stoneMeshes.forEach(group => {
      const sx = group.userData.c * STEP_SIZE - GRID_OFFSET;
      const sz = group.userData.r * STEP_SIZE - GRID_OFFSET;
      group.position.y = getWaveHeight(sx, sz);
    });

    // Update wave light crosses so they physically ride the rippling board!
    activeWaves.forEach(wave => {
      if (wave.waveGroup) {
         wave.waveGroup.children.forEach(mesh => {
            const posAttr = mesh.geometry.attributes.position;
            const colAttr = mesh.geometry.attributes.color;
            
            for (let j = 0; j < posAttr.array.length / 3; j++) {
               const vx = posAttr.array[j * 3];
               const vz = posAttr.array[j * 3 + 1]; // PlaneGeometry uses Y axis for 2D layout
               
               const worldX = vx + wave.waveGroup.position.x;
               const worldZ = -vz + wave.waveGroup.position.z; // Local Y becomes world -Z due to rotation
               
               // Physical height ride
               const by = getWaveHeight(worldX, worldZ);
               posAttr.array[j * 3 + 2] = by + 0.1; // Hover just above the board surface
               
                // Calculate travelling light pulse intensity
               // Distance from the origin of the wave
               const distFromOrigin = Math.sqrt((worldX - wave.waveGroup.position.x)**2 + (worldZ - wave.waveGroup.position.z)**2);
               
               let intensity = 0;
               const waveFront = wave.distance;
               const waveTail = waveFront - wave.wavelength;
               
               if (distFromOrigin <= waveFront && distFromOrigin >= waveTail) {
                 const progress = (distFromOrigin - waveTail) / wave.wavelength;
                 // Smooth sine pulse
                 intensity = Math.sin(progress * Math.PI);
               }
               
                // Attenuate over time
                intensity *= wave.amplitude;
                
                 // Apply color to vertex using RGBA.
                 let finalAlpha = intensity * 0.8;
                 let cr = wave.color.r, cg = wave.color.g, cb = wave.color.b;
                 
                 // For Black (0,0,0), add a sci-fi blue highlight fringe at the edges!
                 if (cr === 0 && cg === 0 && cb === 0) {
                     finalAlpha = Math.pow(intensity, 1.5) * 0.85; 
                     // When intensity is low (fringe), shift color to deep cyan/blue
                     const fringe = Math.max(0, 1.0 - Math.pow(intensity, 0.4));
                     cr = 0; cg = fringe * 0.64; cb = fringe * 0.91; // 0x0ea5e9
                 }
                colAttr.setXYZW(j, cr, cg, cb, finalAlpha);
            }
            posAttr.needsUpdate = true;
            colAttr.needsUpdate = true;
         });
      }
    });

    // Advance waves
    for (let i = activeWaves.length - 1; i >= 0; i--) {
      const wave = activeWaves[i];
      wave.distance += wave.speed;
      wave.amplitude *= wave.decay;
      wave.wavelength += 0.4;
      if (wave.amplitude < 0.05 || wave.distance > wave.maxDistance + wave.wavelength) {
        if (wave.waveGroup) {
          scene.remove(wave.waveGroup);
          wave.waveGroup.children.forEach(mesh => {
            mesh.geometry.dispose();
            mesh.material.dispose();
          });
        }
        activeWaves.splice(i, 1);
      }
    }
  } else if (basePositions) {
    // Flatten board perfectly when animation finishes
    const posAttribute = planeMesh.geometry.attributes.position;
    for (let i = 0; i < posAttribute.array.length; i++) {
      posAttribute.array[i] = basePositions[i];
    }
    posAttribute.needsUpdate = true;
    planeMesh.geometry.computeVertexNormals();
    basePositions = null;
    
    stoneMeshes.forEach(group => {
      group.position.y = 0;
    });
  }

  if (currentRippleMesh) {
    const time = performance.now() * 0.001;
    const dt = 0.016;
    
    // 1. Animate Crystal Pyramid
    const pyramid = currentRippleMesh.userData.pyramid;
    if (pyramid) {
        pyramid.rotation.y = time * 0.5; // Rotate slowly clockwise
        // Bob up and down super smoothly
        pyramid.position.y = STONE_R * 2.5 + Math.sin(time * 1.5) * (STONE_R * 0.3);
    }
    
    // 2. Animate Electric Sparks
    currentRippleMesh.userData.sparks.forEach(spark => {
        if (spark.activeTime > 0) {
            spark.activeTime -= dt;
            
            // Jitter geometry to create chaotic strike
            const posAttr = spark.mesh.geometry.attributes.position;
            const center = pyramid.position; // Sparks crackle around the crystal
            for(let i=0; i<10; i++) {
                posAttr.setXYZ(i, 
                    center.x + (Math.random() - 0.5) * STONE_R * 1.8,
                    center.y + (Math.random() - 0.5) * STONE_R * 2.5,
                    center.z + (Math.random() - 0.5) * STONE_R * 1.8
                );
            }
            posAttr.needsUpdate = true;
            
            // Flicker opacity wildly like electricity
            spark.mesh.material.opacity = Math.random();
            
            if (spark.activeTime <= 0) {
                spark.mesh.material.opacity = 0; // Hide
                spark.triggerDelay = 0.5 + Math.random() * 2.5; // Wait before next strike
            }
        } else {
            spark.triggerDelay -= dt;
            if (spark.triggerDelay <= 0) {
                spark.activeTime = 0.05 + Math.random() * 0.15; // Fast burst (0.05s to 0.2s)
            }
        }
    });
  }

  // No CSS DOM projection needed for true 3D meshes

  renderer.render(scene, camera);
}

// ---- Game Logic ----

function initBoard() {
  boardState = [];
  for (let r = 0; r < boardSize; r++) {
    let row = [];
    for (let c = 0; c < boardSize; c++) {
      row.push({ player: null });
    }
    boardState.push(row);
  }
  
  pendingMove = null;
  if (typeof pendingRingMesh !== 'undefined' && pendingRingMesh) pendingRingMesh.visible = false;
}

function letterToIndex(c) {
  return c.charCodeAt(0) - 97;
}

function playMove(color, c, r) {
  if (c < 0 || c >= boardSize || r < 0 || r >= boardSize) return 0;
  
  boardState[r][c] = { player: color };
  
  // Resolve captures using Liberties.getGroups
  let groups = Liberties.getGroups(boardState);
  let captured = 0;
  
  // Remove captured opponent stones
  for (let g of groups) {
    if (g.color !== color && g.libertyCount === 0) {
      for (let pt of g.stones) {
        boardState[pt[0]][pt[1]] = { player: null };
        captured++;
      }
    }
  }
  
  // Note: normally we'd check self-capture (suicide), but for pure analytics replayer, SGFs are assumed legal.
  return captured;
}

// ---- File Upload & Parsing ----

document.getElementById('file-input').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    const text = evt.target.result;
    parseSGF(text);
  };
  reader.readAsText(file);
  e.target.value = ''; // Reset so the same file can be uploaded again
});

const SAMPLE_SGF = "(;FF[4]GM[1]SZ[19]ST[2]CA[UTF-8]AP[SGFC:1.16]EV[Deep Mind Challenge Match]RO[4]PB[Alphago]PW[Lee Sedol]WR[9p]KM[7.5]DT[2016-03-13]PC[Four Seasons Hotel, Seoul, South Korea]RE[W+R]TM[7200]OT[3x60 byo-yomi]RU[Chinese]SO[gokifu.com]BR[9p]US[Still me]WC[kr]BC[gb];B[pd];W[dp];B[cd];W[qp];B[op];W[oq];B[nq];W[pq];B[cn];W[fq];B[mp];W[po];B[iq];W[ec];B[hd];W[cg];B[ed];W[cj];B[dc];W[bp];B[nc];W[qi];B[ep];W[eo];B[dk];W[fp];B[ck];W[dj];B[ej];W[ei];B[fi];W[eh];B[fh];W[bj];B[fk];W[fg];B[gg];W[ff];B[gf];W[mc];B[md];W[lc];B[nb];W[id];B[hc];W[jg];B[pj];W[pi];B[oj];W[oi];B[ni];W[nh];B[mh];W[ng];B[mg];W[mi];B[nj];W[mf];B[li];W[ne];B[nd];W[mj];B[lf];W[mk];B[me];W[nf];B[lh];W[qj];B[kk];W[ik];B[ji];W[gh];B[hj];W[ge];B[he];W[fd];B[fc];W[ki];B[jj];W[lj];B[kh];W[jh];B[ml];W[nk];B[ol];W[ok];B[pk];W[pl];B[qk];W[nl];B[kj];W[ii];B[rk];W[om];B[pg];W[ql];B[cp];W[co];B[oe];W[rl];B[sk];W[rj];B[hg];W[ij];B[km];W[gi];B[fj];W[jl];B[kl];W[gl];B[fl];W[gm];B[ch];W[ee];B[eb];W[bg];B[dg];W[eg];B[en];W[fo];B[df];W[dh];B[im];W[hk];B[bn];W[if];B[gd];W[fe];B[hf];W[ih];B[bh];W[ci];B[ho];W[go];B[or];W[rg];B[dn];W[cq];B[pr];W[qr];B[rf];W[qg];B[qf];W[jc];B[gr];W[sf];B[se];W[sg];B[rd];W[bl];B[bk];W[ak];B[cl];W[hn];B[in];W[hp];B[fr];W[er];B[es];W[ds];B[ah];W[ai];B[kd];W[ie];B[kc];W[kb];B[gk];W[ib];B[qh];W[rh];B[qs];W[rs];B[oh];W[sl];B[of];W[sj];B[ni];W[nj];B[oo];W[jp])";

window.loadSampleGame = function(e) {
    if (e) e.stopPropagation();
    parseSGF(SAMPLE_SGF);
};

// Handle Drag and Drop
// Drag and drop is now handled by the external landing page, which passes the SGF via sessionStorage and URL parameter `?action=upload`.

function parseSGF(text) {
  // Simple regex parser for linear game (no variations)
  const moveRegex = /;([BW])\[([a-z]{2})?\]/g;
  let match;
  moveHistory = [];
  
  // Extract info
  const getProp = (prop) => {
    const r = new RegExp(`${prop}\\[([^\\]]*)\\]`);
    const m = r.exec(text);
    return m ? m[1] : null;
  };

  const pb = getProp('PB') || 'Black Player';
  const pw = getProp('PW') || 'White Player';
  const br = getProp('BR') || '? Dan';
  const wr = getProp('WR') || '? Dan';
  const re = getProp('RE');
  window.sgfResult = re ? re : null;

  document.getElementById('player-black-name').innerText = pb;
  document.getElementById('player-black-rank').innerText = br;
  document.getElementById('player-white-name').innerText = pw;
  document.getElementById('player-white-rank').innerText = wr;
  
  if (document.getElementById('banner-player-name')) {
      document.getElementById('banner-player-name').innerText = pb;
  }
  if (document.getElementById('banner-ai-name')) {
      document.getElementById('banner-ai-name').innerText = pw;
  }
  
  while ((match = moveRegex.exec(text)) !== null) {
    const color = match[1]; // B or W
    const coords = match[2];
    if (coords) {
      const c = letterToIndex(coords[0]);
      const r = letterToIndex(coords[1]);
      
      // Standard Go Coords (Skip I, 1-19 from bottom)
      const letters = "ABCDEFGHJKLMNOPQRST";
      const colLetter = letters[c] || '?';
      const rowNum = boardSize - r;
      
      moveHistory.push({ color, c, r, label: `${colLetter}${rowNum}` });
    } else {
      moveHistory.push({ color, c: -1, r: -1, label: 'PASS' });
    }
  }
  
  // Overlay has been migrated to landing page
  
  // Reset and play
  initBoard();
  currentMoveIndex = -1;
  capturedByBlack = 0;
  capturedByWhite = 0;
  captureHistory = [];
  
  populateMoveHistory();
  goToMove(moveHistory.length - 1);
}

function populateMoveHistory() {
  const list = document.getElementById('move-history');
  if (!list) return;
  list.innerHTML = '';
  
  // Render reverse chronological to match concept image
  const reversed = [...moveHistory].map((m, idx) => ({m, idx})).reverse();
  
  reversed.forEach(({m, idx}) => {
    const div = document.createElement('div');
    div.className = 'mh-row';
    div.id = `move-item-${idx}`;
    div.innerHTML = `
      <div class="mh-row-left">
        <span class="mh-num" style="display:inline-block; width:24px;">${idx + 1}</span>
        <span class="mh-coord">${m.label}</span>
      </div>
      <div class="mh-stone ${m.color === 'B' ? 'black' : 'white'}"></div>
    `;
    div.onclick = () => goToMove(idx);
    list.appendChild(div);
  });
}

function goToMove(targetIdx) {
  if (targetIdx < -1) targetIdx = -1;
  if (targetIdx >= moveHistory.length) targetIdx = moveHistory.length - 1;
  
  if (targetIdx > currentMoveIndex) {
    placeSound.currentTime = 0;
    placeSound.volume = 0.6;
    placeSound.play().catch(e => console.log('Audio play failed', e));
    
    // Trigger wave if moving forward one step
    if (targetIdx === currentMoveIndex + 1 && targetIdx >= 0 && targetIdx < moveHistory.length) {
      const m = moveHistory[targetIdx];
      createWaveAnimation(m.c, m.r, m.color);
    }
  } else if (targetIdx < currentMoveIndex) {
    unplaceSound.currentTime = 0;
    unplaceSound.volume = 0.6;
    unplaceSound.play().catch(e => console.log('Audio play failed', e));
  }
  
  // For simplicity, reconstruct from 0 to targetIdx
  initBoard();
  capturedByBlack = 0;
  capturedByWhite = 0;
  
  for (let i = 0; i <= targetIdx; i++) {
    const m = moveHistory[i];
    if (m.c !== -1) {
      const caps = playMove(m.color, m.c, m.r);
      if (m.color === 'B') capturedByBlack += caps;
      if (m.color === 'W') capturedByWhite += caps;
    }
  }
  
  currentMoveIndex = targetIdx;
  
  if (autoCamEnabled && currentMoveIndex >= 0) {
    updateAutoCamTarget(currentMoveIndex);
    manualCamOverride = false; // reset override so it smoothly lerps back to overview or new move
  }
  
  // Update Active in list
  document.querySelectorAll('.mh-row').forEach(el => el.classList.remove('active'));
  if (targetIdx >= 0) {
    const activeItem = document.getElementById(`move-item-${targetIdx}`);
    if (activeItem) {
      activeItem.classList.add('active');
      const container = document.querySelector('.move-history-list');
      if (container) {
          const itemTop = activeItem.offsetTop;
          const itemBottom = itemTop + activeItem.offsetHeight;
          const containerTop = container.scrollTop;
          const containerBottom = containerTop + container.clientHeight;
          
          if (itemTop < containerTop) {
              container.scrollTop = itemTop - 10;
          } else if (itemBottom > containerBottom) {
              container.scrollTop = itemBottom - container.clientHeight + 10;
          }
      }
    }
  }
  
  // Update active player highlight
  let nextPlayer = 'B';
  if (targetIdx === -1 && moveHistory.length > 0) {
    nextPlayer = moveHistory[0].color;
  } else if (targetIdx >= 0 && targetIdx < moveHistory.length - 1) {
    nextPlayer = moveHistory[targetIdx + 1].color;
  } else if (targetIdx >= 0 && targetIdx === moveHistory.length - 1) {
    nextPlayer = moveHistory[targetIdx].color === 'B' ? 'W' : 'B';
  }
  
  const bTime = document.querySelector('#panel-black .p-time');
  const wTime = document.querySelector('#panel-white .p-time');
  if (bTime && wTime) {
    if (nextPlayer === 'B') {
      bTime.classList.add('active');
      wTime.classList.remove('active');
    } else {
      wTime.classList.add('active');
      bTime.classList.remove('active');
    }
  }
  
  renderStones3D();
  runDiagnostics();
  
  // Update the KPI visual counter
  const kpiEl = document.getElementById('replayer-move-kpi');
  if (kpiEl) {
      kpiEl.innerText = `${currentMoveIndex + 1} / ${moveHistory.length}`;
  }

  updatePositionMarker(currentMoveIndex);
}

// ---- 3D Rendering ----

let activeWaves = [];
let basePositions = null; // store original board vertices

function createWaveAnimation(c, r, player) {
  if (!fxEnabled || c === -1) return;
  
  const waveGroup = new THREE.Group();
  
  // Use pure black for Black, bright magenta for White
  const color = player === 'B' ? 0x000000 : 0xd946ef; 
  // Additive for White to glow, Normal for Black to act as a dark sweep
  const blendingMode = player === 'B' ? THREE.NormalBlending : THREE.AdditiveBlending;
  
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, 
    transparent: true,
    opacity: 1.0, // Alpha controlled per-vertex now
    blending: blendingMode,
    depthWrite: false,
    vertexColors: true
  });
  
  const sX = c * STEP_SIZE - GRID_OFFSET;
  const sZ = r * STEP_SIZE - GRID_OFFSET;

  // Distance from stone to each grid edge
  const toLeft   = sX + GRID_OFFSET;
  const toRight  = GRID_OFFSET - sX;
  const toTop    = sZ + GRID_OFFSET;
  const toBottom = GRID_OFFSET - sZ;

  const armThick = STEP_SIZE * 0.4;
  const segsPerStep = 4;

  // Horizontal arm: spans from -toLeft to +toRight in local space (centered at stone)
  const hTotalW = Math.max(0.01, toLeft + toRight);
  const segsH = Math.max(2, Math.round(hTotalW / STEP_SIZE * segsPerStep));
  const crossGeomH = new THREE.PlaneGeometry(hTotalW, armThick, segsH, 1);
  crossGeomH.translate((toRight - toLeft) / 2, 0, 0);
  crossGeomH.setAttribute('color', new THREE.BufferAttribute(new Float32Array(crossGeomH.attributes.position.count * 4), 4));

  // Vertical arm: local Y maps to world -Z after rotation.x = -PI/2
  // Positive local Y → negative world Z (upward), negative local Y → positive world Z (downward)
  // Arm spans from -toBottom to +toTop in local Y (vz)
  const vTotalH = Math.max(0.01, toTop + toBottom);
  const segsV = Math.max(2, Math.round(vTotalH / STEP_SIZE * segsPerStep));
  const crossGeomV = new THREE.PlaneGeometry(armThick, vTotalH, 1, segsV);
  crossGeomV.translate(0, (toTop - toBottom) / 2, 0);
  crossGeomV.setAttribute('color', new THREE.BufferAttribute(new Float32Array(crossGeomV.attributes.position.count * 4), 4));
  
  const meshH = new THREE.Mesh(crossGeomH, glowMat);
  meshH.rotation.x = -Math.PI / 2;
  meshH.renderOrder = 1; // 2. VFX layer
  
  const meshV = new THREE.Mesh(crossGeomV, glowMat);
  meshV.rotation.x = -Math.PI / 2;
  meshV.renderOrder = 1; // 2. VFX layer
  
  waveGroup.add(meshH, meshV);
  
  waveGroup.position.set(sX, 0.1, sZ);
  
  scene.add(waveGroup);
  
  activeWaves.push({
    originC: c,
    originR: r,
    distance: 0,
    maxDistance: BOARD_UNITS,
    speed: 1.0,      
    amplitude: 1.0,  
    wavelength: 6,  
    decay: 0.98,
    color: new THREE.Color(color),
    waveGroup: waveGroup
  });
}

// Stone radius: 46% of step so stones don't touch but still feel substantial
const STONE_R = STEP_SIZE * 0.46;
// Use 32x32 segments by default if Max VFX is on. Toggled dynamically via Max VFX.
let stoneGeometry = new THREE.SphereGeometry(STONE_R, isMaxVFX ? 32 : 16, isMaxVFX ? 32 : 12);
const shadowGeometry = new THREE.PlaneGeometry(STONE_R * 2.8, STONE_R * 2.8);



function renderStones3D() {
  // Clear old stones
  stoneMeshes.forEach(m => scene.remove(m));
  stoneMeshes = [];
  currentRippleMesh = null;
  
  // Clear old CSS stones
  const cssLayer = document.getElementById('css-layer');
  if (cssLayer) cssLayer.innerHTML = '';
  
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const cell = boardState[r][c];
      if (cell.player) {
        const group = new THREE.Group();
        group.userData = { c: c, r: r };
        
        // 1. Double-convex 3D stone mesh
        const isBlack = cell.player === 'B';
        const currentMove = currentMoveIndex >= 0 ? moveHistory[currentMoveIndex] : null;
        const isCurrentMove = currentMove && currentMove.r === r && currentMove.c === c;
        
        let stoneMat = isBlack ? blackStoneMat : whiteStoneMat;
        const mesh = new THREE.Mesh(stoneGeometry, stoneMat);
        
        // Floating Crystal Pyramid & Sparks for current move
        if (isCurrentMove) {
          currentRippleMesh = new THREE.Group();
          currentRippleMesh.userData = { isBlack, time: 0, sparks: [] };
          
          // 1. Crystal Pyramid Geometry
          const pyrRadius = STONE_R * 0.6;
          const pyrHeight = STONE_R * 1.5;
          const pyrGeom = new THREE.ConeGeometry(pyrRadius, pyrHeight, 4);
          pyrGeom.rotateX(Math.PI); // Point downwards
          
          // Diamond-like Physical Material
          const baseColor = isBlack ? 0xff2200 : 0x0044ff; // Lava-red or Deep-blue
          const pyrMat = new THREE.MeshPhysicalMaterial({
              color: baseColor,
              transmission: 0.45,     // solid jewel-like (less transparent)
              opacity: 1,
              transparent: true,
              roughness: 0.1,
              ior: 2.4,              // diamond refraction index
              thickness: 0.5,
              attenuationColor: baseColor,      // Tints the refracted light passing through!
              attenuationDistance: STONE_R * 0.5, // Density of the color tint
              side: THREE.DoubleSide
          });
          
          const pyramid = new THREE.Mesh(pyrGeom, pyrMat);
          pyramid.position.y = STONE_R * 2.0; 
          currentRippleMesh.add(pyramid);
          currentRippleMesh.userData.pyramid = pyramid;
          
          // 2. Electric Sparks Pool
          const numSparks = 3; // Number of simultaneous lightning channels
          const sparkCount = 10; // jagged points per spark
          
          for (let i = 0; i < numSparks; i++) {
              const geom = new THREE.BufferGeometry();
              const posArray = new Float32Array(sparkCount * 3);
              geom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
              
              const sparkMat = new THREE.LineBasicMaterial({
                  color: isBlack ? 0x0f172a : 0xffffff, // Black-based or White
                  transparent: true,
                  opacity: 0, // Hidden initially
                  blending: isBlack ? THREE.NormalBlending : THREE.AdditiveBlending,
                  depthWrite: false
              });
              
              const sparkLine = new THREE.Line(geom, sparkMat);
              currentRippleMesh.add(sparkLine);
              currentRippleMesh.userData.sparks.push({
                  mesh: sparkLine,
                  activeTime: 0,
                  triggerDelay: Math.random() * 2.0 // Random staggered start
              });
          }
          
          group.add(currentRippleMesh);
        }
        
        // Scale Y to make it double-convex (flattened sphere)
        const convexity = 0.45;
        mesh.scale.set(1, convexity, 1);
        
        // The sphere radius is STONE_R, scaled by convexity.
        // To rest exactly on Y=0, its center Y must be STONE_R * convexity.
        mesh.position.set(0, STONE_R * convexity, 0);
        
        // Ensure shadows are cast
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        // Randomly rotate to make textures look unique per stone
        mesh.rotation.y = Math.random() * Math.PI * 2;
        
        group.add(mesh);
        

        // 3. Traditional Drop Shadow (Anchors the UI stone to the 3D board)
        const shadow = new THREE.Mesh(shadowGeometry, dropShadowMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(0, 0.01, 0);
        shadow.renderOrder = 1;
        group.add(shadow);

        // Root group sits at y=0 on the board
        group.position.set(
          c * STEP_SIZE - GRID_OFFSET,
          0,
          r * STEP_SIZE - GRID_OFFSET
        );
        scene.add(group);
        stoneMeshes.push(group);
      }
    }
  }

  const currentMove = currentMoveIndex >= 0 ? moveHistory[currentMoveIndex] : null;
  if (currentMove) {
    updateActiveCoordinates(currentMove.c, currentMove.r, currentMove.player);
  } else {
    updateActiveCoordinates(-1, -1, null);
  }
}

// ---- Analytics & Diagnostics ----

function runDiagnostics() {
  // 1. Basic Stats Update
  if (document.getElementById('board-move-num')) {
    document.getElementById('board-move-num').innerText = currentMoveIndex + 1;
  }
  if (document.getElementById('board-move-num-orb')) {
    document.getElementById('board-move-num-orb').innerText = currentMoveIndex + 1;
  }
  
  const statusPill = document.getElementById('game-status-pill');
  if (statusPill) {
      if (playModeEnabled) {
          statusPill.innerText = "Game in Progress";
          statusPill.style.background = "rgba(6, 182, 212, 0.2)";
          statusPill.style.color = "var(--accent-cyan)";
      } else {
          if (currentMoveIndex >= moveHistory.length - 1 && moveHistory.length > 0) {
              if (window.sgfResult) {
                  statusPill.innerText = "Result: " + window.sgfResult;
                  statusPill.style.background = "rgba(139, 92, 246, 0.2)"; // Purple
                  statusPill.style.color = "var(--accent-purple)";
              } else {
                  statusPill.innerText = "Game Ended";
                  statusPill.style.background = "rgba(156, 163, 175, 0.2)"; // Gray
                  statusPill.style.color = "var(--text-muted)";
              }
          } else {
              statusPill.innerText = "Reviewing";
              statusPill.style.background = "rgba(59, 130, 246, 0.2)"; // Blue
              statusPill.style.color = "#60a5fa";
          }
      }
  }
  if (document.getElementById('black-caps')) document.getElementById('black-caps').innerText = capturedByBlack;
  if (document.getElementById('white-caps')) document.getElementById('white-caps').innerText = capturedByWhite;
  if (document.getElementById('disp-b-caps')) document.getElementById('disp-b-caps').innerText = capturedByBlack;
  if (document.getElementById('disp-w-caps')) document.getElementById('disp-w-caps').innerText = capturedByWhite;
  
  if (typeof BoardEstimate === 'undefined' || typeof Liberties === 'undefined') return;

  // 2. Estimation (Donut Chart)
  const estResult = BoardEstimate.estimate(boardState, { komi: 6.5, handicap: 0 });
  const bArea = estResult.score.area[0];
  const wArea = estResult.score.area[1];
  const totalArea = bArea + wArea || 1;
  const bPct = Math.round((bArea / totalArea) * 100);
  const wPct = 100 - bPct;
  
  if (document.getElementById('est-b-pct')) document.getElementById('est-b-pct').innerText = bPct + '%';
  if (document.getElementById('est-w-pct')) document.getElementById('est-w-pct').innerText = wPct + '%';
  if (document.getElementById('est-b-pts')) document.getElementById('est-b-pts').innerText = bArea;
  if (document.getElementById('est-w-pts')) document.getElementById('est-w-pts').innerText = wArea;

  // Draw Donut Chart
  const dCanvas = document.getElementById('donutChart');
  if (dCanvas) {
    const ctx = dCanvas.getContext('2d');
    const x = dCanvas.width / 2;
    const y = dCanvas.height / 2;
    const radius = 20; // scaled down from 30
    const thickness = 10; // scaled down from 12
    
    ctx.clearRect(0, 0, dCanvas.width, dCanvas.height);
    
    // Black Segment
    ctx.beginPath();
    ctx.arc(x, y, radius, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * (bPct / 100)));
    ctx.lineWidth = thickness;
    ctx.strokeStyle = '#3b82f6'; // Blue
    ctx.stroke();
    
    // White Segment
    ctx.beginPath();
    ctx.arc(x, y, radius, (-Math.PI / 2) + (Math.PI * 2 * (bPct / 100)), -Math.PI / 2 + Math.PI * 2);
    ctx.lineWidth = thickness;
    ctx.strokeStyle = '#8b5cf6'; // Purple
    ctx.stroke();
  }

  // 3. Liberties & Combat Volatility
  const libMap = Liberties.computeLibertyMap(boardState);
  let uniqueLibs = 0;
  let sharedLibs = 0;
  const points = Liberties.getLibertyPoints(boardState);
  points.forEach(colors => {
    uniqueLibs++;
    if (colors.size > 1) sharedLibs++;
  });
  
  let volatility = uniqueLibs > 0 ? Math.round((sharedLibs / uniqueLibs) * 100) : 0;
  if (document.getElementById('volatility-val')) document.getElementById('volatility-val').innerText = `${volatility}%`;
  
  let volText = "Peaceful";
  if (volatility > 20) volText = "Skirmishing";
  if (volatility > 40) volText = "Volatile Fight";
  if (document.getElementById('volatility-text')) document.getElementById('volatility-text').innerText = volText;
}

// ---- Play vs AI Mode ────────────────────────────────────────────

let playModeEnabled = false;
let _lastClickPos = null;

window.startOverlayPlayAI = function() {
  const uploadOverlay = document.getElementById('upload-overlay');
  if (uploadOverlay) {
    uploadOverlay.style.opacity = '0';
    setTimeout(() => uploadOverlay.style.display = 'none', 300);
  }

  if (!playModeEnabled) togglePlayMode();
};

window.togglePlayMode = function() {
  playModeEnabled = !playModeEnabled;
  const btn = document.getElementById('btn-play-ai');
  const navItems = document.querySelectorAll('.nav-item');
  
  if (playModeEnabled) {
      navItems.forEach(item => item.classList.remove('active'));
      if (btn) btn.classList.add('active');
  } else {
      if (btn) btn.classList.remove('active');
      if (navItems.length > 0) navItems[0].classList.add('active');
  }

  const newGameBtn = document.getElementById('btn-new-game');
  if (newGameBtn) {
      newGameBtn.innerText = playModeEnabled ? 'New Game' : 'New SGF';
  }

  if (playModeEnabled) {
    // Start a fresh game
    const aiColor = getAIColor();
    const humanColor = aiColor === 'B' ? 'W' : 'B';
    boardSize = 19;
    initBoard();
    moveHistory = [];
    currentMoveIndex = -1;
    capturedByBlack = 0;
    capturedByWhite = 0;
    captureHistory = [];
    renderStones3D();
    runDiagnostics();

    // Ensure auto-cam is off initially for Play vs AI
    if (autoCamEnabled) toggleAutoCam();
    autoCamTarget.set(0, 0, 10);
    autoCamPos.set(0, 72, 56);
    manualCamOverride = false;

    const kpiEl = document.getElementById('replayer-move-kpi');
    if (kpiEl) kpiEl.innerText = '0 / 0';
    document.getElementById('player-black-name').innerText = aiColor === 'B' ? 'AI (Black)' : 'You (Black)';
    document.getElementById('player-black-rank').innerText = aiColor === 'B' ? '5d' : 'Human';
    document.getElementById('player-white-name').innerText = aiColor === 'W' ? 'AI (White)' : 'You (White)';
    document.getElementById('player-white-rank').innerText = aiColor === 'W' ? '5d' : 'Human';

    // AI makes first move if playing Black
    if (aiColor === 'B') setTimeout(() => aiPlayMove('B'), 500);
  }
};

function getNextPlayer() {
  if (moveHistory.length === 0) return 'B';
  if (currentMoveIndex === -1) return moveHistory[0].color;
  const lastMove = moveHistory[currentMoveIndex];
  return lastMove.color === 'B' ? 'W' : 'B';
}

function getSgfMovesUpTo(idx) {
  const moves = [];
  for (let i = 0; i <= idx; i++) {
    const m = moveHistory[i];
    if (m && m.c !== -1) {
      moves.push({ color: m.color, vertex: AI.sgfCoord(m.c, m.r) });
    }
  }
  return moves;
}

async function aiPlayMove(color) {
  const level = '5d';
  const moves = getSgfMovesUpTo(currentMoveIndex);
  const status = document.getElementById('ai-status');
  if (status) status.innerText = `AI (${color}) thinking...`;

  try {
    const data = await AI.aiGenmove(level, moves, color);
    if (data.error || !data.move) {
      if (status) status.innerText = 'AI pass';
      return;
    }
    // Parse SGF move back to column/row indices
    const letters = 'abcdefghjklmnopqrst';
    const col = letters.indexOf(data.move[0]);
    const row = letters.indexOf(data.move[1]);
    if (col === -1 || row === -1) {
      if (status) status.innerText = 'AI pass';
      return;
    }
    const label = 'ABCDEFGHJKLMNOPQRST'[col] + (boardSize - row);
    moveHistory.push({ color, c: col, r: row, label });
    goToMove(moveHistory.length - 1);
    if (status) status.innerText = `AI played ${data.move}`;

    // If still in play mode and it's the AI's turn again (shouldn't happen), or trigger next
    if (playModeEnabled) {
      // Human's turn now - enable board clicks
    }
  } catch (err) {
    const s = document.getElementById('ai-status');
    if (s) s.innerText = err.message || 'AI unavailable';
  }
}

// 3D board click handler for play mode
function setupBoardClick() {
  const canvas = renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  let pointerDownX = 0, pointerDownY = 0;
  canvas.addEventListener('pointerdown', e => {
    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
  });

  function getRaycastIntersect(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersect = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersect);
    if (!intersect) return null;
    
    let minDist = STEP_SIZE * 0.8;
    let bestC = -1, bestR = -1;
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        const gx = c * STEP_SIZE - GRID_OFFSET;
        const gz = r * STEP_SIZE - GRID_OFFSET;
        const dx = intersect.x - gx;
        const dz = intersect.z - gz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < minDist) {
          minDist = dist;
          bestC = c;
          bestR = r;
        }
      }
    }
    return { c: bestC, r: bestR };
  }

  canvas.addEventListener('pointermove', function(event) {
    if (!playModeEnabled || event.pointerType !== 'mouse') return;
    
    const loc = getRaycastIntersect(event.clientX, event.clientY);
    if (!loc || loc.c === -1 || loc.r === -1 || boardState[loc.r][loc.c].player) {
      if (hoverRingMesh) hoverRingMesh.visible = false;
      lastRenderTime = 0;
      return;
    }

    const aiColor = getAIColor();
    const humanColor = aiColor === 'B' ? 'W' : 'B';
    const nextColor = getNextPlayer();
    if (nextColor !== humanColor) return;

    if (pendingMove && pendingMove.c === loc.c && pendingMove.r === loc.r) {
      if (hoverRingMesh) hoverRingMesh.visible = false;
      return;
    }

    hoverRingMesh.position.x = loc.c * STEP_SIZE - GRID_OFFSET;
    hoverRingMesh.position.z = loc.r * STEP_SIZE - GRID_OFFSET;
    hoverRingMesh.material.color.setHex(humanColor === 'B' ? 0x111111 : 0xffffff);
    hoverRingMesh.visible = true;
    lastRenderTime = 0; // Force immediate render
  });

  canvas.addEventListener('pointerup', function(event) {
    if (!playModeEnabled) return;
    if (Math.abs(event.clientX - pointerDownX) > 15 || Math.abs(event.clientY - pointerDownY) > 15) return;

    const loc = getRaycastIntersect(event.clientX, event.clientY);
    if (!loc || loc.c === -1 || loc.r === -1 || boardState[loc.r][loc.c].player) return;

    const aiColor = getAIColor();
    const humanColor = aiColor === 'B' ? 'W' : 'B';
    const nextColor = getNextPlayer();
    if (nextColor !== humanColor) return;

    if (!pendingMove || pendingMove.c !== loc.c || pendingMove.r !== loc.r) {
      pendingMove = { c: loc.c, r: loc.r };
      pendingRingMesh.position.x = loc.c * STEP_SIZE - GRID_OFFSET;
      pendingRingMesh.position.z = loc.r * STEP_SIZE - GRID_OFFSET;
      pendingRingMesh.material.color.setHex(humanColor === 'B' ? 0x111111 : 0xffffff);
      pendingRingMesh.visible = true;
      if (hoverRingMesh) hoverRingMesh.visible = false;
      lastRenderTime = 0; 
      return;
    }

    // Place stone
    pendingMove = null;
    if (pendingRingMesh) pendingRingMesh.visible = false;

    const letters = 'ABCDEFGHJKLMNOPQRST';
    const label = letters[loc.c] + (boardSize - loc.r);
    moveHistory.push({ color: humanColor, c: loc.c, r: loc.r, label });
    goToMove(moveHistory.length - 1);

    // AI responds
    setTimeout(() => aiPlayMove(aiColor), 300);
  });
}

// ---- Controls UI Binding ----

let playInterval = null;
let currentDelay = 1000;

function updatePositionMarker(targetIdx) {
  if (targetIdx >= 0 && targetIdx < moveHistory.length) {
    const lastM = moveHistory[targetIdx];
    if (lastM && lastM.c !== -1 && lastMoveMarkerMesh) {
      lastMoveMarkerMesh.position.x = lastM.c * STEP_SIZE - GRID_OFFSET;
      lastMoveMarkerMesh.position.z = lastM.r * STEP_SIZE - GRID_OFFSET;
      lastMoveMarkerMesh.visible = true;
    } else if (lastMoveMarkerMesh) {
      lastMoveMarkerMesh.visible = false;
    }
  } else if (lastMoveMarkerMesh) {
    lastMoveMarkerMesh.visible = false;
  }
}

function updateDelay(e) {
  currentDelay = parseInt(e.target.value) || 1000;
  if (playInterval) {
    togglePlay(); // stop
    togglePlay(); // restart with new delay
  }
}

function togglePlay() {
  const icon = document.getElementById('play-icon');
  if (playInterval) {
    clearInterval(playInterval);
    playInterval = null;
    icon.classList.replace('ph-pause', 'ph-play');
  } else {
    if (currentMoveIndex >= moveHistory.length - 1) {
      goToMove(-1);
    }
    icon.classList.replace('ph-play', 'ph-pause');
    playInterval = setInterval(() => {
      if (currentMoveIndex < moveHistory.length - 1) {
        goToMove(currentMoveIndex + 1);
      } else {
        togglePlay(); // pause at end
      }
    }, currentDelay);
  }
}
const kpiEl = document.getElementById('replayer-move-kpi');
if (kpiEl) {
    kpiEl.style.cursor = 'text';
    kpiEl.title = 'Double-click/tap to jump to move';
    
    let lastTap = 0;
    function handleDblTapClick(e) {
        if (e && e.type === 'touchend') {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTap;
            if (tapLength < 400 && tapLength > 0) {
                e.preventDefault();
            } else {
                lastTap = currentTime;
                return;
            }
        }
        
        if (kpiEl._editing) return;
        kpiEl._editing = true;
        
        // Pause playback if active
        if (playInterval) togglePlay();
        
        const curMatch = kpiEl.innerText.match(/\d+/);
        const cur = curMatch ? parseInt(curMatch[0], 10) : 1;
        const max = moveHistory.length;
        
        const input = document.createElement('input');
        input.type = 'number';
        input.min = 1;
        input.max = max;
        input.value = cur;
        input.style.cssText = 'width:50px;font-size:13px;font-weight:600;color:var(--text-main);font-variant-numeric:tabular-nums;background:var(--panel-bg);border:1px solid var(--accent-blue);border-radius:4px;padding:2px 4px;text-align:center;outline:none;box-shadow:0 0 10px rgba(59,130,246,0.3);';
        
        kpiEl.innerText = '';
        kpiEl.appendChild(input);
        input.focus();
        input.select();
        
        function done() {
            if (!kpiEl._editing) return;
            kpiEl._editing = false;
            const val = parseInt(input.value, 10);
            if (!isNaN(val) && val >= 1 && val <= max) {
                goToMove(val - 1);
            } else {
                kpiEl.innerText = `${currentMoveIndex + 1} / ${max}`;
            }
        }
        
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); done(); }
            if (e.key === 'Escape') { 
                e.preventDefault(); 
                kpiEl._editing = false; 
                kpiEl.innerText = `${currentMoveIndex + 1} / ${max}`; 
            }
        });
        input.addEventListener('blur', done);
    }
    kpiEl.addEventListener('dblclick', handleDblTapClick);
    kpiEl.addEventListener('touchend', handleDblTapClick, { passive: false });
}

document.getElementById('btn-replay-first').onclick = () => { if(playInterval) togglePlay(); goToMove(-1); };
document.getElementById('btn-replay-back5').onclick = () => { if(playInterval) togglePlay(); goToMove(Math.max(-1, currentMoveIndex - 5)); };
document.getElementById('btn-replay-prev').onclick = () => { if(playInterval) togglePlay(); goToMove(Math.max(-1, currentMoveIndex - 1)); };
document.getElementById('btn-replay-next').onclick = () => { if(playInterval) togglePlay(); goToMove(Math.min(moveHistory.length - 1, currentMoveIndex + 1)); };
document.getElementById('btn-replay-fwd5').onclick = () => { if(playInterval) togglePlay(); goToMove(Math.min(moveHistory.length - 1, currentMoveIndex + 5)); };
document.getElementById('btn-replay-last').onclick = () => { if(playInterval) togglePlay(); goToMove(moveHistory.length - 1); };

// Boot
function bootApp() {
    initThree();
    initBoard();
    setupBoardClick();

    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');

    if (action === 'upload') {
        const sgf = sessionStorage.getItem('uploaded_sgf');
        if (sgf) {
            parseSGF(sgf);
            sessionStorage.removeItem('uploaded_sgf');
        }
    } else if (action === 'sample') {
        window.loadSampleGame();
    } else if (action === 'play_ai') {
        const color = params.get('color') || 'B';
        const colorBtn = document.querySelector(`.ai-color-btn[data-color="${color}"]`);
        if (colorBtn) window.setAIColor(color, colorBtn);
        else window.setAIColor(color, { classList: { add: () => {} } }); // Safe fallback
        window.startOverlayPlayAI();
    }
}

// Ensure fonts and DOM are ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootApp);
} else {
    bootApp();
}

function updateCameraFov() {
  if (!camera) return;
  const baseVerticalFov = 42; 
  if (camera.aspect < 1.0) {
    const baseVerticalFovRad = THREE.MathUtils.degToRad(baseVerticalFov);
    const targetHorizontalFovRad = 2 * Math.atan(Math.tan(baseVerticalFovRad / 2) * 1.0);
    const newVerticalFovRad = 2 * Math.atan(Math.tan(targetHorizontalFovRad / 2) / camera.aspect);
    camera.fov = THREE.MathUtils.radToDeg(newVerticalFovRad);
  } else {
    camera.fov = baseVerticalFov;
  }
  camera.updateProjectionMatrix();
}
