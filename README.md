# Bataille navale

La bataille navale à deux, en local, pour iPad et téléphone. Grille de 10 × 10, cinq navires (porte-avions 5, croiseur 4, contre-torpilleur 3, sous-marin 3, torpilleur 2). Fonctionne dans le navigateur, s'installe comme une application (PWA) et se joue hors ligne, sauf le jumelage du mode téléphone.

## Quatre modes

- **Contre l'ordinateur** : trois niveaux (débutant, normal, fort). Tu places ta flotte à la main ou au hasard.
- **On se passe l'appareil** : chaque joueur place sa flotte à son tour ; un écran masque la grille entre les tours.
- **Face à face** : iPad posé à plat, une grille devant chacun, orientée vers son joueur. Chaque grille montre les tirs reçus par son propriétaire. On vise la grille de l'adversaire, on touche la case puis « Feu ! ».
- **Flottes sur téléphone** : l'iPad est le plateau, chaque téléphone garde sa flotte secrète (placement, impacts reçus). Le jumelage se fait en scannant le QR code de l'iPad avec l'appareil photo du téléphone.

Option : « le joueur qui touche rejoue » (sinon on alterne à chaque tir).

## Utiliser

Ouvrir la page publiée par GitHub Pages, puis « Ajouter à l'écran d'accueil » (iPad, iPhone) ou « Installer l'application » (Chrome sur Android).

## Documentation du projet

- [`ARCHITECTURE.md`](ARCHITECTURE.md) : organisation du code, modèle de données, protocole du mode téléphone.
- [`CARNET_DE_BORD.md`](CARNET_DE_BORD.md) : toutes les opérations effectuées, l'état du projet et ce qui reste à faire.
- [`THIRD_PARTY.md`](THIRD_PARTY.md) : bibliothèques tierces (PeerJS, qrcode-generator).

## Tests

- `node --test tests/engine.test.js` : moteur (placement, tirs, niveaux de l'ordinateur).
- `tests/e2e/*.py` : parcours complets dans un vrai navigateur (voir l'en-tête de chaque script).

## Licence

Tous droits réservés © Maximeavril1869. Code publié pour consultation uniquement ; toute réutilisation exige l'autorisation écrite de l'auteur. Voir le fichier `LICENSE`. Les bibliothèques du dossier `vendor/` gardent leur propre licence (MIT).
