import { SUN, PLANETS, MOON, DEFAULT_UI } from "./config.js";
import {
  createSphere,
  createOrbit,
  createRing,
  createStars,
  createQuad,
  createCone,
} from "./geometry.js";
import { loadTextureMap } from "./texture.js";
import { createCamera, ndcFromEvent } from "./camera.js";
import { createScene } from "./scene.js";
import { makeMesh, resizeCanvas } from "./glmesh.js";
import { bindPanel } from "./ui.js";
import * as astro from "./astro.js";
import { drawGroundView } from "./groundview.js";

const MV = window;

const canvas = document.getElementById("view");
const viewWrap = document.getElementById("view-wrap");
const form = document.getElementById("controls");
const statusEl = document.getElementById("status");
const labelsRoot = document.getElementById("labels");
const astroInfoEl = document.getElementById("astro-info");
const simDateEl = document.getElementById("simDate");
const timeRateEl = document.getElementById("timeRate");
const groundWrap = document.getElementById("ground-wrap");
const groundCanvas = document.getElementById("ground");
const eclipseHud = document.getElementById("eclipse-hud");
const eclipseTitle = document.getElementById("eclipse-title");
const eclipseLine = document.getElementById("eclipse-line");

const gl = canvas.getContext("webgl2", {
  antialias: true,
  preserveDrawingBuffer: true,
});
if (!gl) throw new Error("需要 WebGL2");

const program = window.initShaders(gl, "vertex-shader", "fragment-shader");
gl.useProgram(program);

const loc = {
  model: gl.getUniformLocation(program, "uModel"),
  view: gl.getUniformLocation(program, "uView"),
  proj: gl.getUniformLocation(program, "uProj"),
  nMat: gl.getUniformLocation(program, "uNMatrix"),
  sampler: gl.getUniformLocation(program, "uSampler"),
  light: gl.getUniformLocation(program, "uLightPos"),
  camPos: gl.getUniformLocation(program, "uCamPos"),
  emissive: gl.getUniformLocation(program, "uEmissive"),
  ambient: gl.getUniformLocation(program, "uAmbient"),
  shadow: gl.getUniformLocation(program, "uShadow"),
  tint: gl.getUniformLocation(program, "uTint"),
  useTex: gl.getUniformLocation(program, "uUseTexture"),
  alphaLuma: gl.getUniformLocation(program, "uAlphaFromLuma"),
  alpha: gl.getUniformLocation(program, "uAlpha"),
  glow: gl.getUniformLocation(program, "uGlow"),
  time: gl.getUniformLocation(program, "uTime"),
  sunMode: gl.getUniformLocation(program, "uSunMode"),
  corona: gl.getUniformLocation(program, "uCorona"),
  coronaDisk: gl.getUniformLocation(program, "uCoronaDisk"),
  shadowMode: gl.getUniformLocation(program, "uShadowMode"),
  shadowSpot: gl.getUniformLocation(program, "uShadowSpot"),
  shadowDir: gl.getUniformLocation(program, "uShadowDir"),
  shadowAxis: gl.getUniformLocation(program, "uShadowAxisPoint"),
  shadowR: gl.getUniformLocation(program, "uShadowR"),
  shadowPR: gl.getUniformLocation(program, "uShadowPR"),
};

const sphere = makeMesh(gl, createSphere(40, 64));
const sphereLo = makeMesh(gl, createSphere(8, 12));
const orbit = makeMesh(gl, createOrbit(160));
const ring = makeMesh(gl, createRing(1.25, 2.15, 96));
const stars = makeMesh(gl, createStars());
const quad = makeMesh(gl, createQuad());
const cone = makeMesh(gl, createCone(48));

const ui = { ...DEFAULT_UI };
const cam = createCamera();
const scene = createScene();
scene.setAstro(astro);
scene.sim.mode = ui.mode;
scene.sim.rate = Math.pow(10, ui.timeRate);

/** 演示 / 截图复现用 URL 参数：
 *  ?proj=ortho  ?cam=0.28  ?pause=1  ?freeze=1  ?eclipse=solar|lunar
 *  ?mode=real|demo  ?date=2026-10-22T12:00Z  ?rate=3600
 */
const qs = new URLSearchParams(location.search);
const DEMO = { freeze: qs.has("freeze") };
{
  if (qs.get("proj") === "ortho") cam.projection = "ortho";
  const ct = parseFloat(qs.get("cam"));
  if (Number.isFinite(ct)) cam.setTourTime(ct);
  if (qs.has("pause")) cam.playing = false;
  if (qs.get("mode") === "demo" || qs.get("mode") === "real") {
    ui.mode = qs.get("mode");
    scene.sim.mode = ui.mode;
  }
  const qdate = qs.get("date");
  if (qdate) {
    const d = new Date(qdate);
    if (!isNaN(d)) scene.sim.date = d;
  }
  const qrate = parseFloat(qs.get("rate"));
  if (Number.isFinite(qrate) && qrate > 0) {
    scene.sim.rate = qrate;
    ui.timeRate = Math.log10(qrate);
  }
  const st = parseFloat(qs.get("sim"));
  if (Number.isFinite(st)) scene.sim.time = st;
}

