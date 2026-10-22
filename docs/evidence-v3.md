# 参考网站取证（V3 阶段 · 无头浏览器直采）

> 目标站点：https://solar-system-atlas.pages.dev/
> 取证时间：2026-10-22 23:11–23:16（Asia/Shanghai），截图由 `tools/recon.mjs` 一次流程采集。
> **重要限制：本会话没有可调用的 REA MCP 工具。** 会话中只有 REA skill 的说明书文本，未连接任何 REA 服务/MCP 工具；因此本文所有「已确认」均来自可直接观察的页面表现（截图、DOM、`performance` 资源清单、`innerText`、窗口全局量），未读取其打包源码、未抓取私有接口。最早一版草稿基于 1258×646 早期截图，其数值与「偏航/俯仰」判断已被本文件实测结果取代。

## 0. 环境与可复现性

- 环境：Windows；Chrome `--headless=new --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader`；Node v24.21.0（内置 WebSocket 直连 CDP，无 npm 依赖）；Python 3.12.14 + Pillow 12.3.0。
- 视口：CDP `Emulation.setDeviceMetricsOverride` 固定 1280×800、DPR=1；截图均为 1280×800 PNG。
- WebGL：WebGL 2.0，渲染器 `ANGLE (Google, Vulkan 1.3.0 (SwiftShader ...), SwiftShader driver)` —— 无头环境为软件光栅化，真实 GPU 下观感可能略有差异。
- 流程：`node tools/recon.mjs`（导航最多 4 次重试、每次等 12s；关闭引导层；默认态/对照帧/右拖/滚轮放大/下拖各截图；证据 JSON 打印到 stdout，不落盘）。本轮**第 1 次导航即成功**，无加载失败。
- 网络：本轮 44 个资源全部加载成功；同一会话较早探测中 `orbits` 请求耗时 12.3s（传输 325B）、`earth-live.json` 曾较慢 —— 参考站/本机网络确实时好时坏，故脚本保留 4 次重试。

## 1. 证据文件（截图引用均相对工作区）

| 文件 | 内容 | 尺寸 | 平均亮度 |
|---|---|---|---|
| `screenshots/ref-intro.png` | 开场引导层（HUMAN ARTIFACTS / 进入图谱 / 操作提示 / 跳过开场） | 1280×800 | 5.92/255 |
| `screenshots/ref-default.png` | 关闭引导、进入图谱后的默认三维场景 | 1280×800 | 11.74/255 |
| `screenshots/ref-idle.png` | 与默认态间隔 1.2s、无任何输入的对照帧（量化环境动画噪声） | 1280×800 | 12.04/255 |
| `screenshots/ref-drag-right.png` | 左键 (640,400)→(940,400) 右拖 300px 后 | 1280×800 | 12.80/255 |
| `screenshots/ref-sun-close.png` | 太阳移到画布中心后滚轮 deltaY=-600 ×4 拉近 | 1280×800 | 25.02/255 |
| `screenshots/ref-drag-down.png` | 左键 (640,400)→(640,700) 下拖 300px 后 | 1280×800 | 17.94/255 |

所有截图均非全黑（Pillow 实测平均亮度 5.92–25.02 > 1），文件字节 351 KB–715 KB。

## 2. 站点结构与加载（已确认）

- 访问根路径 `https://solar-system-atlas.pages.dev/` 自动进入 `https://solar-system-atlas.pages.dev/solar/`；标题 `HUMAN ARTIFACTS · A Cartography of Humanity in the Solar System`。
- `window.__THREE__ === "186"`：页面运行时存在 three.js 的开发者工具注册钩子，版本 186（可确认页面加载了 three r186 运行时；打包方式/是否为官方构建未确认）。
- 2 个全屏 canvas（均 1280×800）：主 WebGL 画布（无 class/id）+ UI 粒子层 `canvas.ui-particles`；WebGL2 上下文正常。
- 首屏先出现加载清单（页面文本命中 `EPHEMERIS`、`SURFACE MAPS`），随后出现开场引导层；本轮用 `Runtime.evaluate` 依次点击 `.onboard__close`（知道了）与 `.intro__cta`（进入图谱），`introHidden=true` 后场景完全显示。开场层文本含：「HUMAN ARTIFACTS」「2026 年 10 月版」「进入图谱」「左键选择 · 右键转视角 · 滚轮缩放」「跳过开场 →」「[ SYSTEM READY ] EPHEMERIS // 2026 OBJECT INDEX // ONLINE ORBITAL DATA // READY」「正在对准黄道面」。
- 场景态 `innerText` 开头即天体与任务名录（MERCURY/VENUS/EARTH/MARS/JUPITER…SPUTNIK 1 1957、TELSTAR 1 1962、2001 MARS ODYSSEY…），底部为 1960–2026 时间线 UI。

