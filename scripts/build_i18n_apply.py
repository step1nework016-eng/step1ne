# -*- coding: utf-8 -*-
# 以中文版 /apply-quick/index.html 為底，產生 /id/apply-quick/ 與 /vi/apply-quick/。
# 只換顯示文字；送給後端的值一律維持中文（靠 VAL 對照表把畫面上的字轉回中文值）。
# 中文版檔案本身一個字都不動。
import os, sys, json, re
sys.path.insert(0, os.path.dirname(__file__))
from i18n_apply_data import F, ZH, LATER

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = open(os.path.join(ROOT, 'apply-quick', 'index.html'), encoding='utf-8').read()
# 2026-10-21 測試版（「先送出，晚點再聊」）：python3 scripts/build_i18n_apply.py --beta → 只產 /id/、/vi/apply-quick-beta/，正式版不動
SRC_BETA_PATH = os.path.join(ROOT, 'apply-quick-beta', 'index.html')
JOBS = ['bim-engineer-houli', 'semiconductor-bim-mep-drafting-trainee-hsinchu', 'bim-mep-drafting-engineer-hsinchu']
OLD_QUICK = "var QUICK=['bim-mep-drafting-engineer-hsinchu','semiconductor-bim-mep-drafting-trainee-hsinchu','bim-engineer-houli','trainee-engineering-design-engineer','engineering-drafting-trainee-tongluo'];"
OLD_PAY = "var PAY={'bim-mep-drafting-engineer-hsinchu':'月薪 4.1～5 萬','semiconductor-bim-mep-drafting-trainee-hsinchu':'月薪 4.1～5 萬','bim-engineer-houli':'月薪 4.1～5 萬','trainee-engineering-design-engineer':'月薪 3.5～4.5 萬','engineering-drafting-trainee-tongluo':'月薪 4～6 萬'};"


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def build(lang, beta=False):
    T = F[lang]
    t = open(SRC_BETA_PATH, encoding='utf-8').read() if beta else SRC
    # 中文版 2026-10-21 自己加了語言切換（隱藏的 nav＋底部一段 script）。外語版有自己的切換，
    # 兩套同時在會出現兩個 id="sw"、連結重複——外語版一律拿掉中文那套。
    t = re.sub(r'\n  <nav class="sw" id="sw" aria-label="切換語言" hidden><span>語言：</span></nav>', '', t)
    t = re.sub(r'<script>\n// 有印尼文／越南文版的職缺才顯示語言切換.*?</script>\n', '', t, flags=re.S)

    def R(old, new, n=1):
        nonlocal t
        c = t.count(old)
        if n is not None and c != n:
            raise SystemExit('[%s] 找不到或次數不對(%d≠%s): %s' % (lang, c, n, old[:70]))
        t = t.replace(old, new)

    # ── head
    R('<html lang="zh-Hant">', '<html lang="%s">' % lang)
    # 2026-10-21 外語人選模式：多送一個 lang，後端寫進 note「應徵頁語言：…（id）」，阿財據此開場用他的語言歡迎、之後用中文談並評估中文能力
    R("consent:true,also_other:", "consent:true,lang:'%s',also_other:" % lang)
    R('<meta name="robots" content="noindex,nofollow">', '<link rel="canonical" href="https://step1ne.com/%s/apply-quick/">' % lang)
    R('<title>快速應徵｜Step1ne 德仁管理顧問</title>', '<title>%s</title>' % esc(T['title']))
    R('</style></head><body>', """.sw{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 8px;font-size:13px;color:var(--mu)}
.sw a,.sw b{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:#fff;font-weight:700;color:var(--mu);text-decoration:none}
.sw b{background:var(--tx);color:#fff;border-color:var(--tx)}
.sw a:focus-visible{outline:3px solid var(--ac);outline-offset:2px}
.zhnote{background:#fdf3e2;border:1px solid #f3d9a8;border-left:6px solid #a15c07;border-radius:12px;padding:12px 14px;margin:0 0 8px;font-size:14px;font-weight:700;color:#5b3a10}
</style></head><body>""")
    # 語言切換（保留網址參數，切回中文版會帶同一個職缺）
    R('Step1ne 德仁管理顧問</header>', 'Step1ne 德仁管理顧問</header>\n  <nav class="sw" id="sw" aria-label="%s"><span>%s:</span></nav>' % (esc(T['sw_label']), esc(T['lang_label'])))
    # ── 職缺卡
    R('<h1 id="jt">職缺載入中…</h1>', '<h1 id="jt">%s</h1>' % esc(T['loading']))
    R('<span class="hi">無經驗可・公司培訓</span>', '<span class="hi">%s</span>' % esc(T['badge']))
    R('看工作內容', T['view'], None)
    R('aria-label="選擇職缺"', 'aria-label="%s"' % esc(T['pick_aria']))
    R('<h2 id="s0">想應徵哪一個 <small>都是無經驗可、公司培訓</small></h2>', '<h2 id="s0">%s <small>%s</small></h2>' % (esc(T['pick_h']), esc(T['pick_small'])))
    R('<div class="err">請選一個職缺</div>', '<div class="err">%s</div>' % esc(T['pick_err']))
    R('<span>其他培訓職缺我也願意考慮</span>', '<span>%s</span>' % esc(T['also']))
    R('<p class="lead">留下基本資料就完成應徵，<b>約 1 分鐘</b>。履歷可以之後再補。</p>',
      '<p class="zhnote" role="note">%s</p>\n  <p class="lead">%s</p>' % (esc(T['zhnote']), T['lead']))
    # ── 聯絡
    R('<h2 id="s1">怎麼聯絡你</h2>', '<h2 id="s1">%s</h2>' % esc(T['s1']))
    R('<span>姓名<em>*</em></span>', '<span>%s<em>*</em></span>' % esc(T['name_l']))
    R('<div class="err">請填姓名</div>', '<div class="err">%s</div>' % esc(T['name_e']))
    R('<span>手機<em>*</em></span>', '<span>%s<em>*</em></span>' % esc(T['phone_l']))
    R('<div class="err">請填 10 碼手機號碼</div>', '<div class="err">%s</div>' % esc(T['phone_e']))
    R('placeholder="面談連結會寄到這裡"', 'placeholder="%s"' % esc(T['email_ph']))
    R('<div class="err">Email 格式不對</div>', '<div class="err">%s</div>' % esc(T['email_e']))
    R('<span>期望在哪個城市工作<em>*</em></span>', '<span>%s<em>*</em></span>' % esc(T['city_l']))
    old_city = '<option value="">請選擇</option><option>新竹市</option><option>新竹縣</option><option>苗栗縣</option><option>桃園市</option><option>台中市</option><option>台北市</option><option>新北市</option><option value="__other">其他（自己填）</option>'
    new_city = '<option value="">%s</option>' % esc(T['choose']) + ''.join('<option value="%s">%s</option>' % (zh, esc(lb)) for zh, lb in zip(ZH['cities'], T['cities'])) + '<option value="__other">%s</option>' % esc(T['other'])
    R(old_city, new_city)
    R('placeholder="例：彰化、雲林、都可以" aria-label="其他期望工作城市"', 'placeholder="%s" aria-label="%s"' % (esc(T['city_ph']), esc(T['city_aria'])))
    R('<div class="err">請選城市，選「其他」要填寫</div>', '<div class="err">%s</div>' % esc(T['city_e']))
    # ── 背景
    R('<h2 id="s2">你的背景 <small>點選就好，不用打字</small></h2>', '<h2 id="s2">%s <small>%s</small></h2>' % (esc(T['s2']), esc(T['s2_small'])))
    R('<span>相關經驗<em>*</em></span>', '<span>%s<em>*</em></span>' % esc(T['exp_l']))
    R('aria-label="相關經驗"', 'aria-label="%s"' % esc(T['exp_aria']))
    old_exp = ''.join('<button type="button">%s</button>' % z for z in ZH['exps'])
    R(old_exp, ''.join('<button type="button">%s</button>' % esc(x) for x in T['exps']))
    R('<div class="err">請選一個</div>', '<div class="err">%s</div>' % esc(T['chip_err']), None)
    R('可複選', T['multi'], None)
    R('會用的軟體<em>*</em>', '%s<em>*</em>' % esc(T['sw_l']))
    R('aria-label="會用的軟體"', 'aria-label="%s"' % esc(T['sw_l']))
    R('<span>都還沒用過</span>', '<span>%s</span>' % esc(T['sw_none']))
    R('<div class="err">請至少選一個（沒用過也可以選）</div>', '<div class="err">%s</div>' % esc(T['sw_e']))
    R('相關證照<em>*</em>', '%s<em>*</em>' % esc(T['cert_l']))
    R('aria-label="相關證照"', 'aria-label="%s"' % esc(T['cert_l']))
    for zh, lb in zip(ZH['certs'], T['certs']):
        R('<span>%s</span>' % zh, '<span>%s</span>' % esc(lb))
    R('<span>其他（自己填）</span>', '<span>%s</span>' % esc(T['other']))
    R('<span>都沒有</span>', '<span>%s</span>' % esc(T['cert_none']))
    R('placeholder="填證照名稱，例：室內裝修工程管理" aria-label="其他證照名稱"', 'placeholder="%s" aria-label="%s"' % (esc(T['cert_ph']), esc(T['cert_aria'])))
    R('<div class="err">請至少選一個（沒有也可以選「都沒有」）</div>', '<div class="err">%s</div>' % esc(T['cert_e']))
    R('<span>有機車駕照嗎<em>*</em> <small style="font-weight:400;color:var(--mu)">這個職缺要騎車到廠區</small></span>',
      '<span>%s<em>*</em> <small style="font-weight:400;color:var(--mu)">%s</small></span>' % (esc(T['moto_l']), esc(T['moto_small'])))
    R('aria-label="機車駕照"', 'aria-label="%s"' % esc(T['moto_aria']))
    R('<button type="button">有</button><button type="button">沒有</button>', ''.join('<button type="button">%s</button>' % esc(x) for x in T['motos']))
    R('<span>最高學歷<em>*</em></span>', '<span>%s<em>*</em></span>' % esc(T['edu_l']))
    old_edu = '<option value="">請選擇</option><option>國中以下</option><option>高中職</option><option>五專</option><option>二專</option><option>二技</option><option>大學</option><option>研究所（碩士）</option><option>博士</option>'
    new_edu = '<option value="">%s</option>' % esc(T['choose']) + ''.join('<option value="%s">%s</option>' % (zh, esc(lb)) for zh, lb in zip(ZH['edus'], T['edus']))
    R(old_edu, new_edu)
    R('<div class="err">請選最高學歷</div>', '<div class="err">%s</div>' % esc(T['edu_e']))
    R('placeholder="學校（選填），例：逢甲大學" aria-label="學校（選填）"', 'placeholder="%s" aria-label="%s"' % (esc(T['school_ph']), esc(T['school_aria'])))
    R('placeholder="科系（選填），例：土木工程學系" aria-label="科系（選填）"', 'placeholder="%s" aria-label="%s"' % (esc(T['dept_ph']), esc(T['dept_aria'])))
    R('<span>最快什麼時候可以上班<em>*</em></span>', '<span>%s<em>*</em></span>' % esc(T['start_l']))
    R('aria-label="可到職時間"', 'aria-label="%s"' % esc(T['start_aria']))
    old_start = ''.join('<button type="button">%s</button>' % z for z in ZH['starts']) + '<button type="button" data-pickdate>指定日期…</button>'
    R(old_start, ''.join('<button type="button">%s</button>' % esc(x) for x in T['starts']) + '<button type="button" data-pickdate>%s</button>' % esc(T['pickdate']))
    R('aria-label="指定可到職日期"', 'aria-label="%s"' % esc(T['date_aria']))
    R('<div class="err">請選一個，或指定日期</div>', '<div class="err">%s</div>' % esc(T['start_e']))
    # ── 履歷
    R('<span>有履歷想先附上嗎？</span><small>選填・可以之後再補</small>', '<span>%s</span><small>%s</small>' % (esc(T['res_sum']), esc(T['res_small'])))
    R('aria-label="附履歷方式"', 'aria-label="%s"' % esc(T['res_aria']))
    R('data-r="file">上傳檔案<', 'data-r="file">%s<' % esc(T['r_file']))
    R('data-r="link">貼連結<', 'data-r="link">%s<' % esc(T['r_link']))
    R('data-r="later">之後用 LINE 傳<', 'data-r="later">%s<' % esc(T['r_later']))
    R('<p class="msg">PDF、Word 或圖片，8MB 以內</p>', '<p class="msg">%s</p>' % esc(T['r_hint']))
    R('placeholder="Google Drive、104、Cake 履歷連結（要設成公開）"', 'placeholder="%s"' % esc(T['r_url_ph']))
    R('<p class="msg">沒有履歷也沒關係，面談時阿財會問你的經歷。</p>', '<p class="msg">%s</p>' % esc(T['r_note']))
    R('<span>我同意 Step1ne 用這些資料聯絡我、推薦適合的職缺。不會未經同意轉給任何公司。</span>', '<span>%s</span>' % esc(T['consent']))
    R('>請勾選同意</p>', '>%s</p>' % esc(T['consent_e']))
    # ── 完成畫面
    R('<h2 id="dh">應徵完成！</h2>', '<h2 id="dh">%s</h2>' % esc(T['done_h']))
    R('<p id="dp">下一步是跟 AI 顧問「阿財」線上聊聊，用打字或語音都可以，大約 20 分鐘，隨時可以中斷再回來。</p>', '<p id="dp">%s</p>' % esc(T['done_p']))
    R('id="now" href="#">現在開始聊</a>', 'id="now" href="#">%s</a>' % esc(T['now']))
    R('id="book">改約其他時間</button>', 'id="book">%s</button>' % esc(T['book']))
    R('<p class="note">面談連結也寄到你的 Email 了，關掉這頁也找得回來。</p>', '<p class="note">%s</p>' % esc(T['done_note']))
    R('送出應徵', T['submit'], None)
    R('<small>送出後就能跟阿財聊，名額滿會讓你選時段</small>', '<small>%s</small>' % esc(T['bar_small']))

    # ── JS：資料表
    J = lambda o: json.dumps(o, ensure_ascii=False)
    val = {}
    for k in ('exps', 'certs', 'motos', 'edus', 'starts'):
        for lb, zh in zip(T[k], ZH[k]):
            assert val.get(lb, zh) == zh, '畫面文字重複: ' + lb
            val[lb] = zh
    for lb, zh in ((T['sw_none'], '都還沒用過'), (T['cert_none'], '都沒有'), (T['other'], '其他（自己填）'), (T['pickdate'], '指定日期…')):
        assert val.get(lb, zh) == zh, '畫面文字重複，會對到錯的中文值: ' + lb
    val[T['sw_none']] = '都還沒用過'; val[T['cert_none']] = '都沒有'; val[T['other']] = '其他（自己填）'; val[T['pickdate']] = '指定日期…'
    err = dict(name=T['err_name'], phone=T['err_phone'], email=T['err_email'], city=T['err_city'], exp=T['err_exp'], sw=T['err_sw'],
               cert=T['err_cert'], moto=T['err_moto'], edu=T['err_edu'], start=T['err_start'], consent=T['err_consent'], resume=T['err_res'], other=T['err_other'])
    msg = {k: T[k] for k in ('fallback', 'sel1', 'sel2', 'sel_prefix', 'slots_n', 'left1', 'left2', 'bookfail', 'wd')}
    R(OLD_QUICK, "var QUICK=%s;" % J(JOBS))
    data = ("var LANG=%s,VAL=%s,ERR=%s,MSG=%s,TT=%s,LOC=%s,DUT=%s;\n"
            % (J(lang), J(val), J(err), J(msg), J(T['titles']), J(T['locs']), J({k: {'duties': v[0], 'reqs': v[1]} for k, v in T['duties_map'].items()})))
    pay = {s: T['pay'] for s in JOBS}
    R(OLD_PAY, "var PAY=%s;\n%s" % (J(pay), data))
    # 語言切換連結
    R("ga('quick_apply_landing',", """(function(){var n=document.getElementById('sw'),s=location.search||'';
var L=[['zh','中文','/apply-quick/'],['id','Bahasa Indonesia','/id/apply-quick/'],['vi','Tiếng Việt','/vi/apply-quick/']];
L.forEach(function(x){var e=document.createElement(x[0]===LANG?'b':'a'); e.textContent=x[1]; e.setAttribute('lang',x[0]==='zh'?'zh-Hant':x[0]);
if(x[0]===LANG){e.setAttribute('aria-current','page')} else {e.href=x[2]+s}; n.appendChild(e)})})();
ga('quick_apply_landing',""")
    # 職缺名稱／地點／薪資改用本地翻譯
    R("esc(j.title)", "esc(TT[sl])")
    R("esc(String(j.loc||'').split(/[，,、]/)[0])+'｜'", "esc(LOC[sl])+' | '")
    R("document.getElementById('jt').textContent=j?j.title:'BIM／繪圖職缺'", "document.getElementById('jt').textContent=TT[JOB]||MSG.fallback")
    R("document.getElementById('jl').textContent=j&&j.loc?String(j.loc).split(/[，,、]/)[0]:''", "document.getElementById('jl').textContent=LOC[JOB]||''")
    R(".catch(function(){document.getElementById('jt').textContent='BIM／繪圖職缺'})", ".catch(function(){document.getElementById('jt').textContent=TT[JOB]||MSG.fallback})")
    # 工作內容改用內建翻譯（原本是抓中文）
    R("jobDetail().then(function(m){var j=m[slug]||{};", "Promise.resolve(DUT).then(function(m){var j=m[slug]||{};")
    R("btn.textContent='收起'", "btn.textContent=%s" % J(T['hide']))
    R("panel.textContent='載入中…'", "panel.textContent=%s" % J(T['loadingd']))
    R("'<h3>主要工作</h3>", "'<h3>%s</h3>" % T['h_duty'])
    R("'<h3>條件</h3>", "'<h3>%s</h3>" % T['h_req'])
    R("'<a href=\"/jobs/'+encodeURIComponent(slug)+'/\" target=\"_blank\" rel=\"noopener\">看完整職缺介紹（另開新頁）</a>'",
      "'<a href=\"/%s/jobs/'+encodeURIComponent(slug)+'/\" target=\"_blank\" rel=\"noopener\">%s</a>'" % (lang, T['fulljob']))
    # 已選 N 項
    R("'已選：'+none.textContent.trim():on?'已選 '+on+' 項':'%s'" % T['multi'], "MSG.sel_prefix+none.textContent.trim():on?MSG.sel1+on+MSG.sel2:%s" % J(T['multi']))
    # 畫面字 → 中文值
    R("function(b){return b.textContent.trim()})}", "function(b){var x=b.textContent.trim();return VAL[x]||x})}")
    # 送出
    R("btn.textContent='送出中…'", "btn.textContent=%s" % J(T['sending']))
    R("new Error('讀不到檔案')", "new Error(%s)" % J(T['err_read']))
    R("new Error('履歷檔超過 8MB，可以改貼連結或之後用 LINE 傳')", "new Error(%s)" % J(T['err_big']))
    R("ff.querySelector('.err').textContent=r.error;", "ff.querySelector('.err').textContent=(ERR[r.field]||ERR.other);")
    R("se.textContent=r.error||'送出失敗，請再試一次'", "se.textContent=(ERR[r.field]||ERR.other)")
    R("se.textContent=e.message||'網路不穩，請再按一次'", "se.textContent=(e&&e.name==='Error'&&e.message)?e.message:%s" % J(T['err_net']))
    # 完成畫面
    R("'你已經在面談中了'", J(T['dh_inprog']))
    R("'這個職缺你剛剛已經應徵、也開始跟阿財聊了，不用重新填。按下面回到面談室就能接著聊。'", J(T['dp_inprog']))
    R("now.textContent='回到面談室'", "now.textContent=%s" % J(T['back_room']))
    R("'應徵完成！選一個面談時段'", J(T['dh_book']))
    R("'現在面談室有 '+(r.busy||'幾')+' 位在聊，名額滿了。選一個方便的時間，時間到之前會寄信提醒你。'",
      "%s+(r.busy||%s)+%s" % (J(T['dp_book1']), J(T['dp_book_busy_unknown']), J(T['dp_book2'])))
    R("'你已經約好面談時間了，時間到之前會寄信提醒你。'", J(T['dp_sched']))
    R("'顧問會先看過你的資料，適合的話會再寄信安排面談。'", J(T['dp_screen']))
    # 預約時段
    R("'<p class=\"note\">時段載入中…</p>'", "'<p class=\"note\">%s</p>'" % T['slots_loading'])
    R("'<p class=\"note\">目前沒有可預約的時段，我們會另外寄信跟你安排。</p>'", "'<p class=\"note\">%s</p>'" % T['slots_none'])
    R("W='日一二三四五六'", "W=MSG.wd")
    R("(d===t?'今天':d===tm?'明天':'')", "(d===t?%s:d===tm?%s:'')" % (J(T['today']), J(T['tomorrow'])))
    R("'</b>（'+wd+'）'", "'</b> ('+wd+')'")
    R("by[d].length+' 個時段</small>", "by[d].length+MSG.slots_n+'</small>")
    R('<div class="day">先選日期</div>', '<div class="day">%s</div>' % T['pick_day'])
    R('aria-label="選日期"', 'aria-label="%s"' % esc(T['day_aria']))
    R('<div class="day">再選時間</div>', '<div class="day">%s</div>' % T['pick_time'])
    R("<small>剩 '+x.left+' 位</small>", "<small>'+MSG.left1+x.left+MSG.left2+'</small>")
    R('<p class="note">約好的時間前會寄信提醒你。</p>', '<p class="note">%s</p>' % T['remind'])
    R("m.textContent='預約中…'", "m.textContent=%s" % J(T['booking']))
    R("m.textContent=r.error||'預約失敗'", "m.textContent=MSG.bookfail")
    R("'已為你預約 '+b.getAttribute('data-slot')+'，時間到之前會寄信提醒你，用信裡的連結進入面談室即可。'",
      "%s+b.getAttribute('data-slot')+%s" % (J(T['booked1']), J(T['booked2'])))
    R("m.textContent='預約失敗，請再試一次'", "m.textContent=MSG.bookfail")

    if beta:
        R('<link rel="canonical" href="https://step1ne.com/%s/apply-quick/">' % lang, '<meta name="robots" content="noindex,nofollow">')
        R("['zh','中文','/apply-quick/'],['id','Bahasa Indonesia','/id/apply-quick/'],['vi','Tiếng Việt','/vi/apply-quick/']",
          "['zh','中文','/apply-quick-beta/'],['id','Bahasa Indonesia','/id/apply-quick-beta/'],['vi','Tiếng Việt','/vi/apply-quick-beta/']")
        R("var LATER_T=null,", "var LATER_T=%s," % J(LATER[lang]))
    out = os.path.join(ROOT, lang, 'apply-quick-beta' if beta else 'apply-quick')
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(t)
    return out


if __name__ == '__main__':
    beta = '--beta' in sys.argv
    for lg in ('id', 'vi'):
        print(build(lg, beta=beta))
