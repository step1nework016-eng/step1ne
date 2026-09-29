// 企業端文章的「留需求」小表單（2026-09-29）。
// 企業決策者多半不會為了問一句話去加陌生 LINE——企業端頁 30 天 257 人進站、0 人留聯絡方式。
// 表單送到 step1ne-recruit-api /bd/inbound-lead → company_leads ＋ TG「🏢 官網企業詢問」。
(function () {
  var API = 'https://step1ne-recruit-api.aiagentg888.workers.dev/bd/inbound-lead';
  document.querySelectorAll('form.s1-lead').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = f.querySelector('.s1-lead-msg');
      var btn = f.querySelector('button[type=submit]');
      var v = function (n) { var el = f.elements[n]; return el ? el.value.trim() : ''; };
      if (!v('company') || !v('contact')) {
        msg.textContent = '請填公司名稱，以及 Email 或電話';
        msg.style.color = '#B42318';
        return;
      }
      btn.disabled = true;
      btn.textContent = '送出中…';
      fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          company: v('company'), job: v('job'), contact: v('contact'), plan: v('plan'),
          website: v('website'), page: location.pathname
        })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) {
          f.querySelectorAll('input,button').forEach(function (el) { el.disabled = true; });
          btn.textContent = '已送出';
          msg.textContent = '收到了！顧問會在 1 個工作天內跟您聯絡。';
          msg.style.color = '#0F5F87';
          // 2026-09-29 Jacky：送出後直接給一個加 LINE 官方帳號的大按鈕，想更快的人不用等回電
          if (!f.querySelector('.s1-lead-line')) {
            var line = document.createElement('a');
            line.className = 's1-lead-line';
            line.href = 'https://lin.ee/XcSWPzM';
            line.target = '_blank';
            line.rel = 'noopener';
            line.textContent = '想更快？加入 LINE 直接問顧問 →';
            line.setAttribute('data-cta', 'lead-after-submit-line');
            line.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:10px;background:#06C755;color:#fff;font-weight:700;font-size:16px;text-decoration:none';
            line.addEventListener('click', function () {
              if (window.gtag) gtag('event', 'line_cta_click', { cta: 'lead-after-submit', page_path: location.pathname });
            });
            msg.insertAdjacentElement('afterend', line);
          }
          if (window.gtag) gtag('event', 'employer_lead_submit', { page_path: location.pathname });
        } else {
          btn.disabled = false;
          btn.textContent = '免費取得報價與建議';
          msg.textContent = d.error || '送出失敗，請改用 LINE 聯絡我們';
          msg.style.color = '#B42318';
        }
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = '免費取得報價與建議';
        msg.textContent = '網路不穩，請再試一次，或改用 LINE 聯絡我們';
        msg.style.color = '#B42318';
      });
    });
  });
})();
