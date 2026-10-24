async function ingestAnimated(file, version){
  try {
    if (file.size > LARGE_IMPORT_BYTES) {
      throw new Error("动画文件超过 512 MB 的本地解析保护上限，请先压缩或降低分辨率后再导入");
    }
    const meta = await inspectAnimatedFile(file);
    approveAnimationMemory(meta);
    const decoded = await decodeAnimatedFrames(meta, version);
    if (version !== importVersion || !decoded) return;
    if (decoded.length !== meta.durationsUs.length) throw new Error("动画帧数量读取不完整");
    clearLoadedAnimation();
    frames = decoded.map((decodedFile, index) => ({
      file: decodedFile,
      width: meta.width,
      height: meta.height,
      number: index + 1,
      previewURL: null
    }));
    animationModel = {
      sourceType: meta.format,
      timelineMode: "preserve-source",
      loopCount: meta.loopCount,
      sourceFile: { name: file.name, size: file.size },
      canvas: { width: meta.width, height: meta.height, hasAlpha: Boolean(meta.hasAlpha) },
      warnings: meta.warnings,
      hasVariableFrameDurations: meta.durationsUs.some(duration => Math.abs(duration - meta.durationsUs[0]) >= 0.5),
      frames: frames.map((frame, index) => ({
        index,
        source: frame,
        durationUs: meta.durationsUs[index]
      }))
    };
    $("loop").value = String(meta.loopCount);
    setTimelineModeUI();
    applySuggestedOutputName(safeOutputBase(file.name.replace(/\.(?:gif|webp|apng)$/i, "")));
    pad = Math.max(4, String(frames.length).length);
    renderFrames(previewVersion);
    $("configCard").style.display = "block";
    showFrameflowPage("editor", { updateHistory: true });
    finishUploadState("已准备 " + meta.format.toUpperCase() + " · " + frames.length + " 帧");
    setStatus("已导入 " + meta.format.toUpperCase() + "：" + frames.length + " 帧 · " + formatDuration(timelineDurationUs() / 1000000));
    toast("已导入 " + meta.format.toUpperCase() + " · " + frames.length + " 帧");
  } catch (err) {
    if (version !== importVersion) return;
    finishUploadState("导入失败：" + (err.message || err), true);
    setStatus("动画导入失败：" + (err.message || err));
    toast("动画导入失败");
  }
}

async function inspectPng(file){
  const bytes = new Uint8Array(await file.slice(0, 24).arrayBuffer());
  const validSignature = bytes.length >= 24 && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
  if (!validSignature) throw new Error(`${file.name} 不是有效的 PNG 文件`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height) throw new Error(`${file.name} 的图像尺寸无效`);
  return { file, width, height };
}

