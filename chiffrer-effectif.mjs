#!/usr/bin/env node
/**
 * chiffrer-effectif.mjs — prépare le fichier d'effectif chiffré servi à côté de l'application.
 *
 *   node chiffrer-effectif.mjs effectif.csv effectif.enc.json
 *
 * La phrase de passe est demandée à la saisie (masquée), ou lue dans la variable
 * d'environnement FM_PHRASE pour un usage automatisé.
 *
 * Entrée  : le CSV exporté par l'onglet Effectif de l'application (bouton
 *           Exporter). Le texte est chiffré tel quel : c'est l'application
 *           elle-même qui le relit ensuite, avec son propre lecteur de CSV.
 * Sortie  : effectif.enc.json — AES-256-GCM, clé dérivée par PBKDF2-SHA-256.
 *           Ce fichier seul est commité. Le CSV en clair ne l'est jamais.
 *
 * L'application publie elle-même l'effectif (bouton « Publier » de l'onglet
 * Effectif), via le relais décrit dans relais/README.md. Ce script reste la
 * solution de secours, et prépare la configuration du relais :
 *
 *   node chiffrer-effectif.mjs --jeton
 *
 * affiche l'empreinte du code à donner au relais (EMPREINTE_JETON). Le relais
 * n'apprend jamais le code lui-même.
 *
 * Node 18 ou plus. Aucune dépendance.
 */

import { readFile, writeFile } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";
import { createInterface } from "node:readline";

const ITERATIONS = 250_000;
const SEL_PUBLICATION = "feuille-match/publication";   // même valeur que l'application

/* ------------------------------------------------------------------ */
/* Lecture CSV                                                         */
/* ------------------------------------------------------------------ */

function detecterSeparateur(entete) {
  const pointsVirgules = (entete.match(/;/g) || []).length;
  const virgules = (entete.match(/,/g) || []).length;
  const tabulations = (entete.match(/\t/g) || []).length;
  if (tabulations > pointsVirgules && tabulations > virgules) return "\t";
  return virgules > pointsVirgules ? "," : ";";
}

function decouperLigne(ligne, separateur) {
  const champs = [];
  let courant = "";
  let entreGuillemets = false;

  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (entreGuillemets) {
      if (c === '"') {
        if (ligne[i + 1] === '"') {
          courant += '"';
          i++;
        } else {
          entreGuillemets = false;
        }
      } else {
        courant += c;
      }
    } else if (c === '"') {
      entreGuillemets = true;
    } else if (c === separateur) {
      champs.push(courant.trim());
      courant = "";
    } else {
      courant += c;
    }
  }
  champs.push(courant.trim());
  return champs;
}

function lireCsv(texte) {
  const lignes = texte
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== "");

  if (lignes.length < 2) {
    throw new Error("Le CSV ne contient pas de ligne d'en-têtes suivie de données.");
  }

  const separateur = detecterSeparateur(lignes[0]);
  const entetes = decouperLigne(lignes[0], separateur);

  return lignes.slice(1).map((ligne, index) => {
    const champs = decouperLigne(ligne, separateur);
    if (champs.length !== entetes.length) {
      console.warn(
        `  ligne ${index + 2} : ${champs.length} champs pour ${entetes.length} en-têtes, les manquants seront vides.`
      );
    }
    const objet = {};
    entetes.forEach((entete, i) => {
      objet[entete] = champs[i] ?? "";
    });
    return objet;
  });
}

/* ------------------------------------------------------------------ */
/* Chiffrement                                                         */
/* ------------------------------------------------------------------ */

const b64 = (octets) => Buffer.from(octets).toString("base64");

async function deriverCle(phrase, sel) {
  const matiere = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(phrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: sel, iterations: ITERATIONS, hash: "SHA-256" },
    matiere,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
}

