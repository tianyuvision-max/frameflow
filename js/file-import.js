/* ---------- 导入 ---------- */
$("pickFolder").onclick = async () => {
  if (typeof window.showDirectoryPicker !== "function") {
    $("folderInput").click();
    return;
  }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ mode: "read" });
  } catch (err) {
    if (err && err.name === "AbortError") return;
    console.warn("原生目录选择器不可用，切换到兼容模式", err);
    $("folderInput").click();
    return;
  }
  const files = [];
  showUploadState(true, "正在读取文件夹…", 8);
  try {
    await traverseHandle(handle, files, handle.name);
  } catch (err) {
    console.warn("目录句柄读取失败，切换到兼容模式", err);
    showUploadState(false);
    $("folderInput").click();
    return;
  }
  ingest(files);
};
$("pickFiles").onclick  = () => $("filesInput").click();
$("folderInput").onchange = e => { ingest(Array.from(e.target.files)); e.target.value = ""; };
$("filesInput").onchange  = e => { ingest(Array.from(e.target.files)); e.target.value = ""; };
$("fps").addEventListener("input", () => {
  syncPngSequenceAnimationModel();
  if (frames.length) {
    renderCurrentDiagnostics();
    renderSourceMode();
  }
  updatePreviewDuration();
});
$("webpQuality").addEventListener("input", () => syncWebpQuality());
document.querySelectorAll("[data-webp-quality]").forEach(button => {
  button.addEventListener("click", () => syncWebpQuality(button.dataset.webpQuality));
});

drop.onclick = (e) => { if (!e.target.closest("button,select,input,label")) $("filesInput").click(); };
drop.onkeydown = (e) => {
  if (e.target !== drop) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    $("filesInput").click();
  }
};
["dragenter","dragover"].forEach(ev => drop.addEventListener(ev, e=>{ e.preventDefault(); drop.classList.add("over"); }));
["dragleave","drop"].forEach(ev => drop.addEventListener(ev, e=>{ e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", async e => {
  e.preventDefault();
  const dt = e.dataTransfer;
  let files = [];
  const directFiles = Array.from(dt.files || []);
  const directPngFiles = directFiles.filter(file => /\.png$/i.test(file.name));
  const dragItems = Array.from(dt.items || []);
  // Chrome 要求在 drop 事件的同一轮同步取得 handle Promise，不能等异步读取后再调用。
  const handlePromises = dragItems
    .filter(item => typeof item.getAsFileSystemHandle === "function")
    .map(item => item.getAsFileSystemHandle());
  const legacyEntries = dragItems
    .map(item => typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null)
    .filter(Boolean);
  showUploadState(true, "正在读取文件夹…", 8);
  try {
    if (handlePromises.length) {
      const handles = (await Promise.all(handlePromises)).filter(Boolean);
      for (const handle of handles) await traverseHandle(handle, files, handle.name);
    }
    if (!files.length && legacyEntries.length) {
      for (const entry of legacyEntries) await traverseEntry(entry, files);
    }
    if (!files.length) {
      if (directPngFiles.length) {
        files = directFiles;
      } else if (!legacyEntries.length && !handlePromises.length) {
        files = directFiles;
      } else {
        throw new Error("浏览器未返回目录中的 PNG 文件");
      }
    }
  } catch (err) {
    console.warn("拖拽目录读取失败，尝试使用浏览器直接提供的文件列表", err);
    if (directPngFiles.length) {
      files = directFiles;
      setUploadStatus("目录接口响应异常，已切换兼容读取模式…");
    } else {
      finishUploadState("文件夹读取失败，请改用“选择文件夹”按钮", true);
      setStatus("导入失败：Chrome 未返回目录中的 PNG 文件");
      toast("文件夹读取失败");
      return;
    }
  }
  ingest(files);
});

const ENTRY_READ_TIMEOUT = 8000;
function readEntryFile(entry){
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => finish(reject)(new Error("文件读取超时")), ENTRY_READ_TIMEOUT);
    try {
      entry.file(finish(resolve), finish(reject));
    } catch (err) {
      finish(reject)(err);
    }
  });
}

