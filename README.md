# 千島劇本圖片搜尋技能

供 AI 代理直接替代現有圖片搜尋網站找圖的技能，以書面語繁體中文撰寫。2.0 已把網站的全部找圖類別封裝成可執行程式：千島搜尋與圖集、搜尋摘要高清圖源、關鍵詞相關圖片、外部文章及先行版補搜、已核對公開補充來源。

## 安裝與使用

需要 Node.js 22 以上，無須安裝 npm 套件。將儲存庫複製至代理支援的技能目錄；Codex 範例：

```bash
git clone https://github.com/catball912/qiandao-drama-images.git ~/.codex/skills/qiandao-drama-images
```

其他代理可直接讀取 [SKILL.md](SKILL.md)。可提出：

> 使用 $qiandao-drama-images，搜尋狸貓文創工作室《螻蟻》的封面與角色圖片，包含關鍵詞相關素材及其他版本；保存最高可取得解像度，列出來源、待確認圖片及未取得項目。

在儲存庫目錄執行：

```bash
node scripts/qiandao-images.mjs find --query "螻蟻" --publisher "狸貓文創工作室"
node scripts/qiandao-images.mjs download --query "螻蟻" --id 695041088494490294 --output ./downloads/louyi
```

`find` 回傳合併清單，`download` 執行相同收集再下載。不確定同名版本時會列出候選，以結束碼 3 停止；提供作品 ID 或發行方後繼續。

## 搜尋能力

| 網站找圖方式 | Skill 2.0 |
| --- | --- |
| 繁簡名稱搜尋與同名發行方辨識 | 自動搜尋並保留版本選擇 |
| 搜尋摘要封面、officials、HDs | 收集、分類並合併 |
| App 圖集與作品頁 SSR 圖集 | 自動讀取及後備 |
| 搜尋頁 Nuxt／公開資料後備 | API 失敗時使用 |
| 已核對完整封面、角色與外部補充 | 內附具來源紀錄的公開 URL 索引 |
| 其他關鍵詞命中的圖片 | 合併為相關待確認，保留作品 ID |
| 外部文章／先行版補搜 | DuckDuckGo 公開搜尋、文章圖片擷取及已核對先行版索引 |
| lazy-load、srcset、圖片連結 | 擷取較大候選，排除常見頭像與標誌 |
| 外部圖片下載 | 支援與網站相同的公開圖片來源範圍 |
| CDN 原尺寸核對及增量下載 | 保存像素、SHA-256、來源與本地快取 |

具體函式、限制與來源範圍見 [網站方法對照](references/search-methods.md)。已封裝全部找圖方法，不代表來源永遠可用或已收齊全網歷史素材。搜尋引擎拒絕、文章失效或圖集缺項都會保留警告；代理可用既有工具補查，再匯入清單下載。

## 快取、更新與交接

重複執行會重用本地清單及圖片。`--refresh` 重查來源並補充新圖；`--redownload` 才強制重新取得既有圖源。更新失敗或新圖較小時保留舊檔。每個作品應使用獨立輸出目錄。

```bash
node scripts/qiandao-images.mjs find --query "血與冰淇淋" --id 524331162273962445 > collection.json
node scripts/qiandao-images.mjs download --collection ./collection.json --output ./downloads/blood
node scripts/qiandao-images.mjs archives --query "血與冰淇淋"
node scripts/qiandao-images.mjs page --url "https://www.gamersky.com/handbook/202211/1540513.shtml"
node scripts/qiandao-images.mjs --help
```

預設包含相關命中及外部文章；`--core-only` 可略過這兩類。預設輸出最多 80 個圖源、外部最多 8 頁、每頁 24 張候選；上限及來源失敗會明示，`--max-images`、`--max-pages` 可調整。結束碼 `0` 為完成、`1` 為錯誤、`2` 為部分失敗或來源警告、`3` 為待選作品或未找到。

清單會區分來源標示尺寸、實際下載像素及是否轉碼。「官方圖」不等於角色圖；相關候選也不會自動變成已確認素材。工具不生成或插值放大圖片。程式不依賴原網站、個人登入、Vercel 或 Cloudflare；本套件不提供網站 UI、瀏覽器快取、ZIP 按鈕或雲端共用儲存。

## 協定及驗證

[協定說明](references/protocol.md) 記錄公開來源與既有核對摘要；[缺圖追查](references/investigation.md) 說明實際頁面、miniapp 設定與 REA 接力。進階 REA 調查需要代理環境已有工具，不會自動安裝或執行逆向引擎。

2.0 的集中驗證涵蓋 30 個個案，包括各類來源合併、搜尋頁後備、版本選擇、公開補充索引、文章擷取、外部下載與快取重用。2026-11-02 實測《血與冰淇淋》取得 8 個合併圖源；單獨讀取其公開文章取得 22 個待確認圖片候選，外部先行版下載為 1280×1812 JPEG，已完整解碼及核對 SHA-256。候選張數不是本作已確認素材總數。

```bash
node --test tests/*.test.mjs
```

## 授權

原創程式及文件採用 [MIT](LICENSE)。OpenCC 衍生字元資料依 [Apache-2.0](licenses/Apache-2.0.txt) 散布，來源見 [第三方說明](THIRD_PARTY_NOTICES.md)。套件只保存公開來源的網址與核對註記，不附劇本圖片、網站 bundle、APK、HAR 或個人憑證；程式授權不涵蓋外部素材。