const texEntries = [
  { id: "sun", url: SUN.texture },
  { id: "moon", url: MOON.texture },
  { id: "saturn_ring", url: PLANETS.find((p) => p.ring).ring.texture },
  ...PLANETS.map((p) => ({ id: p.id, url: p.texture })),
];

const textures = await loadTextureMap(gl, texEntries);

gl.enable(gl.DEPTH_TEST);
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
gl.clearColor(0.015, 0.02, 0.035, 1);

function setMat4(locn, m) {
  gl.uniformMatrix4fv(locn, false, MV.flatten(m));
}

// ---------------------------------------------------------------- 拾取 / 聚焦

const BODIES = [
  { id: "sun", name: SUN.name, radius: SUN.radius },
  ...PLANETS.map((p) => ({ id: p.id, name: p.name, radius: p.radius })),
  { id: "moon", name: MOON.name, radius: MOON.radius },
];

const nameOf = (id) => (BODIES.find((b) => b.id === id) || {}).name || id;

function pickBody(nx, ny) {
  const aspect = canvas.width / canvas.height;
  const ray = cam.rayFromNdc(nx, ny, aspect);
  let best = null;
  let bestT = Infinity;
  for (const b of BODIES) {
    const c = scene.sim.positions[b.id];
    if (!c) continue;
    const lx = c[0] - ray.origin[0];
    const ly = c[1] - ray.origin[1];
    const lz = c[2] - ray.origin[2];
    const tca = lx * ray.dir[0] + ly * ray.dir[1] + lz * ray.dir[2];
    if (tca < 0) continue;
    const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
    const r2 = b.radius * b.radius;
    if (d2 > r2) continue;
    const t = tca - Math.sqrt(r2 - d2);
    if (t < bestT) {
      bestT = t;
      best = b;
    }
  }
  return best;
}

function focusBody(id) {
  const b = BODIES.find((x) => x.id === id);
  const c = scene.sim.positions[id];
  if (!b || !c) return;
  if (typeof cam.setFocusTarget === "function") {
    cam.setFocusTarget(MV.vec3(c[0], c[1], c[2]), b.radius, id);
    return;
  }
  // 旧相机兼容路径
  const cur = cam._eyeWorld || cam.eye;
  let dir = MV.subtract(MV.vec3(cur[0], cur[1], cur[2]), MV.vec3(c[0], c[1], c[2]));
  if (MV.length(dir) < 1e-4) dir = MV.vec3(0, 0.6, 1);
  dir = MV.normalize(dir);
  const dist = Math.max(b.radius * 4.2, b.radius * 2.6);
  cam.focusOn(MV.add(MV.vec3(c[0], c[1], c[2]), MV.scale(dist, dir)), MV.vec3(c[0], c[1], c[2]), id);
}

function focusOverview() {
  cam.focusOn(MV.vec3(0, 9, 28), MV.vec3(0, 0, 0), null);
}

// ---------------------------------------------------------------- 名称标签

const labelEls = new Map();
for (const b of BODIES) {
  const el = document.createElement("div");
  el.className = "label";
  el.dataset.id = b.id;
  const span = document.createElement("span");
  span.textContent = b.name;
  el.appendChild(span);
  el.addEventListener("click", (ev) => {
    ev.stopPropagation();
    focusBody(b.id);
  });
  labelsRoot.appendChild(el);
  labelEls.set(b.id, el);
}

let hoverId = null;

function updateLabels(view, proj) {
  if (!ui.showLabels) {
    labelsRoot.style.display = "none";
    return;
  }
  labelsRoot.style.display = "";
  const rect = canvas.getBoundingClientRect();
  const m = MV.mult(proj, view);
  for (const b of BODIES) {
    const el = labelEls.get(b.id);
    const p = scene.sim.positions[b.id];
    if (!p || !rect.width) {
      el.style.display = "none";
      continue;
    }
    const v = MV.mult(m, MV.vec4(p[0], p[1], p[2], 1));
    if (v[3] <= 0) {
      el.style.display = "none";
      continue;
    }
    const px = (v[0] / v[3]) * 0.5 * rect.width + rect.width / 2;
    const py = rect.height / 2 - (v[1] / v[3]) * 0.5 * rect.height;
    const visible = px > 4 && px < rect.width - 4 && py > 4 && py < rect.height - 4;
    el.style.display = visible ? "" : "none";
    if (visible) {
      el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      el.classList.toggle("focused", cam.focusBodyId === b.id);
      el.classList.toggle("hovered", hoverId === b.id);
      el.classList.toggle("dimmed", !!cam.focusBodyId && cam.focusBodyId !== b.id);
    }
  }
}

// ---------------------------------------------------------------- 绘制