## 3. 结构化观察表（A 太阳 / B 视觉语言 / C 相机鼠标 / D 时间运动）

| | 观察项目 | 参考网站实际表现 | 已确认的实现证据 | 合理推测 | 我的项目应如何实现 |
|---|---|---|---|---|---|
| A | 太阳表面细节 | 特写日面为亮橙→奶油白，表面有斑驳颗粒/流纹，边缘能停住；日面垂直直径 **112px（1×）→234px（滚轮 4 次后）**，日心附近颜色 RGB(233,187,148) | `ref-drag-right.png`（日面完整可见）、`ref-sun-close.png`；资源清单加载 `sun_photosphere-2k.jpg` 1.61MB、`sun_halpha-2k.jpg` 0.44MB、`sun_equirect-2k.jpg` 0.82MB | 2K 太阳贴图 + 自发光/色调映射的球体；h-alpha/equirect 可能用于色球层或远景，实际用途未确认 | 已有太阳 2K 贴图与自发光；可加轻微临边因子/颗粒噪声，不必模仿其数据层 |
| A | 太阳边缘与光晕 | 日面半径约 120px；沿上缘向外亮度连续单调衰减：r=130→108.7、150→64.7、180→31.3、220→14.3、280→4.7，**未见二次亮环/同心分层** | `ref-sun-close.png` 径向亮度剖面（Pillow，避开水平黄道亮线） | 单个面向相机的光晕 billboard（加色/径向衰减）或后处理 bloom，具体实现未确认 | 单个 billboard + 指数衰减；可保留现有两圈 rim 壳但避免形成可分辨的同色圆环 |
| A | 与背景的对比 | 日面峰值亮度约 225/255；默认视图 90.95% 像素 <30，太阳是画面最亮主体之一 | `ref-default.png`、`ref-sun-close.png` 像素统计 | — | 保持近黑底 + 单一亮源，避免整体提亮 |
| B | 整体暗度 | 默认视图平均亮度 **11.74/255**、90.95% 像素 <30；开场层平均 **5.92/255**、98.13% 像素 <30 | Pillow 对两张截图的亮度直方图 | 设计令牌化的近黑底色 | 沿用 `#05070c` 级暗底 + 少量高亮信息 |
| B | 主色与强调色 | 亮部像素均值 RGB(168,148,128)（偏暖白）；暖色像素均值 RGB(190,154,121)；铜橙/暖白用于标签、时间线圆点，无大面积彩色 | Pillow 颜色统计 + 全部截图 | 暖白 ink 分级 + 铜橙 accent 的令牌体系 | 保持暗底 + 金/铜强调，标签低饱和、聚焦才提亮 |
| B | 字体与版式 | 大标题宽字距的 `HUMAN ARTIFACTS`；天体/任务标签为小号等宽大写；固定 HUD（顶部导航、左下标题与统计、底部 1960–2026 时间线）叠在全屏画布上 | 资源清单加载 `inter-300.woff2`、`inter-400.woff2`、`ibm-plex-mono-400.woff2`、`ibm-plex-mono-500.woff2`；`ref-intro.png`/`ref-default.png` | 字体即 Inter + IBM Plex Mono（资源名可直接证实字体文件加载） | 已有 Inter + 等宽数字思路，可直接对齐 |
| C | 左键水平拖动 | 右拖 300px（10 步真实 mouseMoved）后，太阳从贴左缘（可见部分质心 x≈51）移到 **x≈342** 完整可见，y 不变（399）；内容差异 **117,443 px（11.47%）**，无输入对照仅 28,500 px（2.78%） | `ref-default.png`→`ref-drag-right.png`；`ref-idle.png` 对照；Pillow 质心/差异统计 | 二维平移（pan）跟手，非球面轨道旋转 | 参考站是 2D 图谱平移；我的项目是偏航/俯仰轨道相机，**不能把该拖拽当作 yaw/pitch 证据** |
| C | 左键垂直拖动 | 下拖 300px 后，放大后的日面上缘 y 283→568（**+285px**），水平漂移仅 +4px；画面整体下移，无旋转、无翻转 | `ref-sun-close.png`→`ref-drag-down.png`；Pillow 位移测量 | 同属平移；该视图不存在“极点翻转”问题 | 现有偏航/俯仰模型本身无极点翻转，方向符号需固定（项目自测覆盖） |
| C | 滚轮缩放 | deltaY=-600 ×4（每次间隔 1s）：日面直径 112→234px，**≈2.09×**；缩放围绕画布中心（先把太阳移到中心，放大后日心仍在 x≈661，画布中心 640） | `ref-drag-right.png`→`ref-sun-close.png`；交互序列与截图 | 以画布中心/视轴为锚点的尺度缩放；光标偏离中心时锚点是否改变未测试 | 以注视点为基点缩放（已实现），保持缩放后构图稳定 |
| C | 右键拖拽 | 开场文字明确提示「右键拖动 · 展开真实轨道倾角」，说明存在该交互入口 | `ref-intro.png`、页面文本层 | — | 本轮未实测右键效果 → **未确认**（作业范围外，不采纳） |
| D | 开场与时间 UI | 首访有加载清单 + 开场引导层；入场后底部状态「正在对准黄道面」；底部时间轴 1960–2026、年份 2026、「206 收录对象 / 81 仍在工作 / 15 深空探测器」、「▶ 回放这段时期」 | `ref-intro.png`、`ref-default.png`、场景 `innerText` | 入场相机缓动 + 数据驱动时间轴 | 已有漫游/暂停；时间轴回放超出作业范围，不采纳 |
| D | 持续运动（无输入） | 间隔 1.2s 两帧差异 **28,500 px（2.78%）**：引言文字轮换（实测到「可它仍在转动。——伽利略 · 1633」与「如果我看得更远，那是因为我站在巨人的肩上。——牛顿 · 1676」等不同引言），天体/标签轻微位移 | `ref-default.png` vs `ref-idle.png`；两图引言文本不同 | 引言轮播 + 实时位置/缓动动画在持续运行 | 参数面板需可暂停（已实现暂停时间按钮/P 键） |
| D | 资源与技术栈 | 44 个资源；主包 `solar.js` 573KB；`earth-catalog.json` 203KB、`album.json` 2.5KB；2K 贴图（太阳 3 张、earth day/night/clouds、jupiter/mars/…）；`__THREE__`=186 | `performance.getEntriesByType('resource')` 清单（附录 B）、窗口全局量 | three.js 打包 + 数据/贴图驱动的“图谱”式场景 | 自有 WebGL2 实现即可，无需引入 three |

