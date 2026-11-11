# ID7 HUD Restore

给 BMW iDrive 7 的 MGU Store 修复工具。用于试用 AlexP50 Waze HUD 后，Redline、HUD Widgets 等第三方 HUD 组件的位置突然偏移或被裁切的情况。它会备份 Cluster renderer 的当前配置，把共享 HUD 画布从 `1000x600` 或 `800x600` 改回 `800x480`。

## 从 MGU Store 安装

1. 打开 **MGU Store → Settings → Add source**。
2. 输入 `ZEKAI-Design/ID7-HUD-Restore`，来源类型选 **Releases**。
3. 刷新来源，安装 **HUD Restore**。Store 会一起安装 **HUD Restore Helper**。需要已安装的 `cluster-render` 0.3.10 或更新版本，可从 `robertnisipeanu/idrive-apps` 安装。
4. 停车，挂 P 挡。若 AlexP50 的 Waze HUD 正在投影，先在那个 App 选 **Return to cluster**。
5. 打开 **HUD Restore**，按 **Restore HUD to 800 x 480**。看到 **Saved** 后，重启 iDrive，再将受影响组件的位置居中。

也可以下载发布页的 USB ZIP，解压到 U 盘根目录，在 Store 的 USB 来源安装。USB ZIP 包含 App 和 Helper，共享的 Cluster renderer 由 Store 单独提供。

App 页面显示的是配置文件中的尺寸。iDrive 重启后渲染器才会读入新配置。若出现 **Restore helper unavailable**，在 Store 的 Tools 检查 Helper 是否已安装，并重启一次 iDrive 后重试。AlexP50 的 Waze HUD 切换投影时可能再次改写尺寸。

## 恢复范围

- 只改 `cluster-render.conf` 的 `hud_size`。原配置备份与当前渲染器版本的配置放在同一目录，文件名为 `cluster-render.conf.hud-restore-*.bak`。
- 配置已是 `800x480` 时不重复写入。发现其他画布尺寸、异常配置或有效的非默认本地覆盖时会报告并跳过写入。
- 辅助服务仅在本机 Unix socket 接收固定的状态读取和恢复请求。没有 Shell 命令接口，也不会重启仪表或 iDrive。App 读取当前车速并在确认停车后才提交恢复请求。
- BMW 原厂 HUD 高度和每个组件的布局属于各自的设置。完成后可把之前用于补偿偏移的 Redline 或 HUD Widgets 位置恢复居中。

参见 [Waze HUD 后台控制逻辑](https://github.com/alexp50/bmw-apps/blob/main/components/waze-hud-control/files/controller.js) 和 [Cluster renderer 的 HUD 默认配置](https://github.com/robertnisipeanu/idrive-apps/blob/cluster-render%400.3.10/native/cluster-render/cluster-render.conf#L106-L111)。

## 构建

使用 Python 3 运行 `python3 build.py`，生成 `dist/` 下的 App、Helper、GitHub Releases catalog 和 USB ZIP。使用 `--repo OWNER/REPO` 可更改 catalog 的发布目标。App 的界面构建器和运行时来自 MIT 授权的 [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps)，车上的 BMW OAP SDK 由安装器提供。