/** 面向相机的 billboard 模型矩阵（日冕 quad） */
function billboardModel(anchor, size) {
  const eye = cam._eyeWorld;
  const fwd = MV.normalize(MV.subtract(cam._atWorld, eye).slice());
  const right = MV.normalize(MV.cross(fwd, MV.vec3(0, 1, 0)).slice());
  const upv = MV.cross(right, fwd);
  const m = MV.mat4();
  m[0][0] = right[0] * size;
  m[1][0] = right[1] * size;
  m[2][0] = right[2] * size;
  m[0][1] = upv[0] * size;
  m[1][1] = upv[1] * size;
  m[2][1] = upv[2] * size;
  m[0][2] = fwd[0];
  m[1][2] = fwd[1];
  m[2][2] = fwd[2];
  m[0][3] = anchor[0];
  m[1][3] = anchor[1];
  m[2][3] = anchor[2];
  return m;
}

function drawNode(node, ecl, fx) {
  setMat4(loc.model, node.model);
  setMat4(loc.nMat, MV.normalMatrix(node.model, false));
  gl.uniform1f(loc.emissive, node.emissive || 0);
  gl.uniform1f(loc.ambient, node.kind === "orbit" ? 1 : 0.12);
  gl.uniform1f(loc.alpha, 1);
  gl.uniform1f(loc.glow, 0);
  gl.uniform1f(loc.alphaLuma, 0);
  gl.uniform1f(loc.corona, 0);
  gl.uniform1f(loc.sunMode, 0);
  gl.uniform1f(loc.shadowMode, 0);
  gl.uniform1f(loc.time, fx.sunTime);

  // 全局阴影只做轻微环境压暗；真正的本影/半影由几何阴影贴图（乘色）负责
  let shadow = 0;
  if (node.id === "earth") shadow = ecl.solar * 0.25;
  if (node.id === "moon") shadow = ecl.lunar * 0.35;
  gl.uniform1f(loc.shadow, shadow);

  if (node.kind === "orbit") {
    gl.uniform1f(loc.useTex, 0);
    gl.uniform3f(loc.tint, 0.32, 0.38, 0.5);
    gl.uniform1f(loc.emissive, 1);
    orbit.draw();
    return;
  }

  if (node.kind === "corona") {
    // 日冕 billboard：加色混合、平滑衰减，不写深度
    setMat4(loc.model, billboardModel(node.anchor, node.size));
    setMat4(loc.nMat, MV.mat4());
    gl.uniform1f(loc.useTex, 0);
    gl.uniform1f(loc.corona, 1);
    gl.uniform1f(loc.coronaDisk, SUN.radius / node.size);
    gl.uniform3f(loc.tint, node.tint[0], node.tint[1], node.tint[2]);
    gl.uniform1f(loc.alpha, 1);
    gl.depthMask(false);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    quad.draw();
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    return;
  }

  const tex = textures[node.textureId] || textures.moon;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(loc.sampler, 0);

  if (node.kind === "glow" || node.kind === "halo") {
    gl.uniform1f(loc.useTex, node.kind === "glow" ? 1 : 0);
    const t = node.tint || [1, 0.8, 0.4];
    gl.uniform3f(loc.tint, t[0], t[1], t[2]);
    gl.uniform1f(loc.emissive, 1);
    gl.uniform1f(loc.glow, 1);
    gl.uniform1f(loc.alpha, node.alpha != null ? node.alpha : 0.3);
    gl.depthMask(false);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    sphere.draw();
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    return;
  }

  gl.uniform1f(loc.useTex, 1);
  gl.uniform3f(loc.tint, 1, 1, 1);

  if (node.kind === "ring") {
    gl.uniform1f(loc.alphaLuma, 1);
    gl.uniform1f(loc.emissive, 0.25);
    gl.depthMask(false);
    ring.draw();
    gl.depthMask(true);
    return;
  }

  if (node.sunSurface) gl.uniform1f(loc.sunMode, 1);

  if (fx && (node.id === fx.focusId || node.id === fx.hoverId)) {
    gl.uniform1f(loc.glow, 1);
    if (node.id === fx.focusId) gl.uniform3f(loc.tint, 1, 0.8, 0.35);
    else gl.uniform3f(loc.tint, 0.7, 0.85, 1);
  }

  if (node.kind === "asteroid") sphereLo.draw();
  else sphere.draw();
}

/** 阴影锥示意：半透明加色体积（本影深、半影淡） */
function drawCone(coneInfo, alpha, tint) {
  if (!coneInfo || !(coneInfo.length > 0) || !(coneInfo.radius > 0)) return;
  const axis = MV.normalize(coneInfo.axis.slice());
  const dot = axis[1];
  let rotAxis = MV.cross(MV.vec3(0, 1, 0), axis);
  let angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
  if (MV.length(rotAxis) < 1e-6) {
    rotAxis = MV.vec3(1, 0, 0);
    angle = dot > 0 ? 0 : 180;
  }
  const model = MV.mult(
    MV.mult(MV.translate(coneInfo.apex[0], coneInfo.apex[1], coneInfo.apex[2]), MV.rotate(angle, rotAxis)),
    MV.scalem(coneInfo.radius, coneInfo.length, coneInfo.radius),
  );
  setMat4(loc.model, model);
  setMat4(loc.nMat, MV.mat4());
  gl.uniform1f(loc.useTex, 0);
  gl.uniform1f(loc.corona, 0);
  gl.uniform1f(loc.sunMode, 0);
  gl.uniform1f(loc.emissive, 1);
  gl.uniform1f(loc.glow, 0);
  gl.uniform1f(loc.shadow, 0);
  gl.uniform1f(loc.alpha, alpha);
  gl.uniform3f(loc.tint, tint[0], tint[1], tint[2]);
  gl.depthMask(false);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  cone.draw();
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(true);
}

