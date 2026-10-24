# FrameFlow
<img src="assets/frameflow-mark.png" alt="FrameFlow 标识" width="180">
**在浏览器本地把 PNG 序列帧和常见动画素材转换为 GIF、WebP、APNG、PNG 序列 ZIP 或 YYEVA 双通道 MP4。
**导入、预览和编码都在浏览器中完成，图片和视频帧不会上传到转换服务器。

> 在线体验：[frameflow.tunetianyu.site](https://frameflow.tunetianyu.site)

## 功能一览

### 导入

- PNG 序列帧：支持选择文件夹、多选文件和拖拽；按文件名自然顺序排列，并检查帧号、尺寸和 PNG 文件头。
- 动画 GIF、WebP 和 APNG：读取动画帧、帧时长和循环信息。
- SVGA 2.x：本地解析并逐帧解码，保留源动画时间轴。
- YYEVA 双通道 MP4：可导入左右并排的视频，并自动判断或手动指定 Alpha 通道位置。

### 导出

- GIF、动画 WebP、APNG。
- PNG 序列 ZIP，方便在其他动画或设计工具中继续处理。
- YYEVA 双通道 MP4：以 H.264 编码，并写入 YYEVA 元数据。

可调整帧率、循环次数和输出文件名；WebP 提供质量设置。预览使用缩略图，导出使用原始帧。

## 隐私与数据

图像解码和格式转换在浏览器内完成，程序不会把图片内容或文件名上传到转换服务器。在线体验站点会匿名记录来源格式、目标格式、帧数和时间，用于累计统计；用户主动提交反馈时，可以选填微信号以便回复。

本仓库是前端代码副本，不包含在线站点的 Worker、D1 数据库或管理员后台。若部署在 GitHub Pages 等纯静态托管上，转换功能仍在本地运行；累计统计、反馈、爱心计数等需要对应的同源 API 后端支持，默认不会在 GitHub Pages 上启用。

本公开副本移除了百度统计脚本、搜索引擎站点验证标记和站点专用 canonical 配置。在线体验链接及作者公开联系方式保留在页面中。

## 本地运行

项目不需要 npm 安装或构建步骤。由于 FFmpeg WebAssembly 需要浏览器 Web Worker，请通过本地 HTTP 服务或 HTTPS 页面打开，不能直接用 `file://` 双击 HTML。

在仓库目录运行：

```bash
python3 -m http.server 8000
```

然后访问 <http://localhost:8000/>。浏览器会从入口页跳转到 FrameFlow 工具。

首次加载 FFmpeg WebAssembly 核心时，需要读取约 32 MB 的本地资源。项目将 FFmpeg 资源自托管在 `libs/ffmpeg/`，请保留该目录结构，不要改用 CDN 或移动其中的文件。

## 项目结构

```text
index.html                              根路径跳转入口
PNG序列帧转GIF-WebP-APNG工具.html        工具页面结构
css/frameflow.css                      页面样式
js/                                    导入、预览、导出与状态模块
assets/                                品牌与界面图片
libs/ffmpeg/                           本地 FFmpeg WebAssembly 运行资源
libs/svga/                             本地 SVGA 播放器及其许可文件
```

主要模块：

- `js/file-import.js`、`js/animated-import.js`：PNG 序列和动画文件导入。
- `js/animation-formats.js`、`js/svga-import.js`、`js/mp4-import.js`：动画格式、SVGA 和双通道 MP4 解析。
- `js/ffmpeg-runtime.js`、`js/export.js`：FFmpeg 生命周期与格式导出。
- `js/preview.js`、`js/app-state.js`：预览和共享时间轴状态。
- `js/counters.js`、`js/feedback.js`、`js/love-fallback.js`：在线统计、反馈与爱心计数前端接口。

## 已知限制

- SVGA 目前支持导入和转为其他格式，不支持导出回 SVGA。
- 双通道 MP4 使用 H.264 有损编码；Alpha 边缘和颜色可能与原始 PNG 有差异。音轨不处理，MP4 不保存动画循环次数。
- GIF 帧延迟以百分之一秒为单位，帧率会有格式精度误差；部分查看器会限制高帧率 GIF 的播放速度。
- 在线统计和反馈依赖未包含在本仓库的 Worker/D1 后端。

## 作者与联系

- 作者：TUNE.天宇
- 微信：`abc3314abc`
- 小红书：[TUNE.天宇主页](https://www.xiaohongshu.com/user/profile/60025c680000000001007310)
- 在线体验：[FrameFlow](https://frameflow.tunetianyu.site)

欢迎体验、反馈问题，也欢迎通过小红书或微信联系。

## 第三方组件与许可证

- SVGA 播放器的许可文件保留在 [`libs/svga/LICENSE`](libs/svga/LICENSE)，说明见 [`libs/svga/README.md`](libs/svga/README.md)。
- 当前副本没有项目级 `LICENSE` 文件，也没有随仓库提供 FFmpeg WebAssembly 资源的独立许可说明。公开前请为项目选择适用的许可证，并补齐随 FFmpeg 资源分发所需的第三方声明；本 README 不替这些组件声明许可证。
