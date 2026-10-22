/**
 * 层级场景图：太阳 → 行星轨道节点 →（地球）月球。
 *
 * 地球倾角必须「先转后挂」：
 *   M_earth = R_y(公转) · T(轨道半径) · R_z(倾角) · R_y(自转) · S(半径)
 * 先在地球局部施加 R_z(23.5°)，再乘上公转轨道变换。
 * 月球不继承地球自转 / 倾角，只挂在地球的轨道节点上。
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
 *
 * 对应齐次矩阵（ι = 倾角，ω = 公转角）：
 *   T 把月球放到 x 轴上的轨道半径；
 *   R_y 在黄道面内公转；
 *   R_x 把整个轨道面抬离黄道 5.145°。
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

export function createScene() {
  const asteroids = createAsteroids(
    ASTEROID_BELT.count,
    ASTEROID_BELT.inner,
    ASTEROID_BELT.outer,
    ASTEROID_BELT.minRadius,
    ASTEROID_BELT.maxRadius,
  );

  const sim = {
    time: 0, // 仿真年
    positions: {},
  };

  function angles(ui) {
    const year = sim.time;
    const orbitK = ui.orbitSpeed;
    const spinK = ui.spinSpeed;
    const out = {};
    for (const p of PLANETS) {
      out[p.id] = {
        rev: ((year * orbitK) / p.period) * 360 + (p.phase || 0),
        spin: ((year * YEAR_SECONDS * spinK) / (p.spinPeriod * DAY_SECONDS)) * 360,
        tilt: p.id === "earth" ? ui.earthTilt : p.tilt,
      };
    }
    out.moon = {
      rev: ((year * orbitK) / MOON.period) * 360,
      spin: ((year * YEAR_SECONDS * spinK) / (MOON.spinPeriod * DAY_SECONDS)) * 360,
    };
    return out;
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
    draw({ kind: "body", id: "sun", model: S.top(), textureId: "sun", emissive: 1 });
    S.pop();
    sim.positions.sun = MV.vec3(0, 0, 0);

    // 太阳光晕：两圈加色混合的 rim 壳（着色器 uGlow 按 |dot(N,V)| 衰减），
    // 由 main.js 归入透明队列最后绘制，避免与行星遮挡产生接缝。
    for (const [k, a] of [[1.5, 0.5], [2.0, 0.3]]) {
      S.push();
      S.mult(MV.scalem(SUN.radius * k, SUN.radius * k, SUN.radius * k));
      draw({ kind: "glow", id: "sun-glow", model: S.top(), textureId: "sun", emissive: 1, alpha: a, tint: [1, 0.78, 0.38] });
      S.pop();
    }

    if (ui.showOrbits) {
      for (const p of PLANETS) {
        S.push();
        S.mult(MV.scalem(p.orbit, p.orbit, p.orbit));
        draw({ kind: "orbit", id: p.id + "-orbit", model: S.top() });
        S.pop();
      }
    }

    let earthOrbitNode = null;

    for (const p of PLANETS) {
      const ang = a[p.id];
      S.push();
      // 公转轨道变换：先平移到轨道半径，再绕 Y 公转
      S.mult(MV.rotate(ang.rev, MV.vec3(0, 1, 0)));
      S.mult(MV.translate(p.orbit, 0, 0));
      const orbitNode = S.top();
      sim.positions[p.id] = translationOf(orbitNode);

      if (p.id === "earth") earthOrbitNode = orbitNode;

      S.push();
      // 先转后挂：局部先倾角、再自转、再缩放，然后挂到轨道节点
      S.mult(MV.rotate(ang.tilt, MV.vec3(0, 0, 1)));
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
        // 轨道线同样用手造倾角，再缩放到月球轨道半径
        S.mult(MV.rotate(MOON.inclination, MV.vec3(1, 0, 0)));
        S.mult(MV.scalem(MOON.orbit, MOON.orbit, MOON.orbit));
        draw({ kind: "orbit", id: "moon-orbit", model: S.top() });
        S.pop();
      }
      const MmoonOrbit = moonOrbitMatrix(MOON.inclination, a.moon.rev, MOON.orbit);
      S.mult(MmoonOrbit);
      sim.positions.moon = translationOf(S.top());
      S.push();
      S.mult(MV.rotate(MOON.tilt, MV.vec3(0, 0, 1)));
      S.mult(MV.rotate(a.moon.spin, MV.vec3(0, 1, 0)));
      S.mult(MV.scalem(MOON.radius, MOON.radius, MOON.radius));
      draw({ kind: "body", id: "moon", model: S.top(), textureId: "moon", emissive: 0 });
      S.pop();
      S.pop();
    }

    // —— 小行星带 ——
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

  function eclipseState() {
    const sun = sim.positions.sun;
    const earth = sim.positions.earth;
    const moon = sim.positions.moon;
    if (!earth || !moon) return { solar: 0, lunar: 0 };
    const se = MV.subtract(earth, sun);
    const sm = MV.subtract(moon, sun);
    const em = MV.subtract(moon, earth);
    const seN = MV.normalize(se.slice());
    const smN = MV.normalize(sm.slice());
    const emN = MV.normalize(em.slice());
    const solarAlign = MV.dot(seN, MV.normalize(MV.subtract(moon, sun).slice()));
    const moonBetween = MV.length(sm) < MV.length(se);
    const earthBetween = MV.length(se) < MV.length(sm);
    const solar = moonBetween ? Math.max(0, (solarAlign - 0.9992) / 0.0008) : 0;
    // 月食：月球在地球背日侧时 (moon-earth) 与太阳→地球方向同向，dot = +1
    const lunarAlign = MV.dot(seN, emN);
    const lunar = earthBetween ? Math.max(0, (lunarAlign - 0.995) / 0.005) : 0;
    return {
      solar: clamp01(solar),
      lunar: clamp01(lunar),
      sun,
      earth,
      moon,
      seN,
      emN,
    };
  }

  /** 把地球、月球拉到近似一线，便于演示日食 / 月食。 */
  function alignForEclipse(kind, orbitSpeed) {
    const k = orbitSpeed || 1;
    // 月球相对地球：rev=0 在背日侧（月食），rev=180° 在向日侧（日食）
    if (kind === "solar") sim.time = (MOON.period * 0.5) / k;
    else sim.time = 0;
  }

  function eclipseCameras() {
    const e = eclipseState();
    if (!e.earth) return null;
    const earth = PLANETS.find((p) => p.id === "earth");
    const dirFromSun = MV.normalize(MV.subtract(e.earth, e.sun).slice());

    // 日食：把相机放在地–日连线上，解出离地心距离 d，使月球视直径约为太阳的
    // 88%（环食「火环」——在无日冕模型时比全食更好辨认）：
    //   Rmoon/(Dmoon-d) = COVER·Rsun/(Dearth-d)   （小角近似 sinθ ≈ R/r）
    //   => d = (COVER·Rsun·Dmoon - Rmoon·Dearth) / (COVER·Rsun - Rmoon)
    const COVER = 0.88;
    const Rm = MOON.radius, Rs = SUN.radius;
    const Dm = MOON.orbit, De = earth.orbit;
    let d = (COVER * Rs * Dm - Rm * De) / (COVER * Rs - Rm);
    if (!(d > earth.radius * 1.05)) d = earth.radius * 1.08; // 兜底：至少贴在地表外
    const solarEye = MV.subtract(e.earth, MV.scale(d, dirFromSun));

    // 月食：相机在地月之间、略偏一侧，让暗掉的月球与地球夜面同框
    const side = MV.normalize(MV.cross(dirFromSun, MV.vec3(0, 1, 0)));
    const lunarEye = MV.add(
      MV.add(e.earth, MV.scale(MOON.orbit * 0.55, dirFromSun)),
      MV.scale(MOON.orbit * 0.28, side),
    );
    return {
      solar: { eye: solarEye, at: e.sun },
      lunar: { eye: lunarEye, at: e.moon },
    };
  }

  return {
    sim,
    traverse,
    eclipseState,
    alignForEclipse,
    eclipseCameras,
    advance(dt) {
      sim.time += dt / YEAR_SECONDS;
    },
  };
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
