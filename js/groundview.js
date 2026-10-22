/**
 * 地面观测视角（Ground View）绘制组件
 * ------------------------------------------------------------
 * 纯 Canvas2D、零依赖、无副作用；供 main.js 在日食 / 月食场景中叠加
 * 「地面观测小窗」。所有几何量以弧度传入，内部按全天空视场半角换算像素。
 *
 * 高 DPI 约定：调用方传入的是 CSS 逻辑尺寸 w×h；由调用方设置
 * canvas.width/height 并 ctx.scale(dpr, dpr)，本文件不读写 devicePixelRatio，
 * 也不修改 ctx 的变换矩阵，只按 w×h 逻辑坐标绘制。
 *
 * 坐标约定：
 *   - 日食：日心固定在画布中心 (w/2, h/2)，月心 = 日心 + (offsetX, -offsetY)；
 *   - 月食：月心固定在画布中心 (w/2, h/2)，地影轴 = 月心 - (offsetX, -offsetY)。
 *     即 data.offsetX/offsetY 始终表示「月心相对地影轴」，右正 / 上正；
 *     画布上把观测目标（月亮）居中，地影相对月亮偏移。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w CSS 宽
 * @param {number} h CSS 高
 * @param {object} data
 * data = {
 *   kind: "solar" | "lunar" | "none",
 *   scaleRad?: number,          // 可选：全天空视场半角（默认 6°，即水平方向 ±6°）
 *   solar?: {
 *     sunRadius: number,        // 太阳角半径（弧度）
 *     moonRadius: number,       // 月球角半径（弧度）
 *     offsetX: number,          // 月心相对日心的角偏移（弧度，右正）
 *     offsetY: number,          // 上正
 *     glow: number              // 0..1 日冕强度
 *   },
 *   lunar?: {
 *     moonRadius: number,
 *     umbraRadius: number,      // 本影角半径（在月球距离处）
 *     penumbraRadius: number,   // 半影角半径
 *     offsetX: number, offsetY: number,  // 月心相对地影轴（右正/上正）
 *   },
 *   caption?: string            // 左下角小字（可空）
 * }
 */
export function drawGroundView(ctx, w, h, data) {
  if (!ctx || typeof ctx.arc !== "function" || !(w > 0) || !(h > 0)) return;
  try {
    ctx.save();
    try {
      drawSky(ctx, w, h);

      const d = data && typeof data === "object" ? data : {};
      const scaleRad = Math.max(1e-4, num(d.scaleRad, DEFAULT_SCALE_RAD));
      const pxPerRad = w / 2 / scaleRad;

      if (d.kind === "solar") drawSolar(ctx, w, h, d.solar, pxPerRad);
      else if (d.kind === "lunar") drawLunar(ctx, w, h, d.lunar, pxPerRad);

      drawCaption(ctx, w, h, d.caption);
    } finally {
      ctx.restore();
    }
  } catch (err) {
    // 组件约定：任何数据 / 环境异常都不得打断调用方渲染，静默降级即可。
  }
}

/** 默认全天空视场半角：6°（画布水平方向覆盖 ±6°）。 */
const DEFAULT_SCALE_RAD = (6 * Math.PI) / 180;

/** 数据缺省时的兜底角半径（弧度）。 */
const FALLBACK_SOLAR = { sunRadius: 0.02, moonRadius: 0.019, glow: 0.45 };
const FALLBACK_LUNAR = { moonRadius: 0.012, umbraRadius: 0.018, penumbraRadius: 0.027 };

/* ------------------------------ 通用工具 ------------------------------ */

function num(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** 构建一个圆形路径（不 fill / stroke）。 */
function pathCircle(ctx, x, y, radius) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.01, radius), 0, Math.PI * 2);
}

/* ------------------------------ 夜空背景 ------------------------------ */

/**
 * 深蓝黑 → 地平线略亮的垂直渐变。
 * 顶部最暗约 rgb(5,7,14)，底部约 rgb(27,42,69)，不会有纯黑像素。
 */
function drawSky(ctx, w, h) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0.0, "#05070e");
  sky.addColorStop(0.42, "#08101f");
  sky.addColorStop(0.74, "#0d172d");
  sky.addColorStop(0.93, "#15213a");
  sky.addColorStop(1.0, "#1b2a45");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // 地平线附近的低空薄雾，让渐变不至于像纯色平涂
  const haze = ctx.createLinearGradient(0, h * 0.55, 0, h);
  haze.addColorStop(0, "rgba(64, 88, 128, 0)");
  haze.addColorStop(1, "rgba(64, 88, 128, 0.18)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);
}

/* ------------------------------ 日食 ------------------------------ */

