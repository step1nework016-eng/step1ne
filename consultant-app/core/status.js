const DEFINITIONS = {
  active: ['面談中', 'success'], paused: ['等待候選人回來', 'warning'], done: ['已完成', 'info'],
  new: ['新進件', 'info'], ready: ['可開始', 'info'], awaiting_booking: ['待預約', 'warning'],
  scheduled: ['已預約', 'info'], pending_assessment: ['待顧問評估', 'warning'], interviewed: ['已面談', 'info'],
  redirected: ['已轉介', 'neutral'], rejected: ['不適合', 'danger'],
  screening: ['篩選中', 'info'], confirm: ['待確認', 'warning'], stage1: ['客戶初審', 'info'],
  stage2: ['客戶一面', 'info'], stage3: ['客戶二面', 'info'], stage4: ['客戶終面', 'info'],
  offer: ['Offer', 'success'], onboard: ['已到職', 'success'], care: ['到職關懷', 'success'], backup: ['備選', 'neutral'],
  client_draft: ['客戶草稿', 'neutral'], pending_review: ['待審核', 'warning'], draft: ['AI 擬稿中', 'info'],
  open: ['招募中', 'success'], closed: ['已關閉', 'neutral'],
  needs_material: ['缺素材', 'warning'], drafted: ['待審稿', 'info'], blocked: ['內容封鎖', 'danger'],
  blocked_compliance: ['合規封鎖', 'danger'], approved: ['已核准', 'success'], approved_scheduled: ['已排程', 'success'],
  posting: ['發布中', 'info'], posted: ['已發布', 'success'], ready_manual: ['待手動發布', 'warning'],
  // 2026-09-22 改字：原本是「已略過」，聽起來像系統自己跳過的。
  // 實際上這個狀態只有一個來源——顧問在 Telegram 上按了「不發」。
  // 查證過 skipped 全系統只用在 social_post_queue，改字沒有別的地方會受影響。
  skipped: ['顧問不發這一篇', 'neutral'], expired: ['已過期', 'neutral'],
  // 2026-09-22 補：這三個狀態資料庫裡真的有（claimed 1 筆、deleted 8 筆、
  // superseded 5 筆），但沒有中文翻譯，畫面上一律顯示「未知狀態」——
  // 顧問看到會以為系統壞了。值是查 social_post_queue 實際有的，不是憑印象列。
  claimed: ['產稿中', 'info'], deleted: ['已刪除', 'neutral'],
  superseded: ['已被新版取代', 'neutral'],
  // 阿財初篩報告的 consultant_decision（reports 分頁）
  undecided: ['待處置', 'warning'], forwarded: ['已轉給客戶', 'success'], need_more: ['再看看', 'info'],
  // 接觸紀錄（outreach）的 outcome，白名單照後端 /admin/outreach/outcome 驗證邏輯
  todo: ['待寄送', 'neutral'], sent: ['已寄出', 'info'], replied: ['有回覆', 'success'],
  meeting: ['約到面談', 'success'], no_reply: ['已讀不回', 'warning'], declined: ['婉拒', 'danger'],
  // 阿福健檢（checkups）的 status
  talking: ['對談中', 'info'], reported: ['報告已產出', 'success'],
  // 人選工作台的 tab（/admin/pipeline/tracker 後端算好直接回傳，六分頁架構定案）
  fill: ['等人選填完', 'neutral'], decide: ['等我決定', 'warning'], client: ['客戶面談階段', 'info'], pool: ['候補池', 'neutral']
};

export function statusMeta(value) {
  const key = String(value ?? '').toLowerCase();
  const [label, tone] = DEFINITIONS[key] || [value || '未知狀態', 'neutral'];
  return { key, label, tone };
}

export function statusBadge(value) {
  const meta = statusMeta(value);
  return `<span class="badge ${meta.tone}">${meta.label}</span>`;
}
