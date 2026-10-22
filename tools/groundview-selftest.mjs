/**
 * js/groundview.js 无头自测运行器
 * ------------------------------------------------------------
 * 启动 headless Chrome（CDP 调试端口 9335，窗口 900×700）
 * → 加载 http://127.0.0.1:8000/tools/groundview-selftest.html
 * → 等待 3s（页面内已同步完成绘制与采样断言）
 * → 读取 document.body.innerText 并打印
 * → 断言：至少 MIN_ASSERTIONS 条 PASS/FAIL 断言，且不含任何 FAIL。
 *
 * 运行：node tools/groundview-selftest.mjs
 * 退出码：0 = 全部 PASS；1 = 存在 FAIL / 页面未产出断言 / 运行异常。
 */
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9335;
const PAGE_URL = "http://127.0.0.1:8000/tools/groundview-selftest.html";
const WAIT_MS = 3000;
const MIN_ASSERTIONS = 10;
// 可选：GROUNDVIEW_DSF=2 node tools/groundview-selftest.mjs
// 用 2 倍设备像素比再跑一遍，验证「调用方 ctx.scale + 组件按 CSS 逻辑坐标绘制」的高 DPI 路径
const DSF = process.env.GROUNDVIEW_DSF || "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const userDataDir = join(tmpdir(), "ap2-groundview-selftest-" + process.pid);

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--hide-scrollbars",
    "--force-device-scale-factor=" + DSF,
    "--window-size=900,700",
    "--run-all-compositor-stages-before-draw",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

chrome.on("error", (err) => {
  console.error("无法启动 Chrome：" + err.message);
  process.exit(1);
});

function killChrome() {
  if (!chrome || chrome.killed) return;
  try {
    chrome.kill();
  } catch {}
  if (process.platform === "win32" && chrome.pid) {
    try {
      spawnSync("taskkill", ["/pid", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
  }
}

async function waitForDebug() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("Chrome DevTools 未就绪（端口 " + PORT + "）");
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
    ws.onerror = () => reject(new Error("CDP WebSocket 连接失败"));
  });
}

const fmtConsole = (p) =>
  (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ");

async function main() {
  // 先确认本地静态服务可访问，便于区分「服务没开」与「页面自测失败」
  try {
    const r = await fetch(PAGE_URL);
    if (!r.ok) throw new Error("HTTP " + r.status);
  } catch (e) {
    throw new Error("本地服务不可用（需要 http://127.0.0.1:8000）：" + PAGE_URL + " — " + e.message);
  }

  await waitForDebug();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((t) => t.type === "page");
  if (!target || !target.webSocketDebuggerUrl) throw new Error("找不到可用的 page target");

  const { send, once, log } = await connect(target.webSocketDebuggerUrl);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");

  const loaded = once("Page.loadEventFired");
  await send("Page.navigate", { url: PAGE_URL });
  await Promise.race([loaded, sleep(8000)]);
  await sleep(WAIT_MS); // 规范要求：加载后 3s 再取文本

  const evalText = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error("页面内执行失败：" + JSON.stringify(r.exceptionDetails));
    }
    return r.result ? r.result.value : undefined;
  };

  const text = String((await evalText("document.body.innerText")) || "");

  console.log("===== page body.innerText =====");
  console.log(text);
  console.log("===============================");

  const textLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const assertions = textLines.filter((l) => /^(PASS|FAIL)\s/.test(l));
  const failures = assertions.filter((l) => l.startsWith("FAIL"));
  const summary = textLines.find((l) => l.includes("SELFTEST RESULT:"));

  console.log("");
  console.log("断言条数：" + assertions.length + "（要求 ≥ " + MIN_ASSERTIONS + "）");
  console.log("PASS：" + (assertions.length - failures.length) + " / FAIL：" + failures.length);
  if (summary) console.log(summary);

  // 页面控制台错误 / 未捕获异常（用于排查，不直接改变 PASS 判定）
  const errorConsole = log.console.filter((p) => p.type === "error" || p.type === "warning");
  if (errorConsole.length) {
    console.log("\n页面 console 警告/错误：");
    for (const p of errorConsole) console.log("  [" + p.type + "] " + fmtConsole(p));
  }
  if (log.exceptions.length) {
    console.log("\n页面未捕获异常：");
    for (const p of log.exceptions) {
      console.log("  " + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || ""));
    }
  }
  const errorEntries = log.entries.filter((e) => e.level === "error");
  if (errorEntries.length) {
    console.log("\n页面日志 error：");
    for (const e of errorEntries) console.log("  " + e.source + ": " + e.text);
  }

  if (assertions.length === 0) {
    const diag = await evalText(
      "JSON.stringify({ url: location.href, ready: document.readyState, title: document.title, bodyText: document.body.innerText.slice(0, 400), html: document.body.innerHTML.slice(0, 400) })",
    );
    console.log("\n诊断：" + diag);
    console.log("SELFTEST FAILED：页面未产出任何 PASS/FAIL 断言");
    return false;
  }

  const allPass = failures.length === 0 && assertions.length >= MIN_ASSERTIONS;
  console.log(allPass ? "\nSELFTEST OK：全部断言 PASS" : "\nSELFTEST FAILED：存在 FAIL 断言");
  return allPass;
}

main()
  .then((ok) => {
    killChrome();
    process.exit(ok ? 0 : 1);
  })
  .catch((err) => {
    console.error("\nSELFTEST RUNNER ERROR：" + (err && err.message ? err.message : err));
    killChrome();
    process.exit(1);
  });
