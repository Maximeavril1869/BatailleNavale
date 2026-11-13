# Architecture

Application web statique, sans compilation ni serveur propre : HTML + JavaScript « classique » (pas de module, pas de framework), comme les autres jeux du même auteur. Aucune bibliothèque tierce. Hébergée sur GitHub Pages.

## Fichiers

```
index.html          Écrans (accueil, placement, bataille, attente de flotte, plateau), styles, modales, salle d'attente, bannière « Hors ligne »
engine.js           Moteur pur : flotte, placement, tirs, ordinateur. Sans dépendance, testable sous Node
en-ligne.js         Brique commune « En ligne » (copie identique dans chaque jeu) : connexion, parties, synchro (window.EnLigne)
app.js              Interface : navigation, modes (solo, en ligne), sauvegarde, grilles, plateau
sw.js               Service worker : cache hors ligne (réseau d'abord) ; ne met jamais en cache une requête vers un autre site
manifest.webmanifest, icons/    PWA
tests/engine.test.js            Tests du moteur (node --test)
tests/e2e/en_ligne.py           Deux appareils + plateau + solo simulés (Chromium) + faux Supabase en mémoire (63 vérifications)
```

Ordre de chargement : `engine.js`, `en-ligne.js`, `app.js`. Règle : changer `APP_VERSION` (app.js) et `CACHE` (sw.js) ensemble à chaque livraison.

## Moteur (`engine.js`)

Données JSON uniquement, donc sauvegardables telles quelles.

- **navire** : `{ id, name, len, cells: [[r, c], ...] }` (ids : `pa`, `cr`, `ct`, `sm`, `to`)
- **inc** : matrice 10 × 10 des tirs *reçus* par un joueur (0 rien, 1 à l'eau, 2 touché)
- **sunk** : navires coulés d'un joueur (donc révélés à tous)
- `fire(ships, inc, sunk, r, c)` renvoie `{ r, c, res: 'miss'|'hit'|'sunk', ship, allSunk }`
- `aiChoose(level, inc, sunk)` : l'ordinateur ne lit que `inc` et `sunk` de sa cible (il ne triche pas)
  - niveau 1 : au hasard, une chance sur deux de viser à côté d'un touché
  - niveau 2 : chasse en damier, puis prolonge la ligne des touchés
  - niveau 3 : densité de probabilité sur toutes les positions possibles des navires restants
  - ordre de force mesuré (300 parties) : environ 70, 51 et 45 tirs pour gagner

## État de partie (`G`)

```
v, mode         2 ; 'solo' | 'online'
gen             numéro de la partie dans la ligne (augmente à « Rejouer »)
level, rejoue   niveau de l'ordinateur (solo), variante « le joueur qui touche rejoue »
names           [nom0, nom1] (nom1 = '…' tant que l'invité n'est pas arrivé)
phase           'place' | 'battle' | 'over'
turn            joueur qui tire
fleets          [flotte0, flotte1] (vide tant que le joueur n'a pas validé)
inc, sunk       tirs reçus et navires coulés par joueur
last            dernier tir { by, r, c, res, name }
shots, winner   compteurs de tirs, vainqueur
ready           [bool, bool] : flotte validée
online          { uids: [uid hôte, uid invité|null], joined }  (en ligne seulement)
```

Sauvegarde solo : `bn_partie_v1` (les anciennes sauvegardes des modes supprimés sont ignorées). Préférences : `bn_prefs_v1`. En ligne : `bn_online_v1` = par code de partie, siège de l'appareil + ma flotte en cours de placement (`gen`, `ships`), qui ne part au serveur qu'à la validation. Session de connexion partagée : `foyer_session_v1`.

## Mode en ligne

Fournisseur : Supabase (projet « plan-du-jour », table `parties`, accès réservé aux comptes connectés). Le jeu est `bataillenavale`.

**Synchro par état complet avec contrôle de version** : après chaque action, `save()` marque l'état « à envoyer » et `pushState()` écrit tout `G` si la version du serveur est celle qu'on connaît. En cas de conflit, **l'état distant l'emporte** et l'action locale est annulée avec un message. Un seul joueur tire à la fois. Le placement est simultané : si les deux valident en même temps, la validation de l'appareil perdant est **rejouée** sur l'état distant (`ONL.redo`) au lieu d'être perdue ; la bataille démarre quand les deux `ready` sont vrais (premier joueur tiré au hasard). Un tir joué hors ligne part au retour du réseau (bannière `#offbar`).

**Surveillance** : toutes les 1,5 s la version est lue ; si elle a changé, l'état est relu (`onRemote` → `takeRemote` → `onlineShow`).

**Flottes cachées** : par choix assumé (confiance), les deux flottes sont dans l'état du serveur dès qu'elles sont validées ; l'interface n'affiche que la flotte de l'appareil et jamais les navires non coulés de l'adversaire, sauf en fin de partie. Le tir est calculé par l'appareil du tireur (`E.fire` sur la flotte adverse de l'état). Pas de protection contre la lecture du réseau.

**Écrans** : `#wait` (salle d'attente avec le code), `#place` (placement, grille privée), `#fleetwait` (flotte prête, on attend l'autre), `#battle` (eaux adverses pour viser + sa flotte). « Rejouer » (`restartOnline`) recommence dans la même ligne avec `gen + 1`.

## Plateau (iPad en affichage seul)

Écran `#plateau`, ouvert depuis le panneau En ligne (« Ouvrir comme plateau »). Il ne prend aucun siège et **n'écrit jamais** : il lit la ligne de la partie (`surveiller` → `ptRemote` → `ptRender`) et montre les deux grilles (tirs reçus, navires coulés, dernier tir, grille visée surlignée), les compteurs de tirs, le tour ; les flottes ne sont révélées qu'en fin de partie. On ne tire pas depuis le plateau : il faut bien viser quelque part, donc **les téléphones restent inchangés** (ils gardent leurs eaux adverses et leur flotte). Pas de signe de vie du plateau, contrairement aux jeux de cartes où le téléphone cache la table commune.

## Ancien mode téléphone (supprimé)

Les modes « on se passe l'appareil », « face à face » et « flottes sur téléphone » (liaison WebRTC par PeerJS, QR code) ont été remplacés par l'en ligne en version 2. `net.js`, `vendor/` et `THIRD_PARTY.md` sont supprimés.