## 4. 截图差异数值（Pillow，max-channel 阈值 >30，总像素 1,024,000）

| 对比对 | MAE（0–255） | 差异像素（>30） | 占比 | 解读 |
|---|---|---|---|---|
| ref-default → ref-idle（无输入对照） | 2.73 | 28,500 | 2.78% | 环境动画噪声基线（引言轮换、天体微动） |
| ref-default → ref-drag-right | 11.50 | **117,443** | **11.47%** | 纯右拖后视角变化，约为噪声基线的 4.1 倍 |
| ref-default → ref-drag-down | 19.50 | **200,645** | **19.59%** | 下拖（含此前滚轮放大）后画面显著变化 |
| ref-default → ref-sun-close | 22.34 | 213,481 | 20.85% | 滚轮放大效果显著 |
| ref-sun-close → ref-drag-down | 26.92 | 262,763 | 25.66% | 放大后再下拖，画面继续变化 |

结论：右拖、下拖两张截图相对 `ref-default.png` 的差异像素分别为 **117,443 / 200,645（阈值 30）**，远高于无操作对照的 28,500，可确认视角/画面确实发生变化；垂直拖动方向与指针一致（内容随指针下移，无翻转）。

## 5. 太阳特写补充数值（A 主题）

- 太阳在 `ref-default.png` 中被画布左缘裁切（只能看到右半部，质心 x≈51）；右拖 300px 后完整进入画面（质心 x≈342），此时测得日面垂直直径 **112px**。
- 太阳移到画布中心后，`deltaY=-600` 连续 4 次（间隔 1s）→ 日面垂直直径 **234px（≈2.09×）**，日心仍在 (661,399)，画布中心 (640,400)。
- 上缘径向亮度剖面（r=0…310px，步长 10）：`201.7, 191.3, 185.0, 142.3, 175.3, 169.7, 177.3, 164.7, 176.3, 164.0, 154.3, 180.7, 139.7, 108.7, 84.0, 64.7, 49.7, 39.3, 31.3, 25.3, 20.7, 17.0, 14.3, 12.0, 10.0, 8.0, 6.7, 5.7, 4.7, 4.7, 3.7, 3.3` —— 日面内（0–110px）在 140–200 波动（表面纹理），出日面半径（≈120px）后**单调衰减至背景**，无二次亮环。

