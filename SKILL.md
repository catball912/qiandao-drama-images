---
name: qiandao-drama-images
description: "以現有圖片搜尋網站的完整找圖流程搜尋劇本封面、角色資料圖、先行版及票根；合併千島搜尋摘要與圖集、關鍵詞相關命中、外部文章及已核對補充來源，下載並核對實際解像度。適用於代理直接替代網站找圖或調查漏圖；不涉及生成圖片或放大重製。"
---

# 千島劇本圖片搜尋

以可執行程式完成現有網站的全部找圖類別，無須呼叫該網站或使用個人登入。需要 Node.js 22 以上，無須安裝 npm 套件。程式與下列相對路徑均位於本技能目錄；代理應以實際絕對路徑執行，並把快取與下載結果放在使用者的工作目錄。

## 完整找圖入口

```bash
node scripts/qiandao-images.mjs find --query "螻蟻" --publisher "狸貓文創工作室" --cache ./work/cache
```

`find` 預設依序整合：繁簡名稱搜尋、搜尋摘要封面／官方圖／HDs、當前完整分組圖集、已核對公開補充索引、同次關鍵詞的其他命中、外部文章及先行版來源。兩種圖集接口、搜尋頁 Nuxt 後備及離線公開來源後備均包含在程式內。

同名劇本可能屬於不同發行方。提供 `--publisher` 或經使用者確認的 `--id`；多個合理候選時，結果為 `state: needs-selection`，須列出發行差異請使用者選擇，不要選第一項。作品 ID 保留為字串，避免大整數精度損失。

```bash
node scripts/qiandao-images.mjs find --query "螻蟻" --id 695041088494490294 --cache ./work/cache
node scripts/qiandao-images.mjs download --query "螻蟻" --id 695041088494490294 --cache ./work/cache --output ./work/louyi
```

`download` 的作品入口執行相同完整收集流程，並下載合併結果。`--core-only` 對應網站關閉補充搜尋：略過其他關鍵詞命中及外部文章，仍保留本作已核對補充圖片。各類方法、來源範圍及網頁對照見 [references/search-methods.md](references/search-methods.md)。

## 判讀結果及下載

- `official` 是官方資料圖，可能包含角色、封面或宣傳素材；核對內容後才報告角色名稱及張數。
- `related` 是其他關鍵詞命中或外部文章候選，保留來源作品 ID／原文頁，不能當成本作已確認角色。外部文案中的「先行版」只產生 `earlyHint`；只有已核對索引才標為確認先行版。
- 合併會按公開網址去重，保留來源參照及較大尺寸提示。不同 URL 的相似設計先保留版本，不宣稱位元組相同。
- `coverage` 分別記錄圖集、文章、各來源時間、上限及省略數。`completeAcrossSources` 固定為 `false`；已執行全部搜尋類別不等於已找到全網所有素材。
- 預設每種字形搜尋 30 個候選、外部最多 8 頁、每頁最多 24 張候選、合併輸出最多 80 個圖源，與網頁既有範圍一致。需要時使用 `--page`、`--max-pages`、`--max-images`；達上限會顯示警告。
- 每個作品使用獨立輸出目錄。可用 `--category cover|official|early|ticket|other|related` 或 `--limit` 限定本次下載；未下載項目不能計為下載成功。

圖片及 `manifest.json` 會記錄來源／下載 URL、實際像素、位元組數、SHA-256、轉換方式與失敗原因。程式先查千島來源尺寸，再嘗試公開 CDN 候選；外部圖源直接保存公開回應，不猜測放大參數。

`sourcePixelSizeMatched: true` 只代表尺寸吻合來源資訊；`originalBytesVerified` 仍為 `false`。`quality: limited` 代表未達來源標示尺寸；`!_origin` 或 `imginfo` 均不是取得原圖的證明。內建檢查涵蓋容器基本結構及尺寸，並非完整像素解碼；依代理既有工具檢視所需交付圖片。

## 快取與更新

使用相同 `--cache` 與 `--output` 才能重用結果。再次執行時讀本地搜尋、圖集及文章清單，核對圖片雜湊；`--refresh` 重查來源並補充新圖或尺寸提示變大的圖，`--redownload` 才強制重取既有圖源。更新失敗、新圖較小或來源消失時保留舊檔。

來源消失的舊項目標為 `seenInLatest: false`，不計入當前來源張數。文章搜尋受限的結果也會保存時間與警告，明確更新才重試。1.x 搜尋快取缺少圖片欄位，2.x 首次會重建搜尋清單；既有下載 manifest 仍可重用。

## 分段工具與代理接力

```bash
node scripts/qiandao-images.mjs search --query "血與冰淇淋"
node scripts/qiandao-images.mjs gallery --id 524331162273962445
node scripts/qiandao-images.mjs archives --query "血與冰淇淋"
node scripts/qiandao-images.mjs page --url "https://www.gamersky.com/handbook/202211/1540513.shtml"
node scripts/qiandao-images.mjs find --query "血與冰淇淋" --id 524331162273962445 > collection.json
node scripts/qiandao-images.mjs download --collection ./collection.json --output ./work/images
```

`page` 擷取已知公開文章的圖片；`--collection` 可承接 `find`、`archives` 或 `page` 的 JSON，也可承接代理核對後追加、具有 `url`／分類／來源欄位的清單。圖片 URL 仍按支援的公開來源範圍驗證，不執行網頁程式。

標準輸出為 JSON；結束碼 `0` 完成、`1` 參數或讀取錯誤、`2` 部分下載失敗／來源警告、`3` 待選作品／未找到。非零結果須閱讀內容，尤其不要把部分來源受限當作零張或全套已齊。

## 缺圖與接口變動

匿名 metadata、圖集 schema 與 CDN 行為見 [references/protocol.md](references/protocol.md)；缺圖定位、實際頁面 caller、公開 miniapp 設定及 REA 接力流程見 [references/investigation.md](references/investigation.md)。後者是需要時的進階調查，不是無人介入的 REA 自動逆向。

正常匿名請求仍遭明確拒絕或驗證挑戰時，回報該來源及已保存的結果。代理可使用環境既有搜尋／瀏覽器工具補查已公開素材，再以來源清單接力；不重放個人憑證、不猜 CDN 檔名，也不把靜態方法名稱當作成功請求。

交付時列出作品與發行方、來源頁、當前圖源數、已核對角色、相關待確認數、下載成功／受限／失敗數及尚未定位的素材。此技能以本地目錄取代網站的找圖與下載流程；不包含網站 UI、ZIP 按鈕、瀏覽器 IndexedDB 或 Cloudflare 共用儲存。
