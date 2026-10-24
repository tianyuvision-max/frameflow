const MP4_IMPORT_MAX_FILE_BYTES = 512 * 1024 * 1024;
const MP4_IMPORT_MAX_FRAMES = 5000;

function waitForVideoEvent(video, eventName, timeoutMs = 12000){
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(eventName, onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("浏览器无法读取这个 MP4 视频")); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("读取 MP4 视频超时，请确认文件完整后重试"));
    }, timeoutMs);
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function halfChromaScore(imageData, startX, width, height){
  const { data, width: imageWidth } = imageData;
  let chromaTotal = 0;
  let visiblePixels = 0;
  let saturatedPixels = 0;
  let sampledPixels = 0;
  for (let y = 0; y < height; y += 3) {
    for (let x = startX; x < startX + width; x += 3) {
      const offset = (y * imageWidth + x) * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const brightness = (red + green + blue) / 3;
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      sampledPixels += 1;
      if (brightness < 18) continue;
      visiblePixels += 1;
      chromaTotal += chroma;
      if (chroma >= 18) saturatedPixels += 1;
    }
  }
  return {
    meanChroma: visiblePixels ? chromaTotal / visiblePixels : 0,
    visibleRatio: sampledPixels ? visiblePixels / sampledPixels : 0,
    saturatedRatio: visiblePixels ? saturatedPixels / visiblePixels : 0
  };
}

