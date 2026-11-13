"""Mode « En ligne » de Bataille navale : deux appareils simulés (deux contextes Chromium), faux serveur Supabase en mémoire.

Aucun réseau réel, aucun vrai compte : e-mails, mots de passe et prénoms inventés.
Couvre aussi le plateau (iPad en affichage seul), une partie complète à deux appareils et la partie contre l'ordinateur.
Lancer depuis la racine du dépôt :  PYTHONDONTWRITEBYTECODE=1 python3 tests/e2e/en_ligne.py
"""
import functools
import http.server
import json
import pathlib
import random
import sys
import threading
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
HOST = 'https://zoyrclsppuhgnyzgodjv.supabase.co'
ACCOUNTS = {'max@example.com': ('mot-de-passe-1', 'uid-max'), 'claire@example.com': ('mot-de-passe-2', 'uid-claire'), 'intrus@example.com': ('mot-de-passe-3', 'uid-intrus')}
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, prefer',
        'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS'}
RESULTS = []


def check(name, ok, detail=''):
    RESULTS.append((name, bool(ok)))
    print(('  OK   ' if ok else '  ECHEC ') + name + ('' if ok else '  -> ' + str(detail)[:300]))


class Faux:
    def __init__(self):
        self.rows = {}
        self.offline = False
        self.cut = set()      # contextes dont le réseau est coupé
        self.n = 0
        self.tokens = {}      # jeton d'accès -> uid
        self.refresh = {}     # jeton de renouvellement -> (email, uid)
        self.conflicts = 0
        self.patches = 0

    def reply(self, route, status, body=None):
        route.fulfill(status=status, headers=CORS, content_type='application/json', body=json.dumps(body) if body is not None else '')

    def new_tokens(self, email, uid):
        self.n += 1
        at, rt = 'AT%d' % self.n, 'RT%d' % self.n
        self.tokens[at] = uid
        self.refresh[rt] = (email, uid)
        return {'access_token': at, 'refresh_token': rt, 'expires_in': 3600, 'user': {'id': uid, 'email': email}}

    def handle(self, route, ctx=None):
        req = route.request
        u = urlparse(req.url)
        q = parse_qs(u.query)
        if req.method == 'OPTIONS':
            route.fulfill(status=204, headers=CORS)
            return
        if self.offline or (ctx is not None and ctx in self.cut):
            route.abort()
            return
        if u.path == '/auth/v1/token':
            body = json.loads(req.post_data or '{}')
            if q.get('grant_type') == ['password']:
                acc = ACCOUNTS.get(body.get('email'))
                if acc and acc[0] == body.get('password'):
                    self.reply(route, 200, self.new_tokens(body['email'], acc[1]))
                else:
                    self.reply(route, 400, {'error_description': 'Invalid login credentials'})
            else:
                r = self.refresh.pop(body.get('refresh_token'), None)
                self.reply(route, 200, self.new_tokens(*r)) if r else self.reply(route, 400, {'error_description': 'Invalid Refresh Token'})
            return
        if u.path == '/rest/v1/parties':
            auth = req.headers.get('authorization', '')
            if not auth.startswith('Bearer ') or auth[7:] not in self.tokens:
                self.reply(route, 401, {'message': 'JWT expired'})
                return
            flt = {k: v[0][3:] for k, v in q.items() if k in ('id', 'jeu', 'version') and v[0].startswith('eq.')}
            match = [r for r in self.rows.values() if all(str(r[k]) == v for k, v in flt.items())]
            if req.method == 'GET':
                cols = q.get('select', ['*'])[0].split(',')
                if q.get('order') == ['maj.desc']:
                    match.sort(key=lambda r: r['maj'], reverse=True)
                out = [r if cols == ['*'] else {c: r[c] for c in cols} for r in match[:int(q.get('limit', ['100'])[0])]]
                self.reply(route, 200, out)
            elif req.method == 'POST':
                it = json.loads(req.post_data)
                if it['id'] in self.rows:
                    self.reply(route, 409, {'code': '23505'})
                else:
                    self.rows[it['id']] = {'id': it['id'], 'jeu': it['jeu'], 'titre': it.get('titre'), 'etat': it['etat'], 'version': it['version'], 'maj': it['maj']}
                    self.reply(route, 201)
            elif req.method == 'PATCH':
                self.patches += 1
                body = json.loads(req.post_data)
                if not match:
                    self.conflicts += 1
                for r in match:
                    r.update({k: body[k] for k in ('etat', 'version', 'maj', 'titre') if k in body})
                self.reply(route, 200, match)
            elif req.method == 'DELETE':
                for r in match:
                    del self.rows[r['id']]
                self.reply(route, 204)
            return
        route.continue_()


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://127.0.0.1:%d/index.html' % srv.server_address[1]


