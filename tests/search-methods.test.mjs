import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalImage, compactEntry, search, hash, normalName, saveJson } from '../scripts/lib/qiandao.mjs';
import { entryAssets, mergeAssets, collect } from '../scripts/lib/collect.mjs';
import { pageImages, searchPages, archives } from '../scripts/lib/archives.mjs';
import { fetchSource } from '../scripts/lib/sources.mjs';
import { downloadAssets, bestImage } from '../scripts/lib/download.mjs';

const originalFetch = globalThis.fetch, run = promisify(execFile);
const id = '123456789012345678', relatedId = '234567890123456789';
const cdn = 'https://treasure.qiandaocdn.com/treasure/images/';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=', 'base64');
let temporary;
test.beforeEach(async () => { temporary = await mkdtemp(resolve(import.meta.dirname, '.tmp-')); });
test.afterEach(async () => { globalThis.fetch = originalFetch; await rm(temporary, { recursive: true, force: true }); });

test('搜尋摘要保留單張官方圖、物件高清來源及已核對外部補充', () => {
  const entry = compactEntry({ id: '870707790300079386', name: '野菩萨', imgs: {
    cover: cdn + 'cover.jpg', officials: cdn + 'fjXVCjd8ktW.jpg', HDs: { alternate: { src: cdn + 'hd.png' } },
  } });
  const result = entryAssets(entry);
  assert.equal(result.assets.length, 10);
  assert.equal(result.assets.find(asset => asset.url.endsWith('fjXVCjd8ktW.jpg')).label, '角色｜生吞');
  assert.equal(result.assets.filter(asset => asset.supplemental).length, 7);
  assert.equal(result.assets.find(asset => asset.url.endsWith('hd.png')).category, 'cover');
});
test('外部網址保留查詢參數，合併時保留較大提示、已核對分類及來源參照', () => {
  const outside = 'https://img1.gamersky.com/a.jpg?token=public&size=large';
  assert.equal(canonicalImage(outside).url, outside);
  const url = cdn + 'MYklmALCj5.png';
  const merged = mergeAssets([
    { url, category: 'official', origins: ['gallery'], reported: { width: 2480, height: 3508 } },
    { url: url + '!lfit_w240', category: 'related', origins: ['keyword-related'], reported: { width: 240, height: 339 } },
  ]);
  assert.equal(merged.length, 1); assert.equal(merged[0].category, 'cover');
  assert.equal(merged[0].reported.width, 2480); assert.equal(merged[0].references.length, 2);
});
test('文章解析涵蓋 lazy-load、最大 srcset、圖片連結與 showimage，排除標誌', () => {
  const html = `<img data-original="https://img1.gamersky.com/lazy.jpg">
    <img src="https://img1.gamersky.com/small.jpg" srcset="https://img1.gamersky.com/small.jpg 240w, https://img1.gamersky.com/large.jpg 1280w">
    <a href="https://img1.gamersky.com/full.jpg"><img src="/thumb.jpg"></a>
    <a href="https://www.gamersky.com/showimage/id?https://img1.gamersky.com/early.jpg"><img alt="先行版海報" src="/thumb.jpg"></a>
    <img src="https://img1.gamersky.com/logo.png"><img src="data:image/png;base64,abc">`;
  const result = pageImages(html, 'https://www.gamersky.com/article.html');
  assert.deepEqual(result.map(image => new URL(image.url).pathname), ['/lazy.jpg', '/large.jpg', '/full.jpg', '/early.jpg']);
  assert.equal(result.at(-1).early, true);
});
test('搜尋結果解開公開轉址並過濾千島重複入口及不支援來源', () => {
  const target = 'https://www.gamersky.com/handbook/example.shtml';
  const html = `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(target)}">海報文章</a>
    <a class="result__a" href="https://qiandao.com/spu?id=1">作品</a>
    <a class="result__a" href="https://unlisted.example/article">其他</a>`;
  assert.deepEqual(searchPages(html), [{ url: target, title: '海報文章' }]);
});
test('搜尋 API 失敗時使用搜尋頁 Nuxt 資料，並保留圖源', async () => {
  const nodes = [{ id: 1, name: 2, imgs: 3, key_property: 4 }, id, '測試劇本', { cover: 5 }, '測試發行方', cdn + 'cover.jpg'];
  globalThis.fetch = async raw => {
    if (String(raw).includes('/plast/')) throw new Error('connection failed');
    return new Response('<script id="__NUXT_DATA__" type="application/json">' + JSON.stringify(nodes) + '</script>');
  };
  const result = await search('測試劇本', { cache: temporary });
  assert.equal(result.entries[0].id, id); assert.equal(result.entries[0].imgs.cover, cdn + 'cover.jpg');
  assert.ok(result.warnings.length);
});
test('即時搜尋不可讀時仍可使用具日期的公開後備', async () => {
  globalThis.fetch = async () => new Response('unavailable', { status: 503 });
  const result = await search('兇手與戀人', { cache: temporary });
  assert.equal(result.entries[0].id, '934993024688117205');
  assert.ok(result.entries[0].supplements.some(asset => asset.url.includes('7910288589a4927b3019655907eff31b')));
  assert.ok(result.warnings.some(warning => warning.includes('公開來源後備')));
});
test('搜尋遭明確拒絕後不再切換字形或頁面重試，仍可保留公開後備', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('denied', { status: 403 }); };
  const result = await search('血與冰淇淋', { cache: temporary });
  assert.equal(calls, 1); assert.equal(result.entries[0].id, '524331162273962445');
  assert.ok(result.warnings.some(warning => warning.includes('403')));
});
function route() {
  return async raw => {
    const url = String(raw);
    if (url.endsWith('/now')) return Response.json({ data: { timestamp: Math.floor(Date.now() / 1000) } });
    if (url.includes('/plast/')) return Response.json({ code: 200, data: { items: [
      { id, name: '測試劇本', key_property: '測試發行方', imgs: { cover: cdn + 'cover.jpg', officials: [cdn + 'summary.jpg'], HDs: { full: cdn + 'hd.png' } } },
      { id: relatedId, name: '測試劇本前傳', key_property: '另一發行方', imgs: { cover: cdn + 'related.jpg' } },
    ] } });
    if (url.includes('view-image-groups')) return Response.json({ code: '0', data: {
      spu: { id, name: '測試劇本', cover: cdn + 'cover.jpg' },
      officialImage: { officialPropertyImage: { propertyName: '官方图', images: [cdn + 'gallery.jpg'] } },
      propertyImages: [{ propertyName: '票根', images: [cdn + 'ticket.png'] }],
    } });
    if (url.includes('duckduckgo')) return new Response('<a class="result__a" href="https://www.gamersky.com/article.html">文章</a>');
    if (url === 'https://www.gamersky.com/article.html') return new Response('<title>海報文章</title><img src="https://img1.gamersky.com/external.jpg" alt="先行版">');
    throw new Error('不應請求：' + url);
  };
}
test('整合入口執行全部找圖類別，相關候選不混作本作素材，重開完全重用快取', async () => {
  globalThis.fetch = route();
  const result = await collect({ query: '測試劇本', publisher: '測試發行方', cache: temporary });
  assert.equal(result.state, 'ready'); assert.equal(result.assets.length, 7);
  const origins = new Set(result.assets.flatMap(asset => asset.origins));
  for (const source of ['search-summary', 'gallery', 'keyword-related', 'web-page']) assert.ok(origins.has(source), source);
  const keyword = result.assets.find(asset => asset.relatedWorkId);
  assert.equal(keyword.category, 'related'); assert.equal(keyword.relatedWorkId, relatedId);
  const external = result.assets.find(asset => asset.url.includes('/external.jpg'));
  assert.equal(external.category, 'related'); assert.equal(external.earlyHint, true); assert.equal(external.versionConfirmed, false);
  globalThis.fetch = async () => { throw new Error('快取重用時不應連線'); };
  const again = await collect({ query: '測試劇本', publisher: '測試發行方', cache: temporary });
  assert.equal(again.assets.length, result.assets.length); assert.deepEqual(again.warnings, result.warnings);
});
test('明確關閉補充搜尋時，不請求外部文章亦不加入其他作品圖源', async () => {
  const get = route();
  globalThis.fetch = async raw => { assert.ok(!String(raw).includes('duckduckgo')); return get(raw); };
  const result = await collect({ query: '測試劇本', cache: temporary, coreOnly: true });
  assert.equal(result.assets.length, 5); assert.equal(result.coverage.archives.skipped, true);
  assert.ok(result.assets.every(asset => asset.category !== 'related'));
});
test('先行版索引在搜尋引擎拒絕時保留來源及警告，不繞過挑戰', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('<div class="anomaly-modal">challenge</div>'); };
  const result = await archives('血與冰淇淋', { cache: temporary });
  assert.equal(result.assets.length, 1); assert.equal(result.assets[0].category, 'early');
  assert.equal(result.assets[0].versionConfirmed, true); assert.ok(result.warnings.length);
  assert.equal(calls, 1);
  await archives('血與冰淇淋', { cache: temporary }); assert.equal(calls, 1);
});
test('外部圖片保存原回應與 query，不對相關圖套用直向海報篩選', async () => {
  const url = 'https://img1.gamersky.com/small.png?size=public'; const calls = [];
  globalThis.fetch = async raw => { calls.push(String(raw)); return new Response(png); };
  const result = await downloadAssets([{ url, category: 'related', archive: true }], { output: temporary });
  assert.equal(result.failures, 0); assert.equal(result.results[0].width, 1);
  assert.equal(result.results[0].originalBytesVerified, false); assert.deepEqual(calls, [url]);
  assert.equal(hash(await readFile(resolve(temporary, result.results[0].file))), hash(png));
  const excluded = await bestImage({ url, category: 'early', archive: true }); assert.equal(excluded.excluded, true);
});
test('重新導向不得跳出公開來源範圍', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://unlisted.example/a.png' } }); };
  await assert.rejects(fetchSource('https://img1.gamersky.com/a.png', { kind: 'image' }), /來源網址/);
  assert.equal(calls, 1);
});
test('CLI 面對同名版本以結束碼 3 回傳候選，不自動進入下載', async () => {
  await saveJson(resolve(temporary, 'search-v2', hash(normalName('同名劇本') + ':1') + '.json'), {
    query: '同名劇本', warnings: [], entries: [
      { id, name: '同名劇本', exactTitle: true, description: '發行方一' },
      { id: relatedId, name: '同名劇本', exactTitle: true, description: '發行方二' },
    ],
  });
  try {
    await run(process.execPath, [resolve(import.meta.dirname, '../scripts/qiandao-images.mjs'), 'download', '--query', '同名劇本', '--cache', temporary]);
    assert.fail('應要求選擇');
  } catch (error) {
    assert.equal(error.code, 3); const result = JSON.parse(error.stdout);
    assert.equal(result.state, 'needs-selection'); assert.equal(result.candidates.length, 2);
  }
});
