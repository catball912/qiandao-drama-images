// 僅核對檔案結構與尺寸；不等於完整像素解碼或畫質鑑定。
export function imageDetails(bytes) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 32 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
    if (new TextDecoder().decode(bytes.subarray(bytes.length - 8, bytes.length - 4)) !== "IEND") throw new Error("來源 PNG 未完整傳送。");
    return { width: data.getUint32(16), height: data.getUint32(20), format: "PNG", contentType: "image/png", extension: "png" };
  }
  if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    let complete = false;
    for (let p = Math.max(2, bytes.length - 128); p < bytes.length - 1; p += 1) if (bytes[p] === 255 && bytes[p + 1] === 217) complete = true;
    if (!complete) throw new Error("來源 JPEG 未完整傳送。");
    let position = 2;
    while (position + 4 < bytes.length) {
      if (bytes[position] !== 255) { position += 1; continue; }
      const marker = bytes[position + 1]; position += 2;
      if ([0xd8, 0xd9, 0x01].includes(marker) || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (position + 7 > bytes.length) break;
      const length = data.getUint16(position);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: data.getUint16(position + 5), height: data.getUint16(position + 3), format: "JPEG", contentType: "image/jpeg", extension: "jpg" };
      }
      if (length < 2) break;
      position += length;
    }
  }
  if (bytes.length >= 30 && new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP") {
    if (data.getUint32(4, true) + 8 > bytes.length) throw new Error("來源 WebP 未完整傳送。");
    const type = new TextDecoder().decode(bytes.subarray(12, 16));
    const base = { format: "WEBP", extension: "webp", contentType: "image/webp" };
    if (type === "VP8X") return { ...base, width: bytes[24] + (bytes[25] << 8) + (bytes[26] << 16) + 1, height: bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) + 1 };
    if (type === "VP8L" && bytes[20] === 0x2f) {
      const bits = data.getUint32(21, true);
      return { ...base, width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (type === "VP8 ") for (let p = 20; p < Math.min(40, bytes.length - 6); p += 1) {
      if (bytes[p] === 0x9d && bytes[p + 1] === 1 && bytes[p + 2] === 0x2a) return { ...base, width: data.getUint16(p + 3, true) & 0x3fff, height: data.getUint16(p + 5, true) & 0x3fff };
    }
  }
  if (bytes.length > 10 && ["GIF87a", "GIF89a"].includes(new TextDecoder().decode(bytes.subarray(0, 6)))) {
    if (bytes.at(-1) !== 0x3b) throw new Error("來源 GIF 未完整傳送。");
    return { width: data.getUint16(6, true), height: data.getUint16(8, true), format: "GIF", extension: "gif", contentType: "image/gif" };
  }
  throw new Error("來源未回傳可辨認的完整圖片。");
}
