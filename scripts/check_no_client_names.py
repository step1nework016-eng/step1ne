#!/usr/bin/env python3
"""出站守門員：擋住客戶名稱被推上對外網站

## 為什麼要有這支

2026-09-21 出事：對外職缺頁的「熱門職缺」卡片，標籤直接印客戶簡稱
（那個位置本來是要放職缺類型：派遣／正職／中高階獵才）。同一次掃描還發現
另外 4 個公開可讀的頁面整頁都是客戶名——包括一份「哪個職缺對應哪一家客戶」
的完整對照表。

Jacky 問的是對的問題：**為什麼一直在修單點事件？**

三個結構性原因：
  ① 內部文件（/docs、/preview、各種 -preview 樣板）跟對外網站放同一個 repo，
     放進去就等於公開，中間沒有任何一道門。
  ② 資料庫的 confidential_client 開關**只在「自動產生職缺頁」時生效**。
     手寫的 HTML、程式註解、樣板頁完全不受管——出事的首頁標籤就是手寫的。
  ③ 從來沒有任何程式在部署前問過「這份 HTML 裡有沒有客戶名稱」。

這支解決 ②③：不管是手寫、貼上、還是 AI 產生的，都要過這道門。

## 怎麼判斷

從 D1 撈 client_companies 的 display_name 與 aliases，另外自動推出簡稱
（去掉「股份有限公司」「管理顧問」「集團」這類後綴）。任何一個出現在對外
檔案裡就是命中——**包含 HTML 註解與 JS 註解**，因為原始碼任何人都看得到。

## 例外

`ALLOWED` 裡的字串不算命中。目前只有我們自己（德仁管理顧問／Step1ne），
以及「私人招待所」這種本來就不指名的描述。
⚠️ 要加東西進 ALLOWED 之前先問 Jacky——這份清單是最後一道防線。

跑法：
  python3 scripts/check_no_client_names.py        # 掃描，有命中就 exit 1
  python3 scripts/check_no_client_names.py -v     # 連每一處的上下文都印出來
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 只掃真的會被公開讀到的東西
SCAN_EXT = ('.html', '.js', '.css', '.json', '.txt', '.xml', '.md')
SKIP_DIRS = {'.git', 'node_modules', 'scripts', '.wrangler', '.claude'}

# 自己人與不指名的描述——不算外洩
ALLOWED = (
    '德仁管理顧問', 'Step1ne', 'step1ne', 'STEP1NE',
    '私人招待所',            # 刻意不指名的寫法
    '全民獵才',              # 自家 LINE 官方帳號
)

# 公司名常見後綴，去掉之後就是大家實際在講的簡稱（弘昌管理顧問有限公司 → 弘昌）
SUFFIXES = ('股份有限公司', '有限公司', '管理顧問', '科技', '集團', '公司',
            '企業社', '工程行', '事業處')


def d1(sql):
    """走 wrangler 查 D1。這支是部署前跑的，不在乎幾秒鐘。"""
    r = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', 'step1ne-recruit', '--remote',
         '--json', '--command', sql],
        cwd=os.path.expanduser('~/claude-projects/工作流程技能包/step1ne-recruit'),
        capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(f'查資料庫失敗：{(r.stderr or r.stdout)[-400:]}')
    out = r.stdout
    i = out.find('[')
    data = json.loads(out[i:]) if i >= 0 else []
    rows = []
    for blk in data:
        rows += blk.get('results', [])
    return rows


def client_names():
    """所有要擋的字串：全名、別名、以及自動推出來的簡稱。"""
    names = set()
    for row in d1('SELECT display_name, aliases FROM client_companies'):
        raw = [row.get('display_name') or '']
        al = row.get('aliases') or ''
        if al.strip().startswith('['):
            try:
                raw += [str(x) for x in json.loads(al)]
            except Exception:
                pass
        else:
            raw += re.split(r'[\n,、;；]', al)
        for n in raw:
            n = (n or '').strip()
            if len(n) < 2:
                continue
            names.add(n)
            # 去掉括號內容再推簡稱：宇泰華科技（PalUp.ai）→ 宇泰華
            base = re.sub(r'[（(].*?[)）]', '', n).strip()
            for suf in SUFFIXES:
                base = base.replace(suf, '')
            base = base.strip()
            if len(base) >= 2:
                names.add(base)
    # 自己人與不指名的描述拿掉
    return sorted({n for n in names
                   if not any(a in n or n in a for a in ALLOWED)},
                  key=len, reverse=True)


def scan(names, verbose=False):
    hits = []
    for root, dirs, files in os.walk(HERE):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fn in files:
            if not fn.endswith(SCAN_EXT):
                continue
            path = os.path.join(root, fn)
            rel = os.path.relpath(path, HERE)
            try:
                text = open(path, encoding='utf-8').read()
            except Exception:
                continue
            for n in names:
                if n not in text:
                    continue
                for i, line in enumerate(text.split('\n'), 1):
                    if n in line:
                        hits.append((rel, i, n, line.strip()[:120]))
                        if not verbose:
                            break
    return hits


def main():
    verbose = '-v' in sys.argv
    names = client_names()
    print(f'要擋的客戶名稱／簡稱共 {len(names)} 組')
    hits = scan(names, verbose)
    if not hits:
        print('✅ 對外網站沒有任何客戶名稱')
        return 0
    print(f'\n🚨 命中 {len(hits)} 處——**不要部署**：\n')
    for rel, ln, name, line in hits:
        print(f'  {rel}:{ln}  ←「{name}」')
        print(f'      {line}')
    print('\n客戶名稱不得出現在對外網站的任何地方，包含 HTML 與 JS 的註解')
    print('（原始碼任何人都看得到）。職缺卡片那個位置要放的是職缺類型，')
    print('不是客戶是誰。')
    return 1


if __name__ == '__main__':
    sys.exit(main())