function readEntryBatch(reader){
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => finish(reject)(new Error("目录读取超时")), ENTRY_READ_TIMEOUT);
    try {
      reader.readEntries(finish(resolve), finish(reject));
    } catch (err) {
      finish(reject)(err);
    }
  });
}

function recordDroppedFile(file, relativePath, out){
  if (relativePath) filePathMap.set(file, relativePath);
  out.push(file);
  setUploadProgress(Math.min(35, 8 + out.length / 10));
  setUploadStatus("正在读取文件夹… 已读取 " + out.length + " 个文件");
}

function readWithTimeout(promise, message){
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ENTRY_READ_TIMEOUT);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

async function traverseHandle(handle, out, relativePath){
  if (handle.kind === "file") {
    const file = await readWithTimeout(handle.getFile(), "文件读取超时");
    recordDroppedFile(file, relativePath, out);
  } else if (handle.kind === "directory") {
    if (typeof handle.entries !== "function") throw new Error("浏览器不支持目录句柄读取");
    for await (const [name, child] of handle.entries()) {
      await traverseHandle(child, out, relativePath + "/" + name);
    }
  }
}

async function traverseEntry(entry, out){
  if (entry.isFile) {
    const file = await readEntryFile(entry);
    recordDroppedFile(file, entry.fullPath, out);
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    while (true) {
      const batch = await readEntryBatch(reader);
      if (!batch.length) break;
      for (const child of batch) await traverseEntry(child, out);
    }
  }
}

function naturalCompare(a, b){ return a.localeCompare(b, undefined, { numeric:true, sensitivity:"base" }); }

const filePathMap = new WeakMap();
function filePath(file){ return file.webkitRelativePath || filePathMap.get(file) || file.name; }
function fileSortKey(file){ return filePath(file); }

function pathParts(file){
  return filePath(file).replace(/^\/+/, "").split("/").filter(Boolean);
}

function formatDuration(seconds){
  if (!Number.isFinite(seconds)) return "—";
  return seconds >= 60
    ? Math.floor(seconds / 60) + "分" + Math.round(seconds % 60) + "秒"
    : seconds.toFixed(seconds < 10 ? 2 : 1) + "秒";
}

function formatByteSize(bytes){
  if (!Number.isFinite(bytes) || bytes < 0) return "未知";
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + " GB";
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + " MB";
  if (bytes >= 1024) return Math.round(bytes / 1024) + " KB";
  return bytes + " B";
}

function estimateAnimationPixelBytes(meta){
  return meta.width * meta.height * meta.durationsUs.length * 4;
}

function approvePixelMemory(pixelBytes){
  if (!Number.isFinite(pixelBytes) || pixelBytes > ANIMATION_MAX_PIXEL_BYTES) {
    throw new Error("预计解码像素内存超过 2 GB，已阻止导入以避免页面崩溃；请减少帧数或降低画布尺寸");
  }
  if (pixelBytes > ANIMATION_WARN_PIXEL_BYTES) {
    const estimate = formatByteSize(pixelBytes);
    if (!window.confirm("该动画展开为完整 RGBA 帧后，理论像素数据约 " + estimate + "。实际峰值会因编码和浏览器而变化，继续可能明显占用内存。\n\n仍要继续导入吗？")) {
      throw new Error("已取消导入：预计解码像素数据约 " + estimate);
    }
  }
  return pixelBytes;
}

function approveAnimationMemory(meta){
  if (meta.file.size > LARGE_IMPORT_BYTES) {
    throw new Error("动画文件超过 512 MB 的本地解析保护上限，请先压缩或降低分辨率后再导入");
  }
  return approvePixelMemory(estimateAnimationPixelBytes(meta));
}

