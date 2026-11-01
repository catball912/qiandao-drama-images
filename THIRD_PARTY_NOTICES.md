# 第三方來源與授權範圍

## OpenCC 字元對照

`scripts/lib/t2s.json` 為從既有 OpenCC 衍生字元表抽出的繁轉簡對照，僅保留單字候選對應，並非完整 OpenCC 詞組轉換器。本儲存庫將原有雙向資料裁為單向 JSON，供搜尋候選及標題比對使用。

來源：[OpenCC](https://github.com/BYVoid/OpenCC)，主要資料 [TSCharacters.txt](https://github.com/BYVoid/OpenCC/blob/master/data/dictionary/TSCharacters.txt)。原衍生快照未保留上游 commit，故不宣稱與特定版本逐項一致。授權為 Apache License 2.0，完整條文保存在 [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt)。

## 千島公開協定

匿名 Web client 的公開協定常數與行為依已發布 JavaScript 進行相容實作；來源及檔案 SHA-256 記於 [references/protocol.md](references/protocol.md)。本儲存庫沒有收錄整份網站程式、APK、登入資訊或 HAR。

## 圖片

本儲存庫不附劇本圖片。示例中的作品名稱、ID 與公開圖片 URL 僅用於定位及核對來源；MIT 授權不涵蓋千島或發行方的圖片、商標及其他素材。

2.0 新增 `scripts/lib/known-sources.json`，整理自原網站已核對的公開 URL 與來源註記，包含外部文章及 MIDU 公開目錄圖片連結；未收錄圖片位元組。歷史註記保留原核對日期與限制，已移除依賴私人本機檔案的路徑。這不是第三方圖片的再授權。
