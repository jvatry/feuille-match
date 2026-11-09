# Relais de publication de l'effectif

Le bouton **Publier** de l'onglet Effectif chiffre l'effectif de l'espace
(U7, U9 ou U11) sur le téléphone, puis l'envoie à ce relais avec le club et la
catégorie. Le relais le commite sur `main` dans le dossier du club, et GitHub
Pages le met en ligne en une à deux minutes :

| Club / catégorie   | Fichier                            | Secret de l'empreinte du code    |
|--------------------|------------------------------------|----------------------------------|
| `fchettange` / U7  | `fchettange/effectif-u7.enc.json`  | `EMPREINTE_JETON_FCHETTANGE_U7`  |
| `fchettange` / U9  | `fchettange/effectif-u9.enc.json`  | `EMPREINTE_JETON_FCHETTANGE_U9`  |
| `fchettange` / U11 | `fchettange/effectif-u11.enc.json` | `EMPREINTE_JETON_FCHETTANGE_U11` |
| `<club>` / `<cat>` | `<club>/effectif-<cat>.enc.json`   | `EMPREINTE_JETON_<CLUB>_<CAT>`   |

- Le relais ne reçoit que le fichier **déjà chiffré** et un **jeton** tiré du
  code de la catégorie. Il ne voit jamais ni le code ni les noms.
- Il garde le jeton GitHub : aucun jeton n'est présent dans le navigateur.
- Il n'accepte que les appels venant de l'application (`ORIGINES`), avec le
  code **de ce club et de cette catégorie**, un fichier exactement dans le
  format attendu, et n'écrit **que** `<club>/effectif-<u7|u9|u11>.enc.json`.
- Un club ou une catégorie sans secret ne peut rien publier : le code d'un
  club ne permet pas d'écrire l'effectif d'un autre.

`chiffrer-effectif.mjs` reste la solution de secours.

## Mise en place (une seule fois)

### 1. Jeton GitHub

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token :

- Repository access : *Only select repositories* → `jvatry/feuille-match`
- Permissions → Repository permissions → **Contents : Read and write**
- Expiration : la plus longue possible, et noter la date pour le renouveler

### 2. Empreinte du code de chaque catégorie de chaque club

Sur un ordinateur, à la racine du dépôt, pour chaque catégorie du club :

```
node chiffrer-effectif.mjs --jeton --club fchettange --categorie u7
node chiffrer-effectif.mjs --jeton --club fchettange --categorie u9
node chiffrer-effectif.mjs --jeton --club fchettange --categorie u11
```

Saisir le code de la catégorie. La commande affiche
`EMPREINTE_JETON_FCHETTANGE_U9 = …` : c'est cette valeur que le relais garde,
pas le code. Les codes doivent être **différents** d'une catégorie à l'autre
et d'un club à l'autre : un coach ne doit ouvrir que l'effectif de la sienne.

### 3. Déploiement sur Cloudflare Workers (gratuit)

Avec le tableau de bord (sans terminal) :

1. dash.cloudflare.com → Workers & Pages → Create → Worker, nom `feuille-match-relais` ;
2. Edit code : remplacer le contenu par `worker.js`, puis Deploy ;
3. Settings → Variables and Secrets :
   - variables `DEPOT` = `jvatry/feuille-match`, `BRANCHE` = `main`,
     `ORIGINES` = `https://jvatry.github.io` ;
   - secrets `GITHUB_TOKEN` (étape 1), puis un secret
     `EMPREINTE_JETON_<CLUB>_<CAT>` par catégorie de chaque club (étape 2).

Ou en ligne de commande, depuis ce dossier :

```
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put EMPREINTE_JETON_FCHETTANGE_U7
npx wrangler secret put EMPREINTE_JETON_FCHETTANGE_U9
npx wrangler secret put EMPREINTE_JETON_FCHETTANGE_U11
```

### 4. Brancher l'application

Dans `feuille-de-match.jsx`, `URL_RELAIS` contient l'adresse du Worker.

## Nouveau club

Ajouter ses secrets `EMPREINTE_JETON_<CLUB>_<CAT>` (étape 2), un par
catégorie du club. Le code du relais ne change pas. Voir `AJOUTER-UN-CLUB.md`.

## Changement de code

Si le code d'une catégorie change : régénérer son fichier avec
`chiffrer-effectif.mjs --club <club> --categorie <u7|u9|u11>`, puis remplacer
le secret `EMPREINTE_JETON_<CLUB>_<CAT>` par la nouvelle empreinte (`--jeton`).
Sinon le relais refuse les publications (« Ce code ne permet pas de publier
l'effectif »).

## Réponses du relais

| Statut | Signification                                         |
|--------|-------------------------------------------------------|
| 200    | publié                                                |
| 403    | code refusé, ou appel ne venant pas de l'appli        |
| 400    | fichier mal formé, club ou catégorie invalide         |
| 413    | fichier trop gros                                     |
| 502    | GitHub a refusé l'écriture (jeton expiré ?)           |
