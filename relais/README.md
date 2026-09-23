# Relais de publication de l'effectif

Le bouton **Publier** de l'onglet Effectif chiffre l'effectif sur le téléphone,
puis l'envoie à ce relais. Le relais le commite dans `effectif.enc.json` sur
`main`, et GitHub Pages le met en ligne en une à deux minutes.

- Le relais ne reçoit que le fichier **déjà chiffré** et un **jeton** tiré du
  code de l'effectif. Il ne voit jamais ni le code ni les noms.
- Il garde le jeton GitHub : aucun jeton n'est présent dans le navigateur.
- Il n'accepte que les appels venant de l'application (`ORIGINES`), avec le
  bon code, et un fichier exactement dans le format attendu.

`chiffrer-effectif.mjs` reste la solution de secours.

## Mise en place (une seule fois)

### 1. Jeton GitHub

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token :

- Repository access : *Only select repositories* → `jvatry/feuille-match`
- Permissions → Repository permissions → **Contents : Read and write**
- Expiration : la plus longue possible, et noter la date pour le renouveler

### 2. Empreinte du code

Sur un ordinateur, à la racine du dépôt :

```
node chiffrer-effectif.mjs --jeton
```

Saisir la phrase de passe de l'effectif. La commande affiche
`EMPREINTE_JETON = …` : c'est cette valeur que le relais garde, pas le code.

### 3. Déploiement sur Cloudflare Workers (gratuit)

Avec le tableau de bord (sans terminal) :

1. dash.cloudflare.com → Workers & Pages → Create → Worker, nom `feuille-match-relais` ;
2. Edit code : remplacer le contenu par `worker.js`, puis Deploy ;
3. Settings → Variables and Secrets :
   - variables `DEPOT` = `jvatry/feuille-match`, `BRANCHE` = `main`,
     `FICHIER` = `effectif.enc.json`, `ORIGINES` = `https://jvatry.github.io` ;
   - secrets `GITHUB_TOKEN` (étape 1) et `EMPREINTE_JETON` (étape 2).

Ou en ligne de commande, depuis ce dossier :

```
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put EMPREINTE_JETON
```

### 4. Brancher l'application

Dans `feuille-de-match.jsx`, renseigner l'adresse du Worker :

```js
const URL_RELAIS = "https://feuille-match-relais.<compte>.workers.dev";
```

puis passer par une PR comme d'habitude. Tant que `URL_RELAIS` est vide, le
bouton Publier explique que la publication n'est pas encore activée, et les
modifications restent sur le téléphone.

## Changement de code

Si la phrase de passe change : régénérer `effectif.enc.json` avec
`chiffrer-effectif.mjs`, puis remplacer le secret `EMPREINTE_JETON` par la
nouvelle empreinte (`--jeton`). Sinon le relais refuse les publications
(« Ce code ne permet pas de publier l'effectif »).

## Réponses du relais

| Statut | Signification                                   |
|--------|-------------------------------------------------|
| 200    | publié                                          |
| 403    | code refusé, ou appel ne venant pas de l'appli  |
| 400    | fichier mal formé                               |
| 413    | fichier trop gros                               |
| 502    | GitHub a refusé l'écriture (jeton expiré ?)     |
