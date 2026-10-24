/* ---------- 进度 ---------- */
function setStatus(t){ $("status").textContent = t; }
function setProgressValue(value){
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  $("progressBar").style.width = percent.toFixed(1)+"%";
  $("progress").setAttribute("aria-valuenow", String(Math.round(percent)));
}
function showProgress(on){ $("progress").style.display = on ? "block" : "none"; if(!on) setProgressValue(0); }
function setWriteProgress(r){ setProgressValue(r*50); }
function setRunProgress(r){ const v = Number.isFinite(r) ? Math.min(1,Math.max(0,r)) : 0; setProgressValue(50 + v*50); }

function apngRiskBytes(){
  if (!frames.length || !frames[0]) return 0;
  return frames[0].width * frames[0].height * 4 * frames.length;
}

function encoderFailureMessage(format, err){
  const label = format === "dual-mp4" ? "双通道 MP4" : format.toUpperCase();
  const errorLogs = ffmpegLogBuffer
    .map(item => item.message)
    .filter(message => /error|failed|invalid|cannot|unable|unsupported|memory|allocate|muxer|conversion failed|aborted/i.test(message));
  const detail = errorLogs.slice(-3).join(" · ");
  if (/memory|allocate|out of memory/i.test(detail)) {
    return label + " 编码失败：浏览器内存不足，建议减少帧数/尺寸或改用 WebP";
  }
  if (detail) return label + " 编码失败：" + detail;
  return "导出失败：" + (err.message || err);
}

function updateEncodingStatus(){
  if (!ffmpegProgressVisible || !activeExportFormat) return;
  const elapsed = Math.max(0, Math.round((performance.now() - encodingStartedAt) / 1000));
  const percent = Math.round(encodingProgress * 100);
  const progressText = percent > 0 ? percent + "%" : "处理中";
  setStatus("正在编码 " + activeExportFormat.toUpperCase() + "… " + progressText + " · 已用 " + elapsed + " 秒");
}

function startEncodingFeedback(format, fps){
  activeExportFormat = format;
  encodingProgress = 0;
  encodingStartedAt = performance.now();
  encodingDuration = animationModel.timelineMode === "preserve-source"
    ? timelineDurationUs() / 1000000
    : frames.length / Math.max(1, fps);
  ffmpegProgressVisible = true;
  clearInterval(encodingStatusTimer);
  updateEncodingStatus();
  encodingStatusTimer = setInterval(updateEncodingStatus, 1000);
}

function stopEncodingFeedback(){
  ffmpegProgressVisible = false;
  activeExportFormat = "";
  encodingDuration = 0;
  clearInterval(encodingStatusTimer);
  encodingStatusTimer = null;
}

function normalizeNumberInput(id, min, max, fallback){
  const input = $(id);
  const parsed = Number.parseInt(input.value, 10);
  const value = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  input.value = String(value);
  return value;
}

function syncWebpQuality(raw = $("webpQuality").value){
  const parsed = Number.parseInt(raw, 10);
  const value = Number.isFinite(parsed)
    ? Math.min(100, Math.max(1, parsed))
    : WEBP_QUALITY_DEFAULT;
  $("webpQuality").value = String(value);
  $("webpQualityValue").textContent = String(value);
  document.querySelectorAll("[data-webp-quality]").forEach(button => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.webpQuality) === value));
  });
  return value;
}

function safeOutputBase(raw){
  let name = String(raw || "").normalize("NFKC").trim();
  name = name.replace(/\.(?:gif|webp|apng|png|mp4)$/i, "");
  name = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/[. ]+$/g, "").trim();
  name = name.slice(0, 80).trim();
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name += "_";
  return name || "动画";
}

