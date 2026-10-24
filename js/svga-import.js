const SVGA_MAX_FRAMES = 5000;
const SVGA_MAX_PROTOBUF_BYTES = 512 * 1024 * 1024;
let activeSVGAImport = null;

function cancelSVGAImport(){
  if (!activeSVGAImport) return;
  const task = activeSVGAImport;
  activeSVGAImport = null;
  task.cancel();
}

async function inspectSVGAFile(file, cancellation){
  if (!file || !Number.isFinite(file.size) || file.size < 22) {
    throw new Error("SVGA 文件为空或内容不完整");
  }
  if (file.size > LARGE_IMPORT_BYTES) {
    throw new Error("SVGA 文件超过 512 MB 的本地解析保护上限");
  }
  const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const cmf = header[0];
  const flg = header[1];
  if ((cmf & 0x0f) !== 8 || (cmf >>> 4) > 7 || ((cmf << 8) + flg) % 31 !== 0 || (flg & 0x20)) {
    throw new Error("文件不是有效的 SVGA zlib 数据流");
  }
  if (typeof DecompressionStream !== "function") {
    throw new Error("当前浏览器缺少本地 SVGA 文件校验能力，请使用新版 Chrome、Edge 或 Safari");
  }
  let reader;
  try {
    reader = file.stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    let protobufBytes = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), cancellation]);
      if (done) break;
      protobufBytes += value.byteLength;
      if (protobufBytes > SVGA_MAX_PROTOBUF_BYTES) {
        await reader.cancel();
        throw new Error("SVGA 解压后的动画数据超过 512 MB 保护上限");
      }
    }
    if (protobufBytes < 8) throw new Error("SVGA 动画数据不完整");
  } catch (error) {
    if (error.message?.includes("512 MB") || error.message?.includes("不完整") || error.message?.includes("已取消")) throw error;
    throw new Error("无法解压 SVGA 动画数据，请确认文件完整且为 SVGA 2.x 格式");
  } finally {
    reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}

function renderSVGAFrame(player, frameIndex){
  // SVGA Lite 2.1.1 的 UMD 构建保留 drawFrame；类型声明虽标为 private，
  // 固定本地版本后可以精确绘制帧编号，避免实时播放截图漏帧。
  if (!player || typeof player.drawFrame !== "function") {
    throw new Error("当前本地 SVGA 渲染器不支持逐帧导出，请更新播放器资源");
  }
  player.currentFrame = frameIndex;
  player.drawFrame(frameIndex);
}

async function ingestSVGA(file, version){
  let parser = null;
  let player = null;
  let objectURL = null;
  let rejectCancellation = null;
  let cancelled = false;
  const cancellation = new Promise((_, reject) => { rejectCancellation = reject; });
  cancellation.catch(() => {});
  const task = {
    cancel(){
      if (cancelled) return;
      cancelled = true;
      try { parser?.destroy(); } catch (_) {}
      try { player?.destroy(); } catch (_) {}
      rejectCancellation(new Error("SVGA 导入已取消"));
    }
  };
  activeSVGAImport = task;

  try {
    await inspectSVGAFile(file, cancellation);
    if (version !== importVersion) return;
    if (!window.SVGA || typeof window.SVGA.Parser !== "function" || typeof window.SVGA.Player !== "function") {
      throw new Error("SVGA 播放器资源未加载，请刷新页面后重试");
    }

    setUploadStatus("正在解析 SVGA 资源…");
    setUploadProgress(8);
    parser = new window.SVGA.Parser();
    objectURL = URL.createObjectURL(file);
    const video = await Promise.race([parser.load(objectURL), cancellation]);
    URL.revokeObjectURL(objectURL);
    objectURL = null;
    if (version !== importVersion) return;

    const majorVersion = String(video?.version || "").split(".")[0];
    if (majorVersion !== "2") throw new Error("当前仅支持 SVGA 2.x 文件；SVGA 1.x 暂不支持");
    const width = Number(video.size?.width);
    const height = Number(video.size?.height);
    const frameCount = Number(video.frames);
    const fps = Number(video.fps);
    if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
      throw new Error("SVGA 画布尺寸无效");
    }
    if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > SVGA_MAX_FRAMES) {
      throw new Error("SVGA 帧数无效或超过 5,000 帧的导入上限");
    }
    if (!Number.isFinite(fps) || fps <= 0 || fps > 1000) throw new Error("SVGA 帧率无效");
    approvePixelMemory(width * height * frameCount * 4);
    if (version !== importVersion) return;

    const canvas = document.createElement("canvas");
    player = new window.SVGA.Player(canvas);
    await Promise.race([player.mount(video), cancellation]);
    if (canvas.width !== width || canvas.height !== height) {
      throw new Error("浏览器无法创建该尺寸的 SVGA 画布");
    }
    if (version !== importVersion) return;
    try { parser.destroy(); } catch (_) {}
    parser = null;

    const baseName = safeOutputBase(file.name.replace(/\.svga$/i, ""));
    const durationUs = 1000000 / fps;
    const decoded = [];
    for (let index = 0; index < frameCount; index++) {
      if (version !== importVersion) return;
      renderSVGAFrame(player, index);
      const name = `${baseName}_${String(index + 1).padStart(Math.max(4, String(frameCount).length), "0")}.png`;
      const png = await Promise.race([canvasToPngFile(canvas, name), cancellation]);
      decoded.push(png);
      const progress = 10 + ((index + 1) / frameCount) * 88;
      setUploadProgress(progress);
      setUploadStatus(`正在准备 SVGA 帧… ${index + 1} / ${frameCount}`);
      if (index % 12 === 11) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (version !== importVersion) return;

    clearLoadedAnimation();
    frames = decoded.map((decodedFile, index) => ({
      file: decodedFile,
      width,
      height,
      number: index + 1,
      previewURL: null
    }));
    animationModel = {
      sourceType: "svga",
      timelineMode: "preserve-source",
      loopCount: 0,
      sourceFile: { name: file.name, size: file.size },
      canvas: { width, height, hasAlpha: true },
      warnings: ["当前转换只处理画面，SVGA 音轨不会带入导出文件。"],
      hasVariableFrameDurations: false,
      frames: frames.map((frame, index) => ({ index, source: frame, durationUs }))
    };
    $("loop").value = "0";
    setTimelineModeUI();
    applySuggestedOutputName(baseName);
    pad = Math.max(4, String(frames.length).length);
    renderFrames(previewVersion);
    $("configCard").style.display = "block";
    showFrameflowPage("editor", { updateHistory: true });
    finishUploadState("已准备 SVGA · " + frames.length + " 帧");
    setStatus("已导入 SVGA 2.x：" + frames.length + " 帧 · " + formatDuration(timelineDurationUs() / 1000000));
    toast("已导入 SVGA · " + frames.length + " 帧");
  } catch (error) {
    if (version !== importVersion) return;
    finishUploadState("导入失败：" + (error.message || error), true);
    setStatus("SVGA 导入失败：" + (error.message || error));
    toast("SVGA 导入失败");
  } finally {
    if (objectURL) URL.revokeObjectURL(objectURL);
    try { parser?.destroy(); } catch (_) {}
    try { player?.destroy(); } catch (_) {}
    if (activeSVGAImport === task) activeSVGAImport = null;
  }
}

window.addEventListener("beforeunload", cancelSVGAImport);
