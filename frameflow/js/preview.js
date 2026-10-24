let previewStartToken = 0;
let previewBitmapCache = new Map();
let previewBitmapLoads = new Map();
const PREVIEW_DECODE_AHEAD = 18;

function renderFrames(version){
  $("framesPanel").style.display = "block";
  const total = frames.reduce((s,f)=>s+f.file.size,0);
  const fmt = b => b >= 1048576 ? (b/1048576).toFixed(1)+" MB" : b >= 1024 ? (b/1024).toFixed(0)+" KB" : b+" B";
  const summary = $("summary");
  summary.replaceChildren();
  const isSourceAnimation = animationModel.timelineMode === "preserve-source";
  const sourceNames = { gif: "GIF 动画", webp: "WebP 动画", apng: "APNG 动画", svga: "SVGA 动画", "yyeva-mp4": "双通道 MP4" };
  const summaryItems = isSourceAnimation
    ? [
        ["来源", sourceNames[animationModel.sourceType] || "动画文件"],
        ["帧数", String(frames.length) + " 帧"],
        ["总时长", formatDuration(timelineDurationUs() / 1000000)],
        ["循环", animationModel.loopCount === 0 ? "无限循环" : animationModel.loopCount + " 次"],
        ["文件体积", formatByteSize(animationModel.sourceFile?.size)],
        ["透明通道", animationModel.canvas.hasAlpha ? "包含透明" : "不含透明"],
        ["画布尺寸", `${frames[0].width}×${frames[0].height}`]
      ]
    : [["帧数", String(frames.length)], ["总大小", fmt(total)], ["尺寸", `${frames[0].width}×${frames[0].height}`]];
  summaryItems.forEach(([label, value]) => {
    const item = document.createElement("span");
    item.append(`${label}：`);
    const strong = document.createElement("b");
    strong.textContent = value;
    item.appendChild(strong);
    summary.appendChild(item);
  });
  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.id = "previewBtn";
  previewButton.className = "preview-trigger";
  previewButton.textContent = "预览准备中…";
  previewButton.disabled = true;
  previewButton.onclick = openPreview;
  summary.appendChild(previewButton);

  renderCurrentDiagnostics();
  const grid = $("grid"); grid.replaceChildren();
  frames.forEach((f,i) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    const img = document.createElement("img");
    img.alt = `第 ${i + 1} 帧`;
    img.loading = "lazy";
    img.decoding = "async";
    cell.appendChild(img);
    grid.appendChild(cell);
  });
  generatePreviews(version);
}

function nextPaint(){
  return new Promise(resolve => requestAnimationFrame(resolve));
}

function loadPreviewImage(url){
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("缩略图解码失败"));
    image.src = url;
  });
}

async function createPreviewURL(frame){
  const scale = Math.min(PREVIEW_SIZE / frame.width, PREVIEW_SIZE / frame.height);
  const drawWidth = Math.max(1, Math.round(frame.width * scale));
  const drawHeight = Math.max(1, Math.round(frame.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = drawWidth;
  canvas.height = drawHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建缩略图画布");

  let bitmap = null;
  let image = null;
  let sourceURL = null;
  try {
    // 支持时直接让浏览器按缩略图尺寸解码，避免把整张原图长期留在预览内存中。
    if (typeof createImageBitmap === "function") {
      try {
        bitmap = await createImageBitmap(frame.file, {
          resizeWidth: drawWidth,
          resizeHeight: drawHeight,
          resizeQuality: "high"
        });
      } catch (_) {
        bitmap = null;
      }
    }
    if (!bitmap) {
      sourceURL = URL.createObjectURL(frame.file);
      image = await loadPreviewImage(sourceURL);
    }
    const source = bitmap || image;
    ctx.drawImage(source, 0, 0, drawWidth, drawHeight);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error("缩略图编码失败")), "image/png");
    });
    return URL.createObjectURL(blob);
  } finally {
    if (bitmap) bitmap.close();
    if (image) image.src = "";
    if (sourceURL) URL.revokeObjectURL(sourceURL);
    canvas.width = 1;
    canvas.height = 1;
  }
}

