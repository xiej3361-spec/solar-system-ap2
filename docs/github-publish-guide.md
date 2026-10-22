# 把太阳系项目发布到 GitHub 并获取可分享 URL（操作流程）

> 目标：任何人打开 `https://你的用户名.github.io/<仓库名>/` 就能看到并操作你的作业。
> 本机状态（2026-10-22 已确认）：git 2.55 已安装、身份已配置、本地仓库已建好并完成首次提交（39 个文件，排除了 zip 和录屏原始帧）。

## 为什么用 GitHub Pages

- 项目是纯静态网站（无构建步骤），GitHub Pages 免费、永久、自动 HTTPS。
- 作业要求的「可运行 URL」即此链接；之后改代码 push 一下链接自动更新。
- 免费账号必须用 **Public（公开）仓库**才能开 Pages。

---

## 方案 A · 命令行推送（推荐，之后更新方便）

### 第 1 步：在 GitHub 网页上建空仓库（约 1 分钟）

1. 登录 github.com → 点右上角 **＋ → New repository**
2. Repository name 填英文，例如 `solar-system-ap2`（**不要勾** Add a README / .gitignore / license，保持空仓库）
3. 选 **Public** → 点 **Create repository**
4. 创建后页面会显示几条命令，其中有一行类似
   `git remote add origin https://github.com/你的用户名/solar-system-ap2.git`
   **把这一行的完整地址复制下来，下一步要用。**

### 第 2 步：本地推送（在本项目文件夹 AP2 里执行）

```powershell
git remote add origin https://github.com/你的用户名/solar-system-ap2.git
git branch -M main
git push -u origin main
```

- 第一次 push 会弹浏览器窗口让你登录 GitHub，点允许即可。
- 看到 `Writing objects ... done` 就是成功了。
- （本地仓库和首次提交我已经帮你做好了，如果上面 `git remote add` 报「已存在」，先 `git remote remove origin` 再执行。）

### 第 3 步：开启 GitHub Pages

1. 打开你的仓库页面 → **Settings**（设置）→ 左侧 **Pages**
2. **Build and deployment** → Source 选 **Deploy from a branch**
3. Branch 选 **main**，目录选 **/(root)** → 点 **Save**
4. 等 1~2 分钟，回到该页面顶部，会出现绿色横幅：
   **Your site is live at https://你的用户名.github.io/solar-system-ap2/**

### 第 4 步：验证

打开那个 URL：能看到太阳系画面、能拖拽、点行星能聚焦、按 O 能切投影 = 发布成功。把链接发给任何人（包括手机）即可。

### 之后更新代码（三步，约 10 秒）

```powershell
git add -A
git commit -m "更新说明"
git push
```

等 1~2 分钟刷新 URL 就是最新版。

---

## 方案 B · 完全不用命令行（网页拖拽上传）

适合网络不稳 / 不想碰 git 的情况（注意：每次更新要重新拖一遍全部文件）：

1. 同方案 A 第 1 步建空仓库（Public）
2. 进入仓库页 → **Add file → Upload files**
3. 打开本项目文件夹，把以下内容**全部拖进**上传区（共 39 个文件，低于 100 个限制）：
   - `index.html`、`README.md`
   - `css/`、`js/`、`Common/`、`textures/`、`docs/` 文件夹
   - `screenshots/` 里的 6 张图 + 1 个 GIF + 2 个文本（**不要拖 screenshots\frames 子文件夹**）
   - `tools/` 里 3 个脚本
   - **不要拖** `AP2-solar-system-src.zip`
4. 点 **Commit changes**
5. 然后同方案 A 第 3 步开启 Pages，得到相同格式的 URL。

---

## 常见问题

| 现象 | 原因与解决 |
|---|---|
| 打开 URL 是 404 | Pages 没开，或 Branch 没选 main / 目录没选 /(root) |
| 页面白屏 | 浏览器不支持 WebGL2，换最新版 Chrome / Edge；或个别文件没传全 |
| 图片/贴图不显示 | 仓库里文件名大小写与代码不一致（GitHub Pages 区分大小写） |
| push 卡住不动 | 网络问题，多试一次；仍不行用方案 B |
| 想更短的网址 | 免费方案：把仓库名建在 `用户名.github.io`（用户主页仓库）；或 Netlify Drop 拖文件夹生成随机短链 |
| 作业要交 zip | zip 保留在本地 `AP2-solar-system-src.zip`（已加入 .gitignore 不占仓库），照常提交即可 |
| 想在手机上好看 | 页面已做响应式；手机浏览器打开即可（小屏面板会折到下方） |

---

## 项目结构速查（仓库里有什么）

```
index.html        入口（着色器 + 面板 + 标签/暗角/颗粒叠层）
js/               配置 / 几何 / 场景图 / 相机 / 纹理 / UI / 主循环
Common/           教材工具库（MV.js 等）
textures/         天体位图
css/              界面样式
docs/analysis.md  目标作品分析 + 迁移矩阵 + 作业符合性审查
screenshots/      双投影对比、日/月食、聚焦特写、10s 漫游 GIF、验证日志
README.md         交互说明 + 层级树图 + 数学推导
```
