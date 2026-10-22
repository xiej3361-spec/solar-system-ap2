/**
 * 层级场景图：太阳 → 行星轨道节点 →（地球）月球。
 *
 * 地球倾角必须「先转后挂」：
 *   M_earth = R_y(公转) · T(轨道半径) · [倾角] · R_y(自转) · S(半径)
 * 先在地球局部施加倾角旋转，再乘上公转轨道变换。
 * 月球不继承地球自转 / 倾角，只挂在地球的轨道节点上。
 *
 * V3 新增：
 *  - 统一模拟时间 sim.date（真实天文模式）/ sim.time（自定义演示模式）
 *  - 真实模式：行星角位置来自 astro.js（JPL 近似轨道要素），地球自转相位由
 *    太阳直射点经度决定，地轴倾角绕固定世界轴（产生真实季节）
 *  - 日食 / 月食：解析求出月球本影 / 半影锥与地球阴影锥，
 *    给出地表阴影斑、地面观测角尺寸与示意体积
 */

import { SUN, PLANETS, MOON, ASTEROID_BELT, YEAR_SECONDS, DAY_SECONDS } from "./config.js";
import { createAsteroids } from "./geometry.js";

const MV = window;

export function createMatrixStack() {
  const stack = [MV.mat4()];
  return {
    loadIdentity() {
      stack[stack.length - 1] = MV.mat4();
    },
    push() {
      stack.push(stack[stack.length - 1]);
    },
    pop() {
      if (stack.length < 2) throw new Error("matrix stack underflow");
      stack.pop();
    },
    mult(m) {
      stack[stack.length - 1] = MV.mult(stack[stack.length - 1], m);
    },
    top() {
      return stack[stack.length - 1];
    },
  };
}

/**
 * 手造月球轨道矩阵（作业必做第 2 条）。
 * 不用任何「一次完成公转+倾角」的封装，只用 MV.js 的 rotate / translate，再 mult。
 *
 * 列向量约定下，M v 表示先应用右侧变换：
 *   M = R_x(ι) · R_y(ω) · T(r, 0, 0)
 */
export function moonOrbitMatrix(inclinationDeg, revolutionDeg, radius) {
  const Rx = MV.rotate(inclinationDeg, MV.vec3(1, 0, 0));
  const Ry = MV.rotate(revolutionDeg, MV.vec3(0, 1, 0));
  const T = MV.translate(radius, 0, 0);
  return MV.mult(MV.mult(Rx, Ry), T);
}

function translationOf(m) {
  return MV.vec3(m[0][3], m[1][3], m[2][3]);
}

function deg2rad(d) {
  return (d * Math.PI) / 180;
}