async function generatePreviews(version){
  const images = $("grid").querySelectorAll(".cell img");
  for (let i = 0; i < frames.length; i++) {
    if (version !== previewVersion) return;
    try {
      const url = await createPreviewURL(frames[i]);
      if (version !== previewVersion) {
        URL.revokeObjectURL(url);
        return;
      }
      frames[i].previewURL = url;
      images[i].src = url;
    } catch (err) {
      console.warn(`第 ${i + 1} 帧缩略图生成失败`, err);
    }
    // 分批把控制权交还给浏览器，避免连续处理大量图片时阻塞滚动和点击。
    if ((i + 1) % 4 === 0) await nextPaint();
  }
  if (version === previewVersion) {
    const button = $("previewBtn");
    const ready = frames.length > 0 && frames.every(frame => frame.previewURL);
    if (button) {
      button.disabled = !ready;
      button.textContent = ready ? "预览动画" : "预览准备中…";
      if (ready) openPreview();
    }
  }
}

function previewFPS(){
  return Math.min(120, Math.max(1, Number.parseInt($("fps").value, 10) || 30));
}

function updatePreviewDuration(){
  if (!animationModel.frames.length) {
    $("previewDuration").textContent = "—";
    return;
  }
  $("previewDuration").textContent = formatDuration(timelineDurationUs() / 1000000);
}

function setDefaultPreviewGeometry(frame){
  if (previewGeometryCustom) return;
  const dialog = $("previewDialog");
  const maxStageWidth = Math.min(520, Math.max(220, window.innerWidth - 80));
  const maxStageHeight = Math.min(560, Math.max(260, window.innerHeight - 220));
  const scale = Math.min(maxStageWidth / frame.width, maxStageHeight / frame.height);
  const stageWidth = Math.round(frame.width * scale);
  const stageHeight = Math.round(frame.height * scale);
  const dialogWidth = Math.min(window.innerWidth - 16, Math.max(300, stageWidth + 32));
  dialog.style.width = dialogWidth + "px";
  dialog.style.removeProperty("height");
  $("previewStage").style.width = stageWidth + "px";
  $("previewStage").style.height = stageHeight + "px";
  dialog.style.left = "auto";
  dialog.style.top = "auto";
  dialog.style.right = "24px";
  dialog.style.bottom = "24px";
}

function updatePreviewStage(){
  const frame = frames[previewIndex] || frames[0];
  if (!frame || !frame.width || !frame.height) return;
  const dialog = $("previewDialog");
  const stage = $("previewStage");
  const head = dialog.querySelector(".preview-head");
  const controls = dialog.querySelector(".preview-controls");
  const note = dialog.querySelector(".preview-note");
  const reservedHeight = (head?.offsetHeight || 28)
    + (controls?.offsetHeight || 30)
    + (note?.offsetHeight || 16)
    + 64;
  const maxWidth = Math.max(160, dialog.clientWidth - 32);
  const maxHeight = Math.max(120, dialog.clientHeight - reservedHeight);
  const scale = Math.max(0.01, Math.min(maxWidth / frame.width, maxHeight / frame.height));
  stage.style.width = Math.max(1, Math.round(frame.width * scale)) + "px";
  stage.style.height = Math.max(1, Math.round(frame.height * scale)) + "px";
}

function previewWindowIndices(index){
  const count = Math.min(frames.length, PREVIEW_DECODE_AHEAD);
  const start = Math.max(0, Math.min(frames.length - 1, Number(index) || 0));
  const indices = new Set();
  for (let offset = 0; offset < count; offset++) indices.add((start + offset) % frames.length);
  return indices;
}

function releasePreviewBitmap(bitmap){
  if (bitmap && typeof bitmap.close === "function") bitmap.close();
}

