import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function detectSoftwareGl(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl =
      probeCanvas.getContext('webgl2') ||
      probeCanvas.getContext('webgl') ||
      (probeCanvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    if (!gl) return true;

    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
    const loseExt = gl.getExtension('WEBGL_lose_context');
    if (loseExt) loseExt.loseContext();

    return /SwiftShader|llvmpipe|Software Rasterizer|Microsoft Basic Render/i.test(rendererStr);
  } catch {
    return false;
  }
}

export function createCadFloorTexture(isDark: boolean, maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = isDark ? '#0f172a' : '#e8eff7';
    ctx.fillRect(0, 0, size, size);

    // Subtle minor grid
    ctx.strokeStyle = isDark ? 'rgba(51, 65, 85, 0.45)' : 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1;
    const step = 64;
    for (let i = 0; i <= size; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }

    // Major architectural tile border
    ctx.strokeStyle = isDark ? 'rgba(59, 130, 246, 0.35)' : 'rgba(37, 99, 235, 0.28)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, size, size);

    // Corner CAD crosshairs
    ctx.strokeStyle = isDark ? 'rgba(96, 165, 250, 0.55)' : 'rgba(37, 99, 235, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 14);
    ctx.lineTo(0, 0);
    ctx.lineTo(14, 0);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(28, 28);
  tex.anisotropy = Math.min(8, Math.max(1, maxAnisotropy));
  tex.needsUpdate = true;
  return tex;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.46)');
    grad.addColorStop(0.55, 'rgba(15, 23, 42, 0.16)');
    grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createLockBadgeTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const cx = size / 2;
    const cy = size / 2;

    // Outer glow aura
    const grad = ctx.createRadialGradient(cx, cy, 24, cx, cy, 62);
    grad.addColorStop(0, 'rgba(245, 158, 11, 0.95)');
    grad.addColorStop(0.7, 'rgba(245, 158, 11, 0.35)');
    grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Badge disc
    ctx.beginPath();
    ctx.arc(cx, cy, 42, 0, Math.PI * 2);
    ctx.fillStyle = '#b45309';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#fde68a';
    ctx.stroke();

    // Padlock shackle
    ctx.beginPath();
    ctx.arc(cx, cy - 8, 13, Math.PI, 0, false);
    ctx.lineWidth = 6.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Padlock body
    ctx.fillStyle = '#ffffff';
    const bw = 34;
    const bh = 25;
    const bx = cx - bw / 2;
    const by = cy - 4;
    const r = 5;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
    ctx.lineTo(bx + r, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
    ctx.fill();

    // Keyhole dot
    ctx.beginPath();
    ctx.arc(cx, cy + 8, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = '#92400e';
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export interface StudioRigCleanup {
  dispose: () => void;
  updateTheme: (isDark: boolean) => void;
}

function createAxisLabelSprite(text: string, colorHex: string): THREE.Sprite {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 34, 0, Math.PI * 2);
    ctx.fillStyle = colorHex;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 44px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2 + 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.46, 0.46, 0.46);
  sprite.renderOrder = 20;
  return sprite;
}

export function createWorldAxesHelper(axisLength = 2.6): THREE.Group {
  const group = new THREE.Group();
  group.name = 'world_xyz_axes_helper';
  group.position.set(0, 0.03, 0);

  const axes = new THREE.AxesHelper(axisLength);
  axes.setColors(new THREE.Color(0xef4444), new THREE.Color(0x22c55e), new THREE.Color(0x3b82f6));
  const axesMat = axes.material as THREE.LineBasicMaterial;
  axesMat.transparent = true;
  axesMat.opacity = 0.9;
  group.add(axes);

  const labelX = createAxisLabelSprite('X', '#ef4444');
  labelX.position.set(axisLength + 0.34, 0.08, 0);
  const labelY = createAxisLabelSprite('Y', '#22c55e');
  labelY.position.set(0, axisLength + 0.34, 0);
  const labelZ = createAxisLabelSprite('Z', '#3b82f6');
  labelZ.position.set(0, 0.08, axisLength + 0.34);
  group.add(labelX, labelY, labelZ);

  return group;
}

export function setupStudioEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  isDark: boolean,
  isSoftwareGl: boolean
): StudioRigCleanup {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envTarget = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = isDark ? 0.7 : 0.85;
  roomEnv.dispose();
  pmrem.dispose();

  const keyLight = new THREE.DirectionalLight(0xfff4e6, 2.0);
  keyLight.position.set(16, 26, 14);
  keyLight.castShadow = !isSoftwareGl;
  if (!isSoftwareGl) {
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -22;
    keyLight.shadow.camera.right = 22;
    keyLight.shadow.camera.top = 22;
    keyLight.shadow.camera.bottom = -22;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 78;
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.02;
  }
  scene.add(keyLight);

  const hemiLight = new THREE.HemisphereLight(0xcfe4ff, 0x263142, 0.75);
  scene.add(hemiLight);

  const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.5);
  rimLight.position.set(-14, 12, -16);
  scene.add(rimLight);

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  let floorTex = createCadFloorTexture(isDark, maxAniso);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    roughness: 0.88,
    metalness: 0.05
  });
  const floorGeo = new THREE.PlaneGeometry(140, 140);
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = 0;
  floorMesh.receiveShadow = !isSoftwareGl;
  floorMesh.name = 'studio_floor';
  scene.add(floorMesh);

  const applyThemeColors = (dark: boolean) => {
    const horizonColor = dark ? 0x0b1120 : 0xeef4fb;
    scene.background = new THREE.Color(horizonColor);
    scene.fog = new THREE.FogExp2(horizonColor, 0.0085);
    scene.environmentIntensity = dark ? 0.7 : 0.85;
    hemiLight.intensity = dark ? 0.65 : 0.82;
    keyLight.intensity = dark ? 1.9 : 2.15;
  };

  applyThemeColors(isDark);

  return {
    updateTheme: (dark: boolean) => {
      applyThemeColors(dark);
      const nextTex = createCadFloorTexture(dark, maxAniso);
      floorMat.map = nextTex;
      floorMat.needsUpdate = true;
      floorTex.dispose();
      floorTex = nextTex;
    },
    dispose: () => {
      scene.environment = null;
      envTarget.dispose();
      floorTex.dispose();
      floorMat.dispose();
      floorGeo.dispose();
    }
  };
}
