// 2026-11-02 四顆燈：人選卡片、人選名單、人選電話名單共用。
// 燈的內容（字、顏色、說明）全部由後端從資料庫真實紀錄當場算好（step1ne-backoffice-worker 的 buildFourLights），
// 這裡只負責畫出來，不自己猜狀態。顏色只是輔助，字本身就看得懂（✓／✗／沒接／待確認）。
import { escapeHtml } from './core/security.js';

// 燈的順序與點下去要切到人選卡片的哪個分頁
const ORDER = [['acai', 'ai'], ['resume', 'cv'], ['call', 'call'], ['rec', 'fw']];
const TONES = new Set(['ok', 'mid', 'bad', 'none']);

// mode：'card'＝人選卡片（每顆都是可以點的按鈕，點了切到對應分頁）；'list'＝名單（只顯示，整列本身就能點）
export function fourLightsHtml(lights, mode = 'list') {
  if (!lights || typeof lights !== 'object') return '';
  const items = ORDER.map(([k, tab]) => {
    const l = lights[k];
    if (!l || !l.label) return '';
    const tone = TONES.has(l.tone) ? l.tone : 'none';
    const hint = escapeHtml(l.hint || '');
    const label = escapeHtml(l.label);
    return mode === 'card'
      ? `<button type="button" class="fl-light fl-${tone}" data-light-goto="${tab}" title="${hint}" aria-label="${label}：${hint}"><i aria-hidden="true"></i><span>${label}</span></button>`
      : `<span class="fl-light fl-${tone}" title="${hint}"><i aria-hidden="true"></i><span>${label}</span></span>`;
  }).join('');
  return items ? `<div class="fl-lights fl-${mode}" role="group" aria-label="進度四顆燈">${items}</div>` : '';
}

// 電話名單剛按下結果時，先在畫面上把電洽那顆燈換掉（後端同一份規則：沒接→沒接、空號→號碼錯、其他→有接通），
// 不用等重新整理。下次載入一律以後端算的為準。
export function patchCallLight(lights, result) {
  if (!lights) return;
  if (result === 'no_answer') lights.call = { tone: 'bad', label: '電洽：沒接', hint: '剛剛打了沒接' };
  else if (result === 'bad_number') lights.call = { tone: 'bad', label: '電洽：號碼錯', hint: '打過，空號或號碼錯誤' };
  else if (result) lights.call = { tone: 'ok', label: '電洽 ✓ 有接通', hint: '剛剛電話有接通' };
}
