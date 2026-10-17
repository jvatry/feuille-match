# Ajouter un club

Chaque club a son dossier à la racine du dépôt. Le nom du dossier est
l'identifiant du club et son adresse :

```
https://jvatry.github.io/feuille-match/<club>/
```

Identifiant : 2 à 30 caractères, lettres minuscules sans accent et chiffres,
en commençant par une lettre (ex. `fchettange`, `asexemple57`). Ni tiret, ni
espace. Le club doit être du District Mosellan : l'application produit ses
feuilles de match.

## 1. Le dossier du club

Partir du dossier `fchettange/` :

| Fichier       | Contenu                                                                   |
|---------------|---------------------------------------------------------------------------|
| `index.html`  | copie **sans modification** de `fchettange/index.html`                    |
| `club.json`   | la fiche du club (ci-dessous)                                             |
| `logo.png`    | le logo du club, fond transparent ou blanc, environ 200 px de haut        |
| `icone.png`   | icône carrée de 192 × 192 px (onglet, raccourci du téléphone)             |

Pas d'effectif à ce stade : il est ajouté par le club lui-même (étape 3).

### `club.json`

```json
{
  "nom": "A.S. Exemple",
  "numero": "500000",
  "couleur": "#0B7A3B",
  "couleurSecondaire": "#F2B800",
  "equipes": "A.S. Exemple",
  "categories": ["U9", "U11"],
  "secteur": "Sidérurgie",
  "groupe": "OUEST",
  "tenue": "maillot vert / short blanc / chaussettes vertes, protège-tibias"
}
```

| Champ               | Obligatoire | Rôle                                                                                   |
|---------------------|-------------|----------------------------------------------------------------------------------------|
| `nom`               | oui         | en-tête, écran du code, titre de la feuille de match, bandeau de la convocation        |
| `numero`            | non         | numéro d'affiliation, affiché à côté du nom                                            |
| `couleur`           | oui         | couleur principale, `#RRGGBB` : boutons, onglets, titres, cases de la convocation      |
| `couleurSecondaire` | non         | le mot « CONVOCATION » du bandeau ; sinon la couleur principale                        |
| `equipes`           | non         | nom des équipes, numéroté (« A.S. EXEMPLE 1 »…), en majuscules ; sinon le nom du club  |
| `categories`        | non         | espaces proposés parmi `U7`, `U9`, `U11` ; sinon les trois                             |
| `secteur`, `groupe` | non         | valeurs pré-remplies d'un nouveau plateau                                              |
| `tenue`             | non         | tenue pré-remplie sur la convocation                                                   |

Les teintes claires (fonds de sélection, bordures, cases de la convocation)
sont calculées à partir de `couleur`. Une couleur trop claire est foncée
automatiquement pour que le texte reste lisible : préférer la couleur du
maillot ou du logo, telle quelle. La feuille de match reste au modèle du
District, sans couleur.

## 2. Les codes et le relais

Le club choisit un code par catégorie (trois ou quatre mots, différents d'une
catégorie à l'autre), et les garde pour ses coachs. Pour chaque catégorie, à
la racine du dépôt :

```
node chiffrer-effectif.mjs --jeton --club <club> --categorie u9
```

puis enregistrer l'empreinte affichée comme secret du relais :

```
cd relais
npx wrangler secret put EMPREINTE_JETON_<CLUB>_U9
```

Le code lui-même n'est jamais commité ni donné au relais. Voir `relais/README.md`.

## 3. Mise en ligne

1. Une branche, une PR avec le dossier du club, merge : l'adresse du club est en ligne.
2. Envoyer au club son adresse et les codes de ses catégories.
3. Le coach ouvre l'adresse, choisit sa catégorie, colle ou importe la liste
   de ses joueurs dans l'onglet Effectif, puis **Publier** : le relais commite
   `<club>/effectif-<cat>.enc.json`. Les autres coachs de la catégorie
   l'ouvrent ensuite avec le même code.

En secours, le mainteneur peut chiffrer un CSV exporté par l'application :

```
node chiffrer-effectif.mjs --club <club> --categorie u9 effectif.csv
```

Ne jamais commiter le CSV en clair (`*.csv` est ignoré par git).

## Retirer un club

Supprimer son dossier et ses secrets `EMPREINTE_JETON_<CLUB>_*` du relais.
Son adresse renvoie alors à la page d'accueil.
