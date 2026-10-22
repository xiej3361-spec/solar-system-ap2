/**
 * AP2 太阳系 · 简化天文计算模块
 *
 * 纯 ES module，零依赖，所有导出函数均为纯函数（相同输入必得相同输出）。
 * 角度约定：内部计算用弧度，导出的经纬度接口明确标注为「度」；距离一律用 AU。
 *
 * 精度说明（重要）：
 * - 行星日心位置使用 JPL Solar System Dynamics 的
 *   "Approximate Positions of the Planets"（Standish）近似轨道要素：
 *   J2000 值 + 每儒略世纪线性变化率，解开普勒方程得到日心黄道坐标。
 *   该组要素约在公元 1800–2050 年有效；**这是简化近似，非精确星历**，
 *   不能用于导航、精密定轨或天文观测预报。
 * - 太阳直射点使用几何太阳方向 + 黄赤交角 + GMST，忽略章动、光行差、
 *   光行时、岁差与行星摄动的高阶项，因此经度可能有亚度级系统偏差。
 * - 月球使用平均要素 + 一阶中心差，距离固定为 384400 km 的平均值，
 *   仅适合教学演示，不是精确月球历表。
 * - 时间参数均为 UTC 儒略日；未考虑 UT1−UTC 的微小差异（< 0.9 s）。
 *
 * @module js/astro
 */

/** 角度单位：1 度对应的弧度。 */
export const DEG = Math.PI / 180;

/** 弧度 → 度。 @type {number} */
const RAD = 180 / Math.PI;

/** 2π。 @type {number} */
const TWO_PI = Math.PI * 2;

/** J2000.0 历元的儒略日（2000-01-01T12:00:00Z）。 @type {number} */
const J2000 = 2451545.0;

/** 一儒略世纪的日数。 @type {number} */
const DAYS_PER_JULIAN_CENTURY = 36525;

/** 1 天文单位对应的千米数（IAU 2012 定义值）。 @type {number} */
const KM_PER_AU = 149597870.7;

/** Unix 纪元 1970-01-01T00:00:00Z 的儒略日。 @type {number} */
const UNIX_EPOCH_JD = 2440587.5;

/** 每天的毫秒数。 @type {number} */
const MS_PER_DAY = 86400000;

/**
 * 把角度归一化到 [0, 360)。
 * @param {number} angleDeg 角度（度）。
 * @returns {number} 归一化角度（度）。
 */
function normalizeDegrees(angleDeg) {
  return ((angleDeg % 360) + 360) % 360;
}

/**
 * 把弧度归一化到 [0, 2π)。
 * @param {number} angleRad 角度（弧度）。
 * @returns {number} 归一化角度（弧度）。
 */
