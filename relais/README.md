# Relais de publication de l'effectif

Le bouton **Publier** de l'onglet Effectif chiffre l'effectif de l'espace
(U9 ou U11) sur le téléphone, puis l'envoie à ce relais. Le relais le commite
sur `main` dans le fichier de la catégorie, et GitHub Pages le met en ligne en
une à deux minutes :

| Catégorie | Fichier                 | Secret de l'empreinte du code |
|-----------|-------------------------|-------------------------------|
| U9        | `effectif-u9.enc.json`  | `EMPREINTE_JETON_U9`          |
| U11       | `effectif-u11.enc.json` | `EMPREINTE_JETON_U11`         |

- Le relais ne reçoit que le fichier **déjà chiffré** et un **jeton** tiré du
  code de la catégorie. Il ne voit jamais ni le code ni les noms.
- Il garde le jeton GitHub : aucun jeton n'est présent dans le navigateur.
- Il n'accepte que les appels venant de l'application (`ORIGINES`), avec le
  code de la catégorie envoyée, un fichier exactement dans le format attendu,
  et n'écrit **que** les deux fichiers ci-dessus.

`chiffrer-effectif.mjs` reste la solution de secours.

## Mise en place (une seule fois)

### 1. Jeton GitHub

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token :

- Repository access : *Only select repositories* → `jvatry/feuille-match`
- Permissions → Repository permissions → **Contents : Read and write**
- Expiration : la plus longue possible, et noter la date pour le renouveler

### 2. Empreinte du code de chaque catégorie

Sur un ordinateur, à la racine du dépôt :

```
node chiffrer-effectif.mjs --jeton --categorie u9
node chiffrer-effectif.mjs --jeton --categorie u11
```

Saisir le code de la catégorie. La commande affiche
`EMPREINTE_JETON_U9 = …` (ou `_U11`) : c'est cette valeur que le relais
garde, pas le code. Les deux codes doivent être **différents** : le coach U11
ne doit pas pouvoir ouvrir l'effectif U9, et inversement.

### 3. Déploiement sur Cloudflare Workers (gratuit)

Avec le tableau de bord (sans terminal) :

1. dash.cloudflare.com → Workers & Pages → Create → Worker, nom `feuille-match-relais` ;
2. Edit code : remplacer le contenu par `worker.js`, puis Deploy ;
3. Settings → Variables and Secrets :
   - variables `DEPOT` = `jvatry/feuille-match`, `BRANCHE` = `main`,
     `ORIGINES` = `https://jvatry.github.io` ;
   - secrets `GITHUB_TOKEN` (étape 1), `EMPREINTE_JETON_U9` et
     `EMPREINTE_JETON_U11` (étape 2).

Ou en ligne de commande, depuis ce dossier :

```
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put EMPREINTE_JETON_U9
npx wrangler secret put EMPREINTE_JETON_U11
```

### 4. Brancher l'application

Dans `feuille-de-match.jsx`, `URL_RELAIS` contient l'adresse du Worker.

## Changement de code

Si le code d'une catégorie change : régénérer son fichier avec
`chiffrer-effectif.mjs --categorie <u9|u11>`, puis remplacer le secret
`EMPREINTE_JETON_<U9|U11>` par la nouvelle empreinte (`--jeton`). Sinon le
relais refuse les publications (« Ce code ne permet pas de publier
l'effectif »).

## Réponses du relais

| Statut | Signification                                         |
|--------|-------------------------------------------------------|
| 200    | publié                                                |
| 403    | code refusé, ou appel ne venant pas de l'appli        |
| 400    | fichier mal formé, ou catégorie inconnue              |
| 413    | fichier trop gros                                     |
| 502    | GitHub a refusé l'écriture (jeton expiré ?)           |