def device(browser, faux, url, poll=150, viewport=None):
    ctx = browser.new_context(viewport=viewport or {'width': 390, 'height': 844})
    ctx.route(HOST + '/**', (lambda c: (lambda route: faux.handle(route, c)))(ctx))
    pg = ctx.new_page()
    pg.errors = []
    pg.on('pageerror', lambda e: pg.errors.append(str(e)))
    pg.on('console', lambda m: pg.errors.append(m.text) if m.type == 'error' and 'ERR_FAILED' not in m.text and 'Failed to load resource' not in m.text else None)
    pg.on('dialog', lambda d: d.accept())
    pg.add_init_script('window.BOT_DELAY=5; window.EL_OPTIONS={poll:%d}; window.PLATEAU_POLL=250; window.PLATEAU_BEAT=300; window.PLATEAU_FRESH=1500;' % poll)
    pg.goto(url)
    return pg


def login(pg, email):
    pg.click('#segMode button[data-m="online"]')
    pg.fill('#olEmail', email)
    pg.fill('#olPwd', ACCOUNTS[email][0])
    pg.click('#btnOlLogin')
    pg.wait_for_selector('#olIn:not([hidden])')


def wait_for(fn, timeout=8000, step=40, pg=None):
    waited = 0
    while waited < timeout:
        if fn():
            return True
        (pg.wait_for_timeout(step) if pg else None)
        waited += step
    return False


def state(faux, id_):
    return faux.rows[id_]['etat']


def fire_move(pg):
    """Si c'est à cet appareil de tirer : vise une case libre au hasard et tire. Rend True si un tir est parti."""
    try:
        if pg.locator('#dlgOver[open]').count() or not pg.locator('#bTarget .grid.armed').count():
            return False
        free = pg.locator('#bTarget b.c.free')
        n = free.count()
        if not n:
            return False
        free.nth(random.randrange(n)).click(timeout=2000)
        pg.click('#bAction', timeout=2000)
        return True
    except Exception:
        return False


def over_open(pg):
    return pg.locator('#dlgOver[open]').count() > 0


def play_until(pages, cond, budget=240):
    import time
    t0 = time.time()
    while time.time() - t0 < budget:
        if cond():
            return True
        moved = False
        for pg in pages:
            if fire_move(pg):
                moved = True
        pages[0].wait_for_timeout(15 if moved else 60)
    return cond()


def hulls(pg, sel):
    return pg.locator(sel + ' b.c.hull').count()