async function decodePreviewFrame(index, version){
  if (previewBitmapCache.has(index)) return previewBitmapCache.get(index);
  if (previewBitmapLoads.has(index)) return previewBitmapLoads.get(index);
  const frame = frames[index];
  if (!frame) return null;
  const load = (async () => {
    let bitmap;
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(frame.file);
    } else {
      frame.previewURLs = frame.previewURLs || {};
      if (!frame.previewURLs.original) frame.previewURLs.original = URL.createObjectURL(frame.file);
      bitmap = await loadPreviewImage(frame.previewURLs.original);
    }
    if (version !== previewVersion || frames[index] !== frame) {
      releasePreviewBitmap(bitmap);
      return null;
    }
    previewBitmapCache.set(index, bitmap);
    return bitmap;
  })();
  previewBitmapLoads.set(index, load);
  try {
    return await load;
  } finally {
    if (previewBitmapLoads.get(index) === load) previewBitmapLoads.delete(index);
  }
}

function prunePreviewBitmapCache(indices){
  for (const [index, bitmap] of previewBitmapCache) {
    if (indices.has(index)) continue;
    releasePreviewBitmap(bitmap);
    previewBitmapCache.delete(index);
  }
}

async function preparePreviewBuffer(index){
  if (!frames.length) return;
  const version = previewVersion;
  const indices = previewWindowIndices(index);
  const bitmaps = await Promise.all([...indices].map(frameIndex => decodePreviewFrame(frameIndex, version)));
  if (version !== previewVersion) return;
  prunePreviewBitmapCache(previewWindowIndices(previewIndex));
  const currentOffset = [...indices].indexOf(previewIndex);
  if (currentOffset >= 0 && bitmaps[currentOffset]) drawPreviewBitmap(bitmaps[currentOffset]);
}

function schedulePreviewBuffer(index){
  void preparePreviewBuffer(index).catch(error => {
    if (previewPlaying) console.warn("动画预览帧缓冲失败", error);
  });
}

function drawPreviewBitmap(bitmap){
  if (!bitmap || !frames.length) return;
  const frame = frames[previewIndex];
  const canvas = $("previewCanvas");
  if (!frame || !canvas) return;
  if (canvas.width !== frame.width) canvas.width = frame.width;
  if (canvas.height !== frame.height) canvas.height = frame.height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
}

function updatePreviewFrame(index){
  if (!frames.length) return;
  previewIndex = Math.max(0, Math.min(frames.length - 1, Number(index) || 0));
  const bitmap = previewBitmapCache.get(previewIndex);
  if (bitmap) drawPreviewBitmap(bitmap);
  else schedulePreviewBuffer(previewIndex);
  $("previewSeek").max = String(Math.max(0, frames.length - 1));
  $("previewSeek").value = String(previewIndex);
  $("previewFrame").textContent = (previewIndex + 1) + " / " + frames.length;
  updatePreviewDuration();
  $("previewNote").textContent = animationModel.timelineMode === "preserve-source"
    ? "预览使用有限帧缓存保持播放流畅 · 导出保留原始帧与时间轴"
    : "预览 " + previewFPS() + " 帧/秒 · 使用有限帧缓存 · 导出仍使用原始 PNG";
}

function previewTick(timestamp){
  if (!previewPlaying || !frames.length) return;
  if (!previewStartTime) previewStartTime = timestamp - timelineOffsetUs(previewIndex) / 1000;
  const nextIndex = timelineFrameIndexAt(timestamp - previewStartTime);
  if (nextIndex !== previewIndex) updatePreviewFrame(nextIndex);
  previewRAF = requestAnimationFrame(previewTick);
}