function normalizeRadians(angleRad) {
  return ((angleRad % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * 把角度归一化到 [-180, 180]，用于表示经度。
 * @param {number} angleDeg 角度（度）。
 * @returns {number} 归一化角度（度）。
 */
function normalizeSignedDegrees(angleDeg) {
  const wrapped = normalizeDegrees(angleDeg);
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/**
 * 把弧度归一化到 [-π, π]，供开普勒方程初值使用。
 * @param {number} angleRad 角度（弧度）。
 * @returns {number} 归一化角度（弧度）。
 */
function normalizeSignedRadians(angleRad) {
  const wrapped = normalizeRadians(angleRad);
  return wrapped > Math.PI ? wrapped - TWO_PI : wrapped;
}

/**
 * 在 [0, 24) 内归一化小时数。
 * @param {number} hours 小时数。
 * @returns {number} 归一化小时数。
 */
function normalizeHours(hours) {
  return ((hours % 24) + 24) % 24;
}

/**
 * 递归冻结对象，保证导出的轨道要素表不会被调用方意外修改。
 * @template T
 * @param {T} value 待冻结值。
 * @returns {T} 冻结后的同一个值。
 */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
  }
  return value;
}

/**
 * 单个轨道要素：J2000 历元值与该要素每儒略世纪的变化率。
 * @typedef {object} OrbitalElement
 * @property {number} j2000 J2000.0 时的值。
 * @property {number} ratePerCentury 每儒略世纪的变化率。
 */

/**
 * 一颗行星的六个近似轨道要素。
 * 角度采用度，半长轴采用 AU，周期项以儒略世纪为单位。
 * @typedef {object} PlanetElements
 * @property {OrbitalElement} a 半长轴 [AU]。
 * @property {OrbitalElement} e 偏心率（无量纲）。
 * @property {OrbitalElement} i 轨道倾角 [度]。
 * @property {OrbitalElement} L 平黄经 [度]。
 * @property {OrbitalElement} longPeri 近日点黄经 [度]。
 * @property {OrbitalElement} longNode 升交点黄经 [度]。
 */

/**
 * JPL "Approximate Positions of the Planets" 近似轨道要素表（1800–2050 年）。
 *
 * 表中数值为 J2000.0 历元值；变化率单位为「每儒略世纪」。
 * 角度字段以度存储，使用前乘以 {@link DEG} 转为弧度。
 * 这是简化近似，非精确星历。
 *
 * @type {Readonly<Record<string, PlanetElements>>}
 */
export const PLANET_ELEMENTS = deepFreeze({
  mercury: {
    a: { j2000: 0.38709927, ratePerCentury: 0.00000037 },
    e: { j2000: 0.20563593, ratePerCentury: 0.00001906 },
    i: { j2000: 7.00497902, ratePerCentury: -0.00594749 },
    L: { j2000: 252.2503235, ratePerCentury: 149472.67411175 },
    longPeri: { j2000: 77.45779628, ratePerCentury: 0.16047689 },
    longNode: { j2000: 48.33076593, ratePerCentury: -0.12534081 },
  },
  venus: {
    a: { j2000: 0.72333566, ratePerCentury: 0.0000039 },
    e: { j2000: 0.00677672, ratePerCentury: -0.00004107 },
    i: { j2000: 3.39467605, ratePerCentury: -0.0007889 },
    L: { j2000: 181.9790995, ratePerCentury: 58517.81538729 },
    longPeri: { j2000: 131.60246718, ratePerCentury: 0.00268329 },
    longNode: { j2000: 76.67984255, ratePerCentury: -0.27769418 },
  },
  earth: {
    a: { j2000: 1.00000261, ratePerCentury: 0.00000562 },
    e: { j2000: 0.01671123, ratePerCentury: -0.00004392 },
    i: { j2000: -0.00001531, ratePerCentury: -0.01294668 },
    L: { j2000: 100.46457166, ratePerCentury: 35999.37244981 },
    longPeri: { j2000: 102.93768193, ratePerCentury: 0.32327364 },
    longNode: { j2000: 0.0, ratePerCentury: 0.0 },
  },
  mars: {
    a: { j2000: 1.52371034, ratePerCentury: 0.00001847 },
    e: { j2000: 0.0933941, ratePerCentury: 0.00007882 },
    i: { j2000: 1.84969142, ratePerCentury: -0.00813131 },
    L: { j2000: -4.55343205, ratePerCentury: 19140.30268499 },
    longPeri: { j2000: -23.94362959, ratePerCentury: 0.44441088 },
    longNode: { j2000: 49.55953891, ratePerCentury: -0.29257343 },
  },
  jupiter: {
    a: { j2000: 5.202887, ratePerCentury: -0.00011607 },
    e: { j2000: 0.04838624, ratePerCentury: -0.00013253 },
    i: { j2000: 1.30439695, ratePerCentury: -0.00183714 },
    L: { j2000: 34.39644051, ratePerCentury: 3034.74612775 },
    longPeri: { j2000: 14.72847983, ratePerCentury: 0.21252668 },
    longNode: { j2000: 100.47390909, ratePerCentury: 0.20469106 },
  },
  saturn: {
    a: { j2000: 9.53667594, ratePerCentury: -0.0012506 },
    e: { j2000: 0.05386179, ratePerCentury: -0.00050991 },
    i: { j2000: 2.48599187, ratePerCentury: 0.00193609 },
    L: { j2000: 49.95424423, ratePerCentury: 1222.49362201 },
    longPeri: { j2000: 92.59887831, ratePerCentury: -0.41897216 },
    longNode: { j2000: 113.66242448, ratePerCentury: -0.28867794 },
  },
  uranus: {
    a: { j2000: 19.18916464, ratePerCentury: -0.00196176 },
    e: { j2000: 0.04725744, ratePerCentury: -0.00004397 },
    i: { j2000: 0.77263783, ratePerCentury: -0.00242939 },
    L: { j2000: 313.23810451, ratePerCentury: 428.48202785 },
    longPeri: { j2000: 170.9542763, ratePerCentury: 0.40805281 },
    longNode: { j2000: 74.01692503, ratePerCentury: 0.04240589 },
  },
  neptune: {
    a: { j2000: 30.06992276, ratePerCentury: 0.00026291 },
    e: { j2000: 0.00859048, ratePerCentury: 0.00005105 },
    i: { j2000: 1.77004347, ratePerCentury: 0.00035372 },
    L: { j2000: -55.12002969, ratePerCentury: 218.45945325 },
    longPeri: { j2000: 44.96476227, ratePerCentury: -0.32241464 },
    longNode: { j2000: 131.78422574, ratePerCentury: -0.00508664 },
  },
});

/**
 * 读取某行星在给定儒略世纪时的轨道要素值：J2000 值 + 每世纪变化率 × T。
 * @param {PlanetElements} elements 行星轨道要素。
 * @param {keyof PlanetElements} key 要素名。
 * @param {number} T 自 J2000 起的儒略世纪数。
 * @returns {number} 该历元的要素值（角度为度，a 为 AU）。
 */
function elementAt(elements, key, T) {
  const element = elements[key];
  return element.j2000 + element.ratePerCentury * T;
}

/**
 * 用牛顿迭代解开普勒方程 M = E − e·sin(E)。
 *
 * 初值取 M + e·sin(M)·(1 + e·cos(M))，每步 E ← E − f(E)/f′(E)。
 * 为满足精算要求，至少执行 4 次迭代；通常 5–6 次即收敛到 1e-12 rad，
 * 最多执行 12 次。对 JPL 表中 e < 0.21 的行星均稳定收敛。
 *
 * @param {number} meanAnomalyRad 平近点角 M [弧度]。
 * @param {number} eccentricity 偏心率 e（0 ≤ e < 1）。
 * @returns {number} 偏近点角 E [弧度]。
 */
function solveKepler(meanAnomalyRad, eccentricity) {
  const M = normalizeSignedRadians(meanAnomalyRad);
  let E = M + eccentricity * Math.sin(M) * (1 + eccentricity * Math.cos(M));

  for (let i = 0; i < 12; i += 1) {
    const residual = E - eccentricity * Math.sin(E) - M;
    const derivative = 1 - eccentricity * Math.cos(E);
    const delta = residual / derivative;
    E -= delta;

    // 前 4 次迭代必须执行；之后残差足够小即可提前结束。
    if (i >= 3 && Math.abs(delta) < 1e-12) {
      break;
    }
  }

  return E;
}

/**
 * Date → 儒略日（UTC）。
 *
 * 使用 Unix 时间戳线性换算，不受运行环境本地时区影响。
 *
 * @param {Date} date 任意 Date 对象（按 UTC 计）。
 * @returns {number} 儒略日 JD（UTC）。
 */
export function julianDay(date) {
  return date.getTime() / MS_PER_DAY + UNIX_EPOCH_JD;
}

/**
 * 格林尼治平恒星时（GMST），单位：度。
 *
 * 采用低阶标准公式：
 * GMST = 280.46061837 + 360.98564736629 × (JD − 2451545.0)。
 *
 * @param {number} jd 儒略日（UTC）。
 * @returns {number} GMST，归一化到 [0, 360) 度。
 */
export function gmstDegrees(jd) {
  return normalizeDegrees(280.46061837 + 360.98564736629 * (jd - J2000));
}

/**
 * 黄赤交角（平黄赤交角），单位：度。
 *
 * 低阶 Meeus 多项式（含 T、T²、T³ 项），不含章动。
 *
 * @param {number} jd 儒略日。
 * @returns {number} 平黄赤交角 [度]。
 */
export function obliquityDegrees(jd) {
  const T = (jd - J2000) / DAYS_PER_JULIAN_CENTURY;
  const arcseconds = 21.448 - 46.815 * T - 0.00059 * T * T + 0.001813 * T * T * T;
  return 23 + 26 / 60 + arcseconds / 3600;
}

/**
 * 行星日心黄道坐标（J2000 黄道与春分点），单位：AU。
 *
 * 使用 JPL "Approximate Positions of the Planets" 近似轨道要素，逐行星
 * 展开为日心直角坐标。适用于约公元 1800–2050 年；**简化近似，非精确星历**。
 *
 * 计算步骤：
 * 1. 由平黄经 L 与近日点黄经求平近点角 M，牛顿迭代解开普勒方程；
 * 2. 在轨道平面内求 x′、y′；
 * 3. 经近日点幅角 ω、升交点黄经 Ω、轨道倾角 I 旋转到黄道坐标。
 *
 * @param {"mercury"|"venus"|"earth"|"mars"|"jupiter"|"saturn"|"uranus"|"neptune"} name 行星名（小写）。
 * @param {number} jd 儒略日（UTC）。
 * @returns {[number, number, number]} 日心黄道坐标 [x, y, z]，单位 AU。
 * @throws {RangeError} 当行星名不在支持列表中。
 */
export function planetPositionAU(name, jd) {
  const planetName = String(name).toLowerCase();
  const elements = PLANET_ELEMENTS[planetName];

  if (!elements) {
    throw new RangeError(`Unknown planet "${name}". Expected one of: ${Object.keys(PLANET_ELEMENTS).join(", ")}`);
  }

  const T = (jd - J2000) / DAYS_PER_JULIAN_CENTURY;
  const a = elementAt(elements, "a", T);
  const e = elementAt(elements, "e", T);
  const incRad = elementAt(elements, "i", T) * DEG;
  const meanLongRad = elementAt(elements, "L", T) * DEG;
  const periLongRad = elementAt(elements, "longPeri", T) * DEG;
  const nodeLongRad = elementAt(elements, "longNode", T) * DEG;

  const meanAnomalyRad = normalizeSignedRadians(meanLongRad - periLongRad);
  const eccentricAnomalyRad = solveKepler(meanAnomalyRad, e);

  // 轨道平面内坐标（以近日点方向为 x′ 轴）。
  const xOrbital = a * (Math.cos(eccentricAnomalyRad) - e);
  const yOrbital = a * Math.sqrt(1 - e * e) * Math.sin(eccentricAnomalyRad);

  // 近日点幅角 ω = ϖ − Ω。
  const argPeriRad = periLongRad - nodeLongRad;
  const cosArgPeri = Math.cos(argPeriRad);
  const sinArgPeri = Math.sin(argPeriRad);
  const cosNode = Math.cos(nodeLongRad);
  const sinNode = Math.sin(nodeLongRad);
  const cosInc = Math.cos(incRad);
  const sinInc = Math.sin(incRad);

  // 轨道平面 → 黄道坐标（J2000 黄道与春分点）的标准旋转。
  const x =
    (cosArgPeri * cosNode - sinArgPeri * sinNode * cosInc) * xOrbital +
    (-sinArgPeri * cosNode - cosArgPeri * sinNode * cosInc) * yOrbital;
  const y =
    (cosArgPeri * sinNode + sinArgPeri * cosNode * cosInc) * xOrbital +
    (-sinArgPeri * sinNode + cosArgPeri * cosNode * cosInc) * yOrbital;
  const z =
    (sinArgPeri * sinInc) * xOrbital +
    (cosArgPeri * sinInc) * yOrbital;

  return [x, y, z];
}

/**
 * 行星日心黄道球坐标，单位：黄经/黄纬为弧度，距离为 AU。
 *
 * @param {"mercury"|"venus"|"earth"|"mars"|"jupiter"|"saturn"|"uranus"|"neptune"} name 行星名（小写）。
 * @param {number} jd 儒略日（UTC）。
 * @returns {{lon: number, lat: number, r: number}} 日心黄经 λ ∈ [0, 2π)、
 *   黄纬 β ∈ [−π/2, π/2]、距离 r [AU]。
 * @throws {RangeError} 当行星名不在支持列表中。
 */
export function planetState(name, jd) {
  const [x, y, z] = planetPositionAU(name, jd);
  const r = Math.hypot(x, y, z);

  return {
    lon: normalizeRadians(Math.atan2(y, x)),
    lat: Math.atan2(z, Math.hypot(x, y)),
    r,
  };
}

/**
 * 太阳的地心黄道坐标（几何方向），单位：弧度 / AU。
 *
 * 由地球日心位置取反得到，忽略光行时与光行差。
 *
 * @param {number} jd 儒略日（UTC）。
 * @returns {{lon: number, lat: number, r: number}} 地心黄经 λ ∈ [0, 2π)、
 *   黄纬 β ∈ [−π/2, π/2]、距离 r [AU]。
 */
export function sunGeocentricEcliptic(jd) {
  const [earthX, earthY, earthZ] = planetPositionAU("earth", jd);
  const x = -earthX;
  const y = -earthY;
  const z = -earthZ;
  const r = Math.hypot(x, y, z);

  return {
    lon: normalizeRadians(Math.atan2(y, x)),
    lat: Math.atan2(z, Math.hypot(x, y)),
    r,
  };
}

/**
 * 太阳赤道坐标（地心、真春分点近似为 J2000 黄道系加平黄赤交角）。
 * @param {number} jd 儒略日（UTC）。
 * @returns {{raDeg: number, decDeg: number}} 赤经 α [0,360) 度、赤纬 δ 度。
 */
function sunEquatorial(jd) {
  const sun = sunGeocentricEcliptic(jd);
  const epsilon = obliquityDegrees(jd) * DEG;
  const cosEpsilon = Math.cos(epsilon);
  const sinEpsilon = Math.sin(epsilon);

  const cosLat = Math.cos(sun.lat);
  const eclipticX = cosLat * Math.cos(sun.lon);
  const eclipticY = cosLat * Math.sin(sun.lon);
  const eclipticZ = Math.sin(sun.lat);

  // 绕黄道 x 轴旋转 ε：黄道 (x,y,z) → 赤道 (x,y,z)。
  const equatorialY = eclipticY * cosEpsilon - eclipticZ * sinEpsilon;
  const equatorialZ = eclipticY * sinEpsilon + eclipticZ * cosEpsilon;
  const declination = Math.asin(Math.max(-1, Math.min(1, equatorialZ)));

  return {
    raDeg: normalizeDegrees(Math.atan2(equatorialY, eclipticX) * RAD),
    decDeg: declination * RAD,
  };
}

/**
 * 太阳直射点（subsolar point）。
 *
 * 先由太阳地心黄道方向求赤道坐标 (α, δ)，再令直射点纬度 = δ，
 * 经度 = α − GMST（归一化到 −180..180，东经为正）。
 *
 * @param {number} jd 儒略日（UTC）。
 * @returns {{lat: number, lon: number}} 直射点纬度、经度 [度]；lon 东经为正，
 *   范围 [−180, 180]。
 */
export function subsolarPoint(jd) {
  const sun = sunEquatorial(jd);
  return {
    lat: sun.decDeg,
    lon: normalizeSignedDegrees(sun.raDeg - gmstDegrees(jd)),
  };
}

/**
 * 赤道与晨昏线的两个交点。
 *
 * 直射点经度为 λ_s 时，晨昏线（太阳高度角为 0 的大圆）与赤道交于
 * λ_s ± 90°。返回的两点纬度严格为 0，经度会归一化到 [−180, 180]。
 *
 * @param {number} jd 儒略日（UTC）。
 * @returns {[{lat: number, lon: number}, {lat: number, lon: number}]}
 *   两个交点；第一个为 λ_s + 90°，第二个为 λ_s − 90°。
 */
export function terminatorPoints(jd) {
  const { lon } = subsolarPoint(jd);
  return [
    { lat: 0, lon: normalizeSignedDegrees(lon + 90) },
    { lat: 0, lon: normalizeSignedDegrees(lon - 90) },
  ];
}

/**
 * 近似当地太阳时，单位：小时。
 *
 * 由太阳时角 H = GMST + 当地经度 − 太阳赤经求视太阳时：
 * 当地太阳时 = 12 h + H / 15°。因此当 lonDeg 恰为直射点经度时，
 * 结果约为 12 时整（正午）。
 *
 * 这是几何近似，未考虑均时差的高阶修正、章动与大气折射。
 *
 * @param {number} jd 儒略日（UTC）。
 * @param {number} lonDeg 当地经度 [度]，东经为正。
 * @returns {number} 当地太阳时 [0, 24) 小时。
 */
export function localSolarTimeHours(jd, lonDeg) {
  const sun = sunEquatorial(jd);
  const hourAngle = normalizeDegrees(gmstDegrees(jd) + lonDeg - sun.raDeg);
  return normalizeHours(12 + hourAngle / 15);
}

/**
 * 月球地心黄道坐标（简化平均要素模型）。
 *
 * 采用简化平均要素：
 * - 平均黄经 L = 218.316 + 13.176396 d（d 为 J2000 起的天数）；
 * - 平均近点角 M = 134.963 + 13.064993 d；
 * - 升交点角距 F = 93.272 + 13.229350 d；
 * - 一阶中心差 6.289°·sin M，纬度近似 5.145°·sin F；
 * - 距离固定为平均距离 384400 km（≈ 0.00256956 AU），不建模椭圆变距。
 *
 * **这是教学用简化模型，不是精密月球历表。** 真实月球黄经还受出差、
 * 二均差、周年差等多项影响，本模型误差可达数度。
 *
 * @param {number} jd 儒略日（UTC）。
 * @returns {{lon: number, lat: number, r: number}} 地心黄经 λ ∈ [0, 2π) [弧度]、
 *   黄纬 β [弧度]、距离 r [AU]。
 */
export function moonGeocentric(jd) {
  const d = jd - J2000;

  // 平均要素（度）。
  const meanLongitude = 218.316 + 13.176396 * d;
  const meanAnomaly = 134.963 + 13.064993 * d;
  const argumentOfLatitude = 93.272 + 13.22935 * d;

  // 一阶中心差给出黄经的主周期修正；纬度由 5.145° 倾角的正弦给出。
  const lonDeg = meanLongitude + 6.289 * Math.sin(meanAnomaly * DEG);
  const latDeg = 5.145 * Math.sin(argumentOfLatitude * DEG);

  return {
    lon: normalizeRadians(lonDeg * DEG),
    lat: latDeg * DEG,
    r: 384400 / KM_PER_AU,
  };
}
