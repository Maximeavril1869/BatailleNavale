"""Test de bout en bout (navigateur réel, Playwright). Prérequis : serveur statique sur :8123 (python3 -m http.server 8123 à la racine du projet)."""
import json
from playwright.sync_api import sync_playwright
import os
SP=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out')+'/'
os.makedirs(SP,exist_ok=True)
errs=[]
def state(pg): return json.loads(pg.evaluate("localStorage.getItem('bn_partie_v1')"))
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':390,'height':844})
    pg=ctx.new_page()
    pg.on('console',lambda m: errs.append((m.type,m.text)) if m.type=='error' else None)
    pg.on('pageerror',lambda e: errs.append(('pageerror',str(e))))
    pg.goto('http://localhost:8123/index.html'); pg.wait_for_timeout(300)
    pg.screenshot(path=SP+'ph_home.png')
    pg.click('#segMode button[data-m="passe"]'); pg.click('#btnNew'); pg.wait_for_timeout(200)
    pg.click('#plRand'); pg.click('#plOk'); pg.wait_for_timeout(200)
    print('veil visible', pg.is_visible('#veil'), pg.inner_text('#veilTitle'))
    pg.click('#btnVeil'); pg.click('#plRand'); pg.click('#plOk'); pg.wait_for_timeout(200)
    s=state(pg); print('phase',s['phase'],'veil',s['veil'],'turn',s['turn'])
    pg.screenshot(path=SP+'passe_veil_start.png')
    pg.click('#btnVeil'); pg.wait_for_timeout(200)
    pg.screenshot(path=SP+'passe_battle.png')
    s=state(pg); sh=s['turn']; tg=1-sh
    cell=lambda r,c: f'#bTarget b.c[data-r="{r}"][data-c="{c}"]'
    # tir en (0,0) : si touché et rejoue off -> await
    pg.click(cell(0,0)); pg.click(cell(0,0)); pg.wait_for_timeout(200)
    s=state(pg); print('await',s['await'],'turn',s['turn'],'last',s['last'])
    print('bouton:',pg.inner_text('#bAction'))
    pg.screenshot(path=SP+'passe_await.png')
    pg.click('#bAction'); pg.wait_for_timeout(200)
    print('veil visible', pg.is_visible('#veil'), pg.inner_text('#veilTitle'))
    pg.click('#btnVeil'); pg.wait_for_timeout(200)
    s=state(pg); print('view',s['view'],'turn',s['turn'])
    print(pg.inner_text('#bMsg'))
    pg.screenshot(path=SP+'passe_p2.png')
    # solo sur iPhone + niveau fort
    pg.click('#btnMenuB'); pg.click('#btnQuit'); pg.wait_for_timeout(200)
    print('resume visible', pg.is_visible('#btnResume'))
    pg.click('#btnResume'); pg.wait_for_timeout(200)
    print('reprise ok', pg.is_visible('#battle'))
    print('errs',errs)
    b.close()