async function startPreview(){
  if (!frames.length) return;
  stopPreview();
  const token = previewStartToken;
  const button = $("previewPlay");
  button.disabled = true;
  button.textContent = "正在准备预览…";
  await preparePreviewBuffer(previewIndex);
  if (token !== previewStartToken || !frames.length) return;
  button.disabled = false;
  previewPlaying = true;
  previewStartTime = performance.now() - timelineOffsetUs(previewIndex) / 1000;
  button.textContent = "暂停";
  previewRAF = requestAnimationFrame(previewTick);
}

function stopPreview(){
  previewStartToken++;
  previewPlaying = false;
  previewStartTime = 0;
  if (previewRAF) cancelAnimationFrame(previewRAF);
  previewRAF = 0;
  const button = $("previewPlay");
  if (button) {
    button.disabled = false;
    button.textContent = "播放";
  }
}

function beginPreviewDrag(event){
  if (event.target.closest("button,input,select,textarea,a") || (event.pointerType === "mouse" && event.button !== 0)) return;
  const dialog = $("previewDialog");
  const dragSurface = event.currentTarget;
  const rect = dialog.getBoundingClientRect();
  previewGeometryCustom = true;
  dialog.style.left = rect.left + "px";
  dialog.style.top = rect.top + "px";
  dialog.style.right = "auto";
  dialog.style.bottom = "auto";
  previewDrag = {
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top
  };
  dragSurface.classList.add("dragging");
  dragSurface.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function movePreviewDrag(event){
  if (!previewDrag || event.pointerId !== previewDrag.pointerId) return;
  const dialog = $("previewDialog");
  const rect = dialog.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  const left = Math.min(maxLeft, Math.max(8, event.clientX - previewDrag.offsetX));
  const top = Math.min(maxTop, Math.max(8, event.clientY - previewDrag.offsetY));
  dialog.style.left = left + "px";
  dialog.style.top = top + "px";
}

function endPreviewDrag(event){
  if (!previewDrag || event.pointerId !== previewDrag.pointerId) return;
  event.currentTarget.classList.remove("dragging");
  try { event.currentTarget.releasePointerCapture(event.pointerId); } catch(_){}
  previewDrag = null;
}

function openPreview(){
  if (!frames.length || !frames.every(frame => frame.previewURL)) return;
  const overlay = $("previewOverlay");
  setDefaultPreviewGeometry(frames[0]);
  overlay.hidden = false;
  updatePreviewFrame(0);
  startPreview();
  $("previewClose").focus();
}

function closePreview(){
  stopPreview();
  previewDrag = null;
  const overlay = $("previewOverlay");
  if (!overlay) return;
  overlay.hidden = true;
}


$("previewClose").onclick = closePreview;
$("previewPlay").onclick = () => previewPlaying ? stopPreview() : startPreview();
$("previewSeek").oninput = e => {
  stopPreview();
  updatePreviewFrame(e.target.value);
};
const previewHead = $("previewDialog").querySelector(".preview-head");
previewHead.addEventListener("pointerdown", beginPreviewDrag);
previewHead.addEventListener("pointermove", movePreviewDrag);
previewHead.addEventListener("pointerup", endPreviewDrag);
previewHead.addEventListener("pointercancel", endPreviewDrag);
if (typeof ResizeObserver === "function") {
  new ResizeObserver(updatePreviewStage).observe($("previewDialog"));
}
window.addEventListener("resize", updatePreviewStage);
$("previewOverlay").addEventListener("click", e => {
  if (e.target === e.currentTarget) closePreview();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("previewOverlay").hidden) closePreview();
});

window.addEventListener("beforeunload", () => {
  closePreview();
  prunePreviewBitmapCache(new Set());
  frames.forEach(frame => {
    if (frame.previewURL) URL.revokeObjectURL(frame.previewURL);
    Object.values(frame.previewURLs || {}).forEach(url => URL.revokeObjectURL(url));
  });
  resultURLs.forEach(url => URL.revokeObjectURL(url));
  wasmObjectURL && URL.revokeObjectURL(wasmObjectURL);
});
