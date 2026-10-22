# 河传答哒 桌面版（Mac 适配）

这里是从 v1.3.1 Windows 安装包（`resources/app.asar`）里取出来的软件源码，加上 Mac 适配。
同一份代码在 Windows 上行为不变，Mac 相关的改动都用 `process.platform === 'darwin'` 区分开。

## Mac 上改了什么

| 地方 | Windows | Mac |
| --- | --- | --- |
| 窗口按钮 | 页面自己画的右上角三个按钮 | 系统左上角红黄绿按钮（`titleBarStyle: 'hidden'`），侧边栏往下让位 |
| 菜单 | 不要菜单 | 屏幕顶部菜单（关于 / 设置 ⌘, / 隐藏 / 退出 ⌘Q，编辑菜单让 ⌘C ⌘V ⌘A 能用） |
| 托盘 | 右下角托盘，`icon.ico` | 屏幕顶部菜单栏，黑白模板图 `build/trayTemplate.png`，自动适配深色 / 浅色 |
| 程序坞 | — | 点程序坞图标把藏起来的窗口叫回来 |
| 开机自启 | 登录项带 `--hidden` | 登录项不能带参数，用 `wasOpenedAtLogin` 判断后台启动 |
| 桌宠、小组件 | 置顶小窗口 | 同样，另外在每个桌面（Space）上都显示 |
| 录课 | 直接录 | 先向系统要麦克风权限；Info.plist 里写了用途说明 |
| 提示文字 | 托盘、右下角、Ctrl | 菜单栏、右上角、⌘ |
| `setAppUserModelId` | 调用 | Mac 没有这个方法，跳过（不跳过会启动就报错） |
| 语音识别 | `sherpa-onnx-win-x64`、`ffmpeg.exe` | `sherpa-onnx-darwin-arm64/x64`、Mac 版 ffmpeg（npm 按平台自动装） |

## 自己在 Mac 上打包

```bash
cd desktop
brew install sevenzip     # 取模型用
npm ci
npm run models            # 从 v1.3.1 Windows 安装包里取出语音识别模型（约 230 MB，带 SHA-256 校验）
npm start                 # 直接运行
npm run dist:mac -- --arm64   # 或 --x64，生成 dist/campus-assistant-1.3.1-mac-arm64.dmg
```

## 自动打包

`.github/workflows/build-mac.yml` 在 GitHub 的 Mac 机器上分别打 Apple 芯片和 Intel 两个 dmg，
并且自检：签名、架构、用打包好的 ffmpeg + 模型识别一段 `say` 生成的语音、启动软件 25 秒不崩。

- 推到任何分支：dmg 在这次运行的 Artifacts 里
- 合并到 main：自动上传到 `v<package.json 里的版本>` 那个 Release（官网的 Mac 下载按钮指向这里）
- Actions 页面手动运行，填 Release 的 tag：上传到那个 Release

## 签名

没有 Apple 开发者账号，所以只做了 ad-hoc 签名（Apple 芯片的 Mac 必须至少有这个才能运行），没有公证。
用户第一次打开会被 Gatekeeper 拦一下，官网常见问题里写了怎么打开。
以后有了开发者账号：把 `mac.identity` 改成证书名、打开 `hardenedRuntime`，再配上公证即可。
