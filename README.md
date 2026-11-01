# 千島劇本圖片搜尋技能

供 AI 代理重用的劇本封面與圖集搜尋流程，以書面語繁體中文撰寫。包含可執行程式，能辨識同名版本、讀取公開圖集、下載圖片、核對實際解像度，並保存來源與本地快取。

## 使用方式

將此儲存庫下載至代理支援的技能目錄，資料夾名稱使用 `qiandao-drama-images`。Codex 可放在 `~/.codex/skills/qiandao-drama-images`；其他代理可直接讀取 [SKILL.md](SKILL.md)。需要 Node.js 22 以上，無須安裝 npm 套件。

```bash
git clone https://github.com/catball912/qiandao-drama-images.git ~/.codex/skills/qiandao-drama-images
```

可向代理提出：

> 使用 $qiandao-drama-images，搜尋狸貓文創工作室《螻蟻》的封面與角色圖片，保存可取得的最高解像度，列出未取得的素材及來源。

若代理無法執行程式，可按技能文件及參考資料使用既有 HTTP／瀏覽器工具；需保留相同的作品核對與尺寸驗證原則。

## 程式範例

在儲存庫目錄執行：

```bash
node scripts/qiandao-images.mjs search --query "螻蟻"
node scripts/qiandao-images.mjs gallery --id 695041088494490294
node scripts/qiandao-images.mjs download --id 695041088494490294 --output ./downloads/louyi
```

重複執行會重用本地結果；`--refresh` 更新搜尋及圖集清單，`--redownload` 強制重新下載已有圖片。完整選項見 `node scripts/qiandao-images.mjs --help`。

這是代理技能及命令列工具，並非託管網站。本地快取不需要雲端帳戶；程式不會上傳下載檔案。

## 能力與界線

| 功能 | 行為 |
| --- | --- |
| 同名作品 | 列出 ID 與發行摘要，由代理依使用者需求確認版本 |
| 圖片收集 | 主封面、官方資料圖及屬性分組；保留票根、先行版標籤 |
| 高清核對 | 比較來源資訊與實際下載像素，不以網址後綴判定原圖 |
| 來源紀錄 | 清單保留網址、尺寸、SHA-256、格式、轉換及錯誤 |
| 增量更新 | 重用本地檔案，更新時補充新圖，保留消失或暫時失效的舊圖 |

當前圖集不保證包含歷史素材或其他平台的全部圖片。「官方圖」也不等於角色圖；圖片內容仍需辨識。程式不會生成、放大或重新繪製圖片。

已於 2026-11-02 驗證公開匿名圖集流程。接口與 CDN 行為可能變動；追查方法、來源雜湊及已知限制見 [協定說明](references/protocol.md) 與 [缺圖追查](references/investigation.md)。

本套件實測《螻蟻》可列出三個同名版本，狸貓版本取得 7 張資料圖加另列主封面；單張公開下載為 1080×1528 JPEG，已完整解碼並核對 SHA-256，清單如實標示尺寸受限。再次執行會重用本地檔案。17 項集中測試涵蓋匿名協定、作品辨識、分組、錯誤處理及快取行為。

集中測試：

```bash
node --test tests/*.test.mjs
```

## 授權

本儲存庫的原創程式及文件採用 [MIT 授權](LICENSE)。繁簡字元對照資料衍生自 OpenCC，依 [Apache-2.0](licenses/Apache-2.0.txt) 散布，詳見 [第三方來源](THIRD_PARTY_NOTICES.md)。劇本圖片與千島網站程式不在本儲存庫內，也不因本工具而取得重新散布授權。