function analyzeSequence(items){
  const records = items.map(item => {
    const stem = item.file.name.replace(/\.[^.]+$/, "");
    const match = stem.match(/(\d+)(?!.*\d)/);
    const parts = pathParts(item.file);
    return {
      item,
      parts,
      number: match ? Number(match[1]) : null,
      padding: match ? match[1].length : null
    };
  });
  const numbered = records.filter(record => Number.isSafeInteger(record.number));
  const numberMap = new Map();
  numbered.forEach(record => {
    const list = numberMap.get(record.number) || [];
    list.push(record.item.file.name);
    numberMap.set(record.number, list);
  });
  const duplicateGroups = [...numberMap.entries()].filter(([, names]) => names.length > 1);
  const uniqueNumbers = [...numberMap.keys()].sort((a, b) => a - b);
  const missingNumbers = [];
  for (let i = 1; i < uniqueNumbers.length && missingNumbers.length < 20; i++) {
    const start = uniqueNumbers[i - 1] + 1;
    const end = uniqueNumbers[i];
    for (let value = start; value < end && missingNumbers.length < 20; value++) missingNumbers.push(value);
  }
  const roots = [...new Set(records.map(record => record.parts.length > 1 ? record.parts[0] : "").filter(Boolean))];
  const paddingLengths = new Set(numbered.map(record => record.padding));
  const warnings = [];
  if (!numbered.length) warnings.push("未能从文件名识别帧号，将按自然排序处理");
  else if (numbered.length < records.length) warnings.push("有 " + (records.length - numbered.length) + " 个文件未识别帧号");
  if (missingNumbers.length) warnings.push("缺少帧号：" + missingNumbers.join("、") + (missingNumbers.length === 20 ? "…" : ""));
  if (duplicateGroups.length) warnings.push("重复帧号：" + duplicateGroups.map(([number]) => number).join("、"));
  if (roots.length > 1) warnings.push("检测到多个文件夹来源：" + roots.join("、"));
  if (paddingLengths.size > 1 && numbered.length === records.length) warnings.push("帧号补零位数不一致");
  const fps = Math.min(120, Math.max(1, Number.parseInt($("fps").value, 10) || 30));
  return {
    warnings,
    numberedCount: numbered.length,
    firstNumber: uniqueNumbers[0],
    lastNumber: uniqueNumbers[uniqueNumbers.length - 1],
    duplicateGroups,
    missingNumbers,
    roots,
    estimatedDuration: items.length / fps
  };
}

function renderDiagnostics(diagnostic){
  const box = $("diagnostics");
  box.replaceChildren();
  box.className = "diagnostics " + (diagnostic.warnings.length ? "warn" : "ok");
  box.hidden = false;

  const mark = document.createElement("span");
  mark.className = "diagnostics-mark";
  mark.textContent = diagnostic.warnings.length ? "⚠" : "✓";
  const main = document.createElement("div");
  main.className = "diagnostics-main";
  const title = document.createElement("span");
  title.className = "diagnostics-title";
  const animationTitles = { gif: "GIF 动画已读取", webp: "WebP 动画已读取", apng: "APNG 动画已读取", svga: "SVGA 动画已读取", "yyeva-mp4": "双通道 MP4 已还原" };
  if (animationTitles[animationModel.sourceType]) title.textContent = animationTitles[animationModel.sourceType];
  else if (!diagnostic.numberedCount) title.textContent = "序列已读取";
  else if (diagnostic.warnings.length) title.textContent = "文件检查发现可能存在的问题";
  else title.textContent = "序列连续 " + diagnostic.firstNumber + "–" + diagnostic.lastNumber;
  const meta = document.createElement("span");
  meta.className = "diagnostics-meta";
  meta.textContent = frames.length + " 帧 · " + formatDuration(diagnostic.estimatedDuration);
  main.append(title, meta);

  if (diagnostic.warnings.length) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "查看 " + diagnostic.warnings.length + " 项提醒";
    const list = document.createElement("ul");
    diagnostic.warnings.forEach(warning => {
      const item = document.createElement("li");
      item.textContent = warning;
      list.appendChild(item);
    });
    details.append(summary, list);
    main.appendChild(details);
  }
  box.append(mark, main);
}