async function chiffrer(texte, phrase) {
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cle = await deriverCle(phrase, sel);

  const clair = new TextEncoder().encode(texte);
  const chiffre = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cle, clair);

  return {
    v: 1,
    algo: "AES-GCM-256",
    kdf: { nom: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, sel: b64(sel) },
    iv: b64(iv),
    donnees: b64(new Uint8Array(chiffre)),
    empreinte: b64(
      new Uint8Array(await crypto.subtle.digest("SHA-256", chiffre)).slice(0, 8)
    ),
    genere: new Date().toISOString().slice(0, 10),
  };
}

/* Le jeton que l'application envoie au relais pour prouver qu'elle connaît
   le code ; le relais n'en garde que le SHA-256. */
async function empreinteJeton(phrase) {
  const texte = new TextEncoder();
  const matiere = await crypto.subtle.importKey("raw", texte.encode(phrase), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: texte.encode(SEL_PUBLICATION), iterations: ITERATIONS, hash: "SHA-256" },
    matiere,
    256
  );
  const jeton = b64(new Uint8Array(bits));
  const hache = await crypto.subtle.digest("SHA-256", texte.encode(jeton));
  return Buffer.from(hache).toString("hex");
}

/* ------------------------------------------------------------------ */
/* Saisie masquée                                                      */
/* ------------------------------------------------------------------ */

function demanderPhrase(invite) {
  return new Promise((resoudre) => {
    const lecteur = createInterface({ input: process.stdin, output: process.stdout });
    const ecrire = process.stdout.write.bind(process.stdout);
    let masquer = false;

    process.stdout.write = (chaine, ...reste) =>
      masquer && chaine !== "\n" && chaine !== "\r\n"
        ? true
        : ecrire(chaine, ...reste);

    lecteur.question(invite, (reponse) => {
      process.stdout.write = ecrire;
      ecrire("\n");
      lecteur.close();
      resoudre(reponse);
    });
    masquer = true;
  });
}

/* ------------------------------------------------------------------ */

async function lirePhrase() {
  let phrase = process.env.FM_PHRASE;
  if (!phrase) {
    phrase = await demanderPhrase("Phrase de passe : ");
    const confirmation = await demanderPhrase("Confirmer        : ");
    if (phrase !== confirmation) {
      console.error("Les deux saisies diffèrent. Rien n'a été écrit.");
      process.exit(1);
    }
  }
  if (phrase.length < 10) {
    console.error(
      "Phrase trop courte : 10 caractères minimum, et de préférence trois ou quatre mots. Rien n'a été écrit."
    );
    process.exit(1);
  }
  return phrase;
}

async function principal() {
  if (process.argv[2] === "--jeton") {
    const empreinte = await empreinteJeton(await lirePhrase());
    console.log(`\nEMPREINTE_JETON = ${empreinte}`);
    console.log("À enregistrer comme secret du relais (voir relais/README.md).");
    return;
  }

  const [entree, sortie = "effectif.enc.json"] = process.argv.slice(2);

  if (!entree) {
    console.error("Usage : node chiffrer-effectif.mjs <effectif.csv> [effectif.enc.json]");
    process.exit(1);
  }

  const texte = await readFile(entree, "utf8");
  const lignes = lireCsv(texte);
  const colonnes = Object.keys(lignes[0]);
  console.log(`${lignes.length} lignes lues dans ${entree}.`);
  console.log(`Colonnes : ${colonnes.join(", ")}`);

  const sansAccent = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const manquantes = ["nom", "licence"].filter(
    (attendue) => !colonnes.some((c) => sansAccent(c).includes(attendue))
  );
  if (manquantes.length) {
    console.error(
      `Colonnes introuvables : ${manquantes.join(", ")}. Exporte l'effectif depuis l'onglet Effectif de l'application. Rien n'a été écrit.`
    );
    process.exit(1);
  }

  const phrase = await lirePhrase();
  const paquet = await chiffrer(texte, phrase);
  await writeFile(sortie, JSON.stringify(paquet, null, 2) + "\n", "utf8");

  console.log(`\n${sortie} écrit — ${lignes.length} lignes, empreinte ${paquet.empreinte}.`);
  console.log("Commite ce fichier. Garde le CSV en clair hors du dépôt.");
}

principal().catch((erreur) => {
  console.error(`Échec : ${erreur.message}`);
  process.exit(1);
});