async function inspectDualChannelMP4(file){
  if (file.size > MP4_IMPORT_MAX_FILE_BYTES) {
    throw new Error("MP4 文件超过 512 MB 的本地解析保护上限，请先压缩后重试");
  }
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      await waitForVideoEvent(video, "loadedmetadata");
    }
    const width = Number(video.videoWidth);
    const height = Number(video.videoHeight);
    const duration = Number(video.duration);
    if (!Number.isSafeInteger(width) || width < 2 || width % 2 !== 0 || !Number.isSafeInteger(height) || height < 1) {
      throw new Error("双通道视频尺寸无效：宽度必须为可均分的偶数");
    }
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("MP4 视频时长无效或无法读取");
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitForVideoEvent(video, "loadeddata");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器无法分析 MP4 帧");
    const times = [...new Set([0.15, 0.3, 0.5, 0.7, 0.85].map(ratio =>
      Math.min(Math.max(0, duration - 0.04), Math.max(0, duration * ratio))
    ))];
    let leftChroma = 0;
    let rightChroma = 0;
    let leftSaturation = 0;
    let rightSaturation = 0;
    let usefulSamples = 0;
    for (const time of times) {
      if (Math.abs(video.currentTime - time) > 0.001) {
        const seeked = waitForVideoEvent(video, "seeked");
        video.currentTime = time;
        await seeked;
      }
      context.drawImage(video, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height);
      const left = halfChromaScore(pixels, 0, width / 2, height);
      const right = halfChromaScore(pixels, width / 2, width / 2, height);
      if (left.visibleRatio < 0.002 && right.visibleRatio < 0.002) continue;
      leftChroma += left.meanChroma;
      rightChroma += right.meanChroma;
      leftSaturation += left.saturatedRatio;
      rightSaturation += right.saturatedRatio;
      usefulSamples += 1;
    }
    if (!usefulSamples) {
      return { width, height, duration, alphaSide: null, confidence: 0 };
    }
    leftChroma /= usefulSamples;
    rightChroma /= usefulSamples;
    leftSaturation /= usefulSamples;
    rightSaturation /= usefulSamples;
    const lowerChroma = Math.min(leftChroma, rightChroma);
    const higherChroma = Math.max(leftChroma, rightChroma);
    const difference = higherChroma - lowerChroma;
    const ratio = higherChroma / Math.max(1, lowerChroma);
    const clear = difference >= 8 && ratio >= 1.45 && Math.max(leftSaturation, rightSaturation) >= 0.025;
    return {
      width,
      height,
      duration,
      alphaSide: clear ? (leftChroma < rightChroma ? "left" : "right") : null,
      confidence: clear ? Math.min(1, difference / Math.max(12, higherChroma)) : 0,
      leftChroma,
      rightChroma
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function ffmpegImportError(){
  const detail = ffmpegLogBuffer
    .map(item => item.message)
    .filter(message => /error|failed|invalid|cannot|unable|unsupported|decoder|memory|allocate|aborted/i.test(message))
    .slice(-3)
    .join(" · ");
  if (/memory|allocate|out of memory/i.test(detail)) return "解析失败：浏览器内存不足，请减少视频尺寸、时长或帧数";
  if (/decoder|codec|unsupported|unknown format|invalid data/i.test(detail)) return "解析失败：当前本地解码器不支持该 MP4 编码，建议导出为 H.264 MP4 后重试";
  return detail ? "解析失败：" + detail : "本地解码器未能从视频中提取帧，请确认文件完整且为左右并排双通道格式";
}

function alphaSideLabel(side){
  return side === "left" ? "左侧" : "右侧";
}

async function ingestDualChannelMP4(file, version){
  const button = $("mp4Process");
  button.disabled = true;
  showUploadState(true, "正在检查视频与 Alpha 位置…", 2);
  setStatus("正在检查双通道 MP4…");
  let ff = null;
  let workDir = "";
  let inputPath = "";
  let pendingFiles = [];
  try {
    const metadata = await inspectDualChannelMP4(file);
    if (version !== importVersion) return;
    const requestedSide = $("mp4AlphaSide").value;
    const alphaSide = requestedSide === "auto" ? metadata.alphaSide : requestedSide;
    if (!alphaSide) {
      setUploadStatus("自动判断不够确定，请选择灰度 Alpha 蒙版所在的一侧后重试");
      setUploadProgress(0);
      setStatus("无法可靠判断 Alpha 位置，请在“Alpha 通道在”中手动选择左侧或右侧");
      toast("请手动选择 Alpha 通道位置");
      return;
    }
    const halfWidth = metadata.width / 2;
    const bytesPerFrame = halfWidth * metadata.height * 4;
    const maxFramesByMemory = Math.floor(ANIMATION_MAX_PIXEL_BYTES / bytesPerFrame);
    const maxFrames = Math.min(MP4_IMPORT_MAX_FRAMES, maxFramesByMemory);
    if (maxFrames < 1) throw new Error("单帧画面超过本地像素内存保护上限");

    showUploadState(true, "正在准备本地视频解码器…", 8);
    ff = await ensureFFmpeg();
    if (version !== importVersion) return;
    workDir = "/yyeva_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    await ff.createDir(workDir);
    inputPath = workDir + "/source.mp4";
    const outputPattern = workDir + "/frame_%05d.png";
    await ff.writeFile(inputPath, new Uint8Array(await file.arrayBuffer()));
    ffmpegLogBuffer = [];
    mp4ImportState = {
      duration: metadata.duration,
      estimateFrames: Math.max(1, Math.ceil(metadata.duration * 30))
    };
    const colorX = alphaSide === "left" ? "iw/2" : "0";
    const alphaX = alphaSide === "left" ? "0" : "iw/2";
    // AE 的颜色半幅可能已按 Alpha 预乘；转 PNG 前先反预乘，避免预览时再次变暗。
    const graph = `[0:v]split=2[colorSrc][alphaSrc];[colorSrc]crop=iw/2:ih:${colorX}:0[color];[alphaSrc]crop=iw/2:ih:${alphaX}:0,format=rgb24,extractplanes=r[alpha];[color][alpha]alphamerge,format=rgba,unpremultiply=inplace=1[out]`;
    setUploadStatus("正在解码视频并重建透明帧…");
    setUploadProgress(12);
    const exitCode = await ff.exec([
      "-i", inputPath,
      "-filter_complex", graph,
      "-map", "[out]",
      "-vsync", "0",
      "-frames:v", String(maxFrames + 1),
      "-start_number", "1",
      "-f", "image2",
      "-vcodec", "png",
      outputPattern
    ]);
    mp4ImportState = null;
    if (version !== importVersion) return;
    if (exitCode !== 0) throw new Error(ffmpegImportError());
    const listing = await ff.listDir(workDir);
    const frameEntries = listing
      .filter(entry => !entry.isDir && /^frame_\d+\.png$/.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    pendingFiles = frameEntries.map(entry => workDir + "/" + entry.name);
    if (frameEntries.length > maxFrames) throw new Error("视频展开后的帧数超过本地内存保护上限，请缩短视频或降低尺寸");
    if (!frameEntries.length) throw new Error(ffmpegImportError());

    const pixelBytes = bytesPerFrame * frameEntries.length;
    approvePixelMemory(pixelBytes);
    const digits = Math.max(4, String(frameEntries.length).length);
    const baseName = safeOutputBase(file.name.replace(/\.mp4$/i, ""));
    const decoded = [];
    for (let index = 0; index < frameEntries.length; index += 1) {
      if (version !== importVersion) return;
      const path = pendingFiles[index];
      const data = await ff.readFile(path);
      const name = `${baseName}_${String(index + 1).padStart(digits, "0")}.png`;
      decoded.push(new File([data], name, { type: "image/png" }));
      await ff.deleteFile(path);
      pendingFiles[index] = "";
      if (index % 8 === 7 || index === frameEntries.length - 1) {
        setUploadProgress(36 + ((index + 1) / frameEntries.length) * 58);
        setUploadStatus(`正在整理透明 PNG… ${index + 1} / ${frameEntries.length} 帧`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    if (version !== importVersion) return;

    clearLoadedAnimation();
    frames = decoded.map((decodedFile, index) => ({
      file: decodedFile,
      width: halfWidth,
      height: metadata.height,
      number: index + 1,
      previewURL: null
    }));
    const durationUs = metadata.duration * 1000000 / frames.length;
    animationModel = {
      sourceType: "yyeva-mp4",
      timelineMode: "preserve-source",
      loopCount: 0,
      sourceFile: { name: file.name, size: file.size },
      canvas: { width: halfWidth, height: metadata.height, hasAlpha: true },
      warnings: [
        `Alpha 蒙版按${alphaSideLabel(alphaSide)}画面重建。`,
        "已反向还原 AE 双通道视频中预乘过的 RGB，避免颜色被 Alpha 重复压暗。",
        "H.264 有损压缩会影响颜色与 Alpha 边缘；可变帧率时间戳按视频总时长均分。"
      ],
      hasVariableFrameDurations: false,
      frames: frames.map((frame, index) => ({ index, source: frame, durationUs }))
    };
    $("loop").value = "0";
    setTimelineModeUI();
    applySuggestedOutputName(baseName);
    pad = Math.max(4, String(frames.length).length);
    renderFrames(previewVersion);
    $("configCard").style.display = "block";
    $("mp4ImportPanel").hidden = true;
    pendingMP4File = null;
    showFrameflowPage("editor", { updateHistory: true });
    finishUploadState(`已准备双通道 MP4 · ${frames.length} 帧`, false);
    setStatus(`已从 MP4 还原 ${frames.length} 张透明 PNG · ${formatDuration(timelineDurationUs() / 1000000)} · Alpha 在${alphaSideLabel(alphaSide)}`);
    toast(`已还原 ${frames.length} 张透明帧`);
  } catch (error) {
    if (version !== importVersion) return;
    mp4ImportState = null;
    finishUploadState("导入失败：" + (error.message || error), true);
    setStatus("双通道 MP4 导入失败：" + (error.message || error));
    toast("双通道 MP4 导入失败");
  } finally {
    mp4ImportState = null;
    if (ff && workDir) {
      if (inputPath) {
        try { await ff.deleteFile(inputPath); } catch (_) {}
      }
      for (const path of pendingFiles) {
        if (!path) continue;
        try { await ff.deleteFile(path); } catch (_) {}
      }
      try { await ff.deleteDir(workDir); } catch (_) {}
    }
    if (version === importVersion) button.disabled = false;
  }
}

$("mp4Process").addEventListener("click", () => {
  if (!pendingMP4File) return;
  void ingestDualChannelMP4(pendingMP4File, importVersion);
});