function suggestOutputBase(files){
  const paths = files.map(pathParts);
  const roots = paths.map(parts => parts.length > 1 ? parts[0] : null);
  if (roots.length && roots.every(root => root && root === roots[0])) return safeOutputBase(roots[0]);
  if (files.length === 1) return safeOutputBase(files[0].name.replace(/\.[^.]+$/, ""));
  return "动画";
}

function applySuggestedOutputName(name){
  const input = $("baseName");
  const current = input.value.trim();
  if (!current || current === suggestedBaseName) input.value = name;
  suggestedBaseName = name;
}

function setTimelineModeUI(){
  const sourceAnimation = animationModel.timelineMode === "preserve-source";
  const fpsInput = $("fps");
  const fpsField = $("fpsField");
  const webpQualityField = $("webp-quality-field");
  if (fpsField) fpsField.hidden = false;
  if (webpQualityField) webpQualityField.hidden = false;
  fpsInput.disabled = sourceAnimation;
  fpsInput.setAttribute("aria-readonly", String(sourceAnimation));
  fpsInput.title = sourceAnimation ? "动画文件模式会保留源文件逐帧时长" : "";
  if (sourceAnimation) {
    const actualFps = animationDisplayFps();
    fpsInput.value = actualFps ? formatFpsValue(actualFps) : "";
    fpsField.querySelector("label").textContent = animationModel.hasVariableFrameDurations
      ? "平均帧频·可变帧时长"
      : "帧频";
    $("fpsHint").textContent = "当前不可修改帧速率";
  } else {
    fpsField.querySelector("label").textContent = "帧频";
    $("fpsHint").textContent = "每秒播放帧数";
  }
  ["exGif", "exWebp", "exApng"].forEach(id => {
    const button = $(id);
    button.title = sourceAnimation ? "将保留源动画的逐帧时长" : "";
  });
  setExportFormatsUI();
}

function setExportFormatsUI(){
  const sourceType = animationModel.sourceType;
  $("exGif").hidden = sourceType === "gif";
  // WebP 同格式重新导出用于调整质量，因此保留此选项。
  $("exWebp").hidden = false;
  $("exApng").hidden = sourceType === "apng";
  $("exMp4").hidden = sourceType === "yyeva-mp4";
  $("exPngSequence").hidden = sourceType === "png-sequence";
  $("exMp4").title = "将彩色画面与 Alpha 蒙版并排编码为 H.264 MP4；输出宽度为画布的两倍";
}

function animationDisplayFps(model = animationModel){
  if (!model.frames.length) return 0;
  const totalUs = timelineDurationUs(model);
  if (!totalUs) return 0;
  const firstDuration = Number(model.frames[0].durationUs) || 0;
  const uniform = model.frames.every(frame => Math.abs((Number(frame.durationUs) || 0) - firstDuration) < 0.5);
  return uniform && firstDuration > 0
    ? 1000000 / firstDuration
    : model.frames.length / (totalUs / 1000000);
}

function formatFpsValue(fps){
  if (!Number.isFinite(fps) || fps <= 0) return "";
  return Math.abs(fps - Math.round(fps)) < 0.005 ? String(Math.round(fps)) : fps.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function renderCurrentDiagnostics(){
  if (animationModel.sourceType !== "png-sequence") {
    renderDiagnostics({
      warnings: animationModel.warnings || [],
      numberedCount: 0,
      firstNumber: null,
      lastNumber: null,
      estimatedDuration: timelineDurationUs() / 1000000
    });
    return;
  }
  renderDiagnostics(analyzeSequence(frames));
}

function clearLoadedAnimation(){
  closePreview();
  previewVersion++;
  prunePreviewBitmapCache(new Set());
  frames.forEach(frame => {
    if (frame.previewURL) URL.revokeObjectURL(frame.previewURL);
    Object.values(frame.previewURLs || {}).forEach(url => URL.revokeObjectURL(url));
  });
  resultURLs.forEach(url => URL.revokeObjectURL(url));
  resultURLs = [];
  frames = [];
  animationModel = createEmptyAnimationModel();
  setExportFormatsUI();
  $("results").replaceChildren();
  $("grid").replaceChildren();
}
