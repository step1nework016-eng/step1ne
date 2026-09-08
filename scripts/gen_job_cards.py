#!/usr/bin/env python3
"""用各職缺內頁的資料重建 /jobs/index.html 的卡片。

為什麼要這支：2026-09-07 查到全站 35 張卡片有 28 張是空的——
job-industry／job-meta／job-desc 全空，只剩職稱跟「查看職缺詳情」。
根因是 publish_job.py 的 update_list() 只會照抄規格 JSON 裡的
card_meta／card_desc／industry，而後台自動上架的規格根本沒有這三個欄位，
於是卡片就長出來但是空的，**而且沒有任何警告**。

內頁其實有完整資料（JobPosting schema 的薪資／地點／僱用型態、
<meta name="description"> 的一句話簡述、hero 的 <span class="tag"> 產業標籤），
所以這支的做法跟 scripts/gen_sitemap.py 同一個路子：不要人工補，
**直接從內頁把資料撈回來填**，以後漏了就再跑一次。

原則：
- 預設只補空的欄位（fill-only）。已經有人工寫過的卡片文案不覆蓋——
  那些是編輯判斷，機器產的版本不見得比較好。
- --force 才會連既有內容一起重產（JD 大改過、想全站對齊時用）。
- --check 只檢查不寫檔，還有空欄位就 exit 1（給上架流程當守門員）。
- 卡片的 <a> 開頭標籤原樣保留（data-track／data-cat／data-pin 這些
  不在 schema 裡的分類資訊不能亂猜），只替換三個內層元素。

用法：
    python3 scripts/gen_job_cards.py            # 補空的
    python3 scripts/gen_job_cards.py --check    # 只檢查
    python3 scripts/gen_job_cards.py --force    # 全部重產
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
LIST_PAGE = os.path.join(SITE, 'jobs', 'index.html')

EMPLOYMENT_LABEL = {
    'FULL_TIME': '正職',
    'PART_TIME': '兼職',
    'CONTRACTOR': '承攬',
    'TEMPORARY': '派遣',
    'INTERN': '實習',
    'PER_DIEM': '日薪',
    'OTHER': '其他',
}


def read_page(slug):
    p = os.path.join(SITE, 'jobs', slug, 'index.html')
    if not os.path.exists(p):
        return None
    return open(p, encoding='utf-8').read()


def page_schema(html):
    """抓內頁的 JobPosting。壞掉的 schema 一律當作沒有，不要讓它整包炸掉。"""
    for m in re.finditer(r'<script type="application/ld\+json">\s*(\{.*?\})\s*</script>', html, re.S):
        try:
            d = json.loads(m.group(1))
        except Exception:
            continue
        if d.get('@type') == 'JobPosting':
            return d
    return None


# 幣別會直接改變數字的意思。/jobs/finance-controller-overseas/ 的 schema 寫的是
# USD 3,000–4,000，/jobs/executive-assistant-japan-taiwan/ 是 JPY 350,000——
# 不看幣別就照數字印，列表卡會變成「月薪 3,000–4,000 元」跟「月薪 35 萬」，
# 一個看起來低到不合理、一個看起來高到不合理，兩個都是假的。
CURRENCY = {
    'TWD': {'wan': '萬', 'unit': '元'},
    'JPY': {'wan': '萬日圓', 'unit': '日圓'},
    'USD': {'wan': None, 'unit': '美金'},
    'CNY': {'wan': None, 'unit': '人民幣'},
    'HKD': {'wan': None, 'unit': '港幣'},
    'SGD': {'wan': None, 'unit': '新加坡幣'},
}


def money(n, currency='TWD'):
    """4 萬 / 3.5 萬 / 40,833 元 / 美金 3,000。

    ⚠️ 不要為了好看四捨五入薪資，那是竄改待遇。
    ⚠️ 一萬以下不要用「萬」——3,000 寫成「0.3 萬」沒有人這樣講。
    """
    n = int(n)
    c = CURRENCY.get(currency, {'wan': None, 'unit': currency})
    if c['wan'] and n >= 10000 and n % 1000 == 0:
        v = n / 10000
        return f'{int(v) if v == int(v) else round(v, 1):g} {c["wan"]}'
    if c['wan']:
        return f'{n:,} {c["unit"]}'
    return f'{c["unit"]} {n:,}'


def salary_text(schema):
    base = schema.get('baseSalary') or {}
    v = base.get('value') or {}
    currency = base.get('currency') or 'TWD'
    lo, hi = v.get('minValue'), v.get('maxValue')
    unit = {'MONTH': '月薪', 'YEAR': '年薪', 'HOUR': '時薪', 'DAY': '日薪'}.get(v.get('unitText'), '月薪')
    # 2026-09-07 Jacky 定的規則：月薪一律只寫下限「N 萬起，依經歷面議」，
    # 不寫上限——寫死區間會變成談薪的天花板，實際待遇本來就依經歷核定。
    # 只有年薪才寫區間（高階職缺的年薪區間是招募資訊的一部分）。
    # ⚠️ 這條規則在五個地方要一致：職缺內頁條件表、列表卡、內文、
    # meta/og/JSON-LD、llms.txt。只改一處會自相矛盾。
    # 同一套規則也在 step1ne-recruit/publish_job.py 的 card_meta()。
    if unit == '年薪' and lo and hi and int(lo) != int(hi):
        a, b = money(lo, currency), money(hi, currency)
        # 兩邊單位一樣就只寫一次（「5 萬–6 萬」→「5–6 萬」）；
        # 單位不一樣（「29,500 元–3.1 萬」）代表混用了，一律退回同一種寫法。
        for suffix in (f' {CURRENCY.get(currency, {}).get("wan")}', f' {CURRENCY.get(currency, {}).get("unit")}'):
            if suffix.strip() and a.endswith(suffix) and b.endswith(suffix):
                return f'{unit} {a[: -len(suffix)]}–{b}'
        pre = CURRENCY.get(currency, {}).get('unit', currency)
        if a.startswith(pre) and b.startswith(pre):
            return f'{unit} {pre} {int(lo):,}–{int(hi):,}'
        return f'{unit} {int(lo):,}–{int(hi):,} {pre}'
    if lo or hi:
        base = lo or hi
        if unit == '月薪':
            txt = money(base, currency)
            # 「美金 3,000」這種前置幣別的寫法，後面直接接「起」會黏在一起，
            # 補一個空白；「4 萬」這種本來就有空白的不用。
            sep = '' if txt.endswith(('萬', '元', '日圓')) else ' '
            return f'{unit} {txt}{sep}起，依經歷面議'
        return f'{unit} {money(base, currency)}以上'
    return ''


def place_text(schema):
    """雲林縣虎尾鎮 → 雲林虎尾。列表卡的空間只夠放這麼短。

    jobLocation 可能是一個 Place，也可能是多個（同一個缺有多個駐點），
    Google 兩種都收——這裡兩種都要吃，最多列兩個地點免得卡片爆掉。
    """
    loc = schema.get('jobLocation') or {}
    places = loc if isinstance(loc, list) else [loc]
    out = []
    for pl in places:
        addr = ((pl or {}).get('address') or {})
        region = re.sub(r'[縣市]$', '', (addr.get('addressRegion') or '').strip())
        locality = re.sub(r'[鎮鄉市區]$', '', (addr.get('addressLocality') or '').strip())
        t = (region + locality) if (region and locality) else (region or locality)
        if t and t not in out:
            out.append(t)
    return '／'.join(out[:2])


def employment_text(schema):
    emp = schema.get('employmentType') or []
    if isinstance(emp, str):
        emp = [emp]
    labels = [EMPLOYMENT_LABEL[e] for e in emp if e in EMPLOYMENT_LABEL]
    return '／'.join(dict.fromkeys(labels))


def derive_meta(schema):
    """卡片上的條件標籤。只放 schema 裡真的有的東西，缺就少一格，不補假的。"""
    if not schema:
        return ''
    parts = [t for t in (salary_text(schema), employment_text(schema), place_text(schema)) if t]
    if not parts:
        return ''
    # 第一格是薪資，沿用既有卡片的 <span class="salary"> 樣式。
    spans = [f'<span><span class="salary">{parts[0]}</span></span>'] if salary_text(schema) else []
    rest = parts[1:] if spans else parts
    spans += [f'<span>{t}</span>' for t in rest]
    return ''.join(spans)


def derive_desc(html, schema):
    """一句話簡述。

    優先用 <meta name="description">——那是為了給人讀而寫的一句話。
    schema 的 description 第一段在後台自動上架的職缺裡常常只是職稱本身
    （publish_job.py 的 ld_description 在沒有 intro 時會退回 title），
    那種情況拿來當卡片文案等於還是空的，所以只在它跟職稱不同時才用。
    """
    m = re.search(r'<meta name="description" content="([^"]*)"', html)
    if m and m.group(1).strip():
        return m.group(1).strip()
    if schema:
        p = re.search(r'<p>(.*?)</p>', schema.get('description') or '', re.S)
        if p:
            text = re.sub(r'<[^>]+>', '', p.group(1)).strip()
            if text and text != (schema.get('title') or '').strip():
                return text
    return ''


def derive_industry(html, spec_industry=''):
    """產業標籤。

    ⚠️ 內頁沒有這個資訊的可靠來源。試過拿 hero 的 <span class="tag"> 來當
    產業，實測會出錯——`headhunter-consultant` 的 tag 是「不限相關經驗／台北」，
    那是條件不是產業，照抄就會在列表頁標出一個假的產業別。data-cat 也不能用：
    後台自動上架的職缺 cat 全部落在 publish_job.py 的預設值 'service'，
    照它翻譯會把職安衛工程師標成「客服・行政」。

    所以這裡只認**上架規格真的有寫**的 industry，沒有就留空——
    寧可少一行標籤，也不要在職缺頁上寫一個編出來的產業別。
    真正的修法在上游：讓 AI 擬稿時一起產出 industry（見
    jobintake/jd_ai_draft_tick.py），新上架的職缺就會自己帶著這個欄位。
    """
    return (spec_industry or '').strip()


FIELD_RE = {
    'industry': re.compile(r'(<div class="job-industry">)(.*?)(</div>)', re.S),
    'meta': re.compile(r'(<div class="job-meta">)(.*?)(</div>)', re.S),
    'desc': re.compile(r'(<p class="job-desc">)(.*?)(</p>)', re.S),
}


def fill_card(card, slug, force, spec_industry=''):
    html = read_page(slug)
    if html is None:
        return card, [], f'找不到內頁 jobs/{slug}/index.html'
    schema = page_schema(html)
    want = {
        'industry': derive_industry(html, spec_industry),
        'meta': derive_meta(schema),
        'desc': derive_desc(html, schema),
    }
    changed = []
    for key, rx in FIELD_RE.items():
        m = rx.search(card)
        if not m:
            continue
        current = m.group(2).strip()
        if current and not force:
            continue
        new = want[key]
        if not new or new == current:
            continue
        card = card[:m.start()] + m.group(1) + new + m.group(3) + card[m.end():]
        changed.append(key)
    missing = [k for k, rx in FIELD_RE.items()
               if (rx.search(card).group(2).strip() if rx.search(card) else '') == '']
    return card, changed, missing


CARD_RE = re.compile(r'<a class="job"[^>]*>.*?</a>', re.S)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true', help='連既有內容一起重產')
    ap.add_argument('--check', action='store_true', help='只檢查不寫檔；還有空欄位就 exit 1')
    ap.add_argument('--slug', help='只處理這一個職缺')
    a = ap.parse_args()

    s = open(LIST_PAGE, encoding='utf-8').read()
    out = []
    last = 0
    filled = 0
    problems = []
    total = 0

    for m in CARD_RE.finditer(s):
        card = m.group(0)
        hm = re.search(r'href="/jobs/([^/"]+)/?"', card)
        if not hm:
            continue
        slug = hm.group(1)
        total += 1
        if a.slug and slug != a.slug:
            continue
        new_card, changed, missing = fill_card(card, slug, a.force)
        if changed:
            filled += 1
            if not a.check:
                print(f'  補 {slug}：{"／".join(changed)}')
        if missing:
            problems.append((slug, missing))
        out.append(s[last:m.start()])
        out.append(new_card)
        last = m.end()

    out.append(s[last:])
    result = ''.join(out)

    # industry 只是提醒——它在內頁沒有來源，缺了不該擋住上架（見 derive_industry）。
    # meta／desc 缺了才是真的壞掉：那代表候選人在列表頁看不到薪資、地點跟任何說明。
    blocking = [(g, m) for g, m in problems if [x for x in m if x != 'industry']]
    if a.check:
        # 檢查的是「跑完這支之後還會不會有空卡片」——因為上架流程本來就會跑它，
        # 補得起來的不算問題，補不起來（內頁根本沒資料）的才要擋。
        print(f'檢查 {total} 張卡片：{len(blocking)} 張缺薪資/地點/簡述，'
              f'{len([1 for _, m in problems if "industry" in m])} 張缺產業別（僅提醒）')
        for g, m in problems:
            print(('  ❌ ' if [x for x in m if x != 'industry'] else '  ⚠️  ') + f'{g}：缺 ' + '／'.join(m))
        sys.exit(1 if blocking else 0)

    if result != s:
        open(LIST_PAGE, 'w', encoding='utf-8').write(result)
    print(f'✅ 共 {total} 張卡片，補了 {filled} 張')
    for g, m in problems:
        print(('  ❌ 仍缺　' if [x for x in m if x != 'industry'] else '  ⚠️  待補　') + f'{g}：' + '／'.join(m))


if __name__ == '__main__':
    main()
