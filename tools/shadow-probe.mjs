// 阴影可见性探针：进入日食 → 把「月影落点」投影到屏幕 → 截图 → 采样对比亮暗
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = join(process.cwd(), "screenshots");
mkdirSync(OUT, { recursive: true });
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9338;
const URL = process.argv[2] || "http://127.0.0.1:8000/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--no-first-run", "--window-size=1280,800", "--force-device-scale-factor=1",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmpdir(), "ap2-shadow")}`, "about:blank"], { stdio: "ignore" });

async function waitDebug() {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; } catch {} await sleep(500); }
  throw new Error("no devtools");
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url); const pending = new Map(); let id = 0;
    ws.onopen = () => {
      const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
      resolve({ send });
    };
    ws.onerror = () => reject(new Error("ws"));
  });
}

const main = async () => {
  await waitDebug();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  const { send } = await connect(page.webSocketDebuggerUrl);
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: URL });
  await sleep(4200);
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  await ev("window.__ap2.enterEclipse('solar')");
  await sleep(1800);
  // 计算阴影落点与地球中心的屏幕坐标
  const info = JSON.parse(await ev(`JSON.stringify((() => {
    const MV = window;
    const { cam, scene } = window.__ap2;
    const p = scene.sim.positions;
    const geo = scene.eclipseGeometry();
    const spot = geo.solar.earthSpot ? geo.solar.earthSpot.point : null;
    const rect = document.getElementById("view").getBoundingClientRect();
    const aspect = document.getElementById("view").width / document.getElementById("view").height;
    const m = MV.mult(cam.projMatrix(aspect), cam.viewMatrix());
    const toPx = (v) => {
      const q = MV.mult(m, MV.vec4(v[0], v[1], v[2], 1));
      return { x: q[0] / q[3] * 0.5 * rect.width + rect.width / 2, y: rect.height / 2 - q[1] / q[3] * 0.5 * rect.height, w: q[3] };
    };
    return {
      spot: spot ? toPx(spot) : null,
      earth: toPx(p.earth),
      umbraR: geo.solar.earthSpot ? geo.solar.earthSpot.umbraR : 0,
      penumbraR: geo.solar.earthSpot ? geo.solar.earthSpot.penumbraR : 0,
    };
  })())`));
  console.log("spot screen:", JSON.stringify(info.spot), "earth:", JSON.stringify(info.earth));
  const { data } = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(join(OUT, "v3-shadow-probe.png"), Buffer.from(data, "base64"));
  writeFileSync(join(OUT, "v3-shadow-probe.json"), JSON.stringify(info, null, 2), "utf8");
  chrome.kill();
  process.exit(0);
};
main().catch((e) => { console.error("PROBE FAIL", e.message); try { chrome.kill(); } catch {} process.exit(1); });
