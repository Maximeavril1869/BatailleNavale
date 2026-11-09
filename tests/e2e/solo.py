"""Test de bout en bout (navigateur réel, Playwright). Prérequis : serveur statique sur :8123 (python3 -m http.server 8123 à la racine du projet)."""
import sys, json
from playwright.sync_api import sync_playwright
import os
SP=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out')+'/'
os.makedirs(SP,exist_ok=True)
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':834,'height':1194},device_scale_factor=1)
    pg=ctx.new_page()
    pg.on('console',lambda m: errs.append(('console',m.type,m.text)) if m.type in('error','warning') else None)
    pg.on('pageerror',lambda e: errs.append(('pageerror',str(e))))
    pg.goto('http://localhost:8123/index.html')
    pg.wait_for_timeout(500)
    pg.screenshot(path=SP+'home.png')
    pg.click('#btnNew')
    pg.wait_for_timeout(200)
    # placement manuelle : porte-avions en A1 horizontal
    def cell(grid,r,c): return f'#{grid} b.c[data-r="{r}"][data-c="{c}"]'
    pg.click(cell('plGrid',0,0))      # porte-avions
    pg.click(cell('plGrid',2,0))      # croiseur
    pg.click('#plRot')
    pg.click(cell('plGrid',4,9))      # contre-torpilleur vertical, ancre trop bas -> recalé ? (4+3<=10 ok)
    pg.click(cell('plGrid',0,0))      # reprend le porte-avions
    pg.wait_for_timeout(100)
    pg.screenshot(path=SP+'place_manual.png')
    print('ok enabled?', pg.is_enabled('#plOk'))
    pg.click('#plRand'); pg.wait_for_timeout(100)
    print('ok enabled after rand?', pg.is_enabled('#plOk'))
    pg.screenshot(path=SP+'place_done.png')
    pg.click('#plOk'); pg.wait_for_timeout(300)
    s=json.loads(pg.evaluate("localStorage.getItem('bn_partie_v1')"))
    print('phase',s['phase'],'turn',s['turn'])
    pg.screenshot(path=SP+'battle0.png')
    # tirer quelques coups
    for (r,c) in [(3,3),(3,4),(5,5)]:
        # attendre notre tour
        for _ in range(40):
            if pg.is_enabled('#bAction') or pg.inner_text('#bAction').startswith('Choisis'):
                break
            pg.wait_for_timeout(200)
        pg.wait_for_timeout(300)
        t=cell('bTarget',r,c)
        if pg.locator(t).count():
            pg.click(t); pg.wait_for_timeout(100)
            if pg.is_enabled('#bAction'): pg.click('#bAction')
        pg.wait_for_timeout(1800)
    pg.screenshot(path=SP+'battle1.png')
    print('msg:',pg.inner_text('#bMsg'))
    print('errs',errs)
    b.close()
