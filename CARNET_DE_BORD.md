# Carnet de bord

Journal de toutes les opérations du projet, pour pouvoir le reprendre sans rien perdre. Les entrées les plus récentes sont en bas ; l'état courant est résumé en tête.

## État courant

- Version 2 : deux modes, **contre l'ordinateur** (hors ligne) et **en ligne** (2 joueurs, chacun sur son appareil) avec **plateau** optionnel (iPad en affichage seul). Les anciens modes (passe-passe, face à face, téléphone par PeerJS) sont supprimés.
- Testé en navigateur simulé uniquement. **Non testé sur de vrais appareils** (iPad Pro, iPhone, Honor) ni sur le vrai Supabase.

## À faire

- Essayer l'en ligne sur deux vrais appareils, puis avec un iPad en plateau, et corriger ce qui sort des essais réels.
- Étendre / valider la même brique En ligne dans les autres jeux (EnqueteManoir en dernier).
- Les trois niveaux d'ordinateur pourraient aussi servir aux autres jeux de cartes (un dépôt par conversation).

## 2026-11-09 — Version 1

Décisions prises avec l'auteur : grille 10 × 10, flotte classique (5, 4, 3, 3, 2), navires pouvant se toucher, on alterne à chaque tir ; variante « le joueur qui touche rejoue » ; ordinateur à trois niveaux.

Opérations : `engine.js` et ses tests (6 tests, niveaux mesurés à environ 70, 51 et 45 tirs) ; `index.html` et `app.js` (ordinateur, passe-passe, face à face) ; mode téléphone avec `net.js`, PeerJS 1.5.4 et qrcode-generator 1.4.4 ; icônes, manifeste, `sw.js`, licence « Tous droits réservés » ; parcours Playwright ; premier envoi sur GitHub.

## 2026-11-13 — Version 2 : En ligne et plateau

Décisions de l'auteur : 2 humains au plus (pas d'ordinateur en ligne : la bataille navale se joue à deux) ; l'en ligne remplace les modes à un seul appareil et la liaison PeerJS ; mains (ici flottes) cachées par confiance ; plateau = deux grilles de tirs, les téléphones gardent leurs eaux adverses pour viser (on ne joue pas sur le plateau) ; flottes des deux joueurs révélées à la fin de la partie, plateau et téléphones.

Opérations :

1. `en-ligne.js` copié de 5 Rois (identique). `net.js`, `vendor/` (PeerJS, qrcode), `THIRD_PARTY.md` et les anciens tests `tests/e2e/{duo,passe,tel,solo}.py` supprimés.
2. `index.html` : modes « Contre l'ordinateur » / « En ligne », panneau compte / code / parties en cours, prénom, salle d'attente, écran « flotte prête », bannière « Hors ligne », écran `#plateau` ; suppression du voile, du face à face et du mode téléphone.
3. `app.js` réécrit : placement simultané en secret (la flotte ne part au serveur qu'à la validation, et reste conservée sur l'appareil si on recharge), synchro d'état complet, **rejeu de la validation de flotte en cas de conflit** (sinon deux validations simultanées perdraient l'une des deux), tirs, « Rejouer » dans la même ligne (`gen`), reprise depuis la liste, suppression vue par l'autre appareil et par le plateau ; plateau en lecture seule.
4. `sw.js` : cache `bataillenavale-v2`, `en-ligne.js` ajouté, PeerJS et QR retirés. `window.BOT_DELAY` (tests) accélère l'ordinateur.
5. Tests : `tests/e2e/en_ligne.py` (63 vérifications : anciens modes ignorés, connexion, code inconnu, 3e personne refusée, flottes secrètes, validations simultanées, droits de tir, hors ligne, reprise, plateau lecture seule, partie complète jusqu'à la victoire avec révélation des flottes, « Rejouer », suppression, solo avec reprise et partie complète) et `node --test tests/engine.test.js` (6 tests).
6. Pas de signe de vie du plateau (contrairement à 5 Rois / 6 qui prend / Le Contrat) : les téléphones ne changent pas d'affichage quand un plateau est branché.
