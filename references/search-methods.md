# 網站找圖方法對照

對照基準：2026-11-02 的圖片搜尋網站第 14 版。網站原始函式名稱供追溯；本套件不依賴該網站部署或私有伺服器。此表列的是找圖與下載方法，非網站介面功能。

| 原網站方法 | 本套件實作 | 入口 |
| --- | --- | --- |
| `searchEntries` 繁簡搜尋、兩個 API origins | `qiandao.mjs/search` | `search`、`find`、`download` |
| `decodeEntries` 搜尋頁 Nuxt 解析 | `sources.mjs/decodeEntries` | 搜尋 API 非明確拒絕的失敗後備 |
| `KNOWN_SOURCES.entries` 公開作品後備 | `known-sources.json`、`compactEntry` | 即時搜尋未取得作品時 |
| `entryAssets` 封面、officials、HDs、補充來源 | `collect.mjs/entryAssets` | `find`、`download` |
| `workGallery`／`galleryFromResponse` | `qiandao.mjs/gallery`、`parseGallery` | `gallery`、整合入口 |
| `imageLabels`／`imageAnnotations`／補充索引 | `known-sources.json`、`mergeAssets` | 分類與已核對來源合併 |
| 其他搜尋命中的 `entryAssets` | `collect.mjs/collect` | 預設加入 `keyword-related`，可用 `--core-only` 關閉 |
| `discoverArchives` 搜尋文章、既有先行版 | `archives.mjs/archives` | `archives`、整合入口 |
| `pageImages` 圖片連結、lazy-load、srcset | `archives.mjs/pageImages` | 文章補搜、`page` |
| `canonicalImage` 網址正規化 | `qiandao.mjs/canonicalImage` | 全部入口 |
| `downloadedImage` CDN 候選、實際像素、海報篩選 | `download.mjs/bestImage` | `download` |
| 舊圖保留及更新 | 本地 JSON／圖片 manifest | 直接重用；`--refresh` 更新清單 |

## 公開補充索引

`scripts/lib/known-sources.json` 由網站的公開來源索引整理，包含《血與冰淇淋》先行版、《兇手與戀人》另一名單版完整封面、《野菩薩》外部角色海報、《螻蟻》六角色與圖集封面註記。保留原始作品名稱與來源 URL，沒有收錄圖片位元組或私人本機路徑。這些是具日期的核對結果，不是每本劇本的固定模板。

索引與即時圖集互補；即時圖集失敗不刪除已知圖源。已核對圖片註記可修正同網址的分類，但其他作品的同關鍵詞命中仍為 `related`。URL 去重會保留來源參照、較大尺寸提示及補充標籤。

## 外部搜尋與圖片擷取

搜尋字串與網站一致：`"<簡體劇本名>" 剧本杀 海报`，使用 DuckDuckGo 公開 HTML 結果。解析直接連結及 `uddg` 轉址，只取支援文章來源，略過千島作品頁，避免重複當外部素材。

文章解析器保留網站的 `data-original`、`data-src`、`data-lazy-src`、`src`、最大 `srcset`、直接圖片 anchor 及 Gamersky `showimage` 連結處理；略過常見頭像、標誌、空白圖與 data URI。文章文字可能含劇透，解析器只擷取圖片，不執行頁面 JavaScript。

一般外部文章圖片及文案中的先行版提示都屬待確認，只有索引中已核對的先行版明確標示 `early`。對已確認版本的文章海報沿用網站的最低 480×650、寬高比 0.4 至 0.9 篩選；相關待確認圖不套用此篩選。

網站原本需先讀文章才使用已核對圖片索引；技能可直接保留已核對 URL，即使文章暫時失效，仍標示其索引來源。未收錄的文章仍須即時讀取，不能把已知單張圖當作已讀完整文章。

## 來源範圍與上限

文章來源：千島、Gamersky、52jubensha、sina.cn、sohu.com、weibo.com、80larp.com。圖片來源：qiandaocdn.com、qiandaoapp.com、gamersky.com、52jubensha.com、sinaimg.cn、qpic.cn、sohu.com、80larp.com、myqcloud.com，以及指定 MIDU 公開 CDN。子網域允許規則與網站一致；每次重新導向也會驗證來源，未關閉 TLS 憑證檢查。

預設每種字形每頁 30 個千島候選、外部 8 頁、單頁 24 張圖片、輸出 80 圖源。`--page` 可換搜尋頁；`--max-pages` 為 1 至 32、`--max-images` 為 1 至 1000，超限會明示省略數，完整已收集清單另留在本地收藏快取。每張下載仍上限 48 MiB，頁面 5 MiB。

搜尋引擎可能拒絕或要求驗證。程式保存失敗警告、已知素材與時間，不繞過挑戰；代理可用環境既有公開搜尋／瀏覽器工具取得合法可讀的文章，交給 `page` 或整理為 `--collection` 輸入。受限的搜尋仍是部分完成，不能宣稱未找到任何相關素材。

## 與網站執行方式的差異

`find` 只回傳來源清單；`download` 才保存圖片。代理可以接手版本判斷與內容辨識，不需要網站 UI。瀏覽器 IndexedDB、ZIP 封裝、Cloudflare 共用快取及其帳戶設定不屬於找圖方法，改由本地檔案與 JSON 提供重用及交接。REA 與 miniapp 設定追查屬進階方法文件，與網站原本一樣，並非通用自動執行入口。
