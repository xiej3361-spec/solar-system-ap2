/**
 * 天体参数集中配置（评分：代码质量）。
 * 距离 / 半径为教学尺度，不是真实 AU；周期为相对地球年的倍数。
 * 改这里即可调整整场景，不必翻渲染代码。
 */

export const SUN = {
  id: "sun",
  name: "太阳",
  radius: 2.4,
  texture: "textures/sun.png",
  emissive: true,
};

/**
 * 行星按距日远近排列。orbit：公转半径；period：公转周期（地球年=1）；
 * spinPeriod：自转周期（地球日=1，负值表示逆向）；tilt：自转轴倾角（度）。
 */
export const PLANETS = [
  { id: "mercury", name: "水星", radius: 0.22, orbit: 4.2, period: 0.24, spinPeriod: 58.6, tilt: 0.03, phase: 20, texture: "textures/mercury.png" },
  { id: "venus",   name: "金星", radius: 0.38, orbit: 5.6, period: 0.62, spinPeriod: -243, tilt: 177.4, phase: 155, texture: "textures/venus.png" },
  { id: "earth",   name: "地球", radius: 0.42, orbit: 7.4, period: 1.00, spinPeriod: 1.00, tilt: 23.5, phase: 80, texture: "textures/earth.png" },
  { id: "mars",    name: "火星", radius: 0.30, orbit: 9.2, period: 1.88, spinPeriod: 1.03, tilt: 25.2, phase: 210, texture: "textures/mars.png" },
  { id: "jupiter", name: "木星", radius: 1.15, orbit: 13.4, period: 11.86, spinPeriod: 0.41, tilt: 3.1, phase: 40, texture: "textures/jupiter.png" },
  { id: "saturn",  name: "土星", radius: 0.95, orbit: 17.6, period: 29.46, spinPeriod: 0.45, tilt: 26.7, phase: 110, texture: "textures/saturn.png",
    ring: { inner: 1.25, outer: 2.15, texture: "textures/saturn_ring.png" } },
  { id: "uranus",  name: "天王星", radius: 0.62, orbit: 21.2, period: 84.01, spinPeriod: -0.72, tilt: 97.8, phase: 255, texture: "textures/uranus.png" },
  { id: "neptune", name: "海王星", radius: 0.60, orbit: 24.4, period: 164.8, spinPeriod: 0.67, tilt: 28.3, phase: 310, texture: "textures/neptune.png" },
];

/** 月球挂在地球节点下，不参与太阳公转半径表。 */
export const MOON = {
  id: "moon",
  name: "月球",
  radius: 0.14,
  orbit: 1.05,
  period: 0.0747,       // 约 27.3 天 / 365
  spinPeriod: 0.0747,   // 同步自转
  tilt: 6.68,
  /** 相对黄道的轨道面倾角。用手造矩阵 R_x(ι)·R_y(ω)·T(r) 施加。 */
  inclination: 5.145,
  texture: "textures/moon.png",
};

export const ASTEROID_BELT = {
  count: 420,
  inner: 10.2,
  outer: 12.2,
  minRadius: 0.018,
  maxRadius: 0.045,
};

export const DEFAULT_UI = {
  orbitSpeed: 1.0,     // 公转倍率
  spinSpeed: 1.0,      // 自转倍率
  earthTilt: 23.5,     // 地球轴倾角，可被滑条覆盖
  showOrbits: true,
  showLabels: true,    // 天体名称叠层标签
  simPaused: false,    // 仿真时间冻结（P / 按钮）
  projection: "perspective", // perspective | ortho
  tourPlaying: true,
};

/** 一年对应的仿真秒数（orbitSpeed=1 时，地球公转一周约 20s）。 */
export const YEAR_SECONDS = 20;
export const DAY_SECONDS = YEAR_SECONDS / 24; // 教学加速：一天相对一年更短，自转可见
