function readGifSubBlocks(bytes, offset){
  let cursor = offset;
  while (cursor < bytes.length) {
    const size = bytes[cursor++];
    if (size === 0) return cursor;
    if (cursor + size > bytes.length) throw new Error("GIF 子块数据不完整");
    cursor += size;
  }
  throw new Error("GIF 缺少子块结束标记");
}

async function inspectGif(file){
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 13 || !(bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)) {
    throw new Error(file.name + " 不是有效的 GIF 文件");
  }
  const readU16 = offset => bytes[offset] | (bytes[offset + 1] << 8);
  const width = readU16(6);
  const height = readU16(8);
  if (!width || !height) throw new Error(file.name + " 的 GIF 画布尺寸无效");
  let offset = 13;
  const logicalPacked = bytes[10];
  if (logicalPacked & 0x80) offset += 3 * (1 << ((logicalPacked & 0x07) + 1));
  let loopCount = 0;
  let durationsUs = [];
  let pendingDurationUs = 10000;
  let zeroDelayCount = 0;
  let hasAlpha = false;

  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3B) break;
    if (marker === 0x21) {
      const label = bytes[offset++];
      if (label === 0xF9) {
        const blockSize = bytes[offset++];
        if (blockSize !== 4 || offset + blockSize >= bytes.length) throw new Error("GIF 图形控制块无效");
        hasAlpha = hasAlpha || Boolean(bytes[offset] & 0x01);
        const delayCs = readU16(offset + 1);
        pendingDurationUs = delayCs ? delayCs * 10000 : 10000;
        if (!delayCs) zeroDelayCount++;
        offset += blockSize;
        if (bytes[offset] === 0) offset++;
      } else if (label === 0xFF) {
        const blockSize = bytes[offset++];
        if (offset + blockSize > bytes.length) throw new Error("GIF 应用扩展无效");
        const appId = String.fromCharCode(...bytes.slice(offset, offset + blockSize));
        offset += blockSize;
        const appData = [];
        while (offset < bytes.length) {
          const size = bytes[offset++];
          if (size === 0) break;
          if (offset + size > bytes.length) throw new Error("GIF 应用扩展数据不完整");
          appData.push(...bytes.slice(offset, offset + size));
          offset += size;
        }
        if (/^NETSCAPE2\.0|^ANIMEXTS1\.0/.test(appId) && appData[0] === 1 && appData.length >= 3) {
          loopCount = appData[1] | (appData[2] << 8);
        }
      } else if (label === 0x01) {
        const blockSize = bytes[offset++];
        if (offset + blockSize > bytes.length) throw new Error("GIF 文本扩展无效");
        offset += blockSize;
        offset = readGifSubBlocks(bytes, offset);
      } else {
        offset = readGifSubBlocks(bytes, offset);
      }
      continue;
    }
    if (marker !== 0x2C) throw new Error("GIF 数据块结构无效");
    if (offset + 9 > bytes.length) throw new Error("GIF 图像描述符不完整");
    const packed = bytes[offset + 8];
    offset += 9;
    if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1));
    if (offset >= bytes.length) throw new Error("GIF 缺少 LZW 压缩数据");
    offset++;
    offset = readGifSubBlocks(bytes, offset);
    durationsUs.push(pendingDurationUs);
    pendingDurationUs = 10000;
  }

  if (!durationsUs.length) throw new Error(file.name + " 中没有可播放的 GIF 帧");
  return {
    file,
    format: "gif",
    width,
    height,
    loopCount,
    durationsUs,
    hasAlpha,
    warnings: zeroDelayCount ? ["检测到 " + zeroDelayCount + " 个 0 延迟帧，按 10ms 预览"] : []
  };
}

function readBigEndian24(bytes, offset){
  return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
}

