/**
 * 相机：偏航 / 俯仰球面轨道 + WASD 自由移动（替代旧版 Shoemake 虚拟轨迹球）。
 *
 * 一、视角模型（相机始终注视 target，up 恒为 (0,1,0)，因此不会翻转 / 滚转）：
 *     eye = target + dist * dir(yaw, pitch)
 *     dir = (sin(yaw)·cos(pitch), sin(pitch), cos(yaw)·cos(pitch))
 *   pitch 限制在 ±1.48 rad（±85°），相机永远不会越过目标；同一方向拖拽在
 *   ±85° 全范围内的含义完全一致（不存在轨迹球式的方向反转 / 滚转）。
 *
 * 二、拖拽方向约定（beginDrag / drag 都传入当前屏幕 NDC 坐标，增量由相机内部计算）：
 *     向右拖（NDC x 增大）：yaw -= dx·1.05，相机绕 target 向右转；
 *     向下拖（NDC y 减小）：等效屏幕向下增量 dyDown = -Δy > 0，
 *                          pitch += dyDown·1.05，相机升高俯视，画面里的场景整体下移。
 *
 * 三、四种模式：
 *   tour        关键帧环绕漫游（18s 一圈，smoothstep 插值），tick 推进 tourTime；
 *   interactive 轨道模型直接驱动；拖拽 / 缩放 / WASD 从其它模式接管时进入；
 *   focus       注视点平滑趋近 focusTarget（天体位置），dist 趋近 radius·4.2；
 *               yaw / pitch 保持，拖动仍环绕聚焦目标，模式始终为 focus；
 *   eclipse     日食 / 月食固定视点：进入时约 0.6s 平滑过渡；之后拖拽 / 缩放仍可用，
 *               模式保持 eclipse，不会自行恢复自动运动。
 *
 * 四、WASD 自由移动（moveInput 由 main 每帧写入）：
 *   前向 = normalize(target - eye)（含俯仰的三维前向），右向 = normalize(cross(前向, up))；
 *   多键同时按下先归一化移动向量（对角不加速），再让 target 与 eye 同步平移，dist 不变。
 */

const MV = window;

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function lerp(a, b, s) {
  return a + (b - a) * s;
}

function lerpVec(a, b, s) {
  return MV.vec3(
    lerp(a[0], b[0], s),
    lerp(a[1], b[1], s),
    lerp(a[2], b[2], s),
  );
}

function copyVec3(v) {
  return MV.vec3(v[0], v[1], v[2]);
}

/** 0→1 的 smoothstep 曲线，用于漫游关键帧与日食 / 月食进入过渡。 */
function smoothstep(s) {
  const t = clamp(s, 0, 1);
  return t * t * (3 - 2 * t);
}

/** 两角之差，规约到 (-π, π]，避免 ±π 处插值绕远路。 */
function angleDiff(a, b) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** 沿最短方向对角度插值。 */
function lerpAngle(a, b, s) {
  return a + angleDiff(a, b) * s;
}

/** 漫游关键帧：四个方位 + 回到起点（沿用旧版路径，保持原有观感）。 */
const TOUR_KEYS = [
  { t: 0.00, eye: [0, 9, 28], at: [0, 0, 0] },
  { t: 0.25, eye: [28, 7, 0], at: [0, 0.4, 0] },
  { t: 0.50, eye: [0, 11, -28], at: [0, 0, 0] },
  { t: 0.70, eye: [-22, 5, -8], at: [7.4, 0, 0] },
  { t: 1.00, eye: [0, 9, 28], at: [0, 0, 0] },
];

/** 按 0→1 的归一化时间采样漫游位姿（段内 smoothstep 插值）。 */
function sampleTour(u) {
  const t = ((u % 1) + 1) % 1;
  let i = 0;
  while (i < TOUR_KEYS.length - 1 && TOUR_KEYS[i + 1].t < t) i++;
  const a = TOUR_KEYS[i];
  const b = TOUR_KEYS[i + 1];
  const s = (t - a.t) / (b.t - a.t);
  const smooth = smoothstep(s);
  return {
    eye: lerpVec(a.eye, b.eye, smooth),
    at: lerpVec(a.at, b.at, smooth),
  };
}