/**
 * 日食：日心居中；日面亮黄白 + 多层径向光晕（光晕强度受 glow 控制）；
 * 月面为不透明暗盘，叠在日面之上形成偏食（月牙）、环食（亮环）、全食（中心全暗）。
 */
function drawSolar(ctx, w, h, solar, pxPerRad) {
  const s = solar && typeof solar === "object" ? solar : {};
  const cx = w / 2;
  const cy = h / 2;

  const sunRad = Math.max(1e-6, num(s.sunRadius, FALLBACK_SOLAR.sunRadius));
  const moonRad = Math.max(1e-6, num(s.moonRadius, sunRad * 0.97));
  const sunR = Math.max(1, sunRad * pxPerRad);
  const moonR = Math.max(0.5, moonRad * pxPerRad);
  const offX = num(s.offsetX, 0) * pxPerRad;
  const offY = -num(s.offsetY, 0) * pxPerRad; // 数据「上正」→ 屏幕 y 向下
  const glow = clamp01(num(s.glow, FALLBACK_SOLAR.glow));

  const mx = cx + offX;
  const my = cy + offY;

  // 1) 大气散射形成的柔和外晕（径向渐变）
  const halo = ctx.createRadialGradient(cx, cy, sunR * 0.55, cx, cy, sunR * (3.6 + 1.2 * glow));
  halo.addColorStop(0, "rgba(255, 246, 218, 0.90)");
  halo.addColorStop(0.14, "rgba(255, 236, 192, 0.52)");
  halo.addColorStop(0.34, "rgba(255, 214, 150, 0.26)");
  halo.addColorStop(0.64, "rgba(214, 170, 122, 0.11)");
  halo.addColorStop(1, "rgba(160, 122, 92, 0)");
  ctx.fillStyle = halo;
  pathCircle(ctx, cx, cy, sunR * (3.6 + 1.2 * glow));
  ctx.fill();

  // 2) 日冕 / 边缘辉光（强度由 glow 参数控制）
  if (glow > 0.02) {
    const coronaR = sunR * (1.35 + 0.85 * glow);
    const corona = ctx.createRadialGradient(cx, cy, sunR * 0.98, cx, cy, coronaR);
    corona.addColorStop(0, `rgba(255, 252, 236, ${0.72 * glow})`);
    corona.addColorStop(0.45, `rgba(255, 240, 198, ${0.30 * glow})`);
    corona.addColorStop(1, "rgba(255, 226, 160, 0)");
    ctx.fillStyle = corona;
    pathCircle(ctx, cx, cy, coronaR);
    ctx.fill();
  }

  // 3) 太阳圆盘：亮黄白，带轻微临边昏暗
  const sun = ctx.createRadialGradient(cx - sunR * 0.22, cy - sunR * 0.24, sunR * 0.06, cx, cy, sunR);
  sun.addColorStop(0, "#fffef9");
  sun.addColorStop(0.55, "#fff6d2");
  sun.addColorStop(0.85, "#ffe89c");
  sun.addColorStop(1, "#ffd267");
  ctx.fillStyle = sun;
  pathCircle(ctx, cx, cy, sunR);
  ctx.fill();

  ctx.lineWidth = Math.max(0.6, sunR * 0.02);
  ctx.strokeStyle = "rgba(255, 240, 190, 0.85)";
  ctx.stroke();

  // 4) 月球：不透明暗盘（极暗轮廓，保证亮日面 / 亮环上边界清晰）
  const moon = ctx.createRadialGradient(mx, my, 0, mx, my, moonR);
  moon.addColorStop(0, "#0c0d14");
  moon.addColorStop(0.7, "#08090f");
  moon.addColorStop(1, "#04050a");
  ctx.fillStyle = moon;
  pathCircle(ctx, mx, my, moonR);
  ctx.fill();

  ctx.lineWidth = Math.max(0.7, moonR * 0.03);
  ctx.strokeStyle = "rgba(96, 112, 144, 0.45)";
  ctx.stroke();
}

/* ------------------------------ 月食 ------------------------------ */

/**
 * 月食：月面居中；地影轴位于 月心 - offset。
 * 本影内（到轴距离 < umbraRadius）画暗红棕色；半影内（umbra..penumbra）渐暗；
 * 其余为正常亮灰月面（径向渐变 + 低透明度暗斑模拟月海纹理）。
 */
