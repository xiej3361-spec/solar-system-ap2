/**
 * recon.mjs — 参考站点 https://solar-system-atlas.pages.dev/ 的无头浏览器取证脚本
 *
 * 两种用法：
 *   1) 全量取证（自起无头 Chrome，产出 screenshots/ref-*.png + 证据 JSON 到 stdout）：
 *        node tools/recon.mjs
 *   2) 附着已开调试端口的 Chrome 做单步探测（开发/调试用）：
 *        node tools/recon.mjs --attach probe
 *        node tools/recon.mjs --attach eval "<js>"
 *        node tools/recon.mjs --attach shot ref-xxx
 *        node tools/recon.mjs --attach drag 300 0
 *        node tools/recon.mjs --attach wheel -600 4
 *        node tools/recon.mjs --attach click 640 400
 *        node tools/recon.mjs --attach textclick 知道了
 *        node tools/recon.mjs --attach key Enter
 *        node tools/recon.mjs --attach nav https://...
 *
 * 仅依赖 Node 内置能力（fetch / WebSocket / child_process），不需要 npm 包。
 * 本脚本只写 screenshots/ref-*.png 与 stdout 证据，不修改项目源码。
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const SITE = "https://solar-system-atlas.pages.dev/";
const OUT = join(process.cwd(), "screenshots");
const VIEWPORT = { width: 1280, height: 800 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* CDP 最小客户端                                                       */
/* ------------------------------------------------------------------ */
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    const waiters = new Map();
    let id = 0;
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
        }
      };
      resolve({ send, once });
    };
    ws.onerror = () => reject(new Error("CDP websocket 连接失败: " + url));
  });
}

async function fetchJson(path, opts) {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return r.json();
}

async function waitForDebug(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      await fetchJson("/json/version");
      return true;
    } catch {}
    await sleep(400);
  }
  throw new Error("Chrome DevTools 端口未就绪");
}

async function pageTarget() {
  const list = await fetchJson("/json/list");
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("没有 page target");
  return page;
}

/* 连到当前页面 target；若 target 已消失自动重取一次 */
async function attach() {
  const page = await pageTarget();
  return connect(page.webSocketDebuggerUrl);
}

const evalJs = async (send, expression) => {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    const msg = r.exceptionDetails.exception?.description || r.exceptionDetails.text;
    throw new Error("页面内执行失败: " + msg);
  }
  return r.result.value;
};

async function shot(send, name) {
  mkdirSync(OUT, { recursive: true });
  const { data } = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const buf = Buffer.from(data, "base64");
  const file = join(OUT, name.endsWith(".png") ? name : name + ".png");
  writeFileSync(file, buf);
  // PNG IHDR: 宽/高在字节 16..24（big-endian）
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { name: name.replace(/\.png$/, ""), file, bytes: buf.length, width, height };
}

/* 等待选择器可见（用于开场遮罩/加载器） */
async function waitForSelector(send, selector, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const ok = await evalJs(
        send,
        `(() => {
          const e = document.querySelector(${JSON.stringify(selector)});
          if (!e) return false;
          const r = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05;
        })()`,
      );
      if (ok) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

/* 等待开场遮罩隐藏（等待 .intro 不可见） */
async function waitIntroHidden(send, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const visible = await evalJs(
        send,
        `(() => {
          const e = document.querySelector(".intro");
          if (!e) return false;
          const cs = getComputedStyle(e);
          return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05;
        })()`,
      );
      if (!visible) return true;
    } catch {}
    await sleep(400);
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* 浏览器启停                                                           */
/* ------------------------------------------------------------------ */
async function launchChrome() {
  const profile = join(tmpdir(), "ap2-recon-profile-" + process.pid);
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--hide-scrollbars",
    "--window-size=" + VIEWPORT.width + "," + VIEWPORT.height,
    "--force-device-scale-factor=1",
    "--run-all-compositor-stages-before-draw",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + profile,
    "about:blank",
  ];
  const chrome = spawn(CHROME, args, { stdio: "ignore", windowsHide: true });
  await waitForDebug();
  return chrome;
}

