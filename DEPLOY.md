# 部署方式

**推 `deploy` 遠端才會上線。`origin` 不會。**

```bash
git push deploy HEAD:main
```

| 遠端 | 位置 | 作用 |
|---|---|---|
| `deploy` | `step1nework016-eng/step1ne` | **Cloudflare Worker `broad-haze-0c9b` 接的來源**，push 後約 45 秒自動建置上線 |
| `origin` | `aijob888/step1ne-website` | 舊備份。沒有任何 webhook，推了不會部署 |

Worker 在 `Official@step1ne.com` 的 Cloudflare 帳號底下，跟 aijob 的帳號是分開的。
`aiagentg888` 那把 CF token 看不到這個 Worker，也查不到建置紀錄——要看 build log
只能登入 step1ne 官方帳號的 Cloudflare 後台。

兩個 repo 內容一樣但 commit hash 不同（各自獨立的歷史），
所以「線上內容跟本機一致」不代表 `origin` 有在部署。2026-07-28 就是這樣誤判過一次：
推了 `origin`、等了 16 分鐘沒生效，查到 `origin` 根本沒有 webhook 才發現接的是另一個 repo。

## 分析追蹤

GA4 `G-DNPMMRDEC0`，裝在每頁 `<head>` 的 `<meta charset>` 之後
（放 charset 前面中文有機率亂碼）。全站的 `lin.ee` 連結點擊會送 `line_cta_click` 事件，
用事件委派掛在 document 上，新增頁面不用再改。
