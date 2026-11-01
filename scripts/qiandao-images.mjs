#!/usr/bin/env node
import { search, gallery, canonicalImage } from './lib/qiandao.mjs';
import { downloadAssets } from './lib/download.mjs';

const help = `千島劇本圖片工具（Node.js 22 以上，無須安裝套件）

node scripts/qiandao-images.mjs search --query "螻蟻" [--page 1]
node scripts/qiandao-images.mjs gallery --id 695041088494490294
node scripts/qiandao-images.mjs download --id 695041088494490294 --output ./downloads/louyi
node scripts/qiandao-images.mjs download --url "https://treasure.qiandaocdn.com/treasure/images/MYklmALCj5.png" --output ./downloads/single

共通選項：--cache ./cache（預設 .qiandao-cache）、--refresh（更新搜尋／圖集清單）。
下載選項：--category cover|official|early|ticket、--limit 正整數、--redownload。
--refresh 重查清單後重用已有圖片；--redownload 才重新下載已有圖源。
所有相對路徑均以目前工作目錄為準；每個作品應使用獨立輸出目錄。
標準輸出為 JSON；結束碼 0=完成，1=讀取／參數錯誤，2=部分下載失敗或更新警告。
`;
function args(argv) {
  const [command, ...rest] = argv, options = {};
  const booleans = new Set(['refresh', 'redownload', 'help']);
  const values = new Set(['query', 'page', 'id', 'url', 'output', 'cache', 'category', 'limit']);
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
    let result;
    if (command === 'search') result = await search(options.query, { ...common, page: options.page ? Number(options.page) : 1 });
    else if (command === 'gallery') result = await gallery(options.id, common);
    else if (command === 'download') {
      if (Boolean(options.id) === Boolean(options.url)) throw new Error('下載時請提供 --id 或 --url，兩者擇一。');
      const collection = options.id ? await gallery(options.id, common) : null;
      let assets = collection?.assets || [{ ...canonicalImage(options.url), label: '指定圖源', category: 'unclassified' }];
      if (options.category) {
        if (!['cover', 'official', 'early', 'ticket'].includes(options.category)) throw new Error('不支援此分類。');
        assets = assets.filter(asset => asset.category === options.category);
      }
      if (options.limit) {
        const limit = Number(options.limit);
        if (!Number.isInteger(limit) || limit <= 0) throw new Error('--limit 必須為正整數。');
        assets = assets.slice(0, limit);
      }
      result = await downloadAssets(assets, { output: options.output, workId: collection?.workId || null, redownload: options.redownload });
      if (collection) {
        result.sourcePage = collection.sourcePage;
        result.sourceCoverage = collection.coverage;
        result.sourceWarnings = collection.warnings;
      }
      if (result.failures || result.warnings || result.sourceWarnings?.length) process.exitCode = 2;
    } else throw new Error('未知指令：' + command);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