## 6. 页面文本与资源清单（原始记录）

页面 `innerText` 前 200 字符（场景态，按 200 字符截断）：
```
MERCURY 水星 VENUS 金星 EARTH 地球 MARS 火星 SPUTNIK 1 1957 TELSTAR 1 1962 2001 MARS ODYSSEY 2001 SOHO 1995 PARKER SOLAR PROBE 2018 SOLAR ORBITER 2020 BEPICOLOMBO 2018 AKATSUKI 2010 KEPLER 2009 OPPORTUNITY 20
```

资源清单前 20 项（`performance.getEntriesByType('resource')`，格式 `文件名 (类型, 传输字节, 耗时)`；本轮共 44 项）：
```
solar.css (link, 30557B, 255ms)
solar.js (script, 573220B, 617ms)
ibm-plex-mono-500.woff2 (css, 15188B, 162ms)
inter-300.woff2 (css, 24216B, 175ms)
ibm-plex-mono-400.woff2 (css, 15008B, 192ms)
inter-400.woff2 (css, 23964B, 164ms)
earth-catalog.json (fetch, 203232B, 219ms)
album.json (fetch, 2517B, 218ms)
favicon.ico (other, 1023B, 164ms)
orbits (fetch, 325B, 12333ms)
sun_halpha-2k.jpg (img, 440194B, 748ms)
sun_photosphere-2k.jpg (img, 1613087B, 830ms)
mercury-2k.jpg (img, 872855B, 831ms)
sun_equirect-2k.jpg (img, 822727B, 796ms)
earth_daymap-2k.jpg (img, 463387B, 844ms)
venus_atmosphere-2k.jpg (img, 229996B, 835ms)
earth_nightmap-2k.jpg (img, 255587B, 877ms)
jupiter-2k.jpg (img, 499276B, 1359ms)
mars-2k.jpg (img, 750847B, 1358ms)
earth_clouds_nasa-2k.jpg (img, 829667B, 1275ms)
```

## 7. 未确认事项与失败项（不下结论）

- 本会话**无 REA MCP 工具**，未使用 REA；无法查看其打包源码，故“具体渲染框架/后处理/实例化合批”等均未确认（`window.__THREE__` 仅能确认 three r186 运行时存在）。
- 右键拖拽（“展开真实轨道倾角”）与背景音乐、时间轴回放本轮未实测 → 效果未确认。
- 滚轮在光标偏离画布中心时的缩放锚点未测试（本轮把光标放在中心，无法区分“中心锚点”与“光标锚点”）。
- 无头环境为 SwiftShader 软件渲染，颜色/抗锯齿与真机 GPU 可能有差异。
- 本轮导航与资源加载 1 次成功、无失败项；同会话早期探测曾出现 `orbits` 请求 12.3s 的慢加载（最终成功），故脚本保留 4 次重试逻辑。