function readLittleEndian24(bytes, offset){
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

async function inspectApng(file){
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 33 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new Error(file.name + " 不是有效的 APNG 文件");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height) throw new Error(file.name + " 的 APNG 画布尺寸无效");
  let offset = 8;
  let frameCount = 0;
  let loopCount = 0;
  const durationsUs = [];
  let hasAcTL = false;
  let zeroDelayCount = 0;
  let hasAlpha = bytes[25] === 4 || bytes[25] === 6;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (dataEnd + 4 > bytes.length) throw new Error("APNG 数据块不完整");
    if (type === "acTL") {
      if (size < 8) throw new Error("APNG 动画控制块无效");
      hasAcTL = true;
      frameCount = view.getUint32(dataStart);
      loopCount = view.getUint32(dataStart + 4);
    } else if (type === "fcTL") {
      if (size < 26) throw new Error("APNG 帧控制块无效");
      const delayNumerator = view.getUint16(dataStart + 20);
      const delayDenominator = view.getUint16(dataStart + 22) || 100;
      const durationUs = delayNumerator > 0
        ? Math.max(1, Math.round(delayNumerator * 1000000 / delayDenominator))
        : 10000;
      if (!delayNumerator) zeroDelayCount++;
      durationsUs.push(durationUs);
    } else if (type === "tRNS") {
      hasAlpha = true;
    }
    offset = dataEnd + 4;
    if (type === "IEND") break;
  }
  if (!hasAcTL || !frameCount || !durationsUs.length) throw new Error(file.name + " 不是有效的 APNG 动画");
  if (durationsUs.length !== frameCount) {
    throw new Error(file.name + " 的 APNG 帧数量与帧控制信息不一致");
  }
  return {
    file,
    format: "apng",
    width,
    height,
    loopCount,
    durationsUs,
    hasAlpha,
    warnings: zeroDelayCount ? ["检测到 " + zeroDelayCount + " 个 0 延迟帧，按 10ms 预览"] : []
  };
}

async function inspectWebp(file){
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 16 || String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP") {
    throw new Error(file.name + " 不是有效的 WebP 文件");
  }
  let offset = 12;
  let width = 0;
  let height = 0;
  let loopCount = 0;
  let hasAnimation = false;
  let hasAlpha = false;
  let background = [0, 0, 0, 0];
  const durationsUs = [];
  const framePayloads = [];
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const size = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (size < 0 || dataEnd > bytes.length) throw new Error("WebP 数据块不完整");
    if (type === "VP8X" && size >= 10) {
      const flags = bytes[dataStart];
      hasAnimation = Boolean(flags & 0x02);
      hasAlpha = Boolean(flags & 0x10);
      width = readLittleEndian24(bytes, dataStart + 4) + 1;
      height = readLittleEndian24(bytes, dataStart + 7) + 1;
    } else if (type === "ANIM" && size >= 6) {
      background = [bytes[dataStart + 2], bytes[dataStart + 1], bytes[dataStart], bytes[dataStart + 3]];
      loopCount = bytes[dataStart + 4] | (bytes[dataStart + 5] << 8);
    } else if (type === "ANMF" && size >= 16) {
      hasAnimation = true;
      durationsUs.push(Math.max(1, readLittleEndian24(bytes, dataStart + 12)) * 1000);
      framePayloads.push({
        x: readLittleEndian24(bytes, dataStart) * 2,
        y: readLittleEndian24(bytes, dataStart + 3) * 2,
        width: readLittleEndian24(bytes, dataStart + 6) + 1,
        height: readLittleEndian24(bytes, dataStart + 9) + 1,
        noBlend: Boolean(bytes[dataStart + 15] & 0x02),
        dispose: Boolean(bytes[dataStart + 15] & 0x01),
        data: bytes.slice(dataStart + 16, dataEnd)
      });
    }
    offset = dataEnd + (size & 1);
  }
  if (!hasAnimation || !durationsUs.length) throw new Error(file.name + " 不是有效的 WebP 动画");
  if (!width || !height) throw new Error(file.name + " 的 WebP 画布尺寸无效");
  return { file, format: "webp", width, height, loopCount, hasAlpha, background, durationsUs, framePayloads, warnings: [] };
}

function writeAscii(bytes, offset, text){
  for (let index = 0; index < text.length; index++) bytes[offset + index] = text.charCodeAt(index);
}

