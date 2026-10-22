/**
 * V3 自检：加载页面 → 收集控制台错误 → 验证时间/天文/日食/相机关键路径 → 截图
 * 用法: node tools/v3-check.mjs [url]
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = join(process.cwd(), "screenshots");
mkdirSync(OUT, { recursive: true });
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9336;
const URL = process.argv[2] || "http://127.0.0.1:8000/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--no-first-run", "--disable-extensions", "--hide-scrollbars",
  "--window-size=1280,800", "--force-device-scale-factor=1",
  "--run-all-compositor-stages-before-draw",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${join(tmpdir(), "ap2-v3check")}`,
  "about:blank",
], { stdio: "ignore" });

async function waitDebug() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; } catch {}
    await sleep(500);
  }
  throw new Error("devtools 未就绪");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    const log = { errors: [], warnings: [], exceptions: [] };
    ws.onopen = () => {
      const send = (method, params = {}) => new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
          const { res, rej } = pending.get(msg.id);
          pending.delete(msg.id);
          msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
        } else if (msg.method === "Runtime.consoleAPICalled") {
          const t = msg.params.type;
          if (t === "error") log.errors.push((msg.params.args || []).map((a) => a.value ?? a.description).join(" "));
          if (t === "warning") log.warnings.push((msg.params.args || []).map((a) => a.value ?? a.description).join(" "));
        } else if (msg.method === "Runtime.exceptionThrown") {
          log.exceptions.push(JSON.stringify(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text));
        }
      };
      resolve({ send, log });
    };
    ws.onerror = () => reject(new Error("ws 失败"));
  });
}

const results = [];
const check = (name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  console.log(results[results.length - 1]);
};

async function main() {
  await waitDebug();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  const cdp = await connect(page.webSocketDebuggerUrl);
  const { send, log } = cdp;
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: URL });
  await sleep(4500);

  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("页面异常: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  const ok = await evalJs("!!window.__ap2");
  check("页面初始化 __ap2", ok);
  if (!ok) {
    console.log("console errors:", log.errors, log.exceptions);
    throw new Error("初始化失败");
  }

  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    writeFileSync(join(OUT, name + ".png"), Buffer.from(data, "base64"));
    console.log("captured", name);
  };

  // 1) 默认视图（真实天文模式）
  await shot("v3-default");

  const mode = await evalJs("window.__ap2.scene.sim.mode");
  check("默认真实天文模式", mode === "real", "mode=" + mode);

  const info = await evalJs("JSON.stringify(window.__ap2.scene.sim.solarInfo)");
  check("真实模式直射点数据已生成", !!info && info !== "null", (info || "").slice(0, 120));

  const astroInfo = await evalJs("document.getElementById('astro-info').textContent");
  check("天文信息面板已填充", /直射点|N|S|E|W/.test(astroInfo), astroInfo.slice(0, 80));

  // 2) 时间推进（真实模式：1 秒真实 ≈ 1 小时模拟）
  const d0 = await evalJs("window.__ap2.scene.sim.date.getTime()");
  await sleep(1200);
  const d1 = await evalJs("window.__ap2.scene.sim.date.getTime()");
  check("真实模式时间推进", d1 > d0, `Δ=${((d1 - d0) / 1000).toFixed(0)}s 模拟`);

  // 3) 暂停后时间冻结
  await evalJs("document.getElementById('btn-sim').click()");
  const p0 = await evalJs("window.__ap2.scene.sim.date.getTime()");
  await sleep(800);
  const p1 = await evalJs("window.__ap2.scene.sim.date.getTime()");
  check("暂停后时间冻结", p0 === p1);
  await evalJs("document.getElementById('btn-sim').click()");

  // 4) 太阳特写
  await evalJs("window.__ap2.focusBody('sun')");
  await sleep(1400);
  await shot("v3-sun-close");
  const sunPos = await evalJs("JSON.stringify(window.__ap2.projectBody('sun'))");
  check("太阳特写投影有效", !!sunPos && sunPos !== "null", sunPos);

  // 5) 地球晨昏线特写（真实模式）
  await evalJs("window.__ap2.focusBody('earth')");
  await sleep(1400);
  await shot("v3-earth-terminator");

  // 6) 日食模式：冻结 + 取景 + 阴影
  await evalJs("window.__ap2.enterEclipse('solar')");
  await sleep(1600);
  const eMode = await evalJs("window.__ap2.cam.mode");
  check("进入日食模式", eMode === "eclipse", "mode=" + eMode);
  const frozen1 = await evalJs("JSON.stringify({t: window.__ap2.scene.sim.time, e: window.__ap2.scene.sim.positions.earth, m: window.__ap2.scene.sim.positions.moon})");
  await sleep(900);
  const frozen2 = await evalJs("JSON.stringify({t: window.__ap2.scene.sim.time, e: window.__ap2.scene.sim.positions.earth, m: window.__ap2.scene.sim.positions.moon})");
  check("日食模式天体状态冻结", frozen1 === frozen2);
  await shot("v3-eclipse-solar-space");

  const geo = await evalJs("JSON.stringify(window.__ap2.eclipseGeometry()?.solar?.earthSpot || null)");
  check("月影落点已计算", geo !== "null" && geo !== "undefined", (geo || "").slice(0, 100));
  let spotObj = null;
  try { spotObj = JSON.parse(geo); } catch {}
  check("月影本影半径 > 0（本影落在地表）", !!spotObj && spotObj.umbraR > 0, spotObj ? `umbraR=${spotObj.umbraR.toFixed(4)}` : "null");

  const go = await evalJs("JSON.stringify(window.__ap2.groundObservations())");
  let goObj = null;
  try { goObj = JSON.parse(go); } catch {}
  check(
    "地面观测角尺寸合理（月球 ≈ 0.7~1.3 太阳）",
    !!goObj && goObj.solar.moonRadius / goObj.solar.sunRadius > 0.7 && goObj.solar.moonRadius / goObj.solar.sunRadius < 1.3,
    goObj ? `ratio=${(goObj.solar.moonRadius / goObj.solar.sunRadius).toFixed(2)}` : "null",
  );

  // 7) 地面视角
  await evalJs("document.getElementById('btn-eclipse-ground').click()");
  await sleep(1600);
  await shot("v3-eclipse-solar-ground");
  const groundVisible = await evalJs("!document.getElementById('ground-wrap').hidden");
  check("地面观测小窗可见", groundVisible);

  // 8) 月食
  await evalJs("window.__ap2.enterEclipse('lunar')");
  await sleep(1600);
  await shot("v3-eclipse-lunar-space");
  await evalJs("document.getElementById('btn-eclipse-ground').click()");
  await sleep(1600);
  await shot("v3-eclipse-lunar-ground");

  // 9) 退出恢复
  await evalJs("window.__ap2.exitEclipse()");
  await sleep(1200);
  const backMode = await evalJs("JSON.stringify({cam: window.__ap2.cam.mode, sim: window.__ap2.scene.sim.mode})");
  check("退出日食回到太阳系", /"cam":"focus"|"cam":"interactive"|"cam":"tour"/.test(backMode), backMode);
  await shot("v3-after-exit");

  // 10) 鼠标拖拽方向一致性（真实鼠标事件）
  await evalJs("window.__ap2.cam.mode='interactive'; window.__ap2.cam.playing=false;");
  const pitch0 = await evalJs("window.__ap2.cam.orbit ? window.__ap2.cam.orbit.pitch : null");
  if (pitch0 !== null) {
    const rect = JSON.parse(await evalJs("JSON.stringify(document.getElementById('view').getBoundingClientRect())"));
    // 取画布中心附近作为拖拽起点（保证始终在画布内；标签已改为冒泡到 #view-wrap，不再拦截）
    const sx = Math.round(rect.left + rect.width * 0.5);
    const sy = Math.round(rect.top + rect.height * 0.55);
    const wrap = (v) => ((v + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const drag = async (x0, y0, x1, y1) => {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: x0, y: y0 });
      for (let i = 1; i <= 8; i++) {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: x0 + ((x1 - x0) * i) / 8, y: y0 + ((y1 - y0) * i) / 8 });
        await sleep(30);
      }
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: x1, y: y1 });
      await sleep(200);
    };
    await drag(sx, sy - 100, sx, sy + 100); // 向下拖
    const p1b = await evalJs("window.__ap2.cam.orbit.pitch");
    check("向下拖动：pitch 增大（相机抬高）", p1b > pitch0, `${pitch0.toFixed(3)} → ${p1b.toFixed(3)}`);
    const yawA = await evalJs("window.__ap2.cam.orbit.yaw");
    await drag(sx, sy, sx + 160, sy); // 向右拖
    const yawB = await evalJs("window.__ap2.cam.orbit.yaw");
    const d1 = wrap(yawB - yawA);
    await drag(sx, sy, sx + 160, sy); // 再次向右拖
    const yawC = await evalJs("window.__ap2.cam.orbit.yaw");
    const d2 = wrap(yawC - yawB);
    check("向右拖动：yaw 两次同向（环绕感知）", d1 < -0.05 && d2 < -0.05, `Δ1=${d1.toFixed(3)} Δ2=${d2.toFixed(3)}`);

    // WASD：按住 W 500ms，相机应沿视线前向移动
    const e0 = await evalJs("JSON.stringify(window.__ap2.cam.eye)");
    await send("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyW", key: "w", windowsVirtualKeyCode: 87 });
    await sleep(500);
    await send("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyW", key: "w", windowsVirtualKeyCode: 87 });
    await sleep(120);
    const e1 = await evalJs("JSON.stringify(window.__ap2.cam.eye)");
    const dist0 = await evalJs("JSON.stringify(window.__ap2.cam.orbit.dist)");
    check("WASD W 使相机移动", e0 !== e1, `${e0} → ${e1}（dist=${JSON.parse(dist0).toFixed(2)}）`);
    await shot("v3-after-drag");
  } else {
    check("相机 orbit 状态可用（新相机）", false, "camera.js 仍是旧实现，等待重写");
  }

  const summary = [
    "== V3 check ==",
    ...results,
    "",
    "-- console errors --",
    ...log.errors,
    "",
    "-- exceptions --",
    ...log.exceptions,
  ];
  writeFileSync(join(OUT, "v3-check-log.txt"), summary.join("\n"), "utf8");
  console.log("\n" + summary.slice(0, 2 + results.length).join("\n"));
  const fails = results.filter((r) => r.startsWith("FAIL"));
  console.log(`\nSUMMARY: ${results.length - fails.length}/${results.length} passed`);
  chrome.kill();
  process.exit(fails.length === 0 && log.exceptions.length === 0 ? 0 : 2);
}

main().catch((e) => {
  console.error("CHECK CRASHED:", e.message);
  try { chrome.kill(); } catch {}
  process.exit(1);
});
