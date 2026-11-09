# Carnet de bord

Journal de toutes les opérations du projet, pour pouvoir le reprendre sans rien perdre. Les entrées les plus récentes sont en bas ; l'état courant est résumé en tête.

## État courant

- Version jouable des quatre modes (ordinateur, passe-passe, face à face, téléphone), testée en navigateur simulé.
- **Non testé sur de vrais appareils** : iPad Pro, iPhone, téléphone Honor (Chrome). Le mode téléphone en particulier dépend du Wi-Fi et du service de mise en relation PeerJS.
- À vérifier : publication GitHub Pages.

## À faire

- Tester sur l'iPad, l'iPhone et le Honor, puis corriger ce qui sort des essais réels.
- Mode téléphone : on tire pour l'instant en touchant l'iPad ; option possible : tirer depuis le téléphone.
- Étendre le mode « iPad = plateau, téléphone = main » aux jeux de cartes (5 Rois, Le Contrat, 6 qui prend ; Skyjo et Flip 7 en dernier, peu d'intérêt) une fois la liaison validée sur ce jeu.
- Ajouter les trois niveaux d'ordinateur (débutant, normal, fort) aux autres jeux de cartes, un dépôt par conversation.
- Skyjo : dépôt `Skyjo` créé et attaché, code pas encore écrit.

## 2026-11-09

Décisions prises avec l'auteur :

- Règles : grille 10 × 10, flotte classique (5, 4, 3, 3, 2), navires pouvant se toucher, on alterne à chaque tir ; variante au choix « le joueur qui touche rejoue ».
- Placement des navires chacun son tour, sur le même appareil (voile « passe l'appareil » entre les deux).
- Face à face : une grille par joueur, orientée vers lui, montrant uniquement les tirs reçus par son propriétaire (on ne révèle pas l'emplacement des navires non touchés).
- Mode téléphone : l'iPad est le plateau, chaque téléphone garde sa flotte ; jumelage par un seul QR code (PeerJS), le mode s'ajoute aux autres. Pilote sur la Bataille navale avant les autres jeux.
- Ordinateur à trois niveaux dès le départ.

Opérations :

1. Lecture du code de `5rois` pour reprendre le même socle (PWA, `engine.js` / `app.js`, `sw.js`, licence « Tous droits réservés »).
2. Écriture de `engine.js` et de ses tests (`tests/engine.test.js`) : 6 tests, niveaux mesurés à environ 70, 51 et 45 tirs.
3. Écriture de `index.html` (écrans et styles) et `app.js` (modes ordinateur, passe-passe, face à face).
4. Ajout de `net.js`, `vendor/peerjs.min.js` (1.5.4), `vendor/qrcode.js` (1.4.4) et du mode téléphone.
5. Icônes, `manifest.webmanifest`, `sw.js`, `LICENSE`, `THIRD_PARTY.md`.
6. Parcours de bout en bout dans Chrome (Playwright), scripts dans `tests/e2e/` :
   - solo : placement manuel et au hasard, tirs, réponse de l'ordinateur ;
   - face à face : partie complète (108 tirs) avec la variante « rejoue », écran de fin, portrait et paysage ;
   - passe-passe sur format téléphone : voiles, tour terminé, reprise ;
   - téléphone : iPad + deux téléphones simulés, partie complète (113 tirs), flottes des téléphones cohérentes avec le plateau, rechargement de l'iPad en cours de partie (les téléphones se reconnectent), revanche.
7. Corrections faites pendant les essais : messages qui se coupaient en plusieurs lignes ; face à face qui débordait de l'écran (pied de siège regroupant message et bouton « Feu ! », disposition adaptée au paysage).
8. Premier envoi sur GitHub (branche `main`).