/** 乘色阴影贴图：把本影 / 半影真正压暗到球体表面 */
function drawShadowCap(center, radius, mode, spotOrAxisPoint, dir, r, pr) {
  const model = MV.mult(MV.translate(center[0], center[1], center[2]), MV.scalem(radius * 1.004, radius * 1.004, radius * 1.004));
  setMat4(loc.model, model);
  setMat4(loc.nMat, MV.normalMatrix(model, false));
  gl.uniform1f(loc.useTex, 0);
  gl.uniform1f(loc.corona, 0);
  gl.uniform1f(loc.sunMode, 0);
  gl.uniform1f(loc.emissive, 0);
  gl.uniform1f(loc.glow, 0);
  gl.uniform1f(loc.shadow, 0);
  gl.uniform1f(loc.alpha, 1);
  gl.uniform1f(loc.shadowMode, mode);
  gl.uniform3f(loc.shadowSpot, spotOrAxisPoint[0], spotOrAxisPoint[1], spotOrAxisPoint[2]);
  gl.uniform3f(loc.shadowDir, dir[0], dir[1], dir[2]);
  gl.uniform3f(loc.shadowAxis, spotOrAxisPoint[0], spotOrAxisPoint[1], spotOrAxisPoint[2]);
  gl.uniform1f(loc.shadowR, r);
  gl.uniform1f(loc.shadowPR, pr);
  gl.blendFunc(gl.DST_COLOR, gl.ZERO); // 乘色：dest × srcGray
  gl.depthMask(false);
  sphere.draw();
  gl.depthMask(true);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

// ---------------------------------------------------------------- 日食 / 月食

let eclipseSave = null;

function groundPose(kind) {
  const go = scene.groundObservations();
  if (!go) return null;
  const sun = scene.sim.positions.sun;
  const earth = scene.sim.positions.earth;
  const moon = scene.sim.positions.moon;
  if (kind === "solar") {
    const P = go.solar.groundPoint;
    const n = MV.normalize(MV.subtract(P, earth).slice());
    const eye = MV.add(P, MV.scale(0.01, n));
    const toSun = MV.normalize(MV.subtract(sun, P).slice());
    return { eye, at: MV.add(P, toSun) };
  }
  const P = go.lunar.groundPoint;
  const n = MV.normalize(MV.subtract(P, earth).slice());
  const eye = MV.add(P, MV.scale(0.01, n));
  const toMoon = MV.normalize(MV.subtract(moon, P).slice());
  return { eye, at: MV.add(P, toMoon) };
}

function enterEclipse(kind) {
  if (!eclipseSave) {
    eclipseSave = {
      mode: scene.sim.mode,
      date: new Date(scene.sim.date),
      time: scene.sim.time,
      rate: scene.sim.rate,
      paused: ui.simPaused,
      projection: cam.projection,
      eye: MV.vec3(cam.eye[0], cam.eye[1], cam.eye[2]),
      at: MV.vec3(cam.at[0], cam.at[1], cam.at[2]),
    };
  }
  scene.alignForEclipse(kind, ui.orbitSpeed);
  scene.traverse(ui, () => {});
  cam.projection = "perspective";
  const cams = scene.eclipseCameras();
  const pose = ui.eclipseView === "ground" ? groundPose(kind) : cams[kind];
  cam.setEclipseView(kind, pose.eye, pose.at);
  eclipseHud.hidden = false;
  groundWrap.hidden = false;
  eclipseTitle.textContent = kind === "solar" ? "日食演示（已冻结时间）" : "月食演示（已冻结时间）";
  updateEclipseButtons();
}

function exitEclipse() {
  if (cam.mode !== "eclipse") return;
  if (eclipseSave) {
    scene.sim.mode = eclipseSave.mode;
    scene.sim.date = new Date(eclipseSave.date);
    scene.sim.time = eclipseSave.time;
    scene.sim.rate = eclipseSave.rate;
    ui.simPaused = eclipseSave.paused;
    ui.mode = eclipseSave.mode;
    cam.projection = eclipseSave.projection;
    cam.focusOn(eclipseSave.eye, eclipseSave.at, null);
    eclipseSave = null;
  } else {
    cam.focusOverview();
  }
  eclipseHud.hidden = true;
  groundWrap.hidden = true;
  updateModeButtons();
  syncModeSliders();
}

function updateEclipseButtons() {
  const spaceBtn = document.getElementById("btn-eclipse-space");
  const groundBtn = document.getElementById("btn-eclipse-ground");
  if (!spaceBtn || !groundBtn) return;
  spaceBtn.setAttribute("aria-pressed", String(ui.eclipseView === "space"));
  groundBtn.setAttribute("aria-pressed", String(ui.eclipseView === "ground"));
}

// ---------------------------------------------------------------- 主循环

let sunAnimTime = 0;
const keys = { w: false, a: false, s: false, d: false, fast: false };

function frame(now) {
  if (!frame.last) frame.last = now;
  const dt = Math.min(0.05, (now - frame.last) / 1000);
  frame.last = now;

  const frozen = DEMO.freeze || ui.simPaused || cam.mode === "eclipse";
  if (!frozen) {
    scene.advance(dt);
    sunAnimTime += dt; // 太阳表面动画时间（冻结模式下停止）
  }

  // WASD 输入交给相机（仅当移动键按下时）
  if (cam.moveInput) {
    cam.moveInput.forward = keys.w ? 1 : 0;
    cam.moveInput.back = keys.s ? 1 : 0;
    cam.moveInput.left = keys.a ? 1 : 0;
    cam.moveInput.right = keys.d ? 1 : 0;
    cam.moveInput.fast = keys.fast;
  }
  cam.tick(dt);

  resizeCanvas(canvas);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const aspect = canvas.width / canvas.height;
  const view = cam.viewMatrix();
  const proj = cam.projMatrix(aspect);
  setMat4(loc.view, view);
  setMat4(loc.proj, proj);
  gl.uniform3f(loc.camPos, cam._eyeWorld[0], cam._eyeWorld[1], cam._eyeWorld[2]);
  gl.uniform3f(loc.light, 0, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, textures.moon);
  gl.uniform1i(loc.sampler, 0);

  const ecl = scene.eclipseState();

  gl.uniform1f(loc.useTex, 0);
  gl.uniform1f(loc.emissive, 1);
  gl.uniform1f(loc.ambient, 1);
  gl.uniform1f(loc.shadow, 0);
  gl.uniform1f(loc.alphaLuma, 0);
  gl.uniform1f(loc.alpha, 1);
  gl.uniform1f(loc.glow, 0);
  gl.uniform1f(loc.corona, 0);
  gl.uniform1f(loc.sunMode, 0);
  gl.uniform1f(loc.shadowMode, 0);
  gl.uniform1f(loc.time, sunAnimTime);
  gl.uniform3f(loc.tint, 0.75, 0.8, 0.95);
  setMat4(loc.model, MV.mat4());
  setMat4(loc.nMat, MV.mat4());
  stars.draw();

  const fx = { focusId: cam.focusBodyId, hoverId, now: performance.now() / 1000, sunTime: sunAnimTime };
  const transparent = [];
  scene.traverse(ui, (node) => {
    if (node.kind === "ring" || node.kind === "glow" || node.kind === "corona") {
      transparent.push(node);
      return;
    }
    if (node.kind === "body") {
      drawNode(node, ecl, fx);
      if (node.id === fx.focusId || node.id === fx.hoverId) {
        transparent.push({
          kind: "halo",
          id: node.id + "-halo",
          model: MV.mult(node.model, MV.scalem(1.07, 1.07, 1.07)),
          tint: node.id === fx.focusId ? [1, 0.8, 0.35] : [0.7, 0.85, 1],
          alpha: node.id === fx.focusId ? 0.22 + 0.1 * Math.sin(fx.now * 5) : 0.16,
          textureId: node.textureId,
        });
      }
      return;
    }
    drawNode(node, ecl, fx);
  });

  // 日月食：阴影锥示意 + 球面阴影贴图（乘色压暗）
  if (cam.mode === "eclipse" && ecl.geo) {
    const geo = ecl.geo;
    if (cam.eclipseKind === "solar") {
      drawCone(geo.solar.penumbraCone, 0.05, [0.5, 0.66, 0.95]);
      drawCone(geo.solar.umbraCone, 0.09, [0.25, 0.4, 0.85]);
      if (geo.solar.earthSpot) {
        const p = geo.solar.earthSpot;
        drawShadowCap(
          ecl.earth,
          geo.Re,
          1,
          p.point,
          geo.dirSM,
          Math.max(0.002, p.umbraR),
          Math.max(p.umbraR + 0.002, p.penumbraR),
        );
      }
    } else {
      drawCone(geo.lunar.penumbraCone, 0.05, [0.6, 0.55, 0.85]);
      drawCone(geo.lunar.umbraCone, 0.08, [0.35, 0.3, 0.75]);
      drawShadowCap(
        ecl.moon,
        geo.Rm,
        2,
        ecl.earth,
        geo.dirSE,
        Math.max(0.002, geo.lunar.umbraRAtMoon),
        Math.max(geo.lunar.umbraRAtMoon + 0.002, geo.lunar.penumbraRAtMoon),
      );
    }
  }

  for (const n of transparent) drawNode(n, ecl, fx);

  if (cam.mode === "eclipse") {
    if (!eclipseSave) eclipseSave = { mode: scene.sim.mode, date: new Date(scene.sim.date), time: scene.sim.time, rate: scene.sim.rate, paused: ui.simPaused, eye: MV.vec3(cam.eye[0], cam.eye[1], cam.eye[2]), at: MV.vec3(cam.at[0], cam.at[1], cam.at[2]) };
    updateEclipseHud();
    drawGroundInset();
  }
  if (cam.mode === "focus" && cam.focusBodyId) {
    cam.setFocusBodyPos(scene.sim.positions[cam.focusBodyId]);
  }

  updateLabels(view, proj);
  updateAstroInfo();
  updateStatus(ecl);
  requestAnimFrame(frame, canvas);
}

function updateEclipseHud() {
  if (cam.mode !== "eclipse") return;
  const geo = scene.eclipseGeometry();
  if (!geo) return;
  const go = scene.groundObservations();
  if (cam.eclipseKind === "solar") {
    const spot = geo.solar.earthSpot;
    const ratio = go ? (go.solar.moonRadius / go.solar.sunRadius) : 0;
    eclipseLine.textContent = spot
      ? `本影半径 ${spot.umbraR.toFixed(3)} · 半影半径 ${spot.penumbraR.toFixed(3)} · 影斑落在地表 · 月球视直径 ${(ratio * 100).toFixed(0)}% 太阳`
      : `影轴未命中地球 · 月球视直径 ${(ratio * 100).toFixed(0)}% 太阳`;
  } else {
    const l = geo.lunar;
    eclipseLine.textContent = l.insideUmbra
      ? `月球位于本影内 ✓ · 地影本影半径 ${l.umbraRAtMoon.toFixed(3)} · 半影半径 ${l.penumbraRAtMoon.toFixed(3)}`
      : l.insidePenumbra
        ? `月球位于半影内 · 距地影轴 ${l.hM.toFixed(3)} · 本影半径 ${l.umbraRAtMoon.toFixed(3)}`
        : "月球在地影之外（未发生月食）";
  }
}

function drawGroundInset() {
  if (cam.mode !== "eclipse") return;
  const go = scene.groundObservations();
  if (!go) return;
  const ctx = groundCanvas.getContext("2d");
  const w = groundCanvas.width;
  const h = groundCanvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (cam.eclipseKind === "solar") {
    const s = go.solar;
    drawGroundView(ctx, w, h, {
      kind: "solar",
      scaleRad: Math.max(s.sunRadius * 2.2, 0.05),
      solar: {
        sunRadius: s.sunRadius,
        moonRadius: s.moonRadius,
        offsetX: s.offsetX,
        offsetY: s.offsetY,
        glow: 1,
      },
      caption: `日食地面观测 · 月视直径 ${(s.moonRadius / s.sunRadius * 100).toFixed(0)}% 太阳`,
    });
  } else {
    const l = go.lunar;
    drawGroundView(ctx, w, h, {
      kind: "lunar",
      scaleRad: Math.max(l.moonRadius * 2.4, 0.05),
      lunar: {
        moonRadius: l.moonRadius,
        umbraRadius: l.umbraRadius,
        penumbraRadius: l.penumbraRadius,
        offsetX: l.offsetX,
        offsetY: l.offsetY,
      },
      caption: `月食地面观测 · 本影角半径 ${(l.umbraRadius * 180 / Math.PI).toFixed(1)}°`,
    });
  }
}

const fmtLat = (v) => `${v >= 0 ? "N" : "S"}${Math.abs(v).toFixed(1)}°`;
const fmtLon = (v) => `${v >= 0 ? "E" : "W"}${Math.abs(v).toFixed(1)}°`;

let astroInfoTick = 0;
function updateAstroInfo() {
  astroInfoTick++;
  if (astroInfoTick % 12 !== 0) return; // 每 12 帧刷新一次，避免频繁改 DOM
  if (scene.sim.mode !== "real" || !scene.sim.solarInfo) {
    astroInfoEl.innerHTML = ui.mode === "demo"
      ? "自定义演示模式：公转 / 自转 / 倾角为可调展示参数，不代表真实天文状态。"
      : "真实天文模式：等待天文计算…";
    return;
  }
  const si = scene.sim.solarInfo;
  const t0 = si.terminator[0];
  const t1 = si.terminator[1];
  astroInfoEl.innerHTML =
    `UTC ${si.utc.slice(0, 16).replace("T", " ")}<br>` +
    `太阳直射点 ${fmtLat(si.subsolar.lat)} ${fmtLon(si.subsolar.lon)}<br>` +
    `晨昏线–赤道交点 ${fmtLon(t0.lon)} / ${fmtLon(t1.lon)}（纬度 0°）<br>` +
    `直射点当地太阳时 ${si.localSolarTime.toFixed(2)} h<br>` +
    `<span class="muted">简化近似：JPL 近似轨道要素，未含岁差 / 章动；非精确星历</span>`;
}

function updateStatus(ecl) {
  const projName = cam.projection === "perspective" ? "透视" : "正交";
  let camName;
  if (cam.mode === "tour") camName = cam.playing ? "漫游中" : "漫游暂停";
  else if (cam.mode === "eclipse") camName = cam.eclipseKind === "solar" ? "日食演示" : "月食演示";
  else if (cam.mode === "focus") camName = cam.focusBodyId ? `聚焦 ${nameOf(cam.focusBodyId)}` : "全景视角";
  else camName = "手动视角";
  const bits = [ui.mode === "real" ? "真实天文" : "自定义演示", `相机 ${camName}`, `投影 ${projName}`];
  if (hoverId && hoverId !== cam.focusBodyId) bits.push(`悬停 ${nameOf(hoverId)}`);
  if (ui.simPaused || cam.mode === "eclipse" || DEMO.freeze) bits.push("时间冻结");
  bits.push(
    ui.mode === "real"
      ? `UTC ${scene.sim.date.toISOString().slice(0, 16).replace("T", " ")}`
      : `仿真年 ${scene.sim.time.toFixed(2)}`,
  );
  bits.push(`日食 ${ecl.solar.toFixed(2)}  月食 ${ecl.lunar.toFixed(2)}`);
  statusEl.textContent = bits.join("  ·  ");
}

// ---------------------------------------------------------------- 交互绑定

function syncModeSliders() {
  const real = ui.mode === "real";
  for (const el of [form.orbitSpeed, form.spinSpeed, form.earthTilt]) {
    el.disabled = real;
    el.closest(".row")?.classList.toggle("disabled", real);
  }
  document.getElementById("mode-real").setAttribute("aria-pressed", String(real));
  document.getElementById("mode-demo").setAttribute("aria-pressed", String(!real));
  if (real && scene.sim.solarInfo) {
    // 保持日期输入与模拟时刻同步
    const iso = scene.sim.date.toISOString().slice(0, 16);
    if (simDateEl.value !== iso) simDateEl.value = iso;
  }
}

function updateModeButtons() {
  const real = ui.mode === "real";
  document.getElementById("mode-real").setAttribute("aria-pressed", String(real));
  document.getElementById("mode-demo").setAttribute("aria-pressed", String(!real));
}

function setMode(mode) {
  ui.mode = mode;
  scene.sim.mode = mode;
  updateModeButtons();
  syncModeSliders();
  if (mode === "real") {
    const v = simDateEl.value;
    if (v) {
      const d = new Date(v + ":00Z");
      if (!isNaN(d)) scene.sim.date = d;
    }
  }
}

const panel = bindPanel(form, ui, {
  onChange() {},
  resumeTour() {
    cam.resumeTour();
  },
  toggleTour() {
    cam.togglePlay();
  },
  toggleProjection() {
    cam.toggleProjection();
  },
  solarEclipse() {
    enterEclipse("solar");
  },
  lunarEclipse() {
    enterEclipse("lunar");
  },
});

{
  const modeReal = document.getElementById("mode-real");
  const modeDemo = document.getElementById("mode-demo");
  modeReal.addEventListener("click", () => setMode("real"));
  modeDemo.addEventListener("click", () => setMode("demo"));

  simDateEl.addEventListener("change", () => {
    const v = simDateEl.value;
    if (!v) return;
    const d = new Date(v + ":00Z");
    if (!isNaN(d)) {
      scene.sim.date = d;
      if (ui.mode !== "real") setMode("real");
    }
  });

  timeRateEl.addEventListener("input", () => {
    ui.timeRate = Number(timeRateEl.value);
    scene.sim.rate = Math.pow(10, ui.timeRate);
    const label = document.querySelector('[data-for="timeRate"]');
    if (label) label.textContent = fmtRate(scene.sim.rate);
  });

  document.getElementById("btn-eclipse-space").addEventListener("click", () => {
    ui.eclipseView = "space";
    updateEclipseButtons();
    if (cam.mode === "eclipse") {
      const cams = scene.eclipseCameras();
      cam.setEclipseView(cam.eclipseKind, cams[cam.eclipseKind].eye, cams[cam.eclipseKind].at);
    }
  });
  document.getElementById("btn-eclipse-ground").addEventListener("click", () => {
    ui.eclipseView = "ground";
    updateEclipseButtons();
    if (cam.mode === "eclipse") {
      const pose = groundPose(cam.eclipseKind);
      if (pose) cam.setEclipseView(cam.eclipseKind, pose.eye, pose.at);
    }
  });
  document.getElementById("btn-exit-eclipse").addEventListener("click", exitEclipse);
}

function fmtRate(rate) {
  if (rate < 60) return `${rate.toFixed(0)} 秒/秒`;
  if (rate < 3600) return `${(rate / 60).toFixed(1)} 分/秒`;
  if (rate < 86400) return `${(rate / 3600).toFixed(1)} 小时/秒`;
  return `${(rate / 86400).toFixed(1)} 天/秒`;
}

if (qs.get("eclipse") === "solar" || qs.get("eclipse") === "lunar") {
  enterEclipse(qs.get("eclipse"));
}
setMode(ui.mode);
syncModeSliders();
{
  const label = document.querySelector('[data-for="timeRate"]');
  if (label) label.textContent = fmtRate(scene.sim.rate);
}

function cssToNdc(cssX, cssY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((cssX - rect.left) / rect.width) * 2 - 1;
  const y = -(((cssY - rect.top) / rect.height) * 2 - 1);
  return [x, y];
}

let pointer = { down: false, moved: false, nx: 0, ny: 0 };

// 注意：指针 / 滚轮事件挂在 #view-wrap 上而不是 canvas 上——
// 天体名称标签是 canvas 的兄弟节点，挂在 canvas 上会被标签拦截（拖不动、滚轮滚页面）。
viewWrap.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  canvas.setPointerCapture(ev.pointerId);
  const [x, y] = ndcFromEvent(canvas, ev);
  pointer = { down: true, moved: false, nx: x, ny: y };
});
viewWrap.addEventListener("pointermove", (ev) => {
  const [x, y] = ndcFromEvent(canvas, ev);
  if (pointer.down && (ev.buttons & 1)) {
    if (!pointer.moved) {
      const dx = x - pointer.nx;
      const dy = y - pointer.ny;
      if (dx * dx + dy * dy < 4e-5) return;
      pointer.moved = true;
      cam.beginDrag(pointer.nx, pointer.ny);
    }
    cam.drag(x, y);
  } else if (!(ev.buttons & 1)) {
    const hit = pickBody(x, y);
    hoverId = hit ? hit.id : null;
    canvas.style.cursor = hit ? "pointer" : "grab";
  }
});
viewWrap.addEventListener("pointerup", (ev) => {
  if (ev.button !== 0) return;
  const [x, y] = ndcFromEvent(canvas, ev);
  const wasDown = pointer.down;
  pointer.down = false;
  if (wasDown && !pointer.moved) {
    const hit = pickBody(x, y);
    if (hit) focusBody(hit.id);
    else if (cam.mode === "focus" || cam.mode === "eclipse") focusOverview();
  }
  cam.endDrag();
});
viewWrap.addEventListener("pointerleave", () => {
  hoverId = null;
  canvas.style.cursor = "grab";
});
viewWrap.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  cam.zoom(ev.deltaY);
}, { passive: false });

