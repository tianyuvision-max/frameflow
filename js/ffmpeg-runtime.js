/* ---------- ffmpeg 懒加载（0.12 自托管内核） ---------- */
function setCoreLoadStatus(state, percent = null){
  const badge = $("localBadge");
  const text = $("localBadgeText");
  if (!badge || !text) return;
  badge.classList.remove("loading", "pending", "deferred", "blocked", "ready", "error");
  if (state === "loading") badge.classList.add("loading");
  if (state === "pending") badge.classList.add("pending");
  if (state === "deferred") badge.classList.add("deferred");
  if (state === "blocked") badge.classList.add("blocked");
  if (state === "ready") badge.classList.add("ready");
  if (state === "error") badge.classList.add("error");
  const label = state === "loading"
    ? (Number.isFinite(percent) ? `解析模块 · 加载 ${Math.round(percent)}%` : "解析模块 · 加载中")
    : state === "pending" ? "解析模块 · 等待加载"
    : state === "deferred" ? "解析模块 · 省流待机"
    : state === "blocked" ? "解析模块 · 需 HTTP"
    : state === "ready" ? "解析模块 · 已就绪"
    : state === "error" ? "解析模块 · 加载失败"
    : "解析模块 · 待机";
  text.textContent = label;
  badge.setAttribute("aria-label", label);
}

async function readBinaryWithProgress(url, onProgress){
  const version = document.querySelector('meta[name="ffmpeg-cache-version"]')?.content || "unversioned";
  const cacheName = `frameflow-ffmpeg-wasm-${version}`;
  let cache = null;
  try {
    if ("caches" in window) cache = await caches.open(cacheName);
  } catch (_) {}
  if (cache) {
    try {
      const cached = await cache.match(url);
      if (cached && cached.ok) {
        const data = new Uint8Array(await cached.arrayBuffer());
        onProgress(1);
        return data;
      }
    } catch (_) {}
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`编码内核加载失败（${response.status}）`);
  let cacheWrite = null;
  if (cache) {
    try {
      cacheWrite = cache.put(url, response.clone()).catch(error => {
        console.warn("编码内核缓存写入失败，将继续使用本次下载", error);
      });
    } catch (_) {}
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const data = new Uint8Array(await response.arrayBuffer());
    onProgress(1);
    if (cacheWrite) await cacheWrite;
    return data;
  }
  const reader = response.body.getReader();
  const total = Number(response.headers.get("content-length")) || 0;
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    received += value.byteLength;
    onProgress(total ? Math.min(1, received / total) : 0.05);
  }
  const data = new Uint8Array(received);
  let offset = 0;
  chunks.forEach(chunk => { data.set(chunk, offset); offset += chunk.byteLength; });
  onProgress(1);
  if (cacheWrite) await cacheWrite;
  return data;
}

async function pruneOldFFmpegWasmCaches(activeName){
  if (!("caches" in window)) return;
  try {
    const oldNames = (await caches.keys()).filter(name =>
      name.startsWith("frameflow-ffmpeg-wasm-") && name !== activeName
    );
    await Promise.all(oldNames.map(name => caches.delete(name)));
  } catch (_) {}
}

async function resolveWasmURL(base, { silent = false } = {}){
  const parts = (document.querySelector('meta[name="ffmpeg-wasm-parts"]')?.content || "")
    .split(",")
    .map(name => name.trim())
    .filter(Boolean);
  if (parts.length > 16 || parts.some(name => !/^[A-Za-z0-9._-]+$/.test(name))) {
    throw new Error("编码内核分片配置无效");
  }
  const names = parts.length ? parts : ["ffmpeg-core.wasm"];
  if (!silent) setStatus(`正在读取本地解析模块缓存或加载编码内核（${names.length > 1 ? names.length + " 个分片" : "约 31MB"}）…`);
  const progressValues = names.map(() => 0);
  const updateProgress = index => {
    const progress = progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length;
    setCoreLoadStatus("loading", progress * 90);
  };
  const buffers = await Promise.all(names.map((name, index) =>
    readBinaryWithProgress(base + name, progress => { progressValues[index] = progress; updateProgress(index); })
  ));
  const cacheVersion = document.querySelector('meta[name="ffmpeg-cache-version"]')?.content || "unversioned";
  await pruneOldFFmpegWasmCaches(`frameflow-ffmpeg-wasm-${cacheVersion}`);
  wasmObjectURL && URL.revokeObjectURL(wasmObjectURL);
  wasmObjectURL = URL.createObjectURL(new Blob(buffers, { type:"application/wasm" }));
  return wasmObjectURL;
}