function buildConcatManifest(frameNames, model = animationModel){
  const lines = [];
  frameNames.forEach((name, index) => {
    const safeName = String(name).replace(/'/g, "'\\''");
    lines.push("file '" + safeName + "'");
    const durationUs = model.frames[index] ? Math.max(1, Number(model.frames[index].durationUs) || 0) : 0;
    if (durationUs > 0) lines.push("duration " + (durationUs / 1000000).toFixed(6));
  });
  if (frameNames.length) {
    const last = String(frameNames[frameNames.length - 1]).replace(/'/g, "'\\''");
    lines.push("file '" + last + "'");
  }
  return lines.join("\n") + "\n";
}

async function buildYYEVATransparentMP4Metadata(width, height, fps){
  // Matches the official YY-MP4 ordinary-alpha descriptor (AE_Extension_Version=1).
  const metadata = {
    descript: {
      width,
      height,
      isEffect: 0,
      version: 1,
      alphaFrame: [width / 2, 0, width / 2, height],
      rgbFrame: [0, 0, width / 2, height],
      fps,
      hasAudio: false,
      effect: [],
      datas: []
    }
  };
  if (typeof CompressionStream !== "function") {
    throw new Error("当前浏览器不支持本地 YYEVA 元数据压缩，请更新 Chrome 或 Safari 后重试");
  }
  const jsonBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const stream = new Blob([jsonBytes]).stream().pipeThrough(new CompressionStream("deflate"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < compressed.length; offset += 0x8000) {
    binary += String.fromCharCode(...compressed.subarray(offset, offset + 0x8000));
  }
  return "yyeffectmp4json[[" + btoa(binary) + "]]yyeffectmp4json";
}

/* ---------- 导出（直接合成 + 自动下载） ---------- */
async function exportAnim(format){
  if (!frames.length) return;
  const fps = normalizeNumberInput("fps", 1, 120, 30);
  const loop = normalizeNumberInput("loop", 0, 9999, 0);
  const preserveSourceTimeline = animationModel.timelineMode === "preserve-source";
  const webpQuality = syncWebpQuality();
  const base = safeOutputBase($("baseName").value);
  $("baseName").value = base;
  const outName = format === "dual-mp4" ? `${base}_frameflow.mp4` : `${base}.${format}`;

  showProgress(true);
  setExportDisabled(true);
  try {
    const ff = await ensureFFmpeg();
    ffmpegLogBuffer = [];
    // 清理上一轮残留：内核虚拟文件系统是累加的，不删会导致旧帧混入新动画
    for (const f of lastFrameFiles){ try { await ff.deleteFile(f); } catch(_){} }
    lastFrameFiles = [];
    setStatus(`写入 ${frames.length} 帧…`);
    for (let i=0;i<frames.length;i++){
      const name = `frame_${String(i+1).padStart(pad,"0")}.png`;
      lastFrameFiles.push(name);
      const buf  = await frames[i].file.arrayBuffer();
      await ff.writeFile(name, new Uint8Array(buf));
      setWriteProgress((i+1)/frames.length);
    }
    let inputArgs;
    if (preserveSourceTimeline) {
      const concatName = "timeline_" + importVersion + ".txt";
      lastFrameFiles.push(concatName);
      const frameNames = frames.map((_, index) => "frame_" + String(index + 1).padStart(pad, "0") + ".png");
      await ff.writeFile(concatName, new TextEncoder().encode(buildConcatManifest(frameNames)));
      inputArgs = ["-f", "concat", "-safe", "0", "-i", concatName];
      if (format !== "dual-mp4") inputArgs.push("-vsync", "0");
    } else {
      inputArgs = ["-framerate", String(fps), "-i", "frame_%0" + pad + "d.png"];
    }
    const largeApng = format === "apng" && apngRiskBytes() >= LARGE_IMPORT_BYTES;
    startEncodingFeedback(format === "dual-mp4" ? "MP4" : format, fps);
    if (largeApng) setStatus("正在编码 APNG… 0% · 序列较大，可能需要较长时间");
    let args = inputArgs;
    lastFrameFiles.push(outName);
    if (format === "gif")       args.push("-filter_complex","split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128","-loop",String(loop), outName);
    else if (format === "webp") args.push("-pix_fmt","yuva420p","-loop",String(loop),"-q:v",String(webpQuality), outName);
    else if (format === "apng") args.push("-vf","format=rgba","-f","apng","-plays",String(loop), outName);
    else if (format === "dual-mp4") {
      const duration = (timelineDurationUs() / 1000000).toFixed(6);
      const outputWidth = frames[0].width * 2;
      const outputHeight = frames[0].height + (frames[0].height % 2);
      const sourceFps = animationDisplayFps() || fps;
      const metadata = await buildYYEVATransparentMP4Metadata(outputWidth, outputHeight, sourceFps);
      // Matches the official YY-MP4 default mid-quality H.264 settings.
      const x264Params = "me=umh:scenecut=60:ref=4:deblock=1:bframes=3:keyint=300:keyint_min=1:qcomp=0.50:aq-mode=2:aq-strength=0.8:psy_rd=0.3";
      const graph = "[0:v]format=rgba,split=2[colorSrc][alphaSrc];"
        + "[colorSrc]premultiply=inplace=1,format=rgb24[color];"
        + "[alphaSrc]alphaextract,format=rgb24[alpha];"
        + "[color][alpha]hstack=inputs=2,pad=iw:ceil(ih/2)*2:0:0:color=black,format=yuv420p[out]";
      args.push(
        "-filter_complex", graph,
        "-map", "[out]",
        "-metadata", "mergeinfo=" + metadata,
        "-an",
        "-fps_mode", "vfr",
        "-t", duration,
        "-c:v", "libx264",
        "-x264-params", x264Params,
        "-crf", "23.5",
        "-preset", "5",
        "-pix_fmt", "yuv420p",
        "-movflags", "+use_metadata_tags",
        outName
      );
    }
    const exitCode = await ff.exec(args);
    if (exitCode !== 0) throw new Error(`编码器退出码 ${exitCode}`);
    const data = await ff.readFile(outName);
    try { await ff.deleteFile(outName); } catch(_){}
    const mime = format==="gif" ? "image/gif" : format==="webp" ? "image/webp" : format==="dual-mp4" ? "video/mp4" : "image/png";
    triggerDownload(outName, new Blob([data], { type:mime }));
    setStatus(`${format === "dual-mp4" ? "双通道 MP4" : format.toUpperCase()} 已导出并下载`);
    toast(`${outName} 已生成`);
  } catch(err){
    console.error(err);
    setStatus(encoderFailureMessage(format, err));
    toast("导出失败，可修正参数后直接重试");
  } finally {
    stopEncodingFeedback();
    showProgress(false);
    setExportDisabled(false);
  }
}

const ZIP_CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    table[n] = value >>> 0;
  }
  return table;
})();