export function createScene() {
  const asteroids = createAsteroids(
    ASTEROID_BELT.count,
    ASTEROID_BELT.inner,
    ASTEROID_BELT.outer,
    ASTEROID_BELT.minRadius,
    ASTEROID_BELT.maxRadius,
  );

  const sim = {
    mode: "real", // "real" 真实天文 | "demo" 自定义演示
    time: 0, // 演示模式：仿真年
    date: new Date(), // 真实模式：模拟时刻（UTC）
    rate: 3600, // 真实模式：每秒推进的模拟秒数（60× 即 1 分钟/秒）
    positions: {},
    solarInfo: null, // 直射点 / 晨昏线等（真实模式）
  };

  let astro = null;
  function setAstro(mod) {
    astro = mod;
  }

  /** 真实天文模式下的角度表（全部由同一 sim.date 推导，无逐帧累加） */
  function realAngles() {
    if (!astro) return null;
    const jd = astro.julianDay(sim.date);
    const out = { jd };
    for (const p of PLANETS) {
      const st = astro.planetState(p.id, jd);
      const lonDeg = (st.lon * 180) / Math.PI;
      // 真实日心距 / 平均日心距 → 按场景展示尺度等比缩放（保留偏心率带来的远近变化）
      const aAU = p.orbitAU || 1;
      out[p.id] = {
        rev: lonDeg,
        // 自转相位：sidereal 周期，从模拟时刻直接计算，避免长时间累计误差
        spin: ((sim.date.getTime() / 86400000) * 360) / Math.abs(p.spinPeriod) + (p.spinPhase || 0),
        tilt: p.id === "earth" ? 23.44 : p.tilt,
        orbitScale: st.r / aAU,
      };
    }
    const sp = astro.subsolarPoint(jd);
    const tp = astro.terminatorPoints(jd);
    sim.solarInfo = {
      jd,
      subsolar: sp,
      terminator: tp,
      localSolarTime: astro.localSolarTimeHours(jd, sp.lon),
      utc: sim.date.toISOString(),
    };
    // 让直射点经线朝向太阳（近似：忽略倾角对经度的小影响）
    out.earth.spin = sp.lon - 180;
    out.earth.subsolar = sp;
    out.earth.fixedTilt = true; // 真实模式：倾角绕固定世界轴（季节成立）

    const mj = astro.moonGeocentric(jd);
    out.moon = {
      rev: (mj.lon * 180) / Math.PI - out.earth.rev,
      lat: (mj.lat * 180) / Math.PI,
      distScale: mj.r / 0.00257,
    };
    return out;
  }

  function demoAngles(ui) {
    const year = sim.time;
    const orbitK = ui.orbitSpeed;
    const spinK = ui.spinSpeed;
    const out = {};
    for (const p of PLANETS) {
      out[p.id] = {
        rev: ((year * orbitK) / p.period) * 360 + (p.phase || 0),
        spin: ((year * YEAR_SECONDS * spinK) / (p.spinPeriod * DAY_SECONDS)) * 360,
        tilt: p.id === "earth" ? ui.earthTilt : p.tilt,
        orbitScale: 1,
      };
    }
    out.moon = {
      rev: ((year * orbitK) / MOON.period) * 360,
      spin: ((year * YEAR_SECONDS * spinK) / (MOON.spinPeriod * DAY_SECONDS)) * 360,
    };
    return out;
  }

  function angles(ui) {
    const real = sim.mode === "real" ? realAngles() : null;
    return real || demoAngles(ui);
  }

  /**
   * 遍历场景图，对每个可绘制节点回调。
   * draw({ kind, id, model, textureId, emissive, alpha })
   */
  function traverse(ui, draw) {
    const a = angles(ui);
    const S = createMatrixStack();

    // —— 太阳 ——
    S.push();
    S.mult(MV.scalem(SUN.radius, SUN.radius, SUN.radius));
    draw({ kind: "body", id: "sun", model: S.top(), textureId: "sun", emissive: 1, sunSurface: 1 });
    S.pop();
    sim.positions.sun = MV.vec3(0, 0, 0);

    // 日冕：面向相机的 billboard（模型矩阵在 main.js 中按相机基向量构造，这里只给锚点）
    draw({
      kind: "corona",
      id: "sun-corona",
      model: MV.mat4(),
      anchor: MV.vec3(0, 0, 0),
      size: SUN.radius * 8.5,
      textureId: "sun",
      tint: [1, 0.62, 0.26],
    });

    if (ui.showOrbits) {
      for (const p of PLANETS) {
        S.push();
        S.mult(MV.scalem(p.orbit * (a[p.id].orbitScale || 1), p.orbit * (a[p.id].orbitScale || 1), p.orbit * (a[p.id].orbitScale || 1)));
        draw({ kind: "orbit", id: p.id + "-orbit", model: S.top() });
        S.pop();
      }
    }

    let earthOrbitNode = null;

    for (const p of PLANETS) {
      const ang = a[p.id];
      const scale = ang.orbitScale || 1;
      S.push();
      // 公转轨道变换：先平移到轨道半径，再绕 Y 公转
      S.mult(MV.rotate(ang.rev, MV.vec3(0, 1, 0)));
      S.mult(MV.translate(p.orbit * scale, 0, 0));
      const orbitNode = S.top();
      sim.positions[p.id] = translationOf(orbitNode);

      if (p.id === "earth") earthOrbitNode = orbitNode;

      S.push();
      // 先转后挂：局部先倾角、再自转、再缩放，然后挂到轨道节点
      if (ang.fixedTilt) {
        // 真实模式：倾角绕「固定世界轴」——共轭 Ry(−rev)·Rz(ε)·Ry(rev)，
        // 使地轴方向不随公转摆动，从而产生真实季节而非随轨道旋转的假倾角。
        const rev = ang.rev;
        const tiltY = MV.mult(
          MV.mult(MV.rotate(-rev, MV.vec3(0, 1, 0)), MV.rotate(ang.tilt, MV.vec3(0, 0, 1))),
          MV.rotate(rev, MV.vec3(0, 1, 0)),
        );
        S.mult(tiltY);
      } else {
        S.mult(MV.rotate(ang.tilt, MV.vec3(0, 0, 1)));
      }
      S.mult(MV.rotate(ang.spin, MV.vec3(0, 1, 0)));
      S.mult(MV.scalem(p.radius, p.radius, p.radius));
      draw({ kind: "body", id: p.id, model: S.top(), textureId: p.id, emissive: 0 });
      S.pop();

      if (p.ring) {
        S.push();
        S.mult(MV.rotate(ang.tilt, MV.vec3(0, 0, 1)));
        S.mult(MV.scalem(p.radius, p.radius, p.radius));
        draw({
          kind: "ring",
          id: "saturn-ring",
          model: S.top(),
          textureId: "saturn_ring",
          emissive: 0.15,
        });
        S.pop();
      }

      S.pop();
    }

    // —— 月球：挂在地球轨道节点，不乘地球倾角/自转 ——
    if (earthOrbitNode) {
      S.push();
      S.mult(earthOrbitNode);
      if (ui.showOrbits) {
        S.push();
        S.mult(MV.rotate(MOON.inclination, MV.vec3(1, 0, 0)));
        S.mult(MV.scalem(MOON.orbit, MOON.orbit, MOON.orbit));
        draw({ kind: "orbit", id: "moon-orbit", model: S.top() });
        S.pop();
      }
      const moonDist = MOON.orbit * (a.moon.distScale || 1);
      const MmoonOrbit = moonOrbitMatrix(MOON.inclination, a.moon.rev, moonDist);
      S.mult(MmoonOrbit);
      sim.positions.moon = translationOf(S.top());
      S.push();
      S.mult(MV.rotate(MOON.tilt, MV.vec3(0, 0, 1)));
      S.mult(MV.rotate(a.moon.spin || 0, MV.vec3(0, 1, 0)));
      S.mult(MV.scalem(MOON.radius, MOON.radius, MOON.radius));
      draw({ kind: "body", id: "moon", model: S.top(), textureId: "moon", emissive: 0 });
      S.pop();
      S.pop();
    }

    // —— 小行星带（仅演示模式，真实模式不改变物理参考） ——
    for (let i = 0; i < asteroids.length; i++) {
      const it = asteroids[i];
      const rev = a.mars.rev * (it.period / 1.88) + (it.angle0 * 180) / Math.PI;
      S.push();
      S.mult(MV.rotate(rev, MV.vec3(0, 1, 0)));
      S.mult(MV.translate(it.r, it.y, 0));
      S.mult(MV.rotate(it.tilt, MV.vec3(1, 0, 0)));
      S.mult(MV.scalem(it.radius, it.radius, it.radius));
      draw({ kind: "asteroid", id: "asteroid", model: S.top(), textureId: "moon", emissive: 0 });
      S.pop();
    }
  }

  // ---------------------------------------------------------------- 日月食几何

  /** 预计算：单位向量、锥长等 */
  function eclipseGeometry() {
    const sun = sim.positions.sun;
    const earth = sim.positions.earth;
    const moon = sim.positions.moon;
    if (!earth || !moon) return null;
    const Rs = SUN.radius;
    const Re = PLANETS.find((p) => p.id === "earth").radius;
    const Rm = MOON.radius;

    const vSM = MV.subtract(moon, sun);
    const dSM = MV.length(vSM);
    const dirSM = MV.scale(1 / dSM, vSM); // 太阳 → 月球
    const vSE = MV.subtract(earth, sun);
    const dSE = MV.length(vSE);
    const dirSE = MV.scale(1 / dSE, vSE); // 太阳 → 地球

    // 月球本影锥：自月球背面收敛，锥顶距离 Lu
    const Lu = (dSM * Rm) / (Rs - Rm);
    // 半影：自月球向地球方向发散
    const penumbraK = (Rs + Rm) / dSM;

    // 地球落点：把地心投影到月影轴上
    const relEM = MV.subtract(earth, moon);
    const tE = MV.dot(relEM, dirSM);
    const perpE = MV.subtract(relEM, MV.scale(tE, dirSM));
    const hE = MV.length(perpE);
    const hitEarth = hE < Re;
    let earthSpot = null;
    if (hitEarth) {
      const tHit = tE - Math.sqrt(Re * Re - hE * hE);
      const point = MV.add(moon, MV.scale(tHit, dirSM));
      const umbraR = Math.max(0, Rm * (1 - tHit / Lu));
      const penumbraR = Rm + tHit * penumbraK;
      earthSpot = { point, umbraR, penumbraR, tHit, onDisk: true };
    }

    // 月食：地影锥
    const Le = (dSE * Re) / (Rs - Re);
    const penumbraKe = (Rs + Re) / dSE;
    const relME = MV.subtract(moon, earth);
    const tM = MV.dot(relME, dirSE);
    const perpM = MV.subtract(relME, MV.scale(tM, dirSE));
    const hM = MV.length(perpM);
    const umbraRAtMoon = Math.max(0, Re * (1 - tM / Le));
    const penumbraRAtMoon = Re + tM * penumbraKe;
    const lunarInsideUmbra = hM < umbraRAtMoon;
    const lunarInsidePenumbra = hM < penumbraRAtMoon;

    return {
      Rs,
      Re,
      Rm,
      dSM,
      dSE,
      dirSM,
      dirSE,
      Lu,
      Le,
      penumbraK,
      // 日食
      solar: {
        moonBetween: MV.length(MV.subtract(moon, sun)) < MV.length(MV.subtract(earth, sun)),
        earthSpot,
        umbraLength: Lu,
        umbraCone: { apex: moon, axis: dirSM, length: Math.max(0, tE), radius: earthSpot ? earthSpot.umbraR : Math.max(0.001, Rm * (1 - tE / Lu)) },
        penumbraCone: {
          apex: MV.add(moon, MV.scale(-(Rm * dSM) / (Rs + Rm), dirSM)),
          axis: dirSM,
          length: tE + (Rm * dSM) / (Rs + Rm),
          radius: Rm + tE * penumbraK,
        },
      },
      // 月食
      lunar: {
        earthBetween: MV.length(MV.subtract(earth, sun)) < MV.length(MV.subtract(moon, sun)),
        tM,
        hM,
        umbraRAtMoon,
        penumbraRAtMoon,
        insideUmbra: lunarInsideUmbra,
        insidePenumbra: lunarInsidePenumbra,
        umbraCone: {
          apex: MV.add(earth, MV.scale(Le, dirSE)),
          axis: MV.scale(-1, dirSE),
          length: Le,
          radius: Re,
        },
        penumbraCone: {
          apex: MV.add(earth, MV.scale(-(Re * dSE) / (Rs + Re), dirSE)),
          axis: dirSE,
          length: (Re * dSE) / (Rs + Re) + tM,
          radius: penumbraRAtMoon,
        },
      },
    };
  }

  /** 太阳直射点（真实模式）或按几何求出的日照点（演示模式），返回地面观测用的几何量 */
  function groundObservations() {
    const sun = sim.positions.sun;
    const earth = sim.positions.earth;
    const moon = sim.positions.moon;
    if (!earth || !moon) return null;
    const geo = eclipseGeometry();
    const Rs = geo.Rs;
    const Re = geo.Re;
    const Rm = geo.Rm;

    // 太阳→地球方向（地球的向阳侧）
    const dirSunEarth = MV.normalize(MV.subtract(earth, sun).slice());
    const dirEarthMoon = MV.normalize(MV.subtract(moon, earth).slice());

    // 太阳直射点（近似）：地球向阳面最靠近太阳的点
    const solarGroundPoint = MV.subtract(earth, MV.scale(Re * 1.001, dirSunEarth));

    // 日食：观测点取月影落点（若地球在月影轴上），否则取向阳侧最接近影轴的点
    let spotPoint = solarGroundPoint;
    if (geo.solar.earthSpot) spotPoint = geo.solar.earthSpot.point;
    const toSun = MV.normalize(MV.subtract(sun, spotPoint).slice());
    const toMoon = MV.normalize(MV.subtract(moon, spotPoint).slice());
    const angSun = Math.asin(Math.min(1, Rs / Math.max(1e-6, MV.length(MV.subtract(sun, spotPoint)))));
    const angMoon = Math.asin(Math.min(1, Rm / Math.max(1e-6, MV.length(MV.subtract(moon, spotPoint)))));
    const cosSep = Math.max(-1, Math.min(1, MV.dot(toSun, toMoon)));
    const sep = Math.acos(cosSep);

    // 天空坐标系（东/北）：用于把角偏移拆成 x/y
    const east = MV.normalize(MV.cross(MV.vec3(0, 1, 0), toSun));
    const north = MV.cross(toSun, east);
    const perpMoon = MV.subtract(toMoon, MV.scale(MV.dot(toMoon, toSun), toSun));
    const offX = MV.dot(perpMoon, east);
    const offY = MV.dot(perpMoon, north);

    // 月食：地面观测点在地球夜面（背日侧）
    const lunarGroundPoint = MV.add(earth, MV.scale(Re * 1.001, dirEarthMoon));
    const toMoonFromGround = MV.normalize(MV.subtract(moon, lunarGroundPoint).slice());
    const distMoonGround = MV.length(MV.subtract(moon, lunarGroundPoint));
    const angMoonLunar = Math.asin(Math.min(1, Rm / Math.max(1e-6, distMoonGround)));
    const umbraAngRad = Math.asin(Math.min(1, geo.lunar.umbraRAtMoon / Math.max(1e-6, distMoonGround)));
    const penumbraAngRad = Math.asin(Math.min(1, geo.lunar.penumbraRAtMoon / Math.max(1e-6, distMoonGround)));
    // 月球中心相对地影轴的角偏移（近似：横向距离 / 距离）
    const lunarOffAng = Math.atan2(geo.lunar.hM, Math.max(1e-6, distMoonGround));

    return {
      solar: {
        sunRadius: angSun,
        moonRadius: angMoon,
        offsetX: offX,
        offsetY: offY,
        separation: sep,
        groundPoint: spotPoint,
      },
      lunar: {
        moonRadius: angMoonLunar,
        umbraRadius: umbraAngRad,
        penumbraRadius: penumbraAngRad,
        offsetX: lunarOffAng,
        offsetY: 0,
        groundPoint: lunarGroundPoint,
      },
    };
  }

  // ---------------------------------------------------------------- 既有接口

  function eclipseState() {
    const sun = sim.positions.sun;
    const earth = sim.positions.earth;
    const moon = sim.positions.moon;
    if (!earth || !moon) return { solar: 0, lunar: 0 };
    const geo = eclipseGeometry();
    // 日食：地球是否落在月影锥内
    let solar = 0;
    if (geo.solar.earthSpot) {
      solar = Math.min(1, geo.solar.earthSpot.penumbraR / Math.max(0.001, geo.solar.earthSpot.umbraR + 1e-6));
      solar = geo.solar.earthSpot.umbraR > 0 ? 1 : Math.min(1, solar * 0.5);
    }
    // 月食：月球相对地影
    let lunar = 0;
    if (geo.lunar.insideUmbra) lunar = 1;
    else if (geo.lunar.insidePenumbra) {
      lunar = 1 - (geo.lunar.hM - geo.lunar.umbraRAtMoon) / Math.max(1e-6, geo.lunar.penumbraRAtMoon - geo.lunar.umbraRAtMoon);
    }
    return { solar: clamp01(solar), lunar: clamp01(lunar), sun, earth, moon, geo };
  }

  /** 把地球、月球拉到近似一线，便于演示日食 / 月食（演示模式） */
  function alignForEclipse(kind, orbitSpeed) {
    sim.mode = "demo";
    const k = orbitSpeed || 1;
    if (kind === "solar") sim.time = (MOON.period * 0.5) / k;
    else sim.time = 0;
  }

  /** 日月食取景：围绕地月区域构图，视角垂直于日–地–月连线 */
  function eclipseCameras() {
    const e = eclipseState();
    if (!e.earth) return null;
    const geo = e.geo;
    const mid = MV.scale(0.5, MV.add(e.earth, e.moon));
    const span = Math.max(
      MV.length(MV.subtract(e.earth, e.moon)) * 0.5 + PLANETS.find((p) => p.id === "earth").radius + MOON.radius,
      1.2,
    );
    const dist = span * 3.4;
    const up = MV.vec3(0, 1, 0);
    const axis = MV.normalize(MV.subtract(e.earth, e.sun).slice());
    const side = MV.normalize(MV.cross(axis, up).slice());
    const dir = MV.normalize(MV.add(MV.scale(0.86, side), MV.scale(0.36, up)));
    const eye = MV.add(mid, MV.scale(dist, dir));

    // 地面点击视点：从地月连线侧向再抬高一点
    const groundEye = MV.add(mid, MV.scale(dist * 1.15, MV.normalize(MV.add(MV.scale(0.7, side), MV.scale(0.62, up)))));

    void geo;
    return {
      solar: { eye, at: mid },
      lunar: { eye, at: mid },
      ground: { eye: groundEye, at: mid },
    };
  }

  function advance(dt) {
    if (sim.mode === "real") {
      sim.date = new Date(sim.date.getTime() + dt * sim.rate * 1000);
    } else {
      sim.time += dt / YEAR_SECONDS;
    }
  }

  return {
    sim,
    setAstro,
    traverse,
    eclipseState,
    alignForEclipse,
    eclipseCameras,
    eclipseGeometry,
    groundObservations,
    advance,
  };
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