function isTypingTarget(t) {
  return t && t.matches && t.matches("input, textarea, select");
}

window.addEventListener("keydown", (ev) => {
  if (isTypingTarget(ev.target)) return;
  switch (ev.code) {
    case "Space":
      ev.preventDefault();
      cam.togglePlay();
      return;
    case "KeyO":
      cam.toggleProjection();
      return;
    case "KeyC":
      cam.resumeTour();
      return;
    case "KeyP":
      ui.simPaused = !ui.simPaused;
      panel.syncSimButton();
      return;
    case "KeyW": ev.preventDefault(); keys.w = true; return;
    case "KeyA": ev.preventDefault(); keys.a = true; return;
    case "KeyS": ev.preventDefault(); keys.s = true; return;
    case "KeyD": ev.preventDefault(); keys.d = true; return;
    case "ShiftLeft":
    case "ShiftRight":
      keys.fast = true;
      return;
    case "Escape":
      if (cam.mode === "eclipse") {
        ev.preventDefault();
        exitEclipse();
      }
      return;
    default:
      return;
  }
});
window.addEventListener("keyup", (ev) => {
  switch (ev.code) {
    case "KeyW": keys.w = false; break;
    case "KeyA": keys.a = false; break;
    case "KeyS": keys.s = false; break;
    case "KeyD": keys.d = false; break;
    case "ShiftLeft":
    case "ShiftRight": keys.fast = false; break;
    default: break;
  }
});
window.addEventListener("blur", () => {
  keys.w = keys.a = keys.s = keys.d = keys.fast = false;
});