async function crc32Blob(blob){
  let crc = 0xffffffff;
  const consume = chunk => {
    for (const byte of chunk) crc = ZIP_CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  };
  if (blob.stream && typeof blob.stream === "function") {
    const reader = blob.stream().getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) consume(value);
      }
    } finally {
      reader.releaseLock?.();
    }
  } else {
    consume(new Uint8Array(await blob.arrayBuffer()));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipHeader(size){
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

async function buildPngSequenceZip(frameList, baseName){
  if (frameList.length > 65535) throw new Error("PNG 序列超过 ZIP 标准格式可容纳的 65,535 帧");
  const encoder = new TextEncoder();
  const digits = Math.max(4, String(frameList.length).length);
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (let index = 0; index < frameList.length; index += 1) {
    const file = frameList[index].file;
    const fileSize = file.size;
    const fileName = `${baseName}_${String(index + 1).padStart(digits, "0")}.png`;
    const nameBytes = encoder.encode(fileName);
    if (nameBytes.length > 65535 || fileSize > 0xffffffff) throw new Error("帧名称或单帧大小超出 ZIP 标准格式限制");
    if (localOffset + 30 + nameBytes.length + fileSize > 0xffffffff) throw new Error("PNG 序列 ZIP 超过 4 GB，当前浏览器导出不支持 ZIP64");
    const crc = await crc32Blob(file);

    const local = zipHeader(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x0800, true);
    local.view.setUint16(8, 0, true);
    local.view.setUint16(10, dosTime, true);
    local.view.setUint16(12, dosDate, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, fileSize, true);
    local.view.setUint32(22, fileSize, true);
    local.view.setUint16(26, nameBytes.length, true);
    local.view.setUint16(28, 0, true);
    localParts.push(local.bytes, nameBytes, file);

    const central = zipHeader(46);
    central.view.setUint32(0, 0x02014b50, true);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint16(8, 0x0800, true);
    central.view.setUint16(10, 0, true);
    central.view.setUint16(12, dosTime, true);
    central.view.setUint16(14, dosDate, true);
    central.view.setUint32(16, crc, true);
    central.view.setUint32(20, fileSize, true);
    central.view.setUint32(24, fileSize, true);
    central.view.setUint16(28, nameBytes.length, true);
    central.view.setUint16(30, 0, true);
    central.view.setUint16(32, 0, true);
    central.view.setUint16(34, 0, true);
    central.view.setUint16(36, 0, true);
    central.view.setUint32(38, 0, true);
    central.view.setUint32(42, localOffset, true);
    centralParts.push(central.bytes, nameBytes);
    localOffset += 30 + nameBytes.length + fileSize;

    setProgressValue(50 + ((index + 1) / frameList.length) * 50);
    setStatus(`正在打包 PNG 序列… ${index + 1}/${frameList.length} 帧`);
    if (index % 8 === 7) await new Promise(resolve => requestAnimationFrame(resolve));
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  if (localOffset + centralSize + 22 > 0xffffffff) throw new Error("PNG 序列 ZIP 超过 4 GB，当前浏览器导出不支持 ZIP64");
  const end = zipHeader(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(4, 0, true);
  end.view.setUint16(6, 0, true);
  end.view.setUint16(8, frameList.length, true);
  end.view.setUint16(10, frameList.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, localOffset, true);
  end.view.setUint16(20, 0, true);
  return new Blob([...localParts, ...centralParts, end.bytes], { type:"application/zip" });
}

async function exportPngSequence(){
  if (!frames.length) return;
  const base = safeOutputBase($("baseName").value);
  $("baseName").value = base;
  const outName = `${base}_PNG序列帧.zip`;
  showProgress(true);
  setExportDisabled(true);
  setProgressValue(50);
  try {
    const zip = await buildPngSequenceZip(frames, base);
    triggerDownload(outName, zip);
    setProgressValue(100);
    setStatus(`PNG 序列 ZIP 已导出：${frames.length} 帧`);
    toast(`${outName} 已生成`);
  } catch (error) {
    console.error(error);
    setStatus(`PNG 序列 ZIP 导出失败：${error.message || error}`);
    toast("PNG 序列 ZIP 导出失败");
  } finally {
    showProgress(false);
    setExportDisabled(false);
  }
}


function triggerDownload(name, blob){
  const url = URL.createObjectURL(blob);
  resultURLs.push(url);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  try {
    const match = name.match(/\.(gif|webp|apng|mp4)$/i);
    const kind = /\.zip$/i.test(name) ? "zip" : match ? match[1].toLowerCase() : "other";
    window.ffCountExport?.(frames.length, kind, animationModel.sourceType);
  } catch (_) {}
  const fmt = b => b >= 1048576 ? (b/1048576).toFixed(2)+" MB" : b >= 1024 ? (b/1024).toFixed(0)+" KB" : b+" B";
  const link = document.createElement("a");
  link.className = "result";
  link.href = url;
  link.download = name;
  link.title = `再次下载 ${name}`;
  const nameText = document.createElement("span");
  nameText.className = "name";
  nameText.textContent = name;
  const sizeText = document.createElement("span");
  sizeText.className = "size";
  sizeText.textContent = `${fmt(blob.size)} · 点击可再下载`;
  link.append(nameText, sizeText);
  $("results").prepend(link);
}

function setExportDisabled(on){
  ["exGif","exWebp","exApng","exMp4","exPngSequence"].forEach(id => $(id).disabled = on);
  $("configCard").setAttribute("aria-busy", String(on));
}

$("exGif").onclick  = () => exportAnim("gif");
$("exWebp").onclick = () => exportAnim("webp");
$("exApng").onclick = () => exportAnim("apng");
$("exMp4").onclick = () => exportAnim("dual-mp4");
$("exPngSequence").onclick = exportPngSequence;