async function ingest(fileList){
  if (!fileList || !fileList.length){
    finishUploadState("未找到文件", true);
    return;
  }
  const currentImport = ++importVersion;
  cancelSVGAImport();
  const mp4Files = fileList.filter(file =>
    /\.mp4$/i.test(file.name) || file.type === "video/mp4"
  );
  if (mp4Files.length) {
    if (fileList.length !== 1 || mp4Files.length !== 1) {
      pendingMP4File = null;
      $("mp4ImportPanel").hidden = true;
      finishUploadState("请一次只导入一个双通道 MP4 文件", true);
      setStatus("导入失败：双通道 MP4 不能与其他文件混合");
      toast("请单独选择一个 MP4 文件");
      return;
    }
    pendingMP4File = mp4Files[0];
    $("mp4ImportPanel").hidden = false;
    $("mp4ImportFileName").textContent = pendingMP4File.name;
    $("mp4AlphaSide").value = "auto";
    $("mp4Process").disabled = false;
    showUploadState(false);
    setStatus("已选择双通道 MP4，请确认 Alpha 通道位置后开始解析");
    return;
  }
  pendingMP4File = null;
  $("mp4ImportPanel").hidden = true;
  const svgaFiles = fileList.filter(file =>
    /\.svga$/i.test(file.name) || file.type === "application/vnd.svga"
  );
  if (svgaFiles.length) {
    if (fileList.length !== 1 || svgaFiles.length !== 1) {
      finishUploadState("请一次只导入一个 SVGA 文件", true);
      setStatus("导入失败：SVGA 动画不能与其他文件混合");
      toast("请单独导入一个 SVGA 动画");
      return;
    }
    showUploadState(true, "正在准备 SVGA 动画…", 0);
    setStatus("正在检查 SVGA 文件…");
    void ingestSVGA(svgaFiles[0], currentImport);
    return;
  }
  const animatedFiles = fileList.filter(file =>
    /\.(?:gif|webp|apng)$/i.test(file.name)
    || ["image/gif", "image/webp"].includes(file.type)
  );
  if (!animatedFiles.length && fileList.length === 1 && /\.png$/i.test(fileList[0].name)) {
    if (fileList[0].size > LARGE_IMPORT_BYTES) {
      finishUploadState("导入失败：单个 PNG 文件超过 512 MB 的本地解析保护上限", true);
      setStatus("导入失败：请先压缩或降低 PNG 分辨率后再导入");
      toast("PNG 文件过大，已停止导入");
      return;
    }
    try {
      await inspectApng(fileList[0]);
      animatedFiles.push(fileList[0]);
    } catch (_) {
      // 普通 PNG 继续沿用原有的单帧 / 序列帧导入路径。
    }
  }
  if (animatedFiles.length) {
    if (fileList.length !== 1) {
      finishUploadState("请一次只导入一个动画文件", true);
      setStatus("导入失败：动画文件不能与其他文件混合");
      toast("请单独导入一个动画文件");
      return;
    }
    showUploadState(true, "正在准备动画文件…", 0);
    setStatus("正在检查动画文件…");
    ingestAnimated(animatedFiles[0], currentImport);
    return;
  }
  showUploadState(true, "正在准备 PNG 文件…", 0);
  setStatus("正在检查 PNG 文件…");
  $("configCard").style.display = frames.length ? "block" : "none";
  const pngFiles = fileList
    .filter(f => /\.png$/i.test(f.name))
    .sort((a,b) => naturalCompare(fileSortKey(a), fileSortKey(b)));
  if (!pngFiles.length){
    finishUploadState("未找到 PNG 文件", true);
    setStatus("未找到 PNG 文件");
    toast("未找到 PNG 文件");
    return;
  }

  let checked;
  try {
    checked = [];
    for (let i = 0; i < pngFiles.length; i++) {
      checked.push(await inspectPng(pngFiles[i]));
      const progress = ((i + 1) / pngFiles.length) * 90;
      setUploadProgress(progress);
      setUploadStatus(`正在校验 PNG… ${i + 1} / ${pngFiles.length}`);
    }
  } catch (err) {
    if (currentImport !== importVersion) return;
    finishUploadState(`导入失败：${err.message || err}`, true);
    setStatus(`导入失败：${err.message || err}`);
    toast("存在无效的 PNG 文件");
    return;
  }
  if (currentImport !== importVersion) return;

  const first = checked[0];
  const mismatch = checked.find(item => item.width !== first.width || item.height !== first.height);
  if (mismatch) {
    finishUploadState("序列帧尺寸不一致", true);
    setStatus(`导入失败：${mismatch.file.name}（${mismatch.width}×${mismatch.height}）与序列首帧（${first.width}×${first.height}）尺寸不一致`);
    toast("序列帧尺寸必须一致");
    return;
  }

  try {
    approvePixelMemory(first.width * first.height * checked.length * 4);
  } catch (err) {
    if (currentImport !== importVersion) return;
    finishUploadState("导入失败：" + (err.message || err), true);
    setStatus("导入失败：" + (err.message || err));
    toast("帧数或尺寸过大，已停止导入");
    return;
  }

  closePreview();
  previewGeometryCustom = false;
  previewVersion++;
  frames.forEach(f => {
    if (f.previewURL) URL.revokeObjectURL(f.previewURL);
    Object.values(f.previewURLs || {}).forEach(url => URL.revokeObjectURL(url));
  });
  resultURLs.forEach(u => URL.revokeObjectURL(u));
  resultURLs = [];
  $("results").replaceChildren();
  frames = checked.map(item => ({ ...item, previewURL:null }));
  syncPngSequenceAnimationModel();
  setTimelineModeUI();
  applySuggestedOutputName(suggestOutputBase(pngFiles));

  pad = Math.max(4, String(frames.length).length);
  renderFrames(previewVersion);
  $("configCard").style.display = "block";   // 上传后展示设置与导出
  showFrameflowPage("editor", { updateHistory: true });
  const total = frames.reduce((sum, frame) => sum + frame.file.size, 0);
  const largeHint = total > LARGE_IMPORT_BYTES ? "，文件较大，导出可能占用较多内存" : "";
  finishUploadState(`已准备 ${frames.length} 张 PNG`);
  setStatus(`已导入 ${frames.length} 张 PNG${largeHint}`);
  toast(`已导入 ${frames.length} 张 PNG`);
}