/** 球面方向：dir = (sin(yaw)cos(pitch), sin(pitch), cos(yaw)cos(pitch))。 */
function dirFromOrbit(yaw, pitch) {
  const cp = Math.cos(pitch);
  return MV.vec3(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
}

/** 由世界位姿（eye, at）反解轨道参数，用于拖拽 / 缩放从漫游位姿无缝接管。 */
function orbitFromLook(eye, at) {
  const target = copyVec3(at);
  const rel = MV.subtract(copyVec3(eye), target);
  const dist = MV.length(rel);
  if (dist < 1e-8) return { yaw: 0, pitch: 0, dist: 1, target };
  const dir = MV.scale(1 / dist, rel);
  return {
    yaw: Math.atan2(dir[0], dir[2]),
    pitch: Math.asin(clamp(dir[1], -1, 1)),
    dist,
    target,
  };
}

function cloneOrbit(o) {
  return { yaw: o.yaw, pitch: o.pitch, dist: o.dist, target: copyVec3(o.target) };
}

/** 轨道位姿 → 世界 eye 坐标。 */
function orbitEye(o) {
  return MV.add(o.target, MV.scale(o.dist, dirFromOrbit(o.yaw, o.pitch)));
}

export function createCamera() {
  /** 集中配置：改这里即可调整手感，不必翻逻辑。 */
  const config = {
    dragSensitivity: 1.05, // 拖拽灵敏度：rad / NDC（≈ 全屏宽拖拽转 120°）
    moveBaseSpeed: 0.9,   // WASD 基准速度：每秒移动 dist 的倍数
    fastMul: 2.6,         // 按住 Shift 的加速倍率
    minDist: 0.05,        // 最近缩放距离
    maxDist: 400,         // 最远缩放距离
    pitchLimit: 1.48,     // 俯仰上限 ±1.48 rad ≈ ±85°
    focusDistFactor: 4.2, // 聚焦距离 = 天体半径 × 4.2
    focusRate: 4.5,       // 聚焦平滑速率（1/s）
    eclipseBlendTime: 0.6,// 日食 / 月食视点进入过渡时长（s）
    zoomStep: 1.08,       // 每格滚轮的缩放倍率
    fovy: 45,             // 垂直视场角（度）
    near: 0.05,
    far: 1200,
  };

  const initialOrbit = orbitFromLook([0, 9, 28], [0, 0, 0]);

  const cam = {
    mode: "tour", // tour | interactive | focus | eclipse
    playing: true,
    tourTime: 0,
    tourPeriod: 18, // 漫游绕一圈的秒数
    projection: "perspective",
    up: MV.vec3(0, 1, 0),
    eye: MV.vec3(0, 9, 28),
    at: MV.vec3(0, 0, 0),
    // 球面轨道状态：eye = target + dist * dir(yaw, pitch)
    orbit: initialOrbit,
    // 由 main 每帧写入的 WASD 输入（0/1 布尔）
    moveInput: { forward: false, back: false, left: false, right: false, fast: false },
    config,
    focusBodyId: null, // 当前聚焦的天体 id（null = 无 / 全景）
    eclipseKind: null, // "solar" | "lunar"（eclipse 模式下有效）
    _eyeWorld: MV.vec3(0, 9, 28),
    _atWorld: MV.vec3(0, 0, 0),
    _drag: null,   // { x, y }：上一次拖拽的 NDC 坐标
    _focus: null,  // 聚焦目标状态
    _eclipse: null,// 日食 / 月食视点状态
  };

  // ------------------------------------------------------------ 内部工具

  /** 把当前画面的世界位姿反解进 orbit（漫游模式取关键帧位姿）。 */
  function syncOrbitFromCurrent() {
    if (cam.mode === "tour") {
      const pose = sampleTour(cam.tourTime / cam.tourPeriod);
      cam.orbit = orbitFromLook(pose.eye, pose.at);
    }
    return cam.orbit;
  }

  /** 约束俯仰与距离，保证相机永不翻转、永不穿到目标另一侧。 */
  function clampOrbit() {
    cam.orbit.pitch = clamp(cam.orbit.pitch, -config.pitchLimit, config.pitchLimit);
    cam.orbit.dist = clamp(cam.orbit.dist, config.minDist, config.maxDist);
  }

  /** 由当前模式计算世界位姿，并同步 eye / at / _eyeWorld / _atWorld。 */
  function syncWorld() {
    if (cam.mode === "tour") {
      // 漫游模式直接使用关键帧插值结果，忽略 orbit
      const pose = sampleTour(cam.tourTime / cam.tourPeriod);
      cam.eye = copyVec3(pose.eye);
      cam.at = copyVec3(pose.at);
    } else {
      cam.eye = orbitEye(cam.orbit);
      cam.at = copyVec3(cam.orbit.target);
    }
    cam._eyeWorld = cam.eye;
    cam._atWorld = cam.at;
    return { eye: cam.eye, at: cam.at };
  }

  /** 从漫游 / 聚焦 / 日食模式夺回控制权，切到交互模式但保持当前位姿。 */
  function enterInteractive() {
    syncOrbitFromCurrent();
    cam.mode = "interactive";
    cam.playing = false;
    cam.eclipseKind = null;
    cam.focusBodyId = null;
    cam._focus = null;
    cam._eclipse = null;
  }

  /** 用户开始拖拽时，停止 focusOn 的 yaw / pitch 自动摆正，避免与拖拽抢方向。 */
  function cancelFocusPose() {
    if (!cam._focus) return;
    cam._focus.yaw = NaN;
    cam._focus.pitch = NaN;
  }

  /** focus 模式每帧平滑：target / dist 趋近目标，yaw / pitch 除非显式指定否则保持。 */
  function updateFocus(dt) {
    const f = cam._focus;
    if (!f) return;
    const k = 1 - Math.exp(-config.focusRate * dt);
    if (f.target) cam.orbit.target = lerpVec(cam.orbit.target, f.target, k);
    if (Number.isFinite(f.dist)) cam.orbit.dist = lerp(cam.orbit.dist, f.dist, k);
    if (Number.isFinite(f.yaw)) {
      cam.orbit.yaw = lerpAngle(cam.orbit.yaw, f.yaw, k);
      if (Math.abs(angleDiff(cam.orbit.yaw, f.yaw)) < 1e-4) f.yaw = NaN;
    }
    if (Number.isFinite(f.pitch)) {
      cam.orbit.pitch = lerp(cam.orbit.pitch, f.pitch, k);
      if (Math.abs(cam.orbit.pitch - f.pitch) < 1e-4) f.pitch = NaN;
    }
    clampOrbit();
  }

  /** eclipse 模式每帧：前 0.6s 平滑过渡；之后保持位姿（用户接管后不再跟随基准）。 */
  function updateEclipse(dt) {
    const ecl = cam._eclipse;
    if (!ecl) return;
    const T = config.eclipseBlendTime;
    if (ecl.blendT < T) {
      ecl.blendT = Math.min(T, ecl.blendT + dt);
      const s = smoothstep(ecl.blendT / T);
      cam.orbit.yaw = lerpAngle(ecl.from.yaw, ecl.base.yaw, s);
      cam.orbit.pitch = lerp(ecl.from.pitch, ecl.base.pitch, s);
      cam.orbit.dist = lerp(ecl.from.dist, ecl.base.dist, s);
      cam.orbit.target = lerpVec(ecl.from.target, ecl.base.target, s);
    } else if (!ecl.userControlled) {
      // 过渡结束且用户尚未接管：跟随 setEclipseView / updateEclipseView 给的基准位姿
      cam.orbit.yaw = ecl.base.yaw;
      cam.orbit.pitch = ecl.base.pitch;
      cam.orbit.dist = ecl.base.dist;
      cam.orbit.target = copyVec3(ecl.base.target);
    }
    clampOrbit();
  }

  /** WASD 自由移动：target 与 eye 同步平移，保持 dist 与俯仰角。 */
  function applyMove(dt) {
    const mi = cam.moveInput;
    const f = mi.forward ? 1 : 0;
    const b = mi.back ? 1 : 0;
    const l = mi.left ? 1 : 0;
    const r = mi.right ? 1 : 0;
    if (!(f || b || l || r)) return false;

    // 漫游模式下按 WASD：先从当前关键帧位姿同步 orbit，再转交互模式
    if (cam.mode === "tour") enterInteractive();
    // 日食 / 月食视点里按 WASD 视为用户接管：之后不再被基准位姿吸附回去
    if (cam.mode === "eclipse" && cam._eclipse) {
      cam._eclipse.blendT = config.eclipseBlendTime;
      cam._eclipse.userControlled = true;
    }

    syncWorld();
    const forward = MV.normalize(MV.subtract(copyVec3(cam.at), copyVec3(cam.eye)));
    const right = MV.normalize(MV.cross(forward, copyVec3(cam.up)));
    let move = MV.add(
      MV.scale(f - b, forward),
      MV.scale(r - l, right),
    );
    const moveLen = MV.length(move);
    if (moveLen < 1e-9) return false;
    move = MV.scale(1 / moveLen, move); // 归一化：对角移动不会更快

    const speed = config.moveBaseSpeed * cam.orbit.dist * (mi.fast ? config.fastMul : 1);
    const step = speed * dt;
    cam.orbit.target = MV.add(cam.orbit.target, MV.scale(step, move));
    syncWorld();
    return true;
  }

  // ------------------------------------------------------------ 每帧推进

  cam.tick = (dt) => {
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (cam.mode === "tour") {
      if (cam.playing) cam.tourTime = (cam.tourTime + step) % cam.tourPeriod;
      // 关键帧位姿始终同步到 orbit，拖拽 / WASD 接管时可以从当前画面无缝出发
      syncOrbitFromCurrent();
    } else if (cam.mode === "focus") {
      updateFocus(step);
    } else if (cam.mode === "eclipse") {
      updateEclipse(step);
    }
    syncWorld();
    applyMove(step);
    syncWorld();
  };

  // ------------------------------------------------------------ 模式切换

  cam.togglePlay = () => {
    if (cam.mode !== "tour") {
      cam.resumeTour();
      return;
    }
    cam.playing = !cam.playing;
  };

  cam.resumeTour = () => {
    cam.mode = "tour";
    cam.playing = true;
    cam.eclipseKind = null;
    cam.focusBodyId = null;
    cam._focus = null;
    cam._eclipse = null;
    cam._drag = null;
    syncOrbitFromCurrent();
    syncWorld();
  };

  cam.setInteractiveFromCurrent = () => {
    enterInteractive();
    syncWorld();
  };

  /** 跳回漫游路径的归一化时刻 t（0~1）并立即套用该关键帧位姿。 */
  cam.setTourTime = (t) => {
    cam.tourTime = (((t % 1) + 1) % 1) * cam.tourPeriod;
    const pose = sampleTour(cam.tourTime / cam.tourPeriod);
    cam.orbit = orbitFromLook(pose.eye, pose.at);
    syncWorld();
  };

  // ------------------------------------------------------------ 聚焦

  /**
   * 平滑飞到指定位姿。bodyId 非空时，main 可通过 setFocusBodyPos / setFocusTarget
   * 每帧提供该天体位置，注视点随之平滑跟随。
   */
  cam.focusOn = (eye, at, bodyId = null) => {
    if (cam.mode === "tour") syncOrbitFromCurrent();
    else syncWorld();
    const target = orbitFromLook(eye, at);
    cam.mode = "focus";
    cam.playing = false;
    cam.eclipseKind = null;
    cam.focusBodyId = bodyId;
    cam._eclipse = null;
    cam._drag = null;
    cam._focus = {
      target: target.target,
      dist: target.dist,
      yaw: target.yaw,     // 显式位姿：yaw / pitch 也平滑过去
      pitch: target.pitch,
      radius: null,
      bodyId,
    };
    syncWorld();
  };

  /** 全景视角：平滑回到默认的俯瞰位姿。 */
  cam.focusOverview = () => {
    cam.focusOn(MV.vec3(0, 9, 28), MV.vec3(0, 0, 0), null);
  };

  /**
   * 聚焦某天体：target 平滑趋近 pos，dist 平滑趋近 radius × focusDistFactor，
   * yaw / pitch 保持当前值（不自动摆正）。同一天体重复调用不会重置用户的缩放。
   */
  cam.setFocusTarget = (pos, radius, bodyId = null) => {
    if (!pos) return;
    const wasFocus = cam.mode === "focus";
    if (!wasFocus) {
      syncOrbitFromCurrent(); // 漫游 / 其它模式下先保留当前画面位姿
      cam.mode = "focus";
      cam.playing = false;
      cam.eclipseKind = null;
      cam._eclipse = null;
      cam._drag = null;
    }
    const old = wasFocus ? cam._focus : null;
    const f = old || {
      target: null,
      dist: NaN,
      yaw: NaN,
      pitch: NaN,
      radius: null,
      bodyId: null,
    };
    const r = Number.isFinite(radius) && radius > 0 ? radius : null;
    // 新目标 / 新半径才重设期望距离；之后保留用户滚轮缩放后的距离
    const newSubject = !old || bodyId !== old.bodyId || r !== old.radius;
    if (newSubject && r != null) f.dist = r * config.focusDistFactor;
    f.target = copyVec3(pos);
    f.radius = r;
    f.bodyId = bodyId;
    f.yaw = NaN; // 保持当前 yaw / pitch
    f.pitch = NaN;
    cam._focus = f;
    cam.focusBodyId = bodyId;
    syncWorld();
  };

  /** 只更新聚焦点的世界坐标（旧 main 每帧跟随天体时调用）。 */
  cam.setFocusBodyPos = (pos) => {
    if (!pos || cam.mode !== "focus") return;
    if (!cam._focus) {
      cam._focus = {
        target: null,
        dist: NaN,
        yaw: NaN,
        pitch: NaN,
        radius: null,
        bodyId: cam.focusBodyId,
      };
    }
    cam._focus.target = copyVec3(pos);
  };

  /** 清除聚焦状态：保持当前位姿，回到可直接拖拽的交互模式。 */
  cam.clearFocus = () => {
    cam.focusBodyId = null;
    cam._focus = null;
    if (cam.mode === "focus") {
      cam.mode = "interactive";
      cam.playing = false;
      cam.eclipseKind = null;
      cam._eclipse = null;
    }
    syncWorld();
  };

  // ------------------------------------------------------------ 日食 / 月食视点

  /**
   * 设置日食 / 月食视点位姿（约 0.6s 平滑过渡）。
   * 之后拖拽 / 缩放仍然有效，且模式保持 eclipse，不会恢复自动运动。
   */
  cam.setEclipsePose = (eye, at) => {
    if (!eye || !at) return;
    if (cam.mode === "tour") syncOrbitFromCurrent();
    else syncWorld();
    const target = orbitFromLook(eye, at);
    cam.mode = "eclipse";
    cam.playing = false;
    cam.focusBodyId = null;
    cam._focus = null;
    cam._drag = null;
    cam._eclipse = {
      from: cloneOrbit(cam.orbit), // 过渡起点 = 当前画面位姿
      base: target,                // 过渡终点 = 日食 / 月食视点
      blendT: 0,
      userControlled: false,
    };
    syncWorld();
  };

  /** 进入指定日食 / 月食视点（带 kind，供状态栏显示）。 */
  cam.setEclipseView = (kind, eye, at) => {
    cam.eclipseKind = kind;
    cam.setEclipsePose(eye, at);
  };

  /**
   * 每帧由 main 提供日食 / 月食视点的最新天体位置。
   * 用户已经拖拽 / 缩放过之后不再覆盖用户视角。
   */
  cam.updateEclipseView = (eye, at) => {
    if (cam.mode !== "eclipse" || !eye || !at) return;
    const base = orbitFromLook(eye, at);
    if (!cam._eclipse) {
      cam._eclipse = {
        from: cloneOrbit(base),
        base,
        blendT: config.eclipseBlendTime,
        userControlled: false,
      };
      return;
    }
    cam._eclipse.base = base;
  };

  // ------------------------------------------------------------ 拖拽 / 缩放

  /**
   * 开始拖拽：记录起点 NDC 坐标。若正在漫游，则从当前关键帧位姿同步 orbit
   * 并切到交互模式（playing = false），实现「拖拽接管漫游」。
   */
  cam.beginDrag = (x, y) => {
    if (cam.mode === "tour") enterInteractive();
    if (cam.mode === "focus") cancelFocusPose();
    if (cam.mode === "eclipse" && cam._eclipse) {
      // 用户接管：立刻结束进入过渡，之后不再被 updateEclipseView 覆盖
      cam._eclipse.blendT = config.eclipseBlendTime;
      cam._eclipse.userControlled = true;
    }
    cam._drag = {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
    };
  };

  /**
   * 拖拽中：参数为当前 NDC 坐标，内部取增量。
   * 向右拖 yaw 减小（相机向右转）；向下拖 pitch 增大（相机升高、场景下移）。
   * 俯仰被夹在 ±pitchLimit，所以任何方向拖到底都不会翻转 / 滚转。
   */
  cam.drag = (x, y) => {
    if (!cam._drag) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const dx = x - cam._drag.x; // NDC 向右为正
    const dyDown = cam._drag.y - y; // 屏幕向下为正（NDC y 向上为正，故取反）
    cam._drag.x = x;
    cam._drag.y = y;
    cam.orbit.yaw -= dx * config.dragSensitivity;
    cam.orbit.pitch += dyDown * config.dragSensitivity;
    clampOrbit();
    if (cam.mode === "focus") cancelFocusPose();
    if (cam.mode === "eclipse" && cam._eclipse) cam._eclipse.userControlled = true;
    syncWorld();
  };

  cam.endDrag = () => {
    cam._drag = null;
  };

  /**
   * 滚轮缩放：只改 dist，target 不动（以注视点为基点的缩放）。
   * 漫游模式下缩放同样会先同步 orbit 并切到交互模式。
   */
  cam.zoom = (delta) => {
    if (!Number.isFinite(delta) || delta === 0) return;
    if (cam.mode === "tour") enterInteractive();
    const s = delta > 0 ? config.zoomStep : 1 / config.zoomStep;
    cam.orbit.dist = clamp(cam.orbit.dist * s, config.minDist, config.maxDist);
    if (cam.mode === "focus" && cam._focus) {
      cam._focus.dist = cam.orbit.dist; // 聚焦模式下保留用户的缩放距离
    }
    if (cam.mode === "eclipse" && cam._eclipse) {
      cam._eclipse.blendT = config.eclipseBlendTime;
      cam._eclipse.userControlled = true;
    }
    syncWorld();
  };

  // ------------------------------------------------------------ 矩阵 / 射线

  /** 视图矩阵；同时把 eye / at / _eyeWorld / _atWorld 同步为当前世界位姿。 */
  cam.viewMatrix = () => {
    syncWorld();
    return MV.lookAt(cam._eyeWorld, cam._atWorld, cam.up);
  };

  cam.eyeWorld = () => cam._eyeWorld || cam.eye;

  cam.projMatrix = (aspect) => {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    if (cam.projection === "ortho") {
      const b = cam.orthoBounds(a);
      return MV.ortho(-b.w, b.w, -b.h, b.h, config.near, config.far);
    }
    return MV.perspective(config.fovy, a, config.near, config.far);
  };

  /** 正交投影的半宽 / 半高（与 projMatrix 同一套公式，拾取射线也要用）。 */
  cam.orthoBounds = (aspect) => {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    syncWorld();
    const dist = Math.max(MV.length(MV.subtract(copyVec3(cam._atWorld), copyVec3(cam._eyeWorld))), 1e-3);
    const h = dist * Math.tan((config.fovy * Math.PI) / 360);
    return { w: h * a, h };
  };

  cam.toggleProjection = () => {
    cam.projection = cam.projection === "perspective" ? "ortho" : "perspective";
  };

  /**
   * 由屏幕 NDC 坐标构造世界空间射线（拾取用），与当前投影严格一致：
   *   - 透视：origin = eye，dir = normalize(前向 + right·tan(fovy/2)·aspect·nx + up·tan(fovy/2)·ny)
   *   - 正交：origin = eye + right·半宽·nx + up·半高·ny，dir = 前向
   * 中心 NDC (0, 0) 的射线方向恒等于 normalize(at - eye)。
   */
  cam.rayFromNdc = (nx, ny, aspect) => {
    syncWorld();
    const eye = copyVec3(cam._eyeWorld);
    const at = copyVec3(cam._atWorld);
    const forward = MV.normalize(MV.subtract(at, eye));
    const right = MV.normalize(MV.cross(forward, copyVec3(cam.up)));
    const upv = MV.normalize(MV.cross(right, forward));
    if (cam.projection === "ortho") {
      const b = cam.orthoBounds(aspect);
      const origin = MV.add(
        MV.add(eye, MV.scale(b.w * nx, right)),
        MV.scale(b.h * ny, upv),
      );
      return { origin, dir: forward };
    }
    const t = Math.tan((config.fovy * Math.PI) / 360);
    const dir = MV.normalize(MV.add(
      MV.add(forward, MV.scale(t * aspect * nx, right)),
      MV.scale(t * ny, upv),
    ));
    return { origin: eye, dir };
  };

  return cam;
}

/** 鼠标 / 触摸事件 → NDC 坐标（y 向上为正，与 WebGL 裁剪空间一致）。 */
export function ndcFromEvent(canvas, ev) {
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
  return [x, y];
}
