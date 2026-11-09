"""Test de bout en bout (navigateur réel, Playwright). Prérequis : serveur statique sur :8123 (python3 -m http.server 8123 à la racine du projet)."""
import json, sys
from playwright.sync_api import sync_playwright
import os
SP=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out')+'/'
os.makedirs(SP,exist_ok=True)
errs=[]
def state(pg): return json.loads(pg.evaluate("localStorage.getItem('bn_partie_v1')"))
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':834,'height':1194})
    pg=ctx.new_page()
    pg.on('console',lambda m: errs.append(('console',m.type,m.text)) if m.type in('error','warning') else None)
    pg.on('pageerror',lambda e: errs.append(('pageerror',str(e))))
    pg.goto('http://localhost:8123/index.html'); pg.wait_for_timeout(300)
    pg.click('#segMode button[data-m="duo"]')
    pg.fill('#n1','Max'); pg.fill('#n2','Léa')
    pg.click('#swRejoue')
    pg.click('#btnNew'); pg.wait_for_timeout(200)
    pg.click('#plRand'); pg.click('#plOk'); pg.wait_for_timeout(300)
    pg.screenshot(path=SP+'duo_veil.png')
    pg.click('#btnVeil'); pg.wait_for_timeout(200)
    pg.screenshot(path=SP+'duo_place2.png')
    pg.click('#plRand'); pg.click('#plOk'); pg.wait_for_timeout(300)
    s=state(pg); print('phase',s['phase'],'turn',s['turn'],'rejoue',s['rejoue'],s['names'])
    pg.screenshot(path=SP+'duo_battle0.png')
    # un tir pour voir la sélection
    sh=s['turn']; tg=1-sh
    cellsel=lambda t,r,c: f'#duo .grid[data-g="d{t}"] b.c[data-r="{r}"][data-c="{c}"]'
    pg.click(cellsel(tg,2,2)); pg.wait_for_timeout(100)
    pg.screenshot(path=SP+'duo_aim.png')
    # partie complète
    shots=0
    while shots<400:
        s=state(pg)
        if s['phase']=='over': break
        sh=s['turn']; tg=1-sh; inc=s['inc'][tg]
        # priorité : voisins d'un touché non coulé, sinon damier
        sunkc={(c[0],c[1]) for sk in s['sunk'][tg] for c in sk['cells']}
        cand=None
        for r in range(10):
            for c in range(10):
                if inc[r][c]==2 and (r,c) not in sunkc:
                    for dr,dc in((0,1),(1,0),(0,-1),(-1,0)):
                        rr,cc=r+dr,c+dc
                        if 0<=rr<10 and 0<=cc<10 and inc[rr][cc]==0 and cand is None: cand=(rr,cc)
        if cand is None:
            for r in range(10):
                for c in range(10):
                    if inc[r][c]==0 and (r+c)%2==0 and cand is None: cand=(r,c)
        if cand is None:
            for r in range(10):
                for c in range(10):
                    if inc[r][c]==0 and cand is None: cand=(r,c)
        pg.click(cellsel(tg,*cand)); pg.click(cellsel(tg,*cand))
        shots+=1
    s=state(pg)
    print('tirs UI',shots,'phase',s['phase'],'winner',s['winner'],'shots',s['shots'])
    pg.wait_for_timeout(300)
    print('dlg open', pg.evaluate("document.getElementById('dlgOver').open"))
    print(pg.inner_text('#overBody'))
    pg.screenshot(path=SP+'duo_over.png')
    pg.click('#ovClose'); pg.wait_for_timeout(200)
    pg.screenshot(path=SP+'duo_reveal.png')
    # paysage
    pg.set_viewport_size({'width':1194,'height':834}); pg.wait_for_timeout(300)
    pg.screenshot(path=SP+'duo_reveal_land.png')
    print('errs',errs)
    b.close()
