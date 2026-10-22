/**
 * camera.js 浏览器自测页的无头运行器。
 *
 * 做法与 tools/capture.mjs 一致：启动 headless Chrome → CDP WebSocket →
 * 打开 tools/camera-selftest.html → 等 3s 让页面跑完断言 →
 * Runtime.evaluate 取 document.body.innerText 打印。
 * 只有全部断言 PASS（且无控制台错误）才以 0 退出，否则退出码 1。
 *
 * 运行（项目根目录）：
 *   "C:\Users\Xie jiarui\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" tools/camera-selftest.mjs
 *
 * 依赖：本地静态服务 http://127.0.0.1:8000 已启动（python -m http.server 8000）。
 */
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9334;
const URL = "http://127.0.0.1:8000/tools/camera-selftest.html";
const WAIT_MS = 3000;
const MIN_PASS = 35;

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
    "--window-size=900,700",
    "--force-device-scale-factor=1",
    "--run-all-compositor-stages-before-draw",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), "ap2-camera-selftest")}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

/** 轮询 devtools 端点，等 Chrome 就绪。 */
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

/** 连接 CDP WebSocket，返回 send / once / 日志。结构与 capture.mjs 一致。 */
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
  await waitForDebug();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((t) => t.type === "page");
  if (!target) throw new Error("/json/list 中没有 page target");

  const { send, once, log } = await connect(target.webSocketDebuggerUrl);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");

  const loaded = once("Page.loadEventFired");
  await send("Page.navigate", { url: URL });
  await loaded;
  await sleep(WAIT_MS); // 等页面模块加载 + 断言跑完

  const evaluated = await send("Runtime.evaluate", {
    expression: "document.body.innerText",
    returnByValue: true,
  });
  const text = evaluated.result && evaluated.result.value ? evaluated.result.value : "";

  console.log("===== tools/camera-selftest.html 自测输出 =====");
  console.log(text.trim() ? text : "（页面无输出：模块可能加载失败）");

  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const passLines = lines.filter((l) => l.startsWith("PASS "));
  const failLines = lines.filter((l) => l.startsWith("FAIL "));

  const consoleErrors = log.console
    .filter((p) => p.type === "error" || p.type === "warning")
    .map((p) => `[${p.type}] ${fmtConsole(p)}`);
  const exceptions = log.exceptions.map(
    (p) => p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "未知异常",
  );
  const logErrors = log.entries
    .filter((e) => e.level === "error")
    .map((e) => `${e.source}: ${e.text}`);

  console.log("");
  console.log(`汇总：PASS ${passLines.length}，FAIL ${failLines.length}，页面控制台错误 ${consoleErrors.length + exceptions.length + logErrors.length}`);
  if (consoleErrors.length) console.log("控制台 error/warn：\n" + consoleErrors.join("\n"));
  if (exceptions.length) console.log("页面异常：\n" + exceptions.join("\n"));
  if (logErrors.length) console.log("Log error：\n" + logErrors.join("\n"));

  if (failLines.length > 0) {
    throw new Error("存在 FAIL 断言（" + failLines.length + " 条），自测未通过");
  }
  if (passLines.length < MIN_PASS) {
    throw new Error(`PASS 断言仅 ${passLines.length} 条（< ${MIN_PASS}），页面可能未完整执行`);
  }
  if (consoleErrors.length + exceptions.length + logErrors.length > 0) {
    throw new Error("页面存在控制台错误 / 未捕获异常");
  }
  if (!text.includes("SELFTEST RESULT: ALL PASS")) {
    throw new Error("页面缺少 ALL PASS 结论行");
  }

  console.log("CAMERA SELFTEST: ALL PASS");
  chrome.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error("CAMERA SELFTEST FAILED:", e && e.message ? e.message : e);
  try {
    chrome.kill();
  } catch {}
  process.exit(1);
});
