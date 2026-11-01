import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalImage, parseGallery, search, gallery, saveJson, hash, boundedBytes } from '../scripts/lib/qiandao.mjs';
import { downloadAssets, candidates } from '../scripts/lib/download.mjs';
import { imageDetails } from '../scripts/lib/image-details.mjs';

const id = '695041088494490294', cdn = 'https://treasure.qiandaocdn.com/treasure/images/';
const realFetch = globalThis.fetch;
let temporary;
test.beforeEach(async () => { temporary = await mkdtemp(resolve(import.meta.dirname, '.tmp-')); });
test.afterEach(async () => { globalThis.fetch = realFetch; await rm(temporary, { recursive: true, force: true }); });
const payload = () => ({ code: '0', data: {
  spu: { id, name: '蝼蚁', cover: 'echotechoss://user-treasure-v2.image/example-cover.jpg' },
  officialImage: { officialPropertyImage: { propertyName: '官方图', images: ['echotechoss://user-treasure-v2.image/example-role.png?imginfo=w2480%2Ch3508%2Ch3508'] } },
  propertyImages: [{ propertyName: '票根', images: [cdn + 'example-ticket.png'] }, { propertyName: '先行版', images: [cdn + 'example-early.png'] }],
} });

test('解碼尺寸提示、移除樣式及拒絕非公開 CDN', () => {
  assert.deepEqual(canonicalImage('echotechoss://user-treasure-v2.image/a.png!lfit_w240?imginfo=w2480%2Ch3508%2Ch3508'),
    { url: cdn + 'a.png', reported: { width: 2480, height: 3508, verified: false } });
  assert.throws(() => canonicalImage('https://treasure.qiandaocdn.com.evil.test/a.png'));
  assert.throws(() => canonicalImage('https://user:pass@treasure.qiandaocdn.com/a.png'));
});
test('讀取所有分組而不把官方資料圖自動視為角色', () => {
  const result = parseGallery(payload(), id);
  assert.equal(result.assets.length, 4);
  assert.deepEqual(result.assets.map(asset => asset.category), ['cover', 'official', 'ticket', 'early']);
  assert.equal(result.coverage.sourceImages, 3);
  assert.equal(result.coverage.completeWithinResponse, true);
  assert.equal(result.coverage.completeAcrossSources, false);
});
test('作品不符或拒絕不得變成成功空圖集；部分格式錯誤必須標記', () => {
  assert.throws(() => parseGallery(payload(), '870707790300079386'), /不符/);
  assert.throws(() => parseGallery({ code: 20000 }, id));
  const malformed = payload(); delete malformed.data.propertyImages;
  assert.throws(() => parseGallery(malformed, id), /格式/);
  const partial = payload(); partial.data.propertyImages.push({ propertyName: '未知分組', images: null });
  assert.equal(parseGallery(partial, id).coverage.completeWithinResponse, false);
});
test('同名候選保留發行資料，繁簡候選搜尋可由本地重用', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ code: 200, data: { items: [
      { id, name: '蝼蚁', key_property: '狸猫文创工作室' },
      { id: '363597345570656036', name: '蝼蚁', key_property: '动物园剧本工作室' },
    ] } });
  };
  const first = await search('螻蟻', { cache: temporary });
  assert.equal(first.entries.length, 2); assert.ok(first.entries.every(entry => entry.exactTitle));
  assert.notEqual(first.entries[0].description, first.entries[1].description);
  const count = calls, again = await search('螻蟻', { cache: temporary });
  assert.equal(again.cacheHit, true); assert.equal(calls, count);
});
test('主要圖集失敗時使用實際 SSR 結構並保留消失的歷史圖源', async () => {
  await saveJson(resolve(temporary, 'gallery', id + '.json'), { workId: id, assets: [{ url: cdn + 'historic.png' }] });
  globalThis.fetch = async raw => {
    const url = String(raw);
    if (url.endsWith('/now')) return Response.json({ data: { timestamp: Math.floor(Date.now() / 1000) } });
    if (url.includes('view-image-groups')) return Response.json({ code: 20000 });
    return Response.json({ code: 0, data: { view: { detailInfo: { spuId: id, list: [
      { type: 'images', images: { list: [{ label: '官方图', images: [cdn + 'latest.png'] }] } },
    ] } } } });
  };
  const result = await gallery(id, { cache: temporary, refresh: true });
  assert.equal(result.sourceKind, 'product-ssr');
  assert.equal(result.assets.length, 2);
  assert.equal(result.assets.find(asset => asset.url.endsWith('historic.png')).seenInLatest, false);
  const again = await gallery(id, { cache: temporary });
  assert.equal(again.cacheHit, true);
});
test('更新失敗不覆寫快取，明確拒絕不切換來源重試', async () => {
  const file = resolve(temporary, 'gallery', id + '.json');
  await saveJson(file, { workId: id, assets: [{ url: cdn + 'saved.png' }] });
  const original = await readFile(file, 'utf8'); let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('denied', { status: 403 }); };
  await assert.rejects(gallery(id, { cache: temporary, refresh: true }), /403/);
  assert.equal(calls, 1); assert.equal(await readFile(file, 'utf8'), original);
});
test('已保存圖片核對雜湊後不發出下載請求，並防止混用作品目錄', async () => {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=', 'base64');
  const asset = { url: cdn + 'saved.png', reported: { width: 1, height: 1, verified: false } };
  const file = hash(asset.url).slice(0, 20) + '.png';
  await writeFile(resolve(temporary, file), bytes);
  await saveJson(resolve(temporary, 'manifest.json'), { workId: id, assets: [{ ...asset, file, sha256: hash(bytes), sourceSize: { width: 1, height: 1 }, width: 1, height: 1 }] });
  globalThis.fetch = async () => { throw new Error('不應發出請求'); };
  const result = await downloadAssets([asset], { output: temporary, workId: id });
  assert.equal(result.results[0].status, 'reused'); assert.equal(result.failures, 0);
  await assert.rejects(downloadAssets([asset], { output: temporary, workId: '870707790300079386' }), /另一作品/);
  assert.equal(imageDetails(bytes).width, 1);
  assert.throws(() => imageDetails(bytes.subarray(0, -7)), /完整/);
});
test('保留來源格式優先且限制串流大小', async () => {
  const url = 'https://public.qiandaocdn.com/interior/images/a.jpg';
  assert.match(candidates(url, { format: 'JPEG' })[0], /format,jpg$/);
  await assert.rejects(boundedBytes(new Response('oversized'), 2), /大小限制/);
});