/* ------------------------------------------------------------------ */
/* 导航 + 等待 WebGL 场景                                               */
/* ------------------------------------------------------------------ */
async function navigate(send, url) {
  const loaded = new Promise((res) => {
    const timer = setTimeout(() => res(false), 25000);
    // loadEventFired 可能因资源慢而拖很久，这里用 once 竞争超时
    send("Page.enable");
    const q = [];
    void q;
    void timer;
    res(true);
  });
  await loaded;
  await send("Page.navigate", { url });
}

async function waitReady(send, timeoutMs = 20000, settleMs = 9000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      last = await evalJs(
        send,
        `(() => {
          const canv = Array.from(document.querySelectorAll("canvas"));
          const gl = canv[0] && (canv[0].getContext("webgl2") || canv[0].getContext("webgl"));
          let px = null;
          if (gl) {
            try {
              const buf = new Uint8Array(4);
              gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
              px = Array.from(buf);
            } catch (e) { px = "err:" + e.message; }
          }
          return JSON.stringify({
            ready: document.readyState,
            href: location.href,
            title: document.title,
            canvases: canv.map((c) => ({ w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight })),
            centerPixel: px,
            bodyTextLen: (document.body && document.body.innerText || "").length,
          });
        })()`,
      );
      const s = JSON.parse(last);
      if (s.ready === "complete" && s.canvases.length > 0 && s.bodyTextLen > 0) {
        await sleep(settleMs);
        return { ...s, href: await evalJs(send, "location.href") };
      }
    } catch {}
    await sleep(500);
  }
  throw new Error("页面未就绪: " + last);
}

/* 距离/差异由离线 Pillow 分析，这里只负责交互动作 */
async function drag(send, x1, y1, x2, y2, steps = 10) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y: y1, buttons: 0 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x1, y: y1, button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    const x = x1 + ((x2 - x1) * i) / steps;
    const y = y1 + ((y2 - y1) * i) / steps;
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(x), y: Math.round(y), button: "left", buttons: 1 });
    await sleep(28);
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y: y2, button: "left", buttons: 0, clickCount: 1 });
  await sleep(500);
}

async function wheel(send, x, y, deltaY, times = 1, intervalMs = 220) {
  for (let i = 0; i < times; i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY });
    if (i < times - 1) await sleep(intervalMs);
  }
  await sleep(700);
}

async function click(send, x, y) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(600);
}

/* DOM / 资源 / 文本证据 */
const EVIDENCE_JS = `(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.01;
  };
  const txt = (el) => (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80);
  const clickable = Array.from(document.querySelectorAll("button,a,[role=button],[tabindex],input,[class*=btn],[class*=button],[class*=intro],[class*=overlay]"))
    .filter(vis)
    .slice(0, 80)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: (el.className && String(el.className).slice(0, 90)) || "",
      id: el.id || "",
      text: txt(el),
      rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
    }));
  const canv = Array.from(document.querySelectorAll("canvas"));
  const prog = [];
  for (const c of canv) {
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      prog.push({
        w: c.width, h: c.height,
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
        version: gl.getParameter(gl.VERSION),
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      });
    }
  }
  const res = performance.getEntriesByType("resource")
    .map((e) => ({ name: e.name.split("/").pop(), type: e.initiatorType, dur: Math.round(e.duration), transfer: e.transferSize }))
    .filter((v, i, a) => a.findIndex((x) => x.name === v.name) === i);
  const scripts = Array.from(document.scripts).map((s) => s.src).filter(Boolean);
  return JSON.stringify({
    href: location.href,
    title: document.title,
    bodyText: (document.body ? document.body.innerText : "").replace(/\\n{2,}/g, "\\n").slice(0, 4000),
    textLen: document.body ? document.body.innerText.length : 0,
    clickable,
    canvases: canv.map((c) => ({ w: c.width, h: c.height, cls: c.className, id: c.id })),
    gl: prog,
    scripts,
    resources: res,
    hasThreeGlobal: !!(window.THREE || window.__THREE_DEVTOOLS__),
    globalsSample: Object.keys(window).filter((k) => /three|babylon|pixi|regl|webgl|atlas|solar|app/i.test(k)).slice(0, 40),
  });
})()`;

