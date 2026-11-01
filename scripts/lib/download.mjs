import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalImage, hash, readJson, saveJson } from './qiandao.mjs';
import { fetchSource, isQiandaoCdn } from './sources.mjs';
import { imageDetails } from './image-details.mjs';

async function responseBytes(url, limit, timeout = 45000) {
  return (await fetchSource(url, { kind: 'image', limit, timeout })).bytes;
}
async function sourceInfo(url) {
  if (!isQiandaoCdn(url)) return null;
  const suffix = new URL(url).pathname.startsWith('/treasure/') ? '!info' : '?x-oss-process=image/info';
  try {
    const data = JSON.parse((await responseBytes(url + suffix, 128 * 1024, 18000)).toString('utf8'));
    const width = Number(data.ImageWidth?.value), height = Number(data.ImageHeight?.value);
    return width > 0 && height > 0 ? { width, height, format: String(data.Format?.value || ''), bytes: Number(data.FileSize?.value) || null, verified: true } : null;
  } catch (error) {
    if ([401, 403, 429].includes(error.status)) throw error;
    return null;
  }
}
export function candidates(url, sourceSize) {
  if (!isQiandaoCdn(url)) return [url];
  if (new URL(url).pathname.startsWith('/treasure/')) return [url + '!_origin'];
  const jpeg = /^(?:jpe?g)$/i.test(sourceSize?.format || '') || (!sourceSize?.format && /\.jpe?g$/i.test(new URL(url).pathname));
  return [...(jpeg ? ['jpg', 'png'] : ['png', 'jpg']).map(format => url + '?x-oss-process=image/format,' + format), url + '!_origin'];
}
export async function bestImage(asset) {
  const { url, reported } = canonicalImage(asset.url);
  const sourceSize = await sourceInfo(url) || asset.reported || reported;
  let best, lastError;
  const attempts = [];
  for (const address of candidates(url, sourceSize)) {
    try {
      const bytes = await responseBytes(address, 48 * 1024 * 1024);
      const details = imageDetails(bytes);
      if (!(details.width > 0 && details.height > 0)) throw new Error('圖片尺寸不正確。');
      if (asset.archive && asset.category !== 'related' && (details.width < 480 || details.height < 650 || details.width / details.height < 0.4 || details.width / details.height > 0.9)) {
        return { excluded: true, reason: '已確認版本候選為縮圖或非直向海報；相關待確認圖片不套用此篩選。', width: details.width, height: details.height };
      }
      attempts.push({ url: address, width: details.width, height: details.height, bytes: bytes.length });
      if (!best || details.width * details.height > best.details.width * best.details.height) best = { bytes, details, downloadUrl: address };
      if (sourceSize?.verified && details.width === sourceSize.width && details.height === sourceSize.height) break;
    } catch (error) {
      if ([401, 403, 429].includes(error.status)) throw error;
      attempts.push({ url: address, error: error.message }); lastError = error;
    }
  }
  if (!best) throw lastError || new Error('沒有取得可辨認的圖片。');
  const same = sourceSize && best.details.width === sourceSize.width && best.details.height === sourceSize.height;
  return { bytes: best.bytes, metadata: { ...best.details, sourceSize,
    sourceUrl: url, downloadUrl: best.downloadUrl, bytes: best.bytes.length, sha256: hash(best.bytes),
    sourcePixelSizeMatched: Boolean(same && sourceSize.verified), originalBytesVerified: false,
    quality: same && sourceSize.verified ? 'source-pixels-matched' : sourceSize && !same ? 'limited' : 'measured',
    validation: 'container-structure-and-dimensions', checkedAt: new Date().toISOString(), attempts,
    transformation: best.downloadUrl.includes('x-oss-process=image/format,') ? '來源 CDN 轉碼；直接保存回應，未放大。' : '直接保存來源回應；來源可能自行壓縮或縮圖。' } };
}

async function validPrevious(output, record) {
  if (!record?.file || !/^[a-f0-9]{20}\.(?:jpg|png|gif|webp)$/.test(record.file)) return false;
  try { return hash(await readFile(resolve(output, record.file))) === record.sha256; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function downloadAssets(assets, { output = 'downloads', workId = null, redownload = false } = {}) {
  output = resolve(output);
  await mkdir(output, { recursive: true });
  const file = resolve(output, 'manifest.json'), old = await readJson(file);
  if (old && old.workId !== workId) throw new Error('輸出目錄已有另一作品的清單；請改用獨立目錄。');
  const records = new Map((old?.assets || []).map(record => [record.url, record]));
  const results = [];
  for (const asset of assets) {
    const previous = records.get(asset.url), reusable = await validPrevious(output, previous);
    const grew = asset.reported && (!previous?.sourceSize || asset.reported.width > previous.sourceSize.width || asset.reported.height > previous.sourceSize.height);
    if (reusable && !redownload && !grew) {
      const record = { ...previous, ...asset, status: 'reused' };
      records.set(asset.url, record); results.push(record); continue;
    }
    try {
      const obtained = await bestImage(asset);
      if (obtained.excluded) {
        const record = reusable ? { ...previous, ...asset, status: 'preserved', warning: obtained.reason } : { ...asset, ...obtained, status: 'excluded' };
        records.set(asset.url, record); results.push(record);
        await saveJson(file, { schemaVersion: 1, workId, updatedAt: new Date().toISOString(), assets: [...records.values()] });
        continue;
      }
      const { bytes, metadata } = obtained;
      // 更新不以較小的公開回應覆蓋已保存的較大圖片。
      if (reusable && metadata.width * metadata.height < previous.width * previous.height) {
        const record = { ...previous, ...asset, status: 'preserved', warning: '最新來源解像度較低，已保留原檔。' };
        records.set(asset.url, record); results.push(record); continue;
      }
      const basename = hash(asset.url).slice(0, 20) + '.' + metadata.extension;
      const temporary = resolve(output, basename + '.' + randomUUID() + '.tmp');
      await writeFile(temporary, bytes); await rename(temporary, resolve(output, basename));
      const record = { ...asset, ...metadata, file: basename, status: 'saved' };
      records.set(asset.url, record); results.push(record);
    } catch (error) {
      const record = reusable
        ? { ...previous, ...asset, status: 'preserved', warning: '更新失敗，已保留原檔：' + error.message }
        : { ...asset, status: 'failed', error: error.message };
      records.set(asset.url, record); results.push(record);
    }
    // 每張完成後記錄進度；中途停止仍可重用已取得的圖片。
    await saveJson(file, { schemaVersion: 1, workId, updatedAt: new Date().toISOString(), assets: [...records.values()] });
  }
  const manifest = { schemaVersion: 1, workId, updatedAt: new Date().toISOString(), assets: [...records.values()] };
  await saveJson(file, manifest);
  return { output, manifest: file, processed: results.length,
    failures: results.filter(record => record.status === 'failed').length,
    warnings: results.filter(record => record.warning).length, results };
}
