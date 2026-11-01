# 公開圖集與 CDN 協定

核對日期：2026-11-02。此文件記錄當時的公開 Web 行為，並非千島提供的穩定 API 契約。

## 搜尋及作品 ID

```text
GET https://api.qiandao.com/plast/search/spu?q=<名稱>&start-index=0&max-results=30&origin=history&scene=qiandao_web
```

成功格式為 `code: 200`、`data.items[]`。使用 `id`、`name`、`key_property`／`description` 區分版本，不能將大型 ID 轉為浮點數。繁簡字元正規化只是提高召回率，不代表同名即同作。搜尋摘要中的 `imgs.cover`、`imgs.officials`、`imgs.HDs` 不保證完整。

## 當前圖集

主要接口：

```text
GET https://api.qiandao.com/treasure/v1/spu/view-image-groups?spuId=<作品ID>
```

成功 `code` 為字串 `"0"`。核對 `data.spu.id`，收集：

- `data.spu.cover`
- `data.officialImage.officialPropertyImage.images[]`
- `data.propertyImages[].images[]`
- 有提供時的 `data.officialImage.degree360Media.degree360Images[]`

分組名稱使用 `propertyName`。`editable` 不影響唯讀流程，不應據此修改資料。本次實測回應沒有分頁欄位；日後若出現游標或未辨認分組，應追查並標示部分覆蓋。

作品頁後備接口：

```text
GET https://api.qiandao.com/treasure/flora/v2/entry/ssr?entryType=spu&entryId=<作品ID>
```

成功 `code` 為數字 `0`。核對 `data.view.detailInfo.spuId`，在 `detailInfo.list[]` 找 `type === "images"`，展開 `images.list[].images[]`，分組名稱使用 `label`。此路徑未必另列主封面。網站圖片元件逐組展開，當時未發現前端裁切或分頁。

## 正常匿名 Web metadata

裸請求及只有 package ID 的請求曾回傳 HTTP 405／SYSTEM.FAIL；依公開 Web 程式產生正常 metadata 後，兩個接口均實測成功。不應單憑 405 推論必須登入。

隨附 `scripts/lib/public-client.mjs` 使用 Node 原生 crypto 產生相容格式，不讀取 Cookie、localStorage、個人 token 或登入設定。公開客戶端常數來自下述已發布程式，並非使用者帳戶憑證。

固定標頭：`x-client-package-id: 1044`、`x-request-package-id: 1044`、`x-echoing-env: test-z`。另產生五個 `X-Request-*` 校驗標頭；不傳送 `X-Request-Id`。

簽名輸入為 `pathname + canonicalQuery + requestId + timestamp`，不含 `?`。query keys 降冪排序，key 編碼兩次、value 編碼一次，以 `&` 串接；預設 `requestId` 為空字串。使用公開常數進行 HMAC-SHA256，先取得小寫十六進位字串，再對其 UTF-8 字串做 Base64；不是直接 Base64 原始摘要。

時間可由 `https://api.qiandao.cn/now` 的 `data.timestamp`（秒）校準；超過 60 秒差距才套用偏移。客戶端設有逾時與短期時差快取。HTTP 401、403、429 應回報並停止該來源；不重放私人憑證或繞過挑戰。隨附客戶端只允許上述兩個圖集路徑及 `/now` 的 GET。

## 圖片網址與尺寸

| 原始前綴 | 公開網址 |
| --- | --- |
| `echotechoss://interior-admin-v2.image/` | `https://public.qiandaocdn.com/interior/images/` |
| `echotechoss://user-treasure-v2.image/` | `https://treasure.qiandaocdn.com/treasure/images/` |

先讀取 `imginfo=w2480,h3508` 等提示，再移除 CDN 樣式後綴與 query 作網址去重。提示可能含重複 `h`，亦可能被 URL 編碼；它是來源描述，不是已下載像素。

`treasure` 圖片以 `!info` 查尺寸、`!_origin` 取得公開回應。其他支援的千島 CDN 圖片以 `?x-oss-process=image/info` 查尺寸，再嘗試 `?x-oss-process=image/format,jpg` 或 `png`；JPEG 來源先用 JPG，避免無細節增益的巨大 PNG。每個候選均須讀取實際檔案尺寸。來源資訊吻合不等於取得位元組完全相同的原檔；CDN 轉碼必須記錄。

每張上限 48 MiB，來源資訊 128 KiB。容器檢查支援 PNG、JPEG、WebP、GIF；不包含完整像素解碼。網路層保留 HTTPS 主機、SNI 與憑證檢查；只在連線失敗時嘗試同 CDN 的替代邊緣 DNS，不針對 HTTP 拒絕或 TLS 錯誤重試。

## 公開來源與核對摘要

以下為當時頁面明確引用的公開檔案；檔名包含建置雜湊，日後可能失效。

| 用途 | 來源 | SHA-256 |
| --- | --- | --- |
| 作品頁路由及 API 基底 | [CLOjgkpa.js](https://assets.qiandaocdn.com/web-bundle/cherry/_nuxt/CLOjgkpa.js) | `e0e628bfd329f4d3d07c560c1d1b863aa28a4177239fbc92c2486ccce524677b` |
| `/spu` 頁面實際 caller | [CA-CYheT.js](https://assets.qiandaocdn.com/web-bundle/cherry/_nuxt/CA-CYheT.js) | `ae529fe9baa14b6d51ee17cc43a21675ea2cb22860557c8b6cf8ea27dc32da4e` |
| 圖片分組展開元件 | [D3hiuOqh.js](https://assets.qiandaocdn.com/web-bundle/cherry/_nuxt/D3hiuOqh.js) | `f46f71355d45927814cc693bafe70450bde0f74712d9fd850d4dcff115e39e4d` |
| 匿名校驗程式 | [Bf96USLE.js](https://assets.qiandaocdn.com/web-bundle/cherry/_nuxt/Bf96USLE.js) | `b38fd6f46cc21320b123758015cf85498b8e521c5e640c3030c5af523d389769` |

匿名校驗曾以三組固定輸入對原公開模組逐標頭比對；測試保留其摘要，並非只用同一份新實作自我計算預期值。此儲存庫不收錄整份網站 bundle。

《螻蟻》狸貓版本 `695041088494490294` 的兩個接口當時均列出 7 張官方資料圖：6 張角色、1 張圖集封面；另有不同 URL 的主封面，共 8 個圖源。圖集封面 `MYklmALCj5.png` 來源資訊為 2480×3508，公開下載實際為 JPEG 1080×1528，屬尺寸受限。此為追查示例，不是其他劇本的固定張數或永久素材清單。