// 地面视图 canvas 尺寸（CSS 320×200，按 DPR 放大）
function resizeGroundCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = 320;
  const h = 200;
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (groundCanvas.width !== bw || groundCanvas.height !== bh) {
    groundCanvas.width = bw;
    groundCanvas.height = bh;
    groundCanvas.style.width = w + "px";
    groundCanvas.style.height = h + "px";
  }
  const ctx = groundCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resizeGroundCanvas();

// 调试 / 自动化测试钩子
window.__ap2 = {
  cam,
  ui,
  scene,
  astro,
  pickAt(cssX, cssY) {
    const [nx, ny] = cssToNdc(cssX, cssY);
    const b = pickBody(nx, ny);
    return b ? b.id : null;
  },
  projectBody(id) {
    const p = scene.sim.positions[id];
    const rect = canvas.getBoundingClientRect();
    if (!p || !rect.width) return null;
    const aspect = canvas.width / canvas.height;
    const v = MV.mult(MV.mult(cam.projMatrix(aspect), cam.viewMatrix()), MV.vec4(p[0], p[1], p[2], 1));
    if (v[3] <= 0) return null;
    return {
      x: rect.left + (v[0] / v[3]) * 0.5 * rect.width + rect.width / 2,
      y: rect.top + rect.height / 2 - (v[1] / v[3]) * 0.5 * rect.height,
    };
  },
  focusBody,
  focusOverview,
  enterEclipse,
  exitEclipse,
  setMode,
  groundObservations: () => scene.groundObservations(),
  eclipseGeometry: () => scene.eclipseGeometry(),
  frozen: () => DEMO.freeze || ui.simPaused || cam.mode === "eclipse",
};
window.requestAnimFrame(frame, canvas);
