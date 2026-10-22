/**
 * 观察 + 投影 + 漫游关键帧 + 虚拟轨迹球（选做 E3）。
 *
 * 视角接管规则：
 *   - 漫游播放时每帧用关键帧插值覆盖 eye
 *   - 鼠标拖拽立刻切到交互模式（轨迹球）
 *   - 空格暂停 / 继续漫游；点「继续漫游」从交互切回关键帧路径
 */

const MV = window;

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

/** 预设环绕路径：四个方位 + 回到起点，中间线性插值。 */
const TOUR_KEYS = [
  { t: 0.00, eye: [0, 9, 28], at: [0, 0, 0] },
  { t: 0.25, eye: [28, 7, 0], at: [0, 0.4, 0] },
  { t: 0.50, eye: [0, 11, -28], at: [0, 0, 0] },
  { t: 0.70, eye: [-22, 5, -8], at: [7.4, 0, 0] },
  { t: 1.00, eye: [0, 9, 28], at: [0, 0, 0] },
];

function lerpVec(a, b, s) {
  return [
    a[0] + (b[0] - a[0]) * s,
    a[1] + (b[1] - a[1]) * s,
    a[2] + (b[2] - a[2]) * s,
  ];
}

function sampleTour(u) {
  const t = ((u % 1) + 1) % 1;
  let i = 0;
  while (i < TOUR_KEYS.length - 1 && TOUR_KEYS[i + 1].t < t) i++;
  const a = TOUR_KEYS[i];
  const b = TOUR_KEYS[i + 1];
  const s = (t - a.t) / (b.t - a.t);
  const smooth = s * s * (3 - 2 * s);
  return {
    eye: lerpVec(a.eye, b.eye, smooth),
    at: lerpVec(a.at, b.at, smooth),
  };
}

/**
 * Shoemake 风格虚拟轨迹球：把屏幕点投到半球，
 * 两次点击对应向量的叉积给出旋转轴，点积给出转角。
 */
function projectTrackball(nx, ny) {
  const r = 1.0;
  const d2 = nx * nx + ny * ny;
  let z;
  if (d2 <= (r * r) / 2) z = Math.sqrt(r * r - d2);
  else z = (r * r) / 2 / Math.sqrt(d2);
  const v = MV.vec3(nx, ny, z);
  return MV.normalize(v);
}

