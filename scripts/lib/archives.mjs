import { resolve } from 'node:path';
import { knownSources, simplify, normalName, hash, readJson, saveJson, canonicalImage } from './qiandao.mjs';
import { fetchSource, responseText, checkedUrl, attributes, stripTags, underDomain } from './sources.mjs';

export function pageImages(content, sourcePage) {
  const result = []; let anchor = '', context = '';
  for (const match of content.matchAll(/<a\b[^>]*>|<\/a\s*>|<img\b[^>]*>|[^<>]+/gi)) {
    const tag = match[0];
    if (/^<a\b/i.test(tag)) { anchor = attributes(tag).href || ''; continue; }
    if (/^<\/a/i.test(tag)) { anchor = ''; continue; }
    if (!/^<img\b/i.test(tag)) { if (!tag.startsWith('<')) context = (context + ' ' + stripTags(tag)).slice(-200); continue; }
    const attrs = attributes(tag);
    let raw = attrs['data-original'] || attrs['data-src'] || attrs['data-lazy-src'] || attrs.src || '';
    const srcset = [...(attrs.srcset || '').matchAll(/(\S+)\s+([\d.]+)(w|x)(?:\s*,|$)/g)].sort((a, b) => Number(b[2]) - Number(a[2]));
    if (srcset.length) raw = srcset[0][1];
    if (anchor.includes('showimage/') && anchor.includes('?') && /^https?:\/\//.test(anchor.split('?')[1])) raw = anchor.split('?')[1];
    else if (/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(anchor)) raw = anchor;
    if (!raw || raw.startsWith('data:')) continue;
    let url; try { url = checkedUrl(new URL(raw, sourcePage).href, 'image').href; } catch { continue; }
    if (/avatar|\/crop\.|\/logo|blank\.|loading\.|favicon|sina\.png/i.test(url)) continue;
    const early = /先行版|先行海报|先行海報|预告海报|預告海報/.test(context + ' ' + (attrs.alt || ''));
    result.push({ url, early });
  }
  return result;
}
export function searchPages(content) {
  const pages = new Map();
  for (const match of content.matchAll(/<a\b([^>]*class=["'][^"']*result__a[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = attributes(match[1]); let raw = attrs.href || '';
    if (raw.startsWith('//')) raw = 'https:' + raw;
    try {
      let url = new URL(raw);
      if (underDomain(url.hostname, ['duckduckgo.com'])) url = new URL(url.searchParams.get('uddg') || '');
      if (underDomain(url.hostname, ['qiandao.com', 'qiandao.cn'])) continue;
      url = checkedUrl(url.href);
      pages.set(url.href, { url: url.href, title: stripTags(match[2]) });
    } catch { /* 只使用網頁既有的公開來源範圍。 */ }
  }
  return [...pages.values()];
}
function imageAssets(images, page, title, verified = false) {
  const assets = [], warnings = [];
  for (const image of images.slice(0, 24)) {
    try {
      const normalized = canonicalImage(image.url), confirmedEarly = Boolean(verified && image.early);
      assets.push({ ...normalized, category: confirmedEarly ? 'early' : 'related',
        label: confirmedEarly ? '先行版海報' : '相關圖片｜' + title,
        sourcePage: page.url, sourceTitle: title, archive: true, versionConfirmed: confirmedEarly,
        earlyHint: Boolean(image.early), provenance: page.provenance || '', origins: [verified ? 'verified-archive' : 'web-page'], seenInLatest: true });
    } catch (error) { warnings.push('部分文章圖源未能辨認：' + error.message); }
  }
  if (images.length > 24) warnings.push('單頁超過 24 張候選圖片，已依網頁流程限制數量。');
  return { assets, warnings };
}
export async function inspectPage(raw) {
  const response = await fetchSource(raw), text = responseText(response);
  const title = stripTags(text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || new URL(response.url).hostname);
  return { schemaVersion: 2, workId: null, sourcePage: response.url, checkedAt: new Date().toISOString(),
    ...imageAssets(pageImages(text, response.url), { url: response.url }, title) };
}
export async function archives(name, { cache = '.qiandao-cache', refresh = false, maxPages = 8 } = {}) {
  if (!String(name || '').trim() || name.length > 120) throw new Error('請提供有效劇本名稱。');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 32) throw new Error('來源頁數須介乎 1 至 32。');
  const file = resolve(cache, 'archives-v2', hash(normalName(name) + ':' + maxPages) + '.json');
  if (!refresh) { const saved = await readJson(file); if (saved) return { ...saved, cacheHit: true }; }
  const pages = new Map((knownSources.archives?.[normalName(name)] || []).map(page => [page.url, page]));
  const warnings = [], assets = [], outcomes = [];
  try {
    const url = 'https://html.duckduckgo.com/html/?' + new URLSearchParams({ q: '"' + simplify(name) + '" 剧本杀 海报' });
    for (const page of searchPages(responseText(await fetchSource(url, { kind: 'search' })))) if (!pages.has(page.url)) pages.set(page.url, page);
  } catch (error) { warnings.push('外部搜尋未完成：' + error.message); }
  for (const page of [...pages.values()].slice(0, maxPages)) {
    try {
      let images = page.images, title = page.title || new URL(page.url).hostname;
      if (!images) {
        const response = await fetchSource(page.url), content = responseText(response);
        title = stripTags(content.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || title);
        images = pageImages(content, response.url);
      }
      const result = imageAssets(images, page, title, Boolean(page.images));
      assets.push(...result.assets); warnings.push(...result.warnings);
      outcomes.push({ url: page.url, state: page.images ? 'verified-index' : 'read', images: result.assets.length });
    } catch (error) {
      warnings.push('未能讀取 ' + new URL(page.url).hostname + '：' + error.message);
      outcomes.push({ url: page.url, state: 'failed', error: error.message });
    }
  }
  if (pages.size > maxPages) warnings.push('外部來源超過 ' + maxPages + ' 頁；本次只處理前列候選。');
  const result = { schemaVersion: 2, query: name, checkedAt: new Date().toISOString(),
    assets: [...new Map(assets.map(asset => [asset.url, asset])).values()], warnings: [...new Set(warnings)],
    coverage: { candidatePages: pages.size, processedPages: outcomes.length, maxPages, imagesPerPage: 24, outcomes, completeAcrossSources: false } };
  // 即使來源受限或沒有命中也保存結果；再次檢查須明確使用 --refresh。
  await saveJson(file, result); return { ...result, cacheHit: false };
}