def main():
    srv, url = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        faux = Faux()

        print('Accueil et connexion')
        a = device(browser, faux, url)
        a.evaluate("localStorage.setItem('bn_prefs_v1', JSON.stringify({mode:'tel',level:3,rejoue:false,n1:'Max',n2:'x'}))")
        a.evaluate("localStorage.setItem('bn_partie_v1', JSON.stringify({v:1,mode:'duo',phase:'battle'}))")
        a.reload()
        check('un ancien choix « téléphone » retombe sur « Contre l’ordinateur »', a.locator('#segMode button[data-m="solo"].on').count() == 1)
        check('une ancienne partie « face à face » n’est pas proposée à la reprise', not a.is_visible('#btnResume'))
        check('les anciens modes et la liaison PeerJS n’existent plus', a.locator('#segMode button').count() == 2 and a.locator('#duo, #veil, #telhost, #phone').count() == 0 and a.evaluate('typeof window.Peer') == 'undefined' and a.evaluate('typeof window.Net') == 'undefined')
        a.click('#segMode button[data-m="online"]')
        check('le panneau de connexion apparaît, pas de niveau d’ordinateur', a.is_visible('#onlinePanel') and a.is_visible('#olLogin') and not a.is_visible('#optLevel'))
        check('« Nouvelle partie » est inactif tant qu’on n’est pas connecté', a.is_disabled('#btnNew'))
        check('la version est affichée', 'Version' in a.inner_text('#ver'))
        a.fill('#olEmail', 'max@example.com'); a.fill('#olPwd', 'faux'); a.click('#btnOlLogin')
        a.wait_for_selector('#olErr:not([hidden])')
        check('mauvais mot de passe : message clair', 'refusé' in a.inner_text('#olErr'), a.inner_text('#olErr'))
        login(a, 'max@example.com')
        check('connecté : e-mail affiché, création possible', 'max@example.com' in a.inner_text('#olWho') and not a.is_disabled('#btnNew'))

        print('Création, salle d’attente, jonction')
        a.fill('#n1', 'Max')
        a.click('#swRejoue')
        a.click('#btnNew')
        a.wait_for_selector('#wait:not([hidden])')
        code = a.inner_text('#waitCode').strip()
        check('code à 4 lettres affiché', len(code) == 4 and code.isalpha() and code.isupper(), code)
        row = faux.rows.get(code)
        check('la partie existe sur le serveur (jeu bataillenavale, version 1, variante « rejoue »)', row and row['jeu'] == 'bataillenavale' and row['version'] == 1 and row['etat']['rejoue'] is True)
        check('l’invité n’est pas encore là', row and row['etat']['online']['joined'] is False)

        b = device(browser, faux, url)
        login(b, 'claire@example.com')
        b.fill('#n1', 'Claire')
        b.fill('#olCode', 'ZZZZ'); b.click('#btnOlJoin')
        b.wait_for_selector('#olErr:not([hidden])')
        check('code inconnu : message', 'inconnu' in b.inner_text('#olErr'), b.inner_text('#olErr'))
        b.fill('#olCode', code.lower()); b.click('#btnOlJoin')
        b.wait_for_selector('#place:not([hidden])')
        check('B arrive au placement de sa flotte', 'Place ta flotte' in b.inner_text('#plTitle'))
        check('A sort de la salle d’attente et arrive au placement', wait_for(lambda: not a.is_visible('#wait') and a.is_visible('#place'), 6000, pg=a))
        check('les deux prénoms sont sur le serveur', state(faux, code)['names'] == ['Max', 'Claire'], state(faux, code)['names'])
        c = device(browser, faux, url)
        login(c, 'intrus@example.com')
        c.fill('#olCode', code); c.click('#btnOlJoin')
        c.wait_for_selector('#olErr:not([hidden])')
        check('une troisième personne ne peut pas rejoindre', 'deux joueurs' in c.inner_text('#olErr'), c.inner_text('#olErr'))
        c.context.close()

        print('Placement des flottes (en secret)')
        a.click('#plRand'); b.click('#plRand')
        check('chacun voit sa flotte sur sa grille (17 cases)', hulls(a, '#plGrid') == 17 and hulls(b, '#plGrid') == 17)
        check('rien de la flotte n’est parti sur le serveur avant validation', state(faux, code)['fleets'] == [[], []] and state(faux, code)['ready'] == [False, False])
        # les deux valident « en même temps » : réseau coupé des deux côtés, puis rétabli
        faux.cut.add(a.context); faux.cut.add(b.context)
        a.click('#plOk'); b.click('#plOk')
        a.wait_for_timeout(300)
        check('hors ligne : les deux appareils passent en attente de l’autre flotte', a.is_visible('#fleetwait') and b.is_visible('#fleetwait'))
        faux.cut.discard(a.context); faux.cut.discard(b.context)
        ok = wait_for(lambda: state(faux, code)['phase'] == 'battle', 10000, pg=a)
        check('validations simultanées : aucune n’est perdue, la bataille démarre', ok and state(faux, code)['ready'] == [True, True] and len(state(faux, code)['fleets'][0]) == 5 and len(state(faux, code)['fleets'][1]) == 5, state(faux, code)['ready'])
        check('les deux appareils affichent la bataille', wait_for(lambda: a.is_visible('#battle') and b.is_visible('#battle'), 6000, pg=a))
        check('chacun voit sa flotte (17 cases) et aucun navire adverse', hulls(a, '#bOwn') == 17 and hulls(b, '#bOwn') == 17 and hulls(a, '#bTarget') == 0 and hulls(b, '#bTarget') == 0)
        check('la flotte d’A est bien celle placée par A (même case sur le serveur)', len([1 for s in state(faux, code)['fleets'][0] for _ in s['cells']]) == 17)

        print('Droits de tir')
        turn = state(faux, code)['turn']
        who, other = (a, b) if turn == 0 else (b, a)
        check('seul le joueur dont c’est le tour peut viser', wait_for(lambda: who.locator('#bTarget .grid.armed').count() == 1, 4000, pg=who) and other.locator('#bTarget .grid.armed').count() == 0)
        check('l’autre est en attente', other.inner_text('#bAction').startswith('Au tour de') and other.is_disabled('#bAction'), other.inner_text('#bAction'))
        who.locator('#bTarget b.c.free').nth(0).click()
        check('un premier toucher sélectionne la case sans tirer', 'Feu en' in who.inner_text('#bAction') and state(faux, code)['shots'] == [0, 0])
        print('Hors ligne')
        v_avant = faux.rows[code]['version']
        who.context.set_offline(True); faux.cut.add(who.context)
        check('réseau coupé : la bannière apparaît', wait_for(lambda: who.is_visible('#offbar'), 4000, pg=who))
        who.click('#bAction')
        who.wait_for_timeout(300)
        check('hors ligne : le tir est joué à l’écran', who.locator('#bTarget b.c.hit, #bTarget b.c.miss').count() == 1)
        check('rien n’est parti sur le serveur', faux.rows[code]['version'] == v_avant)
        who.context.set_offline(False); faux.cut.discard(who.context)
        check('retour du réseau : la bannière disparaît et le tir arrive', wait_for(lambda: not who.is_visible('#offbar') and faux.rows[code]['version'] > v_avant, 8000, pg=who))
        check('l’autre appareil voit l’impact sur sa propre flotte', wait_for(lambda: other.locator('#bOwn b.c.hit, #bOwn b.c.miss').count() == 1, 6000, pg=other))

        print('Reprise après rechargement')
        b.reload()
        b.click('#segMode button[data-m="online"]')
        b.wait_for_selector('#olList .olitem')
        check('la partie apparaît dans « Parties en cours »', code in b.inner_text('#olList'))
        b.click('#olList button[data-ol="resume"]')
        b.wait_for_selector('#battle:not([hidden])')
        check('reprise : Claire retrouve sa flotte', hulls(b, '#bOwn') == 17)

        print('Plateau (iPad en affichage seul)')
        pl = device(browser, faux, url, viewport={'width': 1024, 'height': 768})
        login(pl, 'max@example.com')
        pl.fill('#olCode', 'ZZZZ'); pl.click('#btnOlPlateau')
        pl.wait_for_selector('#olErr:not([hidden])')
        check('plateau : code inconnu refusé', 'inconnu' in pl.inner_text('#olErr'))
        pl.fill('#olCode', code); pl.click('#btnOlPlateau')
        pl.wait_for_selector('#plateau:not([hidden])')
        check('le plateau montre les deux grilles avec leurs noms', pl.locator('#plateau .grid').count() == 2 and 'Max' in pl.inner_text('#pCap0') and 'Claire' in pl.inner_text('#pCap1'), pl.inner_text('#pCap0'))
        check('le plateau montre le tir déjà joué', pl.locator('#plateau b.c.hit, #plateau b.c.miss').count() == 1)
        check('le plateau ne montre aucun navire (flottes secrètes)', hulls(pl, '#plateau') == 0)
        check('le plateau indique le tour et surligne la grille visée', 'Au tour de' in pl.inner_text('#pMsg') and pl.locator('#plateau .gridwrap.aimed').count() == 1, pl.inner_text('#pMsg'))
        check('le plateau n’est pas un joueur : pas de bouton de tir, pas de grille à viser', not pl.is_visible('#bAction') and pl.locator('#plateau .grid.armed').count() == 0)
        pl.locator('#plateau b.c').nth(30).click()
        pl.wait_for_timeout(400)
        check('toucher le plateau ne tire pas', state(faux, code)['shots'][0] + state(faux, code)['shots'][1] == 1, state(faux, code)['shots'])
        check('le plateau n’écrit rien sur le serveur (aucune ligne ajoutée, partie inchangée)', len(faux.rows) == 1 and not [r for r in faux.rows.values() if r['jeu'] == 'plateau'])
        check('les téléphones restent inchangés (leurs deux grilles)', a.is_visible('#bTarget') and a.is_visible('#bOwn') and b.is_visible('#bTarget') and b.is_visible('#bOwn'))

        print('Partie complète, jusqu’à la victoire')
        fin = play_until([a, b], lambda: over_open(a) and over_open(b), budget=300)
        check('la partie va jusqu’au bout sur les deux appareils', fin)
        if fin:
            st = state(faux, code)
            check('le serveur indique la fin et le vainqueur', st['phase'] == 'over' and st['winner'] in (0, 1), st['phase'])
            check('les compteurs de tirs sont cohérents (au moins 17 tirs du gagnant)', st['shots'][st['winner']] >= 17 and st['shots'][0] + st['shots'][1] == sum(1 for t in (0, 1) for rr in st['inc'][t] for v in rr if v), st['shots'])
            check('même texte de résultat des deux côtés (sauf Victoire / Défaite)', 'tirs' in a.inner_text('#overBody') and 'tirs' in b.inner_text('#overBody'))
            a.click('#ovClose'); b.click('#ovClose')
            check('flottes adverses révélées sur les téléphones', hulls(a, '#bTarget') > 0 or hulls(b, '#bTarget') > 0)
            check('plateau : partie terminée avec les flottes révélées', wait_for(lambda: 'Partie terminée' in pl.inner_text('#pTitle') and hulls(pl, '#plateau') > 0, 6000, pg=pl), pl.inner_text('#pTitle'))
            print('Rejouer')
            a.evaluate("() => document.getElementById('ovAgain') && document.getElementById('ovAgain').click()")
            check('« Rejouer » : retour au placement sur les deux appareils, nouvelle partie dans la même ligne', wait_for(lambda: a.is_visible('#place') and b.is_visible('#place') and not over_open(b), 8000, pg=a) and state(faux, code)['phase'] == 'place' and state(faux, code)['ready'] == [False, False] and state(faux, code)['shots'] == [0, 0], state(faux, code)['phase'])
            check('la flotte précédente est effacée du placement', hulls(a, '#plGrid') == 0 and hulls(b, '#plGrid') == 0)
            check('plateau : retour au placement des flottes', wait_for(lambda: 'Placement' in pl.inner_text('#pTitle'), 6000, pg=pl), pl.inner_text('#pTitle'))

        print('Suppression')
        b.click('#btnMenuPl'); b.click('#btnQuit')
        b.wait_for_selector('#olList .olitem')
        b.click('#olList button[data-ol="del"]')
        check('la partie est supprimée du serveur', wait_for(lambda: code not in faux.rows, 4000, pg=b))
        check('l’autre appareil est prévenu et revient à l’accueil', wait_for(lambda: a.is_visible('#home') and 'supprimée' in a.inner_text('#olErr'), 6000, pg=a), a.inner_text('#olErr'))
        check('le plateau est prévenu aussi', wait_for(lambda: pl.is_visible('#home'), 6000, pg=pl))
        check('aucune erreur JavaScript (en ligne)', not a.errors and not b.errors and not pl.errors, a.errors + b.errors + pl.errors)

        print('Contre l’ordinateur (sans réseau)')
        s = device(browser, faux, url)
        patches0, rows0 = faux.patches, dict((k, v['version']) for k, v in faux.rows.items())
        s.click('#btnNew')
        s.wait_for_selector('#place:not([hidden])')
        s.click('#plRand')
        check('solo : flotte complète, validation possible', s.is_enabled('#plOk'))
        s.click('#plOk')
        s.wait_for_selector('#battle:not([hidden])')
        check('solo : la bataille démarre', hulls(s, '#bOwn') == 17)
        for _ in range(3):
            wait_for(lambda: s.locator('#bTarget .grid.armed').count() == 1, 8000, pg=s)
            fire_move(s)
        s.reload()
        check('solo : « Reprendre la partie » proposé après rechargement', s.is_visible('#btnResume'))
        s.click('#btnResume')
        s.wait_for_selector('#battle:not([hidden])')
        check('solo : reprise avec les tirs déjà joués', s.locator('#bTarget b.c.hit, #bTarget b.c.miss, #bOwn b.c.hit, #bOwn b.c.miss').count() >= 3)
        solo_over = play_until([s], lambda: over_open(s), budget=120)
        check('solo : la partie va jusqu’au bout (victoire ou défaite)', solo_over)
        check('solo : aucune écriture sur le serveur', faux.patches == patches0 and dict((k, v['version']) for k, v in faux.rows.items()) == rows0)
        check('aucune erreur JavaScript (solo)', not s.errors, s.errors)

        sw = (ROOT / 'sw.js').read_text()
        check('le service worker ne met jamais en cache les requêtes vers un autre site', "origin !== location.origin" in sw and 'en-ligne.js' in sw and 'peerjs' not in sw)
        browser.close()
    failed = [n for n, ok in RESULTS if not ok]
    print('\n%d vérifications, %d échec(s)' % (len(RESULTS), len(failed)))
    for n in failed:
        print('  ECHEC : ' + n)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
