# -*- coding: utf-8 -*-
"""日英版拿掉「N 個招募中」這種職缺數（官網不透露規模，10/23 定）。中文頁目前還有，另外列給 Jacky。
翻譯對照本裡只要原文是「地點（N 個招募中）」，日英一律改成只寫地點，並列入數字檢查例外。"""
import json, os, re
D = os.path.join(os.path.dirname(__file__), 'i18n_tm')
pat = re.compile(r'^(.*?)（\s*\d+\s*個招募中）$')
nc_p = os.path.join(D, 'no_number_check.json')
nc = json.load(open(nc_p, encoding='utf-8'))
keys = set(nc['keys'])
for l in ('ja', 'en'):
    p = os.path.join(D, l + '.json'); d = json.load(open(p, encoding='utf-8'))
    for k, v in d.items():
        if pat.match(k):
            d[k] = re.sub(r'\s*[（(][^）)]*\d+[^）)]*[）)]\s*$', '', v).strip()
            keys.add(k)
    json.dump(dict(sorted(d.items())), open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
nc['keys'] = sorted(keys)
nc['_why'] = '這些段落的中文有不該對外的數字（任用率 8 成、N 個招募中），日英版刻意刪掉，數字檢查跳過'
json.dump(nc, open(nc_p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n'.join(k for k in sorted(keys)))
