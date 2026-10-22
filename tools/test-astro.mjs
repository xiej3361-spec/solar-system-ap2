/**
 * Self-tests for js/astro.js.
 *
 * Run from the project root:
 *   & $node tools/test-astro.mjs
 *
 * Prints one PASS/FAIL line per required assertion and exits non-zero on failure.
 */

import {
  DEG,
  PLANET_ELEMENTS,
  julianDay,
  gmstDegrees,
  obliquityDegrees,
  planetPositionAU,
  planetState,
  sunGeocentricEcliptic,
  subsolarPoint,
  terminatorPoints,
  localSolarTimeHours,
  moonGeocentric,
} from "../js/astro.js";

const J2000 = 2451545.0;
const AU_KM = 149597870.7;

let passed = 0;
let failed = 0;

/**
 * Execute one test and print a PASS/FAIL line.
 * @param {string} name Test label.
 * @param {() => boolean | {ok: boolean, detail?: string}} fn Test body.
 */
function run(name, fn) {
  try {
    const result = fn();
    const ok = typeof result === "boolean" ? result : Boolean(result && result.ok);
    const detail = result && typeof result === "object" && result.detail ? ` - ${result.detail}` : "";

    if (ok) {
      passed += 1;
      console.log(`PASS  ${name}${detail}`);
    } else {
      failed += 1;
      console.log(`FAIL  ${name}${detail}`);
    }
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.log(`FAIL  ${name} - threw: ${message}`);
  }
}

/** Format a number for diagnostic output. */
function fmt(value, digits = 6) {
  return Number(value).toFixed(digits);
}

