import { fetchCdn, hasCdnRoute } from './cdn-transport.mjs';

export const PAGE_DOMAINS = ['qiandao.com', 'qiandao.cn', 'gamersky.com', '52jubensha.com', 'sina.cn', 'sohu.com', 'weibo.com', '80larp.com'];
export const IMAGE_DOMAINS = ['qiandaocdn.com', 'qiandaoapp.com', 'gamersky.com', '52jubensha.com', 'sinaimg.cn', 'qpic.cn', 'sohu.com', '80larp.com', 'myqcloud.com', 'midujuben.tor1.cdn.digitaloceanspaces.com'];
export const underDomain = (host, domains) => domains.some(domain => host === domain || host.endsWith('.' + domain));
export const isQiandaoCdn = raw => underDomain(new URL(raw).hostname, ['qiandaocdn.com', 'qiandaoapp.com']);
export function checkedUrl(raw, kind = 'page') {
  const url = new URL(raw);
  if (url.protocol === 'http:') url.protocol = 'https:';
  const domains = kind === 'image' ? IMAGE_DOMAINS : kind === 'search' ? ['html.duckduckgo.com'] : PAGE_DOMAINS;
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !underDomain(url.hostname, domains)) throw new Error('不支援此公開來源網址。');
  url.hash = ''; return url;
}
export async function boundedBytes(response, limit) {
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error('來源回傳 HTTP ' + response.status), { status: response.status });
  }
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw new Error('來源超過單一回應大小限制。');
  }
  if (!response.body) throw new Error('來源沒有回應內容。');
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length;
      if (total > limit) throw new Error('來源超過單一回應大小限制。');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}
export async function fetchSource(raw, { kind = 'page', limit = 5 * 1024 * 1024, timeout = 18000, get } = {}) {
  let url = checkedUrl(raw, kind);
  const signal = AbortSignal.timeout(timeout);
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await (get || (kind === 'image' && hasCdnRoute(url.hostname) ? fetchCdn : globalThis.fetch))(url.href, {
      signal, redirect: 'manual', credentials: 'omit', headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        Accept: kind === 'image' ? 'image/*,application/json' : 'text/html,application/json',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new Error('重新導向未提供網址。');
      url = checkedUrl(new URL(location, url).href, kind); continue;
    }
    return { bytes: await boundedBytes(response, limit), url: url.href, contentType: response.headers.get('content-type') || '' };
  }
  throw new Error('來源重新導向次數過多。');
}
export function responseText({ bytes, contentType = '' }) {
  const prefix = new TextDecoder().decode(bytes.subarray(0, 8000));
  const encoding = contentType.match(/charset=["']?([\w-]+)/i)?.[1] || prefix.match(/charset=["']?([\w-]+)/i)?.[1] || 'utf-8';
  let result;
  try { result = new TextDecoder(encoding).decode(bytes); } catch { result = new TextDecoder().decode(bytes); }
  if (/aliyun_waf|acw_sc__|challenge-form|anomaly\.js|anomaly-modal/i.test(result.slice(0, 40000))) {
    throw Object.assign(new Error('來源要求瀏覽器驗證，未將挑戰頁當作搜尋結果。'), { status: 403 });
  }
  return result;
}
export function decodeHtml(text) {
  return String(text || '').replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[0-9a-f]+);/gi, entity => {
    const fixed = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
    if (fixed[entity.toLowerCase()]) return fixed[entity.toLowerCase()];
    const value = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
  });
}
export const stripTags = text => decodeHtml(String(text || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
export function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3]);
  return result;
}
export function decodeEntries(page) {
  const match = page.match(/<script\b[^>]*\bid=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('作品搜尋頁缺少可辨認的 Nuxt 資料。');
  const nodes = JSON.parse(match[1]);
  if (!Array.isArray(nodes)) throw new Error('Nuxt 資料格式已改變。');
  function resolve(index, visited = new Set()) {
    if (!Number.isInteger(index) || index < 0 || index >= nodes.length || visited.has(index) || visited.size > 30) return null;
    const next = new Set(visited); next.add(index); const value = nodes[index];
    if (Array.isArray(value)) {
      if (['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef'].includes(value[0])) return resolve(value[1], next);
      return value.map(item => Number.isInteger(item) ? resolve(item, next) : item);
    }
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, next)]));
    return value;
  }
  const entries = new Map();
  nodes.forEach((value, index) => {
    if (value && !Array.isArray(value) && typeof value === 'object' && 'imgs' in value && 'name' in value && 'id' in value) {
      const entry = resolve(index); if (entry?.name && entry.imgs) entries.set(String(entry.id), entry);
    }
  });
  return [...entries.values()];
}
