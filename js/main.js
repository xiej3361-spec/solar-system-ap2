import { SUN, PLANETS, MOON, DEFAULT_UI } from "./config.js";
import { createSphere, createOrbit, createRing, createStars } from "./geometry.js";
import { loadTextureMap } from "./texture.js";
import { createCamera, ndcFromEvent } from "./camera.js";
import { createScene } from "./scene.js";
import { makeMesh, resizeCanvas } from "./glmesh.js";
import { bindPanel } from "./ui.js";

const MV = window;

const canvas = document.getElementById("view");
const form = document.getElementById("controls");
const statusEl = document.getElementById("status");
const labelsRoot = document.getElementById("labels");

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
};

const sphere = makeMesh(gl, createSphere(40, 64));
const sphereLo = makeMesh(gl, createSphere(8, 12));
const orbit = makeMesh(gl, createOrbit(160));
const ring = makeMesh(gl, createRing(1.25, 2.15, 96));
const stars = makeMesh(gl, createStars());

const ui = { ...DEFAULT_UI };
const cam = createCamera();
const scene = createScene();

/**
 * 演示 / 截图复现用 URL 参数（不影响正常交互）：
 *   ?proj=ortho        初始用正交投影
 *   ?cam=0.28          漫游路径跳到 28% 处并套用该关键帧位姿
 *   ?pause=1           漫游不播放
 *   ?sim=0.5           仿真时间设到 0.5 年
 *   ?freeze=1          冻结仿真时间（天体不动）
 *   ?eclipse=solar|lunar  直接进入日食 / 月食视点
 */
const qs = new URLSearchParams(location.search);
const DEMO = { freeze: qs.has("freeze") };
{
  if (qs.get("proj") === "ortho") cam.projection = "ortho";
  const ct = parseFloat(qs.get("cam"));
  if (Number.isFinite(ct)) cam.setTourTime(ct);
  if (qs.has("pause")) cam.playing = false;
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
gl.clearColor(0.02, 0.03, 0.06, 1);

function setMat4(locn, m) {
  gl.uniformMatrix4fv(locn, false, MV.flatten(m));
}

// ---------------------------------------------------------------- 拾取 / 聚焦

/** 可拾取天体表（与 scene 的层级节点一一对应，半径来自 config）。 */
const BODIES = [
  { id: "sun", name: SUN.name, radius: SUN.radius },
  ...PLANETS.map((p) => ({ id: p.id, name: p.name, radius: p.radius })),
  { id: "moon", name: MOON.name, radius: MOON.radius },
];

const nameOf = (id) => (BODIES.find((b) => b.id === id) || {}).name || id;

/** CPU 射线-球体求交：屏幕 NDC → 世界射线 → 最近命中的天体。 */
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

/** 平滑飞近某天体：保持当前观察方位，距离取天体半径的合理倍数。 */
function focusBody(id) {
  const b = BODIES.find((x) => x.id === id);
  const c = scene.sim.positions[id];
  if (!b || !c) return;
  const cur = cam._eyeWorld || cam.eye;
  let dir = MV.subtract(MV.vec3(cur[0], cur[1], cur[2]), MV.vec3(c[0], c[1], c[2]));
  if (MV.length(dir) < 1e-4) dir = MV.vec3(0, 0.6, 1);
  dir = MV.normalize(dir);
  const dist = Math.max(b.radius * 4.2, b.radius * 2.6);
  const eye = MV.add(MV.vec3(c[0], c[1], c[2]), MV.scale(dist, dir));
  cam.focusOn(eye, MV.vec3(c[0], c[1], c[2]), id);
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

/** 把天体世界坐标投影到屏幕，更新叠层标签位置（背后 / 出界隐藏）。 */
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
      // 有聚焦对象时其余标签淡出，突出当前对象
      el.classList.toggle("dimmed", !!cam.focusBodyId && cam.focusBodyId !== b.id);
    }
  }
}

// ---------------------------------------------------------------- 绘制

