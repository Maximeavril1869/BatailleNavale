# Bataille navale

La bataille navale à deux, en local, pour iPad et téléphone. Grille de 10 × 10, cinq navires (porte-avions 5, croiseur 4, contre-torpilleur 3, sous-marin 3, torpilleur 2). Fonctionne dans le navigateur, s'installe comme une application (PWA) ; contre l'ordinateur, elle se joue hors ligne.

## Deux modes

- **Contre l'ordinateur** : trois niveaux (débutant, normal, fort), hors ligne. Tu places ta flotte à la main ou au hasard.
- **En ligne** : à deux, chacun sur son appareil. Chacun place sa flotte en secret sur son écran, puis on tire chacun son tour depuis son appareil (on touche une case, puis « Feu ! »). Il faut le compte partagé de l'auteur pour créer ou rejoindre une partie (code à 4 lettres).
- **Plateau (option, en ligne)** : un iPad ouvert comme plateau montre les deux grilles (tirs, navires coulés, dernier tir, tour). Personne ne joue dessus. Les flottes ne sont révélées qu'à la fin de la partie, sur le plateau comme sur les téléphones.

Option, choisie à la création d'une partie : « le joueur qui touche rejoue » (sinon on alterne à chaque tir).

## Utiliser

Ouvrir la page publiée par GitHub Pages, puis « Ajouter à l'écran d'accueil » (iPad, iPhone) ou « Installer l'application » (Chrome sur Android).

## Documentation du projet

- [`ARCHITECTURE.md`](ARCHITECTURE.md) : organisation du code, modèle de données, mode En ligne et plateau.
- [`CARNET_DE_BORD.md`](CARNET_DE_BORD.md) : toutes les opérations effectuées, l'état du projet et ce qui reste à faire.

## Tests

- `node --test tests/engine.test.js` : moteur (placement, tirs, niveaux de l'ordinateur).
- `PYTHONDONTWRITEBYTECODE=1 python3 tests/e2e/en_ligne.py` : parcours complets dans un navigateur simulé (deux appareils, plateau, partie contre l'ordinateur) avec un faux serveur en mémoire.

## Licence

Tous droits réservés © Maximeavril1869. Code publié pour consultation uniquement ; toute réutilisation exige l'autorisation écrite de l'auteur. Voir le fichier `LICENSE`.
