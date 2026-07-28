# 職缺頁結構化資料（JobPosting）維護說明

## 為什麼沒有填 streetAddress

Google Search Console 會報「`streetAddress` 欄位未填」，這是**非重大警告**，
而且這裡是**刻意留空的**。

`jobLocation` 指的是「這份工作實際上班的地點」，也就是**委任客戶的辦公室或廠區**。
填上完整街道地址等於直接洩漏是哪一家公司在徵人——那違反匿名原則，
而且客戶多半也沒有授權公開。

編一個看起來合理的地址更糟：結構化資料是給機器讀的事實宣告，
填假地址會讓 Google 的職缺卡片顯示錯誤位置，求職者按了導航會被帶到別的地方。

**填到區級（addressLocality）就停。** 這是誠實且對求職者有用的精度。
哪天某個客戶明確授權公開地址，再單獨補那一頁。

## experienceRequirements 必須是物件

Google 要的是 `OccupationalExperienceRequirements` 物件，帶 `monthsOfExperience` 數字。
純文字會被判定型別不符。原本那段人看得懂的描述改放 `qualifications`，資訊不會掉。

```json
"experienceRequirements": {
  "@type": "OccupationalExperienceRequirements",
  "monthsOfExperience": 24
},
"qualifications": "2 年以上後端開發經驗，具 .NET Core 與 MSSQL 實務經驗"
```

## 地址層級

縣市放 `addressRegion`，鄉鎮市區放 `addressLocality`。
把「台北市」寫進 `addressLocality`、或把「台灣」當地區，都會讓 Google 判讀錯誤。