/* ------------------------------------------------------------------ */
/* 主流程（无 --attach 时）                                             */
/* ------------------------------------------------------------------ */
async function mainCapture() {
  mkdirSync(OUT, { recursive: true });
  const startedAt = new Date().toISOString();
  const shots = [];
  const chrome = await launchChrome();
  let ok = true;
  try {
    const page = await pageTarget();
    const { send } = await connect(page.webSocketDebuggerUrl);
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    // 固定 CSS 视口为 1280×800（无头窗口内含边框，默认 innerHeight 会少几十像素）
    await send("Emulation.setDeviceMetricsOverride", {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    /* 1) 导航（最多 4 次重试，每次等 12s 让 WebGL 场景加载） */
    let ready = null;
    let navErr = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= 4 && !ready; attempt++) {
      attempts = attempt;
      try {
        console.error(`[nav] attempt ${attempt} -> ${SITE}`);
        await send("Page.navigate", { url: SITE });
        await sleep(12000);
        ready = await waitReady(send, 15000, 1200);
      } catch (e) {
        navErr = e.message;
        console.error("[nav] failed:", e.message);
        await sleep(2500);
      }
    }
    if (!ready) throw new Error("参考站点加载失败（4 次重试）: " + navErr);
    console.error("[nav] ready:", JSON.stringify(ready));

    /* 2) 等待开场遮罩加载完成（加载器消失、「进入图谱」按钮出现），先记录首屏状态 */
    const earlyProbe = JSON.parse(
      await evalJs(send, `JSON.stringify({
        href: location.href,
        loaderHint: (document.body.innerText || "").match(/SURFACE MAPS|EPHEMERIS|界面音频/gi) || [],
        hasIntro: !!document.querySelector(".intro"),
        ctaVisible: (() => { const e = document.querySelector(".intro__cta"); return e ? (getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0) : false; })(),
        bodyText: (document.body.innerText || "").slice(0, 200),
      })`),
    );
    const introReady = await waitForSelector(send, ".intro__cta", 30000);
    console.error("[intro] cta visible:", introReady, "| early:", JSON.stringify(earlyProbe));
    await sleep(1500);
    const evIntro = JSON.parse(await evalJs(send, EVIDENCE_JS));
    shots.push(await shot(send, "ref-intro"));
    console.error("[shot] ref-intro");

    /* 3) 关闭引导弹窗「知道了」→「进入图谱」→ 等待开场遮罩隐藏、入场相机动画稳定 */
    const enterResult = JSON.parse(
      await evalJs(send, `(() => {
        const log = { onboardClosed: false, ctaClicked: false, ctaText: null };
        const close = document.querySelector(".onboard__close");
        if (close) { close.click(); log.onboardClosed = true; }
        const cta = document.querySelector(".intro__cta");
        if (cta) { cta.click(); log.ctaClicked = true; log.ctaText = (cta.innerText || "").trim(); }
        return JSON.stringify(log);
      })()`),
    );
    let introHidden = await waitIntroHidden(send, 8000);
    if (!introHidden) {
      await evalJs(send, `(() => { const s = document.querySelector(".intro__skip"); if (s) s.click(); })()`);
      enterResult.skipClicked = true;
      introHidden = await waitIntroHidden(send, 5000);
    }
    console.error("[intro] hidden after enter:", introHidden);
    await sleep(8000); // 等待入场相机动画结束、首帧稳定

    /* 4) 三维场景默认态 + 无操作对照帧（量化星空/粒子/行星运动等环境动画噪声） */
    shots.push(await shot(send, "ref-default"));
    console.error("[shot] ref-default");
    await sleep(1200);
    shots.push(await shot(send, "ref-idle"));
    console.error("[shot] ref-idle (control, no input)");

    /* 5) 左键向右拖动 300px（640,400 → 940,400，10 步），把左缘的太阳移入画面中部 */
    await drag(send, 640, 400, 940, 400, 10);
    await sleep(1500);
    shots.push(await shot(send, "ref-drag-right"));
    console.error("[shot] ref-drag-right");

    /* 6) 滚轮拉近太阳：站点缩放锚点为画布中心，故先再向右平移 300px 把太阳移到画面中心 */
    const canvasRect = JSON.parse(
      await evalJs(send, `(() => { const c = document.querySelector("canvas"); const r = c.getBoundingClientRect(); return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height, dpr: devicePixelRatio }); })()`),
    );
    await drag(send, 640, 400, 940, 400, 10); // 补充平移：让太阳进入缩放锚点（画布中心）
    await sleep(800);
    const zoomX = Math.round(canvasRect.x + canvasRect.w / 2);
    const zoomY = Math.round(canvasRect.y + canvasRect.h / 2);
    await wheel(send, zoomX, zoomY, -600, 4, 1000);
    await sleep(1500);
    shots.push(await shot(send, "ref-sun-close"));
    console.error("[shot] ref-sun-close");

    /* 7) 左键向下拖动 300px（640,400 → 640,700，10 步） */
    await drag(send, 640, 400, 640, 700, 10);
    await sleep(1500);
    shots.push(await shot(send, "ref-drag-down"));
    console.error("[shot] ref-drag-down");

    /* 7) 场景态证据（文本/资源/DOM/WebGL） */
    const evScene = JSON.parse(await evalJs(send, EVIDENCE_JS));

    /* 仅输出到 stdout，不落额外文件 */
    const resources = evScene.resources.slice(0, 20).map((r) => `${r.name} (${r.type}, ${r.transfer}B, ${r.dur}ms)`);
    const evidence = {
      startedAt,
      site: SITE,
      navAttempts: attempts,
      redirectHref: ready.href,
      title: evScene.title,
      threeGlobal: evScene.globalsSample.includes("__THREE__"),
      threeVersion: await evalJs(send, "window.__THREE__ || null"),
      viewport: await evalJs(send, "({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })"),
      canvasRect,
      canvases: evScene.canvases,
      gl: evScene.gl,
      intro: {
        earlyProbe,
        ctaVisibleAfterWait: introReady,
        enterResult,
        introHidden,
        introTextFirst200: evIntro.bodyText.replace(/\n/g, " ").slice(0, 200),
      },
      interactions: {
        dragRight: "left button 640,400 -> 940,400 (10 steps)",
        centeringPan: "left button 640,400 -> 940,400 (10 steps) — 追加平移把太阳移到画布中心，供滚轮放大",
        wheel: "deltaY=-600 x4, 1000ms interval, at canvas center 640,400（站点缩放锚点为画布中心）",
        dragDown: "left button 640,400 -> 640,700 (10 steps)",
      },
      bodyTextFirst200: evScene.bodyText.replace(/\n/g, " ").slice(0, 200),
      resourceCount: evScene.resources.length,
      resourcesFirst20: resources,
      scriptSrc: evScene.scripts,
      screenshots: shots.map((s) => `${s.name}: ${s.width}x${s.height}, ${s.bytes}B`),
      screenshotFiles: shots.map((s) => s.file),
    };
    console.log(JSON.stringify(evidence, null, 2));
    ok = true;
  } finally {
    try { chrome.kill(); } catch {}
    if (!ok) process.exitCode = 1;
  }
}

/* ------------------------------------------------------------------ */
/* --attach 单步模式                                                    */
/* ------------------------------------------------------------------ */
async function mainAttach(args) {
  const cmd = args[0];
  const rest = args.slice(1);
  await waitForDebug();
  const { send } = await attach();
  await send("Page.enable");
  await send("Runtime.enable");

  switch (cmd) {
    case "probe": {
      const url = rest[0] || SITE;
      await send("Page.navigate", { url });
      const ready = await waitReady(send, 30000);
      const ev = JSON.parse(await evalJs(send, EVIDENCE_JS));
      console.log(JSON.stringify({ ready, evidence: ev }, null, 2));
      break;
    }
    case "eval":
      console.log(JSON.stringify(await evalJs(send, rest.join(" ")), null, 2));
      break;
    case "shot":
      console.log(await shot(send, rest[0] || "ref-attach"));
      break;
    case "nav": {
      await send("Page.navigate", { url: rest[0] });
      await sleep(Number(rest[1] || 12000));
      console.log(JSON.stringify(await evalJs(send, "({href:location.href,title:document.title})")));
      break;
    }
    case "drag": {
      const [dx, dy, steps] = rest.map(Number);
      // 从画布中心开始拖
      const c = await evalJs(send, `(() => { const c=document.querySelector("canvas"); if(!c) return null; const r=c.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}); })()`);
      const cc = JSON.parse(c);
      await drag(send, cc.x, cc.y, cc.x + (dx || 0), cc.y + (dy || 0), steps || 10);
      console.log(JSON.stringify({ from: cc, to: [cc.x + (dx || 0), cc.y + (dy || 0)] }));
      break;
    }
    case "wheel": {
      const [dy, times] = rest.map(Number);
      const c = JSON.parse(await evalJs(send, `(() => { const c=document.querySelector("canvas"); if(!c) return null; const r=c.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`));
      await wheel(send, c.x, c.y, dy || -600, times || 1);
      console.log(JSON.stringify({ at: c, deltaY: dy || -600, times: times || 1 }));
      break;
    }
    case "click": {
      const [x, y] = rest.map(Number);
      await click(send, x, y);
      console.log("clicked " + x + "," + y);
      break;
    }
    case "enter": {
      // 点击开场遮罩上的「进入图谱」按钮（.intro__cta），失败则退化为「跳过开场」
      const out = await evalJs(send, `(() => {
        const el = document.querySelector(".intro__cta") || document.querySelector(".intro__skip");
        if (!el) return JSON.stringify({ clicked: false });
        el.click();
        return JSON.stringify({ clicked: true, cls: String(el.className), text: (el.innerText || "").slice(0, 40) });
      })()`);
      await sleep(2500);
      console.log(out);
      break;
    }
    case "skip": {
      const out = await evalJs(send, `(() => {
        const el = document.querySelector(".intro__skip");
        if (!el) return JSON.stringify({ clicked: false });
        el.click();
        return JSON.stringify({ clicked: true, cls: String(el.className) });
      })()`);
      await sleep(2500);
      console.log(out);
      break;
    }
    case "closeonboard": {
      const out = await evalJs(send, `(() => {
        const el = document.querySelector(".onboard__close");
        if (!el) return JSON.stringify({ clicked: false });
        el.click();
        return JSON.stringify({ clicked: true, cls: String(el.className) });
      })()`);
      await sleep(1200);
      console.log(out);
      break;
    }
    case "state": {
      const out = await evalJs(send, `JSON.stringify({
        href: location.href,
        introPresent: !!document.querySelector(".intro"),
        introDisplay: (() => { const e = document.querySelector(".intro"); return e ? getComputedStyle(e).display + "|" + getComputedStyle(e).opacity : null; })(),
        onboardPresent: !!document.querySelector(".onboard"),
        canvases: Array.from(document.querySelectorAll("canvas")).map((c) => [c.width, c.height]),
        viewport: [innerWidth, innerHeight],
        bodyText: (document.body.innerText || "").slice(0, 300),
        three: window.__THREE__ || null,
      })`);
      console.log(out);
      break;
    }
    case "textclick": {
      const text = rest.join(" ");
      const out = await evalJs(send, `(() => {
        const t = ${JSON.stringify(text)};
        const els = Array.from(document.querySelectorAll("button,a,[role=button],div,span,p"));
        const el = els.find((e) => (e.innerText || e.textContent || "").replace(/\\s+/g, " ").trim().includes(t));
        if (!el) return JSON.stringify({ clicked: false, text: t });
        const r = el.getBoundingClientRect();
        el.click();
        return JSON.stringify({ clicked: true, tag: el.tagName, cls: String(el.className).slice(0,100), text: (el.innerText||"").slice(0,80), rect: [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)] });
      })()`);
      console.log(out);
      break;
    }
    case "key": {
      const key = rest[0] || "Enter";
      const map = { Enter: 13, Escape: 27, Space: 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
      const code = map[key] ?? key.toUpperCase().charCodeAt(0);
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      await sleep(800);
      console.log("key " + key);
      break;
    }
    default:
      console.error("未知命令: " + cmd);
      process.exit(2);
  }
  process.exit(0);
}

/* ------------------------------------------------------------------ */
const argv = process.argv.slice(2);
const attachIdx = argv.indexOf("--attach");
if (attachIdx >= 0) {
  mainAttach(argv.filter((a) => a !== "--attach")).catch((e) => {
    console.error("ATTACH FAILED:", e.message);
    process.exit(1);
  });
} else {
  mainCapture().catch((e) => {
    console.error("CAPTURE FAILED:", e.message);
    process.exit(1);
  });
}
