import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getPublicQiandao } from './public-client.mjs';

const t2s = JSON.parse(await readFile(new URL('./t2s.json', import.meta.url), 'utf8'));
export const simplify = text => Array.from(String(text), c => t2s[c] || c).join('');
export const normalName = text => simplify(text).normalize('NFKC').replace(/[\s\p{P}\p{S}_]/gu, '').toLowerCase();
export const hash = text => createHash('sha256').update(text).digest('hex');
export function workId(raw) {
  const value = String(raw || '');
  if (!/^\d{10,22}$/.test(value)) throw new Error('請提供 10 至 22 位數字的作品 ID；不要將其轉為 JavaScript Number。');
  return value;
}

export async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, path);
}
export async function boundedBytes(response, limit) {
  if (!response.ok) {
    await response.body?.cancel();
    const error = new Error('來源回傳 HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('來源超過單一回應大小限制。');
  }
  if (!response.body) throw new Error('來源沒有回應內容。');
  const reader = response.body.getReader(), chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw new Error('來源超過單一回應大小限制。');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

export function canonicalImage(raw) {
  if (typeof raw !== 'string' || raw.length > 3000) throw new Error('圖片網址格式不正確。');
  const value = raw.replaceAll('&amp;', '&')
    .replace(/^echotechoss:\/\/interior-admin-v2\.image\//, 'https://public.qiandaocdn.com/interior/images/')
    .replace(/^echotechoss:\/\/user-treasure-v2\.image\//, 'https://treasure.qiandaocdn.com/treasure/images/');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !['public.qiandaocdn.com', 'treasure.qiandaocdn.com', 'cdn.qiandaoapp.com'].includes(url.hostname)) {
    throw new Error('只支援已核對的公開千島圖片 CDN。');
  }
  const info = url.searchParams.get('imginfo') || '';
  const width = Number(info.match(/(?:^|,)w(\d+)/)?.[1]);
  const height = Number(info.match(/(?:^|,)h(\d+)/)?.[1]);
  const reported = width > 0 && height > 0 ? { width, height, verified: false } : null;
  url.pathname = url.pathname.split('!')[0];
  url.search = ''; url.hash = '';
  return { url: url.href, reported };
}

function category(label) {
  if (/票根|紀念票|纪念票/.test(label)) return 'ticket';
  if (/先行|預告|预告/.test(label)) return 'early';
  if (/^封面(?:圖|图)?$/.test(label)) return 'cover';
  return 'official';
}
export function parseGallery(payload, id, sourceKind = 'image-groups') {
  id = workId(id);
  if (String(payload?.code) !== '0' || !payload?.data) throw new Error('圖集沒有回傳成功資料。');
  const data = payload.data;
  let groups = [], cover = '', name = '', actualId;
  if (sourceKind === 'image-groups') {
    ({ id: actualId, name = '', cover = '' } = data.spu || {});
    if (!Array.isArray(data.propertyImages) || !data.officialImage || typeof data.officialImage !== 'object') {
      throw new Error('圖集分組格式已改變，無法確認清單。');
    }
    if (data.officialImage.officialPropertyImage) groups.push(data.officialImage.officialPropertyImage);
    groups.push(...data.propertyImages);
    const panoramic = data.officialImage.degree360Media?.degree360Images;
    if (Array.isArray(panoramic) && panoramic.length) groups.push({ propertyName: '360°圖片', images: panoramic });
  } else if (sourceKind === 'product-ssr') {
    const detail = data.view?.detailInfo;
    actualId = detail?.spuId;
    if (!Array.isArray(detail?.list)) throw new Error('作品頁圖集格式已改變。');
    groups = detail.list.filter(section => section.type === 'images').flatMap(section => {
      if (!Array.isArray(section.images?.list)) throw new Error('作品頁圖片分組格式已改變。');
      return section.images.list;
    });
  } else throw new Error('未知圖集來源類型。');
  if (String(actualId) !== id) throw new Error('回傳圖集與指定作品 ID 不符。');
  const assets = new Map(), warnings = [], counts = [];
  function add(raw, label, kind, group) {
    try {
      const image = canonicalImage(raw);
      const existing = assets.get(image.url);
      if (existing) {
        existing.groups = [...new Set([...existing.groups, group])];
        if (image.reported && (!existing.reported || image.reported.width * image.reported.height > existing.reported.width * existing.reported.height)) existing.reported = image.reported;
        if (kind === 'cover') existing.category = kind;
      } else assets.set(image.url, { ...image, label, category: kind, groups: [group], seenInLatest: true });
    } catch (error) { warnings.push('部分圖片未能收集：' + error.message); }
  }
  if (cover) add(cover, '主封面', 'cover', '主封面');
  for (const group of groups) {
    if (!Array.isArray(group?.images)) { warnings.push('部分圖片分組無法辨認。'); continue; }
    const label = String(group.propertyName || group.label || '作品資料圖');
    counts.push({ label, count: group.images.length });
    group.images.forEach((raw, index) => add(raw, `${label} ${index + 1}`, category(label), label));
  }
  return { schemaVersion: 1, workId: id, name, sourceKind,
    sourcePage: 'https://qiandao.com/spu?id=' + id, checkedAt: new Date().toISOString(),
    assets: [...assets.values()], warnings: [...new Set(warnings)],
    coverage: { groups: counts, sourceImages: counts.reduce((n, group) => n + group.count, 0),
      completeWithinResponse: warnings.length === 0, completeAcrossSources: false,
      note: '只涵蓋本次來源回應；未保證包含歷史版本、其他平台或未列出的票根。官方資料圖不等於全部都是角色圖片。' } };
}

const origins = ['https://api.qiandao.com', 'https://api.qiandao.cn'];
async function jsonAt(path, signed) {
  let lastError;
  for (const origin of origins) {
    try {
      const raw = origin + path;
      const init = { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000), credentials: 'omit', redirect: 'error' };
      const response = signed ? await getPublicQiandao(raw, init) : await fetch(raw, init);
      return JSON.parse((await boundedBytes(response, 5 * 1024 * 1024)).toString('utf8'));
    } catch (error) {
      // 明確拒絕不藉由切換網域重試。
      if ([401, 403, 429].includes(error.status)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
export async function search(query, { cache = '.qiandao-cache', refresh = false, page = 1 } = {}) {
  if (!String(query || '').trim() || query.length > 120) throw new Error('請提供 1 至 120 字的劇本名稱。');
  if (!Number.isInteger(page) || page < 1 || page > 20) throw new Error('頁數必須介乎 1 至 20。');
  const file = resolve(cache, 'search', hash(normalName(query) + ':' + page) + '.json');
  if (!refresh) { const saved = await readJson(file); if (saved) return { ...saved, cacheHit: true }; }
  const variants = [...new Set([simplify(query), query])], entries = new Map();
  for (const spelling of variants) {
    const params = new URLSearchParams({ q: spelling, 'start-index': String((page - 1) * 30), 'max-results': '30', origin: 'history', scene: 'qiandao_web' });
    const payload = await jsonAt('/plast/search/spu?' + params, false);
    if (payload.code !== 200 || !Array.isArray(payload.data?.items)) throw new Error('搜尋回應格式已改變。');
    for (const item of payload.data.items) {
      if (!item?.id || !item.name) continue;
      entries.set(String(item.id), { id: String(item.id), name: item.name,
        description: String(item.key_property || item.description || ''),
        exactTitle: normalName(item.name) === normalName(query),
        sourcePage: 'https://qiandao.com/spu?id=' + item.id });
    }
  }
  const result = { query, page, pageSize: 30, checkedAt: new Date().toISOString(),
    entries: [...entries.values()].sort((a, b) => Number(b.exactTitle) - Number(a.exactTitle)),
    note: '同名作品可能屬於不同發行方；請依 description 及作品頁確認。每種字形每頁最多 30 個結果，並非全站總數。' };
  await saveJson(file, result);
  return { ...result, cacheHit: false };
}
export async function gallery(rawId, { cache = '.qiandao-cache', refresh = false } = {}) {
  const id = workId(rawId), file = resolve(cache, 'gallery', id + '.json');
  const saved = await readJson(file);
  if (saved && !refresh) return { ...saved, cacheHit: true };
  let lastError;
  for (const sourceKind of ['image-groups', 'product-ssr']) {
    const path = sourceKind === 'image-groups'
      ? '/treasure/v1/spu/view-image-groups?' + new URLSearchParams({ spuId: id })
      : '/treasure/flora/v2/entry/ssr?' + new URLSearchParams({ entryType: 'spu', entryId: id });
    try {
      const result = parseGallery(await jsonAt(path, true), id, sourceKind);
      if (sourceKind === 'product-ssr') result.warnings.push('主要圖集未能讀取，已使用作品頁圖集；主封面未必另行列出。');
      const current = new Set(result.assets.map(asset => asset.url));
      for (const asset of saved?.assets || []) if (!current.has(asset.url)) result.assets.push({ ...asset, seenInLatest: false });
      await saveJson(file, result);
      return { ...result, cacheHit: false };
    } catch (error) {
      if ([401, 403, 429].includes(error.status)) throw error;
      lastError = error;
    }
  }
  // 更新失敗時保留磁碟舊檔，但不把失敗冒稱為最新的成功空圖集。
  throw new Error('讀取圖集失敗，既有快取維持原狀。' + (lastError?.message || ''));
}
