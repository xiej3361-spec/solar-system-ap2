/**
 * 单位几何：球体（带法线 + 经纬 UV）、轨道圆、土星环、星空点。
 * 半径一律为 1，尺寸交给模型矩阵的 scalem。
 */

export function createSphere(latBands = 32, lonBands = 48) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let lat = 0; lat <= latBands; lat++) {
    const phi = (lat / latBands) * Math.PI; // 0 北极 → π 南极
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let lon = 0; lon <= lonBands; lon++) {
      const theta = (lon / lonBands) * 2 * Math.PI;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      // Y-up：北极在 +Y，经线绕 Y
      const x = sinPhi * cosTheta;
      const y = cosPhi;
      const z = sinPhi * sinTheta;
      positions.push(x, y, z);
      normals.push(x, y, z);
      // u 经度，v 纬度。v=0 对应北极（图像上方），配合 UNPACK_FLIP_Y_WEBGL
      uvs.push(lon / lonBands, 1 - lat / latBands);
    }
  }

  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const a = lat * (lonBands + 1) + lon;
      const b = a + lonBands + 1;
      indices.push(a, b, a + 1);
      indices.push(b, b + 1, a + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
    count: indices.length,
    mode: "triangles",
  };
}

/** XZ 平面上的单位圆，LINE_LOOP。 */
export function createOrbit(segments = 128) {
  const positions = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(a), 0, Math.sin(a));
  }
  return {
    positions: new Float32Array(positions),
    count: segments,
    mode: "lineLoop",
  };
}

/** 土星环：XZ 平面圆环，带径向 UV。 */
export function createRing(inner, outer, sectors = 96) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= sectors; i++) {
    const a = (i / sectors) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    positions.push(inner * c, 0, inner * s, outer * c, 0, outer * s);
    normals.push(0, 1, 0, 0, 1, 0);
    uvs.push(0, i / sectors, 1, i / sectors);
  }
  for (let i = 0; i < sectors; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2);
    indices.push(a + 1, a + 3, a + 2);
    // 双面：再推一组反向
    indices.push(a, a + 2, a + 1);
    indices.push(a + 1, a + 2, a + 3);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
    count: indices.length,
    mode: "triangles",
  };
}

export function createStars(count = 1400, radius = 80) {
  const positions = [];
  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    positions.push(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta),
    );
  }
  return {
    positions: new Float32Array(positions),
    count,
    mode: "points",
  };
}

export function createAsteroids(count, inner, outer, minR, maxR, seed = 7) {
  const items = [];
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let i = 0; i < count; i++) {
    const r = inner + rnd() * (outer - inner);
    const angle0 = rnd() * Math.PI * 2;
    const y = (rnd() - 0.5) * 0.35;
    const radius = minR + rnd() * (maxR - minR);
    const tilt = (rnd() - 0.5) * 25;
    const period = 3.2 + rnd() * 2.4;
    items.push({ r, angle0, y, radius, tilt, period });
  }
  return items;
}

/**
 * 面向相机的单位四边形（-1..1，UV 0..1），用于太阳日冕 billboard。
 * 模型矩阵由 main.js 按相机基向量构造（billboard）。
 */
export function createQuad() {
  return {
    positions: new Float32Array([
      -1, -1, 0,
      1, -1, 0,
      1, 1, 0,
      -1, 1, 0,
    ]),
    normals: new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    count: 6,
    mode: "triangles",
  };
}

/**
 * 单位圆锥：顶点在原点、沿 +Y 方向展开到 y=1、底面半径 1（无底面）。
 * 用于日月食的本影 / 半影体积示意（模型矩阵：平移顶点 + 旋转轴 + 非等比缩放）。
 */
export function createCone(segments = 48) {
  const positions = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    positions.push(0, 0, 0); // 顶点
    positions.push(Math.cos(a), 1, Math.sin(a)); // 底面环
  }
  for (let i = 0; i < segments; i++) {
    const apex = i * 2;
    const baseA = i * 2 + 1;
    const baseB = i * 2 + 3;
    indices.push(apex, baseB, baseA);
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint16Array(indices),
    count: indices.length,
    mode: "triangles",
  };
}
