/**
 * 无头浏览器素材采集 + 交互自动化验证（一次性脚本，用于生成截图/录屏与取证）。
 *  - 透视 / 正交对比截图、日食 / 月食截图
 *  - 新交互验证：拾取 → 真实鼠标点击聚焦 → 标签可见性 → 空白返回全景 → 暂停按钮 → 悬停光标
 *  - 10 秒环绕漫游帧序列（screenshots/frames/f*.png，供 stitch_gif.py 合成 GIF）
 *  - 目标站点取证：solar-system-atlas.pages.dev 的截图 + 页面证据 JSON
 *  - 控制台错误收集到 screenshots/capture-log.txt
 *
 * 运行：node tools/capture.mjs （需要 Chrome，且环境允许 Chromium 进程间管道）
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = join(process.cwd(), "screenshots");
const FRAMES = join(OUT, "frames");
mkdirSync(FRAMES, { recursive: true });

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const URL = "http://127.0.0.1:8000/?freeze=1&pause=1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--hide-scrollbars",
    "--window-size=1280,800",
    "--force-device-scale-factor=1",
    "--run-all-compositor-stages-before-draw",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), "ap2-headless")}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function waitForDebug() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("chrome devtools 未就绪");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    const waiters = new Map();
    let id = 0;
    const log = { console: [], exceptions: [], entries: [] };

    ws.onopen = () => {
      const send = (method, params = {}) =>
        new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      const once = (method) =>
        new Promise((res) => {
          const q = waiters.get(method) || [];
          q.push(res);
          waiters.set(method, q);
        });
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
          const { res, rej } = pending.get(msg.id);
          pending.delete(msg.id);
          msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
        } else if (msg.method) {
          const q = waiters.get(msg.method);
          if (q && q.length) q.shift()(msg.params);
          if (msg.method === "Runtime.consoleAPICalled") log.console.push(msg.params);
          if (msg.method === "Runtime.exceptionThrown") log.exceptions.push(msg.params);
          if (msg.method === "Log.entryAdded") log.entries.push(msg.params.entry);
        }
      };
      resolve({ send, once, log });
    };
    ws.onerror = () => reject(new Error("CDP websocket 连接失败"));
  });
}

const fmtConsole = (p) =>
  (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ");

async function main() {
  await waitForDebug();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((t) => t.type === "page");
  const cdp = await connect(target.webSocketDebuggerUrl);
  const { send, once, log } = cdp;

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");

  await send("Page.navigate", { url: URL });
  await once("Page.loadEventFired");
  await sleep(3500); // 等纹理全部上传 + 首帧渲染

  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error("页面内执行失败: " + JSON.stringify(r.exceptionDetails));
    }
    return r.result.value;
  };

  const ready = await evalJs("!!window.__ap2 && !!window.__ap2.cam && !!window.__ap2.scene");
  if (!ready) throw new Error("页面未初始化 __ap2（可能脚本报错）");

  const shot = async (name, setupExpr) => {
    await evalJs(setupExpr);
    await sleep(700);
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    writeFileSync(join(OUT, name + ".png"), Buffer.from(data, "base64"));
    console.log("captured", name);
  };

  const results = [];
  const test = (name, ok, extra) => {
    const line = `${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`;
    results.push(line);
    console.log(line);
  };

  const poseExpr = (proj) => `(() => {
    const { cam, scene } = window.__ap2;
    cam.mode = "tour";
    cam.playing = false;
    cam.projection = ${JSON.stringify(proj)};
    cam.setTourTime(0.30);
    scene.sim.time = 0;
    return cam.tourTime;
  })()`;

  // 1) 静态截图
  await shot("proj-perspective", poseExpr("perspective"));
  await shot("proj-ortho", poseExpr("ortho"));

  const eclExpr = (kind) => `(() => {
    const { cam, scene, ui } = window.__ap2;
    scene.alignForEclipse(${JSON.stringify(kind)}, ui.orbitSpeed);
    scene.traverse(ui, () => {});
    cam.projection = "perspective"; // 与页面 enterEclipse 行为一致
    const c = scene.eclipseCameras();
    cam.setEclipseView(${JSON.stringify(kind)}, c[${JSON.stringify(kind)}].eye, c[${JSON.stringify(kind)}].at);
    return JSON.stringify(cam.eye);
  })()`;
  await shot("eclipse-solar", eclExpr("solar"));
  await shot("eclipse-lunar", eclExpr("lunar"));

  // 2) 新交互验证（停在漫游位姿 t=0.30、sim=0 的确定性画面上）
  await evalJs(`(() => {
    const { cam, scene } = window.__ap2;
    cam.resumeTour();
    cam.playing = false;
    cam.projection = "perspective";
    cam.setTourTime(0.30);
    scene.sim.time = 0;
  })()`);
  await sleep(500);

  const sat = JSON.parse(await evalJs(`JSON.stringify(window.__ap2.projectBody("saturn"))`));
  test("projectBody(saturn) 投影有效", !!(sat && sat.x > 0 && sat.y > 0), JSON.stringify(sat));

  // 全景位姿下统计可见标签（聚焦特写后大部分天体自然出画，需在此之前测）
  const labelCount = await evalJs(
    `Array.from(document.querySelectorAll(".label")).filter((e) => e.offsetParent !== null).length`,
  );
  test("全景下名称标签可见数 > 5", labelCount > 5, "visible=" + labelCount);

  if (sat) {
    // 悬停：直接向 canvas 派发合成的 PointerEvent（CDP mouseMoved 在无头下不一定生成 pointer 事件）
    await evalJs(`(() => {
      const c = document.getElementById("view");
      c.dispatchEvent(new PointerEvent("pointermove", {
        clientX: ${sat.x}, clientY: ${sat.y}, buttons: 0, bubbles: true,
      }));
    })()`);
    await sleep(150); // 等下一帧把 hovered 类写到标签上
    const hoverRes = await evalJs(`(() => {
      const c = document.getElementById("view");
      const lbl = document.querySelector(".label.hovered");
      return JSON.stringify({ cursor: c.style.cursor, hover: lbl ? lbl.dataset.id : null });
    })()`);
    const hr = JSON.parse(hoverRes);
    test("悬停天体光标变 pointer", hr.cursor === "pointer", JSON.stringify(hr));
    test("悬停高亮命中 saturn", hr.hover === "saturn", JSON.stringify(hr));

    const picked = await evalJs(`window.__ap2.pickAt(${sat.x}, ${sat.y})`);
    test("屏幕点拾取到 saturn", picked === "saturn", "got=" + picked);

    await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: sat.x, y: sat.y });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: sat.x, y: sat.y });
    await sleep(1600);
    const st = JSON.parse(await evalJs(`JSON.stringify({mode: window.__ap2.cam.mode, id: window.__ap2.cam.focusBodyId})`));
    test("点击后相机进入聚焦", st.mode === "focus" && st.id === "saturn", JSON.stringify(st));
    const { data } = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    writeFileSync(join(OUT, "focus-saturn.png"), Buffer.from(data, "base64"));
    console.log("captured focus-saturn");
  }

  const empty = await evalJs(`(() => {
    const r = document.getElementById("view").getBoundingClientRect();
    for (let i = 1; i <= 21; i++) for (let j = 1; j <= 13; j++) {
      const x = r.left + (r.width * i) / 22, y = r.top + (r.height * j) / 14;
      if (!window.__ap2.pickAt(x, y)) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
  })()`);
  test("找到空白屏幕点", !!empty, JSON.stringify(empty));
  if (empty) {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: empty.x, y: empty.y });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: empty.x, y: empty.y });
    await sleep(1200);
    const st = JSON.parse(await evalJs(`JSON.stringify({mode: window.__ap2.cam.mode, id: window.__ap2.cam.focusBodyId})`));
    test("点击空白回到全景", st.mode === "focus" && st.id === null, JSON.stringify(st));
  }

  await evalJs(`document.getElementById("btn-sim").click()`);
  const paused = JSON.parse(
    await evalJs(`JSON.stringify({p: window.__ap2.ui.simPaused, t: document.getElementById("btn-sim").textContent})`),
  );
  test("暂停时间按钮生效", paused.p === true, JSON.stringify(paused));
  await evalJs(`document.getElementById("btn-sim").click()`);

  await evalJs(`(() => {
    document.querySelector('.label[data-id="earth"] span').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  await sleep(1300);
  const lblFocus = await evalJs(`window.__ap2.cam.focusBodyId`);
  test("点击名称标签聚焦地球", lblFocus === "earth", "focus=" + lblFocus);

  // 3) 10 秒环绕漫游帧（关键帧驱动，60 帧 × 166ms）
  await evalJs(`(() => {
    const { cam } = window.__ap2;
    cam.resumeTour();
    cam.playing = false; // 关键帧驱动：不让 tick 覆盖位姿
    cam.projection = "perspective";
  })()`);

  const N = 60;
  const tourSpan = 10 / 18; // 10 秒漫游占 18 秒一圈的 55.6%
  const poses = [];
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * tourSpan;
    const tt = await evalJs(`window.__ap2.cam.setTourTime(${t}), window.__ap2.cam.tourTime`);
    poses.push(tt);
    await sleep(350); // 等合成器输出新位姿
    const { data } = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    writeFileSync(join(FRAMES, `f${String(i).padStart(3, "0")}.png`), Buffer.from(data, "base64"));
  }
  console.log(
    `tour frames: ${N}, 位姿序列 ${poses[0].toFixed(2)} -> ${poses[poses.length - 1].toFixed(2)}（间隔 ${(poses[5] - poses[4]).toFixed(3)}s，应为 ${((tourSpan / (N - 1)) * 18).toFixed(3)}s）`,
  );

  // 4) 目标站点取证（截图 + 页面证据；该站点与本机网络时好时坏，失败不阻塞）
  try {
    await send("Page.navigate", { url: "https://solar-system-atlas.pages.dev/solar/" });
    await sleep(10000);
    const ev = JSON.parse(
      await evalJs(`JSON.stringify({
        title: document.title,
        text: document.body.innerText.slice(0, 500),
        canvases: Array.from(document.querySelectorAll("canvas")).map((c) => ({ w: c.width, h: c.height })),
        hasThree: !!(window.THREE || window.__THREE_DEVTOOLS__),
        res: performance.getEntriesByType("resource").map((e) => e.name.split("/").pop()).filter((v, i, a) => a.indexOf(v) === i).slice(0, 60),
      })`),
    );
    writeFileSync(join(OUT, "target-site-evidence.json"), JSON.stringify(ev, null, 2), "utf8");
    const { data } = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    writeFileSync(join(OUT, "target-site.png"), Buffer.from(data, "base64"));
    console.log("target site evidence captured");
    results.push("TARGET-SITE captured (screenshots/target-site.png + target-site-evidence.json)");
  } catch (e) {
    results.push("TARGET-SITE FAILED: " + e.message);
    console.log("target site capture failed:", e.message);
  }

  // 5) 状态与错误收集（此时页面已导航到目标站点，#status 可能不存在）
  const status = await evalJs(`document.getElementById('status') ? document.getElementById('status').textContent : 'n/a'`);
  const lines = [
    "status: " + status,
    "tour pose span: " + poses[0].toFixed(3) + " -> " + poses[poses.length - 1].toFixed(3) + " (frames " + N + ")",
    "",
    "-- interaction tests --",
    ...results,
    "",
    "-- console (error/warn) --",
    ...log.console.filter((p) => p.type === "error" || p.type === "warning").map((p) => `[${p.type}] ${fmtConsole(p)}`),
    "",
    "-- page exceptions --",
    ...log.exceptions.map((p) => JSON.stringify(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text)),
    "",
    "-- log entries (error) --",
    ...log.entries.filter((e) => e.level === "error").map((e) => `${e.source}: ${e.text}`),
  ];
  writeFileSync(join(OUT, "capture-log.txt"), lines.join("\n"), "utf8");
  console.log(lines.slice(0, 4).join("\n"));
  console.log("log written:", join(OUT, "capture-log.txt"));
  console.log("DONE");

  chrome.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error("CAPTURE FAILED:", e);
  try { chrome.kill(); } catch {}
  process.exit(1);
});