function drawLunar(ctx, w, h, lunar, pxPerRad) {
  const l = lunar && typeof lunar === "object" ? lunar : {};
  const mx = w / 2; // 观测目标（月亮）居中
  const my = h / 2;

  const moonRad = Math.max(1e-6, num(l.moonRadius, FALLBACK_LUNAR.moonRadius));
  const moonR = Math.max(1, moonRad * pxPerRad);

  let umbraR = Math.max(0.5, num(l.umbraRadius, FALLBACK_LUNAR.umbraRadius) * pxPerRad);
  let penumbraR = Math.max(0.5, num(l.penumbraRadius, FALLBACK_LUNAR.penumbraRadius) * pxPerRad);
  if (penumbraR <= umbraR) penumbraR = umbraR + Math.max(1, moonR * 0.25);

  const offX = num(l.offsetX, 0) * pxPerRad;
  const offY = -num(l.offsetY, 0) * pxPerRad;
  const ax = mx - offX; // 地影轴
  const ay = my - offY;

  // 1) 月亮整体的极淡外发光
  const glowR = moonR * 1.85;
  const glow = ctx.createRadialGradient(mx, my, moonR * 0.8, mx, my, glowR);
  glow.addColorStop(0, "rgba(196, 212, 255, 0.18)");
  glow.addColorStop(0.45, "rgba(160, 184, 240, 0.08)");
  glow.addColorStop(1, "rgba(120, 150, 220, 0)");
  ctx.fillStyle = glow;
  pathCircle(ctx, mx, my, glowR);
  ctx.fill();

  // 2) 地影轮廓（很淡的圆形参考线，画在月亮之下，只在天空区域可见）
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(198, 172, 168, 0.20)";
  pathCircle(ctx, ax, ay, umbraR);
  ctx.stroke();
  ctx.strokeStyle = "rgba(150, 170, 215, 0.10)";
  pathCircle(ctx, ax, ay, penumbraR);
  ctx.stroke();

  // 3) 正常月面：亮灰径向纹理
  const base = ctx.createRadialGradient(
    mx - moonR * 0.3,
    my - moonR * 0.35,
    moonR * 0.12,
    mx,
    my,
    moonR * 1.04,
  );
  base.addColorStop(0, "#e3e6ec");
  base.addColorStop(0.52, "#cdd1da");
  base.addColorStop(0.84, "#b4bac6");
  base.addColorStop(1, "#969cab");
  ctx.fillStyle = base;
  pathCircle(ctx, mx, my, moonR);
  ctx.fill();

  // 4) 在月面内叠加月海暗斑（低透明度径向渐变模拟微纹理）与地影
  ctx.save();
  pathCircle(ctx, mx, my, moonR);
  ctx.clip();

  drawMaria(ctx, mx + moonR * 0.34, my - moonR * 0.28, moonR * 0.52, 0.10);
  drawMaria(ctx, mx - moonR * 0.42, my + moonR * 0.30, moonR * 0.46, 0.08);
  drawMaria(ctx, mx + moonR * 0.10, my + moonR * 0.58, moonR * 0.34, 0.06);

  // 半影：从本影边界到半影边界，暗色 alpha 线性衰减
  const uf = clamp01(umbraR / penumbraR);
  const pen = ctx.createRadialGradient(ax, ay, 0, ax, ay, penumbraR);
  pen.addColorStop(0, "rgba(88, 30, 22, 0.92)");
  pen.addColorStop(Math.min(0.999, uf), "rgba(88, 30, 22, 0.88)");
  pen.addColorStop(1, "rgba(88, 30, 22, 0)");
  ctx.fillStyle = pen;
  pathCircle(ctx, ax, ay, penumbraR);
  ctx.fill();

  // 本影：暗红棕色（越靠影轴越暗）
  const umb = ctx.createRadialGradient(ax, ay, 0, ax, ay, umbraR);
  umb.addColorStop(0, "#41160f");
  umb.addColorStop(0.68, "#582019");
  umb.addColorStop(1, "#682b20");
  ctx.fillStyle = umb;
  pathCircle(ctx, ax, ay, umbraR);
  ctx.fill();

  ctx.restore();

  // 5) 月面边缘细描边，使圆盘在深色天空中有清晰边界
  ctx.lineWidth = Math.max(0.6, moonR * 0.025);
  ctx.strokeStyle = "rgba(226, 234, 250, 0.22)";
  pathCircle(ctx, mx, my, moonR);
  ctx.stroke();
}

/** 月面暗斑（月海 / 环形山区域的简化纹理）。 */
function drawMaria(ctx, x, y, radius, alpha) {
  const patch = ctx.createRadialGradient(x, y, 0, x, y, Math.max(0.01, radius));
  patch.addColorStop(0, `rgba(74, 86, 108, ${alpha})`);
  patch.addColorStop(1, "rgba(74, 86, 108, 0)");
  ctx.fillStyle = patch;
  pathCircle(ctx, x, y, radius);
  ctx.fill();
}

/* ------------------------------ 左下角 caption ------------------------------ */

function drawCaption(ctx, w, h, caption) {
  if (typeof caption !== "string" || caption.length === 0) return;
  ctx.save();
  ctx.font = '10px ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#8b93a0";
  ctx.fillText(caption, 10, h - 9);
  ctx.restore();
}