/** Smallest absolute angular difference between two degree values, in degrees. */
function angularDifferenceDegrees(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** Normalize degrees to [0, 360). */
function normalizeDegrees(angleDeg) {
  return ((angleDeg % 360) + 360) % 360;
}

// ---------------------------------------------------------------------------
// 1. GMST at J2000.0
// ---------------------------------------------------------------------------
run("1. gmstDegrees(2451545.0) = 280.46 +/- 0.05 deg", () => {
  const gmst = gmstDegrees(J2000);
  return {
    ok: Math.abs(gmst - 280.46) <= 0.05,
    detail: `got ${fmt(gmst)} deg`,
  };
});

// ---------------------------------------------------------------------------
// 2. March equinox: subsolar latitude near 0
// ---------------------------------------------------------------------------
run("2. subsolarPoint(2026-03-20T12:00Z).lat = 0 +/- 0.4 deg", () => {
  const jd = julianDay(new Date("2026-03-20T12:00:00Z"));
  const point = subsolarPoint(jd);
  return {
    ok: Math.abs(point.lat) <= 0.4,
    detail: `lat = ${fmt(point.lat)} deg`,
  };
});

// ---------------------------------------------------------------------------
// 3. June solstice: subsolar latitude near +23.44 deg
// ---------------------------------------------------------------------------
run("3. subsolarPoint(2026-06-21T12:00Z).lat = 23.44 +/- 0.3 deg", () => {
  const jd = julianDay(new Date("2026-06-21T12:00:00Z"));
  const point = subsolarPoint(jd);
  return {
    ok: Math.abs(point.lat - 23.44) <= 0.3,
    detail: `lat = ${fmt(point.lat)} deg`,
  };
});

// ---------------------------------------------------------------------------
// 4. December solstice: subsolar latitude near -23.44 deg
// ---------------------------------------------------------------------------
run("4. subsolarPoint(2026-12-21T12:00Z).lat = -23.44 +/- 0.3 deg", () => {
  const jd = julianDay(new Date("2026-12-21T12:00:00Z"));
  const point = subsolarPoint(jd);
  return {
    ok: Math.abs(point.lat + 23.44) <= 0.3,
    detail: `lat = ${fmt(point.lat)} deg`,
  };
});

// ---------------------------------------------------------------------------
// 5. Earth at J2000: heliocentric distance and longitude
// ---------------------------------------------------------------------------
run("5. planetState('earth', J2000): r in [0.98, 0.99] AU, lon = 100.46 +/- 1.5 deg", () => {
  const state = planetState("earth", J2000);
  const lonDeg = state.lon / DEG;
  const lonError = angularDifferenceDegrees(lonDeg, 100.46);
  return {
    ok: Number.isFinite(state.r) && state.r >= 0.98 && state.r <= 0.99 && lonError <= 1.5,
    detail: `r = ${fmt(state.r)} AU, lon = ${fmt(lonDeg)} deg, lon error = ${fmt(lonError)} deg`,
  };
});

// ---------------------------------------------------------------------------
// 6. All eight planets: finite vectors and plausible heliocentric distances
// ---------------------------------------------------------------------------
run("6. planetPositionAU: 8 planets finite, heliocentric radii plausible", () => {
  const names = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"];
  const ranges = {
    mercury: [0.3, 0.5],
    venus: [0.7, 0.75],
    earth: [0.97, 1.03],
    mars: [1.3, 1.8],
    jupiter: [4.9, 5.5],
    saturn: [8.9, 10.2],
    uranus: [18.0, 20.5],
    neptune: [29.0, 31.0],
  };

  const rows = names.map((name) => {
    const position = planetPositionAU(name, J2000);
    const state = planetState(name, J2000);
    const radius = Math.hypot(position[0], position[1], position[2]);
    return { name, position, state, radius };
  });

  const finite = rows.every(({ position, state }) =>
    position.length === 3 &&
    position.every(Number.isFinite) &&
    Number.isFinite(state.lon) &&
    Number.isFinite(state.lat) &&
    Number.isFinite(state.r)
  );

  const inRange = rows.every(({ name, radius }) =>
    radius >= ranges[name][0] && radius <= ranges[name][1]
  );

  const consistent = rows.every(({ position, state }) =>
    Math.abs(Math.hypot(position[0], position[1], position[2]) - state.r) <= 1e-12
  );

  const tableOk = Object.keys(PLANET_ELEMENTS).length === 8 &&
    names.every((name) =>
      Object.values(PLANET_ELEMENTS[name]).every((element) =>
        Number.isFinite(element.j2000) && Number.isFinite(element.ratePerCentury)
      )
    );

  const detail = [
    `mercury r = ${fmt(rows[0].radius)} AU`,
    `neptune r = ${fmt(rows[7].radius)} AU`,
    `table entries = ${Object.keys(PLANET_ELEMENTS).length}`,
  ].join(", ");

  return { ok: finite && inRange && consistent && tableOk, detail };
});

// ---------------------------------------------------------------------------
// 7. Terminator equator intersections are exactly subsolar longitude +/- 90 deg
// ---------------------------------------------------------------------------
run("7. terminatorPoints.lon = subsolarPoint.lon +/- 90 deg (mod 360)", () => {
  const jd = julianDay(new Date("2026-06-21T12:00:00Z"));
  const subsolar = subsolarPoint(jd);
  const points = terminatorPoints(jd);
  const expected = [
    normalizeDegrees(subsolar.lon + 90),
    normalizeDegrees(subsolar.lon - 90),
  ];
  const actual = [
    normalizeDegrees(points[0].lon),
    normalizeDegrees(points[1].lon),
  ];

  const structureOk = Array.isArray(points) &&
    points.length === 2 &&
    points.every((point) => point.lat === 0);
  const lonOk = angularDifferenceDegrees(actual[0], expected[0]) <= 1e-10 &&
    angularDifferenceDegrees(actual[1], expected[1]) <= 1e-10;

  return {
    ok: structureOk && lonOk,
    detail: `subsolar lon = ${fmt(subsolar.lon)} deg, intersections = [${fmt(actual[0])}, ${fmt(actual[1])}] deg`,
  };
});

// ---------------------------------------------------------------------------
// 8. Local solar time at the subsolar meridian is noon
// ---------------------------------------------------------------------------
run("8. localSolarTimeHours(jd, subsolar.lon) = 12 +/- 0.01 h", () => {
  const jd = julianDay(new Date("2026-06-21T12:00:00Z"));
  const lonS = subsolarPoint(jd).lon;
  const hours = localSolarTimeHours(jd, lonS);
  return {
    ok: Math.abs(hours - 12) <= 0.01 && hours >= 0 && hours < 24,
    detail: `hours = ${fmt(hours)} h at lon = ${fmt(lonS)} deg`,
  };
});

// ---------------------------------------------------------------------------
// 9. Lunar geocentric distance is the mean distance
// ---------------------------------------------------------------------------
run("9. moonGeocentric(J2000).r in [0.0023, 0.0029] AU", () => {
  const moon = moonGeocentric(J2000);
  const expectedKm = 384400;
  const gotKm = moon.r * AU_KM;
  return {
    ok: moon.r >= 0.0023 && moon.r <= 0.0029 && Math.abs(gotKm - expectedKm) < 1e-6,
    detail: `r = ${fmt(moon.r, 9)} AU (${fmt(gotKm, 4)} km)`,
  };
});

// ---------------------------------------------------------------------------
// 10. Julian day conversion at J2000.0
// ---------------------------------------------------------------------------
run("10. julianDay(Date.UTC(2000,0,1,12)) = 2451545.0 +/- 1e-6", () => {
  const jd = julianDay(new Date(Date.UTC(2000, 0, 1, 12)));
  return {
    ok: Math.abs(jd - 2451545.0) <= 1e-6,
    detail: `jd = ${fmt(jd, 9)}`,
  };
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const total = passed + failed;
console.log(`\nSummary: ${passed}/${total} passed, ${failed} failed.`);

if (failed > 0) {
  console.log("SOME TESTS FAILED");
  process.exitCode = 1;
} else {
  console.log("ALL TESTS PASSED");
}
