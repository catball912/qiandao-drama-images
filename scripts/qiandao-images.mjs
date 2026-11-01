#!/usr/bin/env node
import { readJson, canonicalImage, search, gallery } from './lib/qiandao.mjs';
import { archives, inspectPage } from './lib/archives.mjs';
import { collect } from './lib/collect.mjs';
import { downloadAssets } from './lib/download.mjs';

const help = `千島劇本圖片工具 2.0（Node.js 22 以上，無須安裝套件）

node scripts/qiandao-images.mjs find --query "螻蟻" --publisher "狸貓文創工作室"
node scripts/qiandao-images.mjs find --query "螻蟻" --id 695041088494490294
node scripts/qiandao-images.mjs download --query "螻蟻" --id 695041088494490294 --output ./downloads/louyi
node scripts/qiandao-images.mjs search --query "螻蟻" [--page 1]
node scripts/qiandao-images.mjs gallery --id 695041088494490294
node scripts/qiandao-images.mjs archives --query "血與冰淇淋"
node scripts/qiandao-images.mjs page --url "https://www.gamersky.com/handbook/202211/1540513.shtml"
node scripts/qiandao-images.mjs download --collection ./collection.json --output ./downloads/work
node scripts/qiandao-images.mjs download --url "https://img1.gamersky.com/image2022/11/20221122_djq_587_2/1.jpg" --output ./downloads/single

find／download 預設合併搜尋摘要、完整圖集、公開補充索引、其他關鍵詞命中及外部文章。
同名作品未確認時輸出候選並以結束碼 3 停止，不會自行選第一項。
--core-only 略過其他關鍵詞命中與外部文章；仍保留本作已核對補充來源。
--cache ./cache（預設 .qiandao-cache）、--refresh（更新清單）、--max-images 80、--max-pages 8。
--refresh 重查來源後重用已有圖片；--redownload 才重新下載已有圖源。
下載篩選：--category cover|official|early|ticket|other|related、--limit 正整數。
相對路徑以目前工作目錄為準；每個作品使用獨立輸出目錄。
標準輸出為 JSON；結束碼 0=完成，1=錯誤，2=部分下載失敗／來源警告，3=待選作品／未找到。
`;
function args(argv) {
  const [command, ...rest] = argv, options = {};
  const booleans = new Set(['refresh', 'redownload', 'help', 'core-only']);
  const values = new Set(['query', 'publisher', 'page', 'id', 'url', 'output', 'cache', 'category', 'limit', 'collection', 'max-images', 'max-pages']);
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].replace(/^--/, '');
    if (!rest[i].startsWith('--') || (!booleans.has(key) && !values.has(key))) throw new Error('未知選項：' + rest[i]);
    if (Object.hasOwn(options, key)) throw new Error('選項重複：' + key);
    if (booleans.has(key)) options[key] = true;
    else {
      if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('選項缺少值：' + key);
      options[key] = rest[++i];
    }
  }
  return { command, options };
}
try {
  const { command, options } = args(process.argv.slice(2));
  if (!command || ['help', '--help', '-h'].includes(command) || options.help) console.log(help);
  else {
    const common = { cache: options.cache, refresh: options.refresh };
    const selection = { ...common, query: options.query, id: options.id, publisher: options.publisher,
      page: options.page ? Number(options.page) : 1, coreOnly: options['core-only'],
      maxImages: options['max-images'] ? Number(options['max-images']) : 80,
      maxPages: options['max-pages'] ? Number(options['max-pages']) : 8 };
    let result;
    if (command === 'search') result = await search(options.query, { ...common, page: selection.page });
    else if (command === 'gallery') result = await gallery(options.id, common);
    else if (command === 'archives') result = await archives(options.query, { ...common, maxPages: selection.maxPages });
    else if (command === 'page') result = await inspectPage(options.url);
    else if (command === 'find') result = await collect(selection);
    else if (command === 'download') {
      if ([Boolean(options.id || options.query), Boolean(options.url), Boolean(options.collection)].filter(Boolean).length !== 1) throw new Error('請提供作品名稱／ID、--url 或 --collection，三者擇一。');
      const collection = options.collection ? await readJson(options.collection) : options.url
        ? { workId: null, assets: [{ ...canonicalImage(options.url), label: '指定圖源', category: 'unclassified' }], warnings: [] }
        : await collect(selection);
      if (!collection || !Array.isArray(collection.assets) && !collection.state) throw new Error('圖片清單格式不正確。');
      if (collection.state && collection.state !== 'ready') result = collection;
      else {
        let assets = collection.assets;
        if (options.category) {
          if (!['cover', 'official', 'early', 'ticket', 'other', 'related'].includes(options.category)) throw new Error('不支援此分類。');
          assets = assets.filter(asset => asset.category === options.category);
        }
        if (options.limit) {
          const limit = Number(options.limit);
          if (!Number.isInteger(limit) || limit <= 0) throw new Error('--limit 必須為正整數。');
          assets = assets.slice(0, limit);
        }
        result = await downloadAssets(assets, { output: options.output, workId: collection.workId || null, redownload: options.redownload });
        result.sourcePage = collection.sourcePage;
        result.sourceCoverage = collection.coverage;
        result.sourceWarnings = collection.warnings || [];
      }
    } else throw new Error('未知指令：' + command);
    if (['needs-selection', 'not-found'].includes(result.state)) process.exitCode = 3;
    else if (result.failures || Array.isArray(result.warnings) && result.warnings.length || typeof result.warnings === 'number' && result.warnings || result.sourceWarnings?.length) process.exitCode = 2;
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