function ensureFFmpeg({ silent = false } = {}){
  if (ffmpeg) {
    setCoreLoadStatus("ready", 100);
    return Promise.resolve(ffmpeg);
  }
  if (ffmpegLoading) {
    setCoreLoadStatus("loading");
    if (!silent) setStatus("正在读取本地解析模块缓存或加载编码内核，请稍候…");
    return ffmpegLoading;
  }
  setCoreLoadStatus("loading", 0);
  if (!silent) setStatus("正在读取本地解析模块缓存或加载编码内核，请稍候…");
  // 必须用绝对同源 URL：worker 内 importScripts/import 无法解析无前缀的相对路径
  const base = new URL("libs/ffmpeg/", location.href).href;
  ffmpegLoading = (async () => {
    let candidate = null;
    try {
      if (!window.FFmpegWASM || !window.FFmpegWASM.FFmpeg) throw new Error("ffmpeg 脚本未正确加载");
      const { FFmpeg } = window.FFmpegWASM;
      candidate = new FFmpeg();
      candidate.on("log", ({ type, message }) => {
        if (!message) return;
        const logMessage = String(message);
        ffmpegLogBuffer.push({ type, message: logMessage });
        if (ffmpegLogBuffer.length > 60) ffmpegLogBuffer.shift();
        // 某些 WebP 编码路径不会持续推送 progress 比例，但 FFmpeg 仍会输出 frame=N。
        // 用已处理帧数补充真实进度，不使用基于时间的虚假百分比。
        if (ffmpegProgressVisible && activeExportFormat === "webp") {
          const frameMatch = logMessage.match(/\bframe=\s*(\d+)/);
          if (frameMatch) {
            const frameProgress = Math.min(1, Number(frameMatch[1]) / Math.max(1, frames.length));
            if (Number.isFinite(frameProgress) && frameProgress > encodingProgress) {
              encodingProgress = frameProgress;
              setRunProgress(encodingProgress);
              updateEncodingStatus();
            }
          }
        }
        if (mp4ImportState) {
          const frameMatch = logMessage.match(/\bframe=\s*(\d+)/);
          if (frameMatch) {
            const currentFrame = Number(frameMatch[1]);
            const estimate = Math.max(1, Number(mp4ImportState.estimateFrames) || 1);
            const progress = Math.min(1, currentFrame / estimate);
            setUploadProgress(12 + progress * 22);
            setUploadStatus(`正在解码视频并重建透明帧… ${currentFrame} 帧`);
          }
        }
      });
      candidate.on("progress", ({ progress, time }) => {
        if (!ffmpegProgressVisible) return;
        const candidates = [];
        if (Number.isFinite(progress)) candidates.push(Math.min(1, Math.max(0, progress)));
        // ffmpeg.wasm 0.12 的 time 单位为毫秒；它对 WebP 动画通常比 progress 比例更稳定。
        if (Number.isFinite(time) && encodingDuration > 0) {
          candidates.push(Math.min(1, Math.max(0, time / 1000 / encodingDuration)));
        }
        const nextProgress = candidates.length ? Math.max(...candidates) : 0;
        encodingProgress = Math.max(encodingProgress, nextProgress);
        setRunProgress(encodingProgress);
        updateEncodingStatus();
      });
      const wasmURL = await resolveWasmURL(base, { silent });
      setCoreLoadStatus("loading", 92);
      await candidate.load({
        coreURL: base + "ffmpeg-core.js",
        wasmURL
      });
      ffmpeg = candidate;
      setCoreLoadStatus("ready", 100);
      return candidate;
    } catch(err){
      console.error(err);
      setCoreLoadStatus("error");
      try { candidate && candidate.terminate(); } catch(_){}
      wasmObjectURL && URL.revokeObjectURL(wasmObjectURL);
      wasmObjectURL = null;
      ffmpeg = null;
      ffmpegLoading = null;
      throw err;
    }
  })();
  return ffmpegLoading;
}

function scheduleFFmpegWarmup(){
  if (location.protocol === "file:") {
    setCoreLoadStatus("blocked");
    return;
  }
  const connection = navigator.connection;
  // effectiveType 在本地 HTTP / 内嵌浏览器中经常被误报为 2g；只尊重用户明确开启的省流模式。
  if (connection?.saveData) {
    setCoreLoadStatus("deferred");
    return;
  }
  setCoreLoadStatus("pending");
  let started = false;
  const start = () => {
    if (started || ffmpeg || ffmpegLoading) return;
    started = true;
    ensureFFmpeg({ silent:true }).catch(err => {
      // 预热失败不打断导入；用户点击导出时会自动重新尝试。
      console.warn("编码内核后台预热失败，将在导出时重试", err);
    });
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(start, { timeout:3000 });
  }
  // 空闲回调在部分浏览器 / 内嵌页面中可能长期不触发，定时器作为兜底。
  setTimeout(start, 1500);
}