function makeWebpChunk(type, data){
  const paddedLength = data.length + (data.length & 1);
  const chunk = new Uint8Array(8 + paddedLength);
  writeAscii(chunk, 0, type);
  new DataView(chunk.buffer).setUint32(4, data.length, true);
  chunk.set(data, 8);
  return chunk;
}

function makeStandaloneWebpFrame(frame){
  let offset = 0;
  let hasAlpha = false;
  let hasBitstream = false;
  const imageChunks = [];
  while (offset + 8 <= frame.data.length) {
    const type = String.fromCharCode(...frame.data.slice(offset, offset + 4));
    const size = frame.data[offset + 4] | (frame.data[offset + 5] << 8) | (frame.data[offset + 6] << 16) | (frame.data[offset + 7] << 24);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (size < 0 || dataEnd > frame.data.length) throw new Error("WebP 动画帧数据不完整");
    if (type === "ALPH" || type === "VP8 " || type === "VP8L") {
      imageChunks.push(frame.data.slice(offset, dataEnd + (size & 1)));
      hasAlpha = hasAlpha || type === "ALPH" || type === "VP8L";
      hasBitstream = hasBitstream || type === "VP8 " || type === "VP8L";
    }
    offset = dataEnd + (size & 1);
  }
  if (!hasBitstream) throw new Error("WebP 动画帧缺少 VP8 图像数据");
  const vp8x = new Uint8Array(10);
  vp8x[0] = hasAlpha ? 0x10 : 0;
  vp8x[4] = (frame.width - 1) & 0xff;
  vp8x[5] = ((frame.width - 1) >> 8) & 0xff;
  vp8x[6] = ((frame.width - 1) >> 16) & 0xff;
  vp8x[7] = (frame.height - 1) & 0xff;
  vp8x[8] = ((frame.height - 1) >> 8) & 0xff;
  vp8x[9] = ((frame.height - 1) >> 16) & 0xff;
  const chunks = [makeWebpChunk("VP8X", vp8x), ...imageChunks];
  const payloadSize = 4 + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(8 + payloadSize);
  writeAscii(output, 0, "RIFF");
  new DataView(output.buffer).setUint32(4, payloadSize, true);
  writeAscii(output, 8, "WEBP");
  let cursor = 12;
  chunks.forEach(chunk => {
    output.set(chunk, cursor);
    cursor += chunk.length;
  });
  return output;
}

function loadWebpFrameImage(bytes){
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([bytes], {type: "image/webp"}));
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("浏览器无法解码 WebP 动画帧"));
    };
    image.src = url;
  });
}

function canvasToPngFile(canvas, name){
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error("WebP 动画帧无法转换为 PNG"));
        return;
      }
      resolve(new File([blob], name, {type: "image/png"}));
    }, "image/png");
  });
}

async function decodeWebpAnimationFrames(meta, version){
  const canvas = document.createElement("canvas");
  canvas.width = meta.width;
  canvas.height = meta.height;
  const context = canvas.getContext("2d", {alpha: true});
  if (!context) throw new Error("浏览器不支持 WebP 动画画布解码");
  const background = meta.hasAlpha ? [0, 0, 0, 0] : (meta.background || [0, 0, 0, 0]);
  const paintBackground = (x = 0, y = 0, width = meta.width, height = meta.height) => {
    context.clearRect(x, y, width, height);
    if (background[3]) {
      context.fillStyle = `rgba(${background[0]},${background[1]},${background[2]},${background[3] / 255})`;
      context.fillRect(x, y, width, height);
    }
  };
  paintBackground();
  const decoded = [];
  for (let index = 0; index < meta.framePayloads.length; index++) {
    if (version !== importVersion) return null;
    const frame = meta.framePayloads[index];
    const image = await loadWebpFrameImage(makeStandaloneWebpFrame(frame));
    if (frame.noBlend) paintBackground(frame.x, frame.y, frame.width, frame.height);
    context.drawImage(image, frame.x, frame.y, frame.width, frame.height);
    decoded.push(await canvasToPngFile(canvas, meta.file.name.replace(/\.webp$/i, "") + "_" + (index + 1) + ".png"));
    if (frame.dispose) paintBackground(frame.x, frame.y, frame.width, frame.height);
    setUploadProgress(((index + 1) / meta.framePayloads.length) * 90);
    setUploadStatus("正在解码 WEBP… " + (index + 1) + " / " + meta.framePayloads.length + " 帧");
  }
  return decoded;
}