function drawNode(node, ecl, fx) {
  setMat4(loc.model, node.model);
  const nmat = MV.normalMatrix(node.model, false);
  setMat4(loc.nMat, nmat);
  gl.uniform1f(loc.emissive, node.emissive || 0);
  gl.uniform1f(loc.ambient, node.kind === "orbit" ? 1 : 0.12);
  gl.uniform1f(loc.alpha, 1);
  gl.uniform1f(loc.glow, 0);
  gl.uniform1f(loc.alphaLuma, 0);

  let shadow = 0;
  if (node.id === "earth") shadow = ecl.solar * 0.7;
  if (node.id === "moon") shadow = ecl.lunar * 0.85;
  gl.uniform1f(loc.shadow, shadow);

  if (node.kind === "orbit") {
    gl.uniform1f(loc.useTex, 0);
    gl.uniform3f(loc.tint, 0.35, 0.42, 0.55);
    gl.uniform1f(loc.emissive, 1);
    orbit.draw();
    return;
  }

  const tex = textures[node.textureId] || textures.moon;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(loc.sampler, 0);

  if (node.kind === "glow" || node.kind === "halo") {
    // 太阳光晕 / 聚焦高亮环：加色混合的 rim 壳，不写深度
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

  // 选中 / 悬停天体的边缘描光（着色器 uGlow 的 rim 项）
  if (fx && (node.id === fx.focusId || node.id === fx.hoverId)) {
    gl.uniform1f(loc.glow, 1);
    if (node.id === fx.focusId) gl.uniform3f(loc.tint, 1, 0.8, 0.35);
    else gl.uniform3f(loc.tint, 0.7, 0.85, 1);
  }

  if (node.kind === "asteroid") sphereLo.draw();
  else sphere.draw();
}

function frame(now) {
  if (!frame.last) frame.last = now;
  const dt = Math.min(0.05, (now - frame.last) / 1000);
  frame.last = now;

  // 仿真时间：演示参数冻结 / 手动暂停 / 日食月食视点内都不推进
  if (!DEMO.freeze && !ui.simPaused && cam.mode !== "eclipse") scene.advance(dt);
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
  gl.uniform3f(loc.tint, 0.75, 0.8, 0.95);
  setMat4(loc.model, MV.mat4());
  setMat4(loc.nMat, MV.mat4());
  stars.draw();

  const fx = { focusId: cam.focusBodyId, hoverId, now: performance.now() / 1000 };
  const transparent = [];
  scene.traverse(ui, (node) => {
    if (node.kind === "ring" || node.kind === "glow") {
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
  for (const n of transparent) drawNode(n, ecl, fx);

  // 日食/月食视点：每帧跟随天体当前位置刷新相机（时间冻结，位置不变，画面稳定）
  if (cam.mode === "eclipse") {
    const cams = scene.eclipseCameras();
    if (cams && cams[cam.eclipseKind]) cam.updateEclipseView(cams[cam.eclipseKind].eye, cams[cam.eclipseKind].at);
  }
  // 聚焦视点：注视点跟随天体公转
  if (cam.mode === "focus" && cam.focusBodyId) {
    cam.setFocusBodyPos(scene.sim.positions[cam.focusBodyId]);
  }

  updateLabels(view, proj);

  const projName = cam.projection === "perspective" ? "透视" : "正交";
  let camName;
  if (cam.mode === "tour") camName = cam.playing ? "漫游中" : "漫游暂停";
  else if (cam.mode === "eclipse") camName = cam.eclipseKind === "solar" ? "日食视点" : "月食视点";
  else if (cam.mode === "focus") camName = cam.focusBodyId ? `聚焦 ${nameOf(cam.focusBodyId)}` : "全景视角";
  else camName = "轨迹球";
  const bits = [`投影 ${projName}`, `相机 ${camName}`];
  if (hoverId && hoverId !== cam.focusBodyId) bits.push(`悬停 ${nameOf(hoverId)}`);
  if (ui.simPaused || cam.mode === "eclipse") bits.push("时间冻结");
  bits.push(`仿真年 ${scene.sim.time.toFixed(2)}`);
  bits.push(`日食 ${ecl.solar.toFixed(2)}  月食 ${ecl.lunar.toFixed(2)}`);
  statusEl.textContent = bits.join("  ·  ");

  window.requestAnimFrame(frame, canvas);
}

// ---------------------------------------------------------------- 交互绑定

function enterEclipse(kind) {
  scene.alignForEclipse(kind, ui.orbitSpeed);
  scene.traverse(ui, () => {}); // 先刷新天体位置，再放相机
  cam.projection = "perspective"; // 日/月食是近景：正交下月球只剩几个像素，必须用透视
  const cams = scene.eclipseCameras();
  cam.setEclipseView(kind, cams[kind].eye, cams[kind].at);
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

if (qs.get("eclipse") === "solar" || qs.get("eclipse") === "lunar") {
  enterEclipse(qs.get("eclipse"));
}

function cssToNdc(cssX, cssY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((cssX - rect.left) / rect.width) * 2 - 1;
  const y = -(((cssY - rect.top) / rect.height) * 2 - 1);
  return [x, y];
}

// 点击（位移小）与拖拽（位移大）区分：拖拽走轨迹球，点击走聚焦
let pointer = { down: false, moved: false, nx: 0, ny: 0 };

canvas.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  canvas.setPointerCapture(ev.pointerId);
  const [x, y] = ndcFromEvent(canvas, ev);
  pointer = { down: true, moved: false, nx: x, ny: y };
});
canvas.addEventListener("pointermove", (ev) => {
  const [x, y] = ndcFromEvent(canvas, ev);
  if (pointer.down && (ev.buttons & 1)) {
    if (!pointer.moved) {
      const dx = x - pointer.nx;
      const dy = y - pointer.ny;
      if (dx * dx + dy * dy < 4e-5) return; // 微小抖动不算拖拽
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
canvas.addEventListener("pointerup", (ev) => {
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
canvas.addEventListener("pointerleave", () => {
  hoverId = null;
  canvas.style.cursor = "grab";
});
canvas.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  cam.zoom(ev.deltaY);
}, { passive: false });

window.addEventListener("keydown", (ev) => {
  if (ev.target.matches("input, textarea, select")) return;
  if (ev.code === "Space") {
    ev.preventDefault();
    cam.togglePlay();
  } else if (ev.key === "o" || ev.key === "O") {
    cam.toggleProjection();
  } else if (ev.key === "c" || ev.key === "C") {
    cam.resumeTour();
  } else if (ev.code === "KeyP") {
    ui.simPaused = !ui.simPaused;
    panel.syncSimButton();
  }
});

// 调试 / 自动化测试钩子
window.__ap2 = {
  cam,
  ui,
  scene,
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
};
window.requestAnimFrame(frame, canvas);
