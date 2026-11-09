"""Test de bout en bout (navigateur réel, Playwright). Prérequis : serveur statique sur :8123 (python3 -m http.server 8123 à la racine du projet) et serveur PeerJS local sur :9000 (npx peer --port 9000 --path /bn --host 127.0.0.1)."""
import json, time
from playwright.sync_api import sync_playwright
import os
SP=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out')+'/'
os.makedirs(SP,exist_ok=True)
errs=[]
INIT="window.BN_PEER_OPTIONS={host:'localhost',port:9000,path:'/bn',secure:false,key:'peerjs',config:{iceServers:[]}};"
def st(pg,key='bn_partie_v1'):
    v=pg.evaluate(f"localStorage.getItem('{key}')"); return json.loads(v) if v else None
def wait(cond,timeout=20,step=0.2):
    t=time.time()
    while time.time()-t<timeout:
        if cond(): return True
        time.sleep(step)
    return False
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--disable-features=WebRtcHideLocalIpsWithMdns'])
    def mk(w,h,name):
        c=b.new_context(viewport={'width':w,'height':h}); c.add_init_script(INIT)
        pg=c.new_page()
        pg.on('console',lambda m,n=name: errs.append((n,m.type,m.text)) if m.type=='error' else None)
        pg.on('pageerror',lambda e,n=name: errs.append((n,'pageerror',str(e))))
        return c,pg
    ci,ipad=mk(834,1194,'ipad'); c1,ph1=mk(390,844,'ph1'); c2,ph2=mk(412,915,'ph2')
    ipad.goto('http://localhost:8123/index.html'); ipad.wait_for_timeout(300)
    ipad.click('#segMode button[data-m="tel"]'); ipad.click('#btnNew')
    ok=wait(lambda: ipad.evaluate("!!document.getElementById('qr').getAttribute('data-url')"))
    url=ipad.evaluate("document.getElementById('qr').getAttribute('data-url')"); print('QR ok',ok,url)
    ipad.screenshot(path=SP+'tel_host0.png')
    for i,(pg,name) in enumerate([(ph1,'Alice'),(ph2,'Bob')]):
        pg.goto(url); pg.wait_for_timeout(400)
        pg.screenshot(path=SP+f'tel_ph{i}_join.png')
        pg.fill('#phName',name); pg.click('#phGo')
        pg.wait_for_selector('#plOk',state='visible')
    wait(lambda: ipad.evaluate("document.getElementById('slot0').classList.contains('on')&&document.getElementById('slot1').classList.contains('on')"))
    print('slots', ipad.inner_text('#slot0'),'|',ipad.inner_text('#slot1'))
    ipad.screenshot(path=SP+'tel_host1.png')
    ph1.click('#plRand'); ph1.screenshot(path=SP+'tel_ph0_place.png'); ph1.click('#plOk')
    ph2.click('#plRand'); ph2.click('#plOk')
    ok=wait(lambda: (st(ipad) or {}).get('phase')=='battle'); print('battle started',ok)
    ipad.wait_for_timeout(500)
    ipad.screenshot(path=SP+'tel_battle0.png'); ph1.screenshot(path=SP+'tel_ph0_battle.png')
    cellsel=lambda t,r,c: f'#duo .grid[data-g="d{t}"] b.c[data-r="{r}"][data-c="{c}"]'
    shots=0; last=0
    while shots<400:
        s=st(ipad)
        if s['phase']=='over': break
        sh=s['turn']; tg=1-sh; inc=s['inc'][tg]
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
        before=sum(s['shots'])
        ipad.click(cellsel(tg,*cand)); ipad.click(cellsel(tg,*cand))
        ok=wait(lambda: sum(st(ipad)['shots'])>before,timeout=6)
        if not ok: print('tir sans réponse',cand); break
        shots+=1
        if shots==30:
            # test de reprise : on recharge l'iPad en pleine partie
            ipad.reload(); ipad.wait_for_timeout(500); ipad.click('#btnResume')
            ok=wait(lambda: ipad.evaluate("[...document.querySelectorAll('#duo .seat')].length==2") and True)
            ok=wait(lambda: 'déconnecté' not in ipad.inner_text('#seat0') and 'déconnecté' not in ipad.inner_text('#seat1'),timeout=40)
            print('reprise iPad : téléphones reconnectés ->',ok)
    s=st(ipad); print('tirs',shots,'phase',s['phase'],'winner',s['winner'],'shots',s['shots'])
    ipad.wait_for_timeout(500)
    p1=st(ph1,'bn_phone_v1'); p2=st(ph2,'bn_phone_v1')
    print('inc phone1==host inc[0]', p1['inc']==s['inc'][0], ' inc phone2==host inc[1]', p2['inc']==s['inc'][1])
    print('phone1:',ph1.inner_text('#phStatus'),'| phone2:',ph2.inner_text('#phStatus'))
    ph1.screenshot(path=SP+'tel_ph0_over.png'); ipad.screenshot(path=SP+'tel_over.png')
    # revanche
    ipad.click('#ovAgain'); ipad.wait_for_timeout(1200)
    print('revanche : iPad phase',st(ipad)['phase'],'| phone1 sur placement',ph1.is_visible('#plOk'),'| phone2',ph2.is_visible('#plOk'))
    print('errs',errs)
    b.close()