async function inspectAnimatedFile(file){
  if (/\.gif$/i.test(file.name) || file.type === "image/gif") return inspectGif(file);
  if (/\.apng$/i.test(file.name)) return inspectApng(file);
  if (/\.webp$/i.test(file.name) || file.type === "image/webp") return inspectWebp(file);
  throw new Error(file.name + " 不是支持的动画文件");
}

async function decodeAnimatedFrames(meta, version){
  if (meta.format === "webp") return decodeWebpAnimationFrames(meta, version);
  const ff = await ensureFFmpeg();
  const token = meta.format + "_" + version + "_" + Date.now();
  const inputName = token + "." + meta.format;
  const outputPattern = token + "_%04d.png";
  const outputNames = [];
  const expectedOutputNames = Array.from({length: meta.durationsUs.length}, (_, index) =>
    token + "_" + String(index + 1).padStart(4, "0") + ".png"
  );
  const decoded = [];
  const clearDecodedOutputs = async () => {
    for (const name of expectedOutputNames) {
      try { await ff.deleteFile(name); } catch(_){}
    }
  };
  const decodeErrorDetail = () => ffmpegLogBuffer
    .map(item => item.message)
    .filter(message => /error|invalid|unsupported|failed|cannot|unable|decoder|demux/i.test(message))
    .slice(-3)
    .join(" · ");
  try {
    await ff.writeFile(inputName, new Uint8Array(await meta.file.arrayBuffer()));
    setStatus("正在解码 " + meta.format.toUpperCase() + "… 0 / " + meta.durationsUs.length + " 帧");
    ffmpegLogBuffer = [];
    const decodeArgs = meta.format === "gif"
      ? ["-i", inputName, "-vsync", "0", "-frames:v", String(meta.durationsUs.length), "-f", "image2", outputPattern]
      : ["-i", inputName, "-map", "0:v:0", "-an", "-fps_mode", "passthrough", "-frames:v", String(meta.durationsUs.length), "-f", "image2", outputPattern];
    let exitCode = await ff.exec(decodeArgs);
    if (exitCode !== 0 && meta.format === "webp") {
      // 部分 WebP 动画在旧版内核中不接受 fps_mode，退回不指定同步策略的逐帧解码。
      await clearDecodedOutputs();
      exitCode = await ff.exec(["-i", inputName, "-map", "0:v:0", "-an", "-frames:v", String(meta.durationsUs.length), "-f", "image2", outputPattern]);
    }
    if (exitCode !== 0) {
      const detail = decodeErrorDetail();
      throw new Error(meta.format.toUpperCase() + " 解码器退出码 " + exitCode + (detail ? "：" + detail : ""));
    }
    for (let index = 0; index < meta.durationsUs.length; index++) {
      if (version !== importVersion) return null;
      const name = token + "_" + String(index + 1).padStart(4, "0") + ".png";
      outputNames.push(name);
      const data = await ff.readFile(name);
      decoded.push(new File([data], meta.file.name.replace(/\.(?:gif|webp|apng)$/i, "") + "_" + (index + 1) + ".png", { type: "image/png" }));
      setUploadProgress(((index + 1) / meta.durationsUs.length) * 90);
      setUploadStatus("正在解码 " + meta.format.toUpperCase() + "… " + (index + 1) + " / " + meta.durationsUs.length + " 帧");
    }
    return decoded;
  } finally {
    try { await ff.deleteFile(inputName); } catch(_){}
    for (const name of outputNames) {
      try { await ff.deleteFile(name); } catch(_){}
    }
  }
}
