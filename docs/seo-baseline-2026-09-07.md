# SEO 基準紀錄　2026-09-07

視窗：2026-06-07 ~ 2026-09-04（90 天。GSC 有 2–3 天延遲）

全站：曝光 17796　點擊 686　CTR 3.85%　平均排名 6.3

## 實驗 A：補 sitemap 的 7 篇（第 2 環）

動作：2026-09-07 用 `scripts/gen_sitemap.py` 重建 sitemap.xml，新增 7 篇文章。
根因：sitemap 只有「上架職缺」流程會更新，文章發布流程完全不碰它。

回收日 **2026-10-05**（4 週）。判準：這 7 篇至少 4 篇曝光 > 0。
沒達標代表：問題不在收錄，是內容進不了前百 → 改查第 3 環。

| 網址 | 曝光 | 點擊 | 排名 |
|---|---|---|---|
| `/articles/ai-interview-anxiety/` | 0 | 0 | — |
| `/articles/ai-interview-fairness/` | 0 | 0 | — |
| `/articles/ai-interview-guide/` | 0 | 0 | — |
| `/articles/ai-interview-questions/` | 0 | 0 | — |
| `/articles/ai-interview-vs-consultant/` | 0 | 0 | — |
| `/articles/bim-career-path/` | 0 | 0 | — |
| `/articles/construction-labor-shortage-bim/` | 0 | 0 | — |

## 對照組：BIM 群組（這輪不動）

| 網址 | 曝光 | 點擊 | 排名 |
|---|---|---|---|
| `/articles/bim-engineer-salary/` | 1454 | 44 | 5.3 |
| `/articles/what-is-bim-engineer/` | 1321 | 37 | 6.8 |
| `/articles/bim-career-change/` | 161 | 12 | 8.0 |
| `/construction/` | 1 | 0 | 9.0 |

## 這輪明確不做

- 不改任何 title / meta description / H1
- 不拆 `/construction/`、不撤 301
- 不加內鏈

## 待排：實驗 C（首頁 + 職缺列表的 H1 變更）

| 頁面 | 現在 | 改版後 |
|---|---|---|
| 首頁 | 為關鍵職位，用 AI 精準媒合對的人 | 找人這件事，應該看得到進度。 |
| 職缺列表 | 職缺專區 | 35 個開放中的職缺 |

這兩個會同時影響排名與 CTR，**必須單獨記基準、單獨回收，不可與實驗 A 同時上線**。

## 診斷結論（2026-09-07）

`/construction/` 斷在第 3 環：已建立索引、但零查詢曝光。
原因是它沒有一個「自己能贏、而文章贏不了」的字——所有 BIM 查詢都由
`what-is-bim-engineer`（排名 7.7）與 `bim-engineer-salary`（排名 5.4）承接。
它想接的交易型意圖（營造職缺／建廠職缺）站上目前零曝光證據。
