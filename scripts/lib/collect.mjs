import { resolve } from 'node:path';
import { search, gallery, workId, knownSources, compactEntry, canonicalImage, normalName, readJson, saveJson, hash } from './qiandao.mjs';
import { archives } from './archives.mjs';

export function entryAssets(entry) {
  const assets = [], warnings = [], page = entry.sourcePage || 'https://qiandao.com/spu?id=' + entry.id;
  function add(raw, category, label, extra = {}) {
    try { assets.push({ ...canonicalImage(raw), category, label, sourcePage: page,
      origins: ['search-summary'], seenInLatest: true, ...extra }); }
    catch (error) { warnings.push('搜尋摘要部分圖源無法辨認：' + error.message); }
  }
  const cover = entry.imgs?.cover || entry.image;
  if (typeof cover === 'string' && cover) add(cover, 'cover', '主封面');
  const list = value => !value ? [] : typeof value === 'string' ? [value] : Array.isArray(value) ? value : Object.values(value);
  const raw = item => typeof item === 'string' ? item : item?.url || item?.src;
  list(entry.imgs?.officials).forEach((item, index) => { if (raw(item)) add(raw(item), 'official', '官方資料圖 ' + (index + 1)); });
  list(entry.imgs?.HDs).forEach((item, index) => { if (raw(item)) add(raw(item), 'cover', '封面高清來源 ' + (index + 1)); });
  for (const image of entry.supplements || []) if (image.url) {
    const { url, ...extra } = image;
    add(url, image.category || 'other', image.label || '公開補充圖片', {
      ...extra, supplemental: true, origins: ['verified-supplement'], seenInLatest: true,
    });
  }
  for (const asset of assets) if (entry.imageLabels?.[asset.url]) asset.label = entry.imageLabels[asset.url];
  return { assets, warnings };
}
export function mergeAssets(items) {
  const result = new Map();
  const priority = asset => asset.category === 'related' ? 0 : asset.supplemental ? 3 : asset.category === 'cover' ? 2 : 1;
  for (const input of items) {
    const normalized = canonicalImage(input.url), asset = { ...input, ...normalized, reported: input.reported || normalized.reported };
    if (asset.category !== 'related') Object.assign(asset, knownSources.imageAnnotations?.[asset.url] || {});
    const previous = result.get(asset.url);
    if (!previous) {
      asset.origins = asset.origins || ['gallery'];
      asset.references = [{ sourcePage: asset.sourcePage || '', sourceTitle: asset.sourceTitle || '', category: asset.category }];
      result.set(asset.url, asset); continue;
    }
    const preferred = priority(asset) > priority(previous) ? asset : previous;
    const reported = !previous.reported || asset.reported && asset.reported.width * asset.reported.height > previous.reported.width * previous.reported.height ? asset.reported : previous.reported;
    result.set(asset.url, { ...previous, ...preferred, reported,
      seenInLatest: previous.seenInLatest !== false || asset.seenInLatest !== false,
      origins: [...new Set([...(previous.origins || []), ...(asset.origins || ['gallery'])])],
      references: [...(previous.references || []), { sourcePage: asset.sourcePage || '', sourceTitle: asset.sourceTitle || '', category: asset.category }] });
  }
  return [...result.values()];
}
export async function collect({ query, id, publisher, cache = '.qiandao-cache', refresh = false, coreOnly = false, maxImages = 80, maxPages = 8, page = 1 } = {}) {
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > 1000) throw new Error('圖片上限須介乎 1 至 1000。');
  if (!query && !id) throw new Error('請提供劇本名稱或作品 ID。');
  if (id) id = workId(id);
  let detail, detailError;
  const loadGallery = async () => {
    if (!detail && !detailError && id) {
      try { detail = await gallery(id, { cache, refresh }); } catch (error) { detailError = error; }
    }
  };
  const fallback = knownSources.entries.find(entry => String(entry.id) === id);
  if (!query && fallback) query = fallback.name;
  if (!query) { await loadGallery(); query = detail?.name; }
  if (!query) throw new Error('無法取得此 ID 的作品名稱；請同時提供 --query。' + (detailError?.message || ''));
  const matches = await search(query, { cache, refresh, page }), warnings = [...matches.warnings];
  let selected;
  if (id) selected = matches.entries.find(entry => entry.id === id) || (fallback && compactEntry(fallback, query));
  else {
    let candidates = matches.entries;
    if (publisher) candidates = candidates.filter(entry => normalName(entry.description).includes(normalName(publisher)));
    const exact = candidates.filter(entry => entry.exactTitle);
    if (exact.length) candidates = exact;
    if (candidates.length !== 1) return { schemaVersion: 2, state: candidates.length ? 'needs-selection' : 'not-found', query,
      candidates: candidates.length ? candidates : matches.entries, warnings,
      note: '尚未確認唯一作品，未讀取圖集或下載圖片。請依發行資料提供 --id 或 --publisher。' };
    selected = candidates[0]; id = selected.id;
  }
  await loadGallery();
  if (!selected) selected = compactEntry({ id, name: detail?.name || query }, query);
  if (publisher && !normalName(selected.description).includes(normalName(publisher))) throw new Error('指定 ID 的發行資料未能確認符合 --publisher；請核對候選。');
  const base = entryAssets(selected); warnings.push(...base.warnings);
  const collected = [...base.assets];
  if (detail) {
    warnings.push(...detail.warnings);
    collected.push(...detail.assets.map(asset => ({ ...asset, sourcePage: detail.sourcePage, sourceTitle: '千島作品圖集', origins: ['gallery'] })));
  } else warnings.push('圖集未能更新，仍保留搜尋及已核對補充來源：' + detailError?.message);
  if (!coreOnly) for (const match of matches.entries) {
    if (match.id === id) continue;
    const related = entryAssets(match); warnings.push(...related.warnings);
    collected.push(...related.assets.map(asset => ({ ...asset, category: 'related', relatedWorkId: match.id,
      label: '相關｜' + match.name + ' · ' + asset.label, versionConfirmed: false, origins: ['keyword-related'] })));
  }
  const extra = coreOnly ? { assets: [], warnings: [], coverage: { skipped: true } } : await archives(selected.sourceName || selected.name, { cache, refresh, maxPages });
  warnings.push(...extra.warnings); collected.push(...extra.assets);
  const file = resolve(cache, 'collections-v2', id + '-' + hash(normalName(query) + ':' + coreOnly + ':' + page).slice(0, 16) + '.json');
  const previous = await readJson(file), all = mergeAssets(collected), seen = new Set(all.map(asset => asset.url));
  for (const asset of previous?.retainedAssets || previous?.assets || []) if (!seen.has(asset.url)) all.push({ ...asset, seenInLatest: false });
  const omitted = Math.max(0, all.length - maxImages);
  if (omitted) warnings.push('共發現及保留 ' + all.length + ' 個圖源；本次依上限輸出前 ' + maxImages + ' 個，可用 --max-images 提高上限。');
  const result = { schemaVersion: 2, state: 'ready', query, workId: id, name: selected.name,
    description: selected.description, sourcePage: selected.sourcePage, checkedAt: new Date().toISOString(),
    assets: all.slice(0, maxImages), warnings: [...new Set(warnings)], historicalCoverage: selected.historicalCoverage,
    coverage: { gallery: detail?.coverage || { completeWithinResponse: false }, archives: extra.coverage,
      searchCheckedAt: matches.checkedAt, galleryCheckedAt: detail?.checkedAt || null, archivesCheckedAt: extra.checkedAt || null,
      discovered: all.length, omitted, related: all.filter(asset => asset.category === 'related').length,
      completeAcrossSources: false, note: '已執行網頁現有的搜尋類別；不保證來源包含全部歷史素材。相關圖片屬待確認，不能計入本作已確認角色。' } };
  await saveJson(file, { ...result, retainedAssets: all }); return result;
}