export function createCamera() {
  const cam = {
    mode: "tour", // tour | interactive | eclipse | focus
    playing: true,
    tourTime: 0,
    tourPeriod: 18, // 绕一圈秒数
    projection: "perspective",
    eye: MV.vec3(0, 9, 28),
    at: MV.vec3(0, 0, 0),
    up: MV.vec3(0, 1, 0),
    radius: 30,
    worldRot: MV.mat4(), // 轨迹球累积的世界旋转（作用在相机位置上）
    eclipseKind: null,
    focusBodyId: null, // 聚焦模式正在注视的天体（null = 全景）
    _drag: null,
    _focus: null, // { eye, at, dist, dir }
  };

  function currentLook() {
    if (cam.mode === "tour") return sampleTour(cam.tourTime / cam.tourPeriod);
    return { eye: cam.eye, at: cam.at };
  }

  cam.tick = (dt) => {
    if (cam.mode === "tour" && cam.playing) {
      cam.tourTime = (cam.tourTime + dt) % cam.tourPeriod;
      const look = sampleTour(cam.tourTime / cam.tourPeriod);
      cam.eye = look.eye;
      cam.at = look.at;
    } else if (cam.mode === "focus" && cam._focus) {
      // 指数平滑趋近目标：k 与帧率无关，远快近慢，到达自然
      const k = 1 - Math.exp(-4.5 * dt);
      if (cam._focus.body && cam._focusBodyPos) {
        const targetAt = cam._focusBodyPos; // 天体在动，注视点每帧跟随
        const targetEye = MV.add(
          MV.vec3(targetAt[0], targetAt[1], targetAt[2]),
          MV.scale(cam._focus.dist, cam._focus.dir),
        );
        cam.at = lerpVec(cam.at, targetAt, k);
        cam.eye = lerpVec(cam.eye, targetEye, k);
      } else {
        cam.at = lerpVec(cam.at, cam._focus.at, k);
        cam.eye = lerpVec(cam.eye, cam._focus.eye, k);
      }
    }
  };

  cam.togglePlay = () => {
    if (cam.mode !== "tour") {
      cam.mode = "tour";
      cam.playing = true;
      return;
    }
    cam.playing = !cam.playing;
  };

  cam.resumeTour = () => {
    cam.mode = "tour";
    cam.playing = true;
    cam.eclipseKind = null;
    cam.focusBodyId = null;
  };

  cam.setInteractiveFromCurrent = () => {
    cam.mode = "interactive";
    cam.playing = false;
    cam.eclipseKind = null;
    cam.focusBodyId = null;
  };

  /**
   * 聚焦模式：相机平滑飞到 eye/at。bodyId 非空时注视点每帧跟随该天体
   * （由外部通过 setFocusBodyPos 提供其世界坐标）。
   */
  cam.focusOn = (eye, at, bodyId = null) => {
    cam.mode = "focus";
    cam.playing = false;
    cam.eclipseKind = null;
    cam.focusBodyId = bodyId;
    cam._focus = {
      eye: MV.vec3(eye[0], eye[1], eye[2]),
      at: MV.vec3(at[0], at[1], at[2]),
      dist: MV.length(MV.subtract(MV.vec3(eye[0], eye[1], eye[2]), MV.vec3(at[0], at[1], at[2]))),
      dir: MV.normalize(MV.subtract(MV.vec3(eye[0], eye[1], eye[2]), MV.vec3(at[0], at[1], at[2]))),
      body: bodyId,
    };
    cam._focusBodyPos = null;
  };

  cam.setFocusBodyPos = (pos) => {
    if (pos) cam._focusBodyPos = MV.vec3(pos[0], pos[1], pos[2]);
  };

  cam.viewMatrix = () => {
    const look = currentLook();
    const at = MV.vec3(look.at[0], look.at[1], look.at[2]);
    let eye = MV.vec3(look.eye[0], look.eye[1], look.eye[2]);
    if (cam.mode === "interactive") {
      const rel = MV.subtract(eye, at);
      const r4 = MV.mult(cam.worldRot, MV.vec4(rel[0], rel[1], rel[2], 0));
      eye = MV.add(at, MV.vec3(r4[0], r4[1], r4[2]));
    }
    cam._eyeWorld = eye;
    cam._atWorld = at;
    return MV.lookAt(eye, at, cam.up);
  };

  cam.eyeWorld = () => cam._eyeWorld || cam.eye;

  cam.projMatrix = (aspect) => {
    const fovy = 45;
    const near = 0.15;
    const far = 200;
    if (cam.projection === "ortho") {
      const b = cam.orthoBounds(aspect);
      return MV.ortho(-b.w, b.w, -b.h, b.h, near, far);
    }
    return MV.perspective(fovy, aspect, near, far);
  };

  /** 正交投影的半宽半高（与 projMatrix 保持同一套公式，拾取要用）。 */
  cam.orthoBounds = (aspect) => {
    const fovy = 45;
    const look = currentLook();
    const dist = MV.length(MV.subtract(
      MV.vec3(look.eye[0], look.eye[1], look.eye[2]),
      MV.vec3(look.at[0], look.at[1], look.at[2]),
    ));
    const h = dist * Math.tan((fovy * Math.PI) / 360);
    return { w: h * aspect, h };
  };

  cam.toggleProjection = () => {
    cam.projection = cam.projection === "perspective" ? "ortho" : "perspective";
  };

  cam.beginDrag = (nx, ny) => {
    cam.setInteractiveFromCurrent();
    cam._drag = projectTrackball(nx, ny);
  };

  cam.drag = (nx, ny) => {
    if (!cam._drag) return;
    const cur = projectTrackball(nx, ny);
    const axis = MV.cross(cam._drag, cur);
    const axisLen = MV.length(axis);
    if (axisLen < 1e-6) return;
    const angle = (Math.acos(clamp(MV.dot(cam._drag, cur), -1, 1)) * 180) / Math.PI;
    const R = MV.rotate(angle, axis);
    cam.worldRot = MV.mult(R, cam.worldRot);
    cam._drag = cur;
  };

  cam.endDrag = () => {
    cam._drag = null;
  };

  cam.zoom = (delta) => {
    cam.setInteractiveFromCurrent();
    const s = delta > 0 ? 1.08 : 0.92;
    // 以注视点为基点缩放，而不是围绕世界原点（此前 at≠原点时会跑偏）
    const rel = MV.subtract(
      MV.vec3(cam.eye[0], cam.eye[1], cam.eye[2]),
      MV.vec3(cam.at[0], cam.at[1], cam.at[2]),
    );
    cam.eye = MV.add(
      MV.vec3(cam.at[0], cam.at[1], cam.at[2]),
      MV.scale(s, rel),
    );
  };

  cam.setEclipseView = (kind, eye, at) => {
    cam.mode = "eclipse";
    cam.playing = false;
    cam.eclipseKind = kind;
    cam.focusBodyId = null;
    cam.updateEclipseView(eye, at);
    cam.worldRot = MV.mat4();
  };

  /** 日食/月食视点每帧跟随天体位置更新（仿真时间在 ecl 模式下冻结，画面稳定）。 */
  cam.updateEclipseView = (eye, at) => {
    cam.eye = MV.vec3(eye[0], eye[1], eye[2]);
    cam.at = MV.vec3(at[0], at[1], at[2]);
  };

  /** 跳到漫游路径的某时刻并立即套用该关键帧位姿（截图 / 录屏复现用）。 */
  cam.setTourTime = (t) => {
    cam.tourTime = (((t % 1) + 1) % 1) * cam.tourPeriod;
    const look = sampleTour(cam.tourTime / cam.tourPeriod);
    cam.eye = MV.vec3(look.eye[0], look.eye[1], look.eye[2]);
    cam.at = MV.vec3(look.at[0], look.at[1], look.at[2]);
  };

  /**
   * 由屏幕 NDC 坐标构造世界空间射线（拾取用），透视 / 正交各自正确。
   * 返回 { origin: vec3, dir: vec3 }（dir 已归一化）。
   */
  cam.rayFromNdc = (nx, ny, aspect) => {
    const look = currentLook();
    const eye = MV.vec3(look.eye[0], look.eye[1], look.eye[2]);
    const at = MV.vec3(look.at[0], look.at[1], look.at[2]);
    const fwd = MV.normalize(MV.subtract(at, eye));
    const right = MV.normalize(MV.cross(fwd, MV.vec3(cam.up[0], cam.up[1], cam.up[2])));
    const upv = MV.cross(right, fwd);
    if (cam.projection === "ortho") {
      const b = cam.orthoBounds(aspect);
      const origin = MV.add(
        MV.add(MV.vec3(eye[0], eye[1], eye[2]), MV.scale(b.w * nx, right)),
        MV.scale(b.h * ny, upv),
      );
      return { origin, dir: fwd };
    }
    const fovy = 45;
    const t = Math.tan((fovy * Math.PI) / 360);
    const dir = MV.normalize(MV.add(
      MV.add(fwd, MV.scale(t * aspect * nx, right)),
      MV.scale(t * ny, upv),
    ));
    return { origin: MV.vec3(eye[0], eye[1], eye[2]), dir };
  };

  return cam;
}

export function ndcFromEvent(canvas, ev) {
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
  return [x, y];
}
