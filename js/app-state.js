// ffmpeg.wasm 0.12 单线程内核（已自托管于 libs/ffmpeg/，无需外部 CDN）
let frames = [];
let animationModel = createEmptyAnimationModel();

function createEmptyAnimationModel(){
  return {
    sourceType: "none",
    timelineMode: "fixed-fps",
    loopCount: 0,
    sourceFile: null,
    canvas: { width: 0, height: 0, hasAlpha: true },
    frames: []
  };
}

function currentSequenceFps(){
  return Math.min(120, Math.max(1, Number.parseInt($("fps").value, 10) || 30));
}

function syncPngSequenceAnimationModel(){
  const fps = currentSequenceFps();
  const durationUs = 1000000 / fps;
  const first = frames[0];
  animationModel = {
    sourceType: "png-sequence",
    timelineMode: "fixed-fps",
    loopCount: 0,
    canvas: {
      width: first?.width || 0,
      height: first?.height || 0,
      hasAlpha: true
    },
    frames: frames.map((frame, index) => ({
      index,
      source: frame,
      durationUs
    }))
  };
}

function timelineDurationUs(model = animationModel){
  return model.frames.reduce((total, frame) => total + Math.max(1, Number(frame.durationUs) || 0), 0);
}

function timelineFrameIndexAt(elapsedMs, model = animationModel){
  if (!model.frames.length) return 0;
  const totalUs = timelineDurationUs(model);
  let cursorUs = (Math.max(0, elapsedMs) * 1000) % totalUs;
  for (let index = 0; index < model.frames.length; index++) {
    const durationUs = Math.max(1, Number(model.frames[index].durationUs) || 0);
    if (cursorUs < durationUs) return index;
    cursorUs -= durationUs;
  }
  return model.frames.length - 1;
}

function timelineOffsetUs(index, model = animationModel){
  return model.frames
    .slice(0, Math.max(0, Math.min(index, model.frames.length)))
    .reduce((total, frame) => total + Math.max(1, Number(frame.durationUs) || 0), 0);
}

// file:// 双击打开时浏览器会拦截 Worker，给出明确提示并指向在线链接
if (location.protocol === "file:") {
  const w = document.getElementById("fileWarn");
  if (w) w.style.display = "block";
}
let resultURLs = [];
let ffmpeg = null;
let ffmpegLoading = null;
let wasmObjectURL = null;
let pad = 4;
let importVersion = 0;
let previewVersion = 0;
let suggestedBaseName = "动画";
let previewIndex = 0;
let previewRAF = 0;
let previewPlaying = false;
let previewStartTime = 0;
let previewDrag = null;
let previewGeometryCustom = false;
let lastFrameFiles = [];   // 上一轮写入内核的帧文件名，导出前清理以免混入
let ffmpegLogBuffer = [];
let mp4ImportState = null;
let pendingMP4File = null;
let ffmpegProgressVisible = false;
let activeExportFormat = "";
let encodingProgress = 0;
let encodingStartedAt = 0;
let encodingDuration = 0;
let encodingStatusTimer = null;
const PNG_SIGNATURE = [137,80,78,71,13,10,26,10];
const LARGE_IMPORT_BYTES = 512 * 1024 * 1024;
const ANIMATION_WARN_PIXEL_BYTES = 512 * 1024 * 1024;
const ANIMATION_MAX_PIXEL_BYTES = 2 * 1024 * 1024 * 1024;
const PREVIEW_SIZE = 176;  // 2x 88px 缩略图，兼顾 Retina 清晰度与内存占用
const WEBP_QUALITY_DEFAULT = 80;

const $ = id => document.getElementById(id);
const drop = $("drop");
const toast = (msg) => {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._t); t._t = setTimeout(()=>t.classList.remove("show"), 2600);
};
function setUploadProgress(value){
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  $("uploadProgressBar").style.width = percent.toFixed(1)+"%";
  $("uploadProgress").setAttribute("aria-valuenow", String(Math.round(percent)));
}
function setUploadStatus(text){ $("uploadStatus").textContent = text; }
function showUploadState(on, text = "", progress = 0){
  $("uploadState").style.display = on ? "block" : "none";
  if (on) { setUploadProgress(progress); setUploadStatus(text); }
}
function finishUploadState(text, keepVisible = false){
  setUploadProgress(keepVisible ? 0 : 100);
  setUploadStatus(text);
  if (!keepVisible) setTimeout(() => showUploadState(false), 900);
}
