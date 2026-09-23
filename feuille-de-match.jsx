import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Trash2, Printer, Users, FileText, ClipboardList, Search,
  RotateCcw, AlertTriangle, Check, UserPlus, X, Download, Upload,
  ChevronDown, ChevronRight, Pencil,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Tokens                                                             */
/* ------------------------------------------------------------------ */
const C = {
  ink: "#12211C",
  ink70: "#12211Cb3",
  terrain: "#1F6B4A",
  terrainSoft: "#E3EFE8",
  craie: "#F4F6F3",
  ligne: "#D6DED8",
  brassard: "#E8A317",
  alerte: "#A8321C",
  papier: "#FFFFFF",
};

const CLUB = { nom: "F.C. Hettange Grande", numero: "527314" };

const MIN_JOUEURS = 5;   // 4 joueurs de champ + 1 gardien
const MAX_JOUEURS = 8;   // + 3 remplaçants
const MAX_EQUIPES = 8;   // la feuille du district : 4 blocs par page, sur deux pages
const DELEGUE = "Délégué";

const CLE_EFFECTIF = "feuilles:effectif";
const CLE_PLATEAU = "feuilles:plateau";
const CLE_CODE = "feuilles:code";
const CLE_EMPREINTE = "feuilles:empreinte";
const CLE_REMPLACEE = "feuilles:empreinte-remplacee";
const CLE_PUBLIE = "feuilles:publie";
const CLE_NOUVEAUTES = "feuilles:nouveautes";

/* Effectif chiffré publié à côté de l'application. */
const URL_EFFECTIF = "./effectif.enc.json";

/* Relais qui met en ligne l'effectif chiffré (voir relais/README.md). Vide :
   le bouton Publier explique que la publication n'est pas encore activée. */
const URL_RELAIS = "https://feuille-match-relais.jvatry.workers.dev";

/* Mêmes paramètres que chiffrer-effectif.mjs. */
const ITERATIONS = 250000;
const SEL_PUBLICATION = "feuille-match/publication";

/* Nouvelle vérification de l'effectif publié pendant l'utilisation. */
const INTERVALLE_VERIFICATION = 5 * 60 * 1000;

/* Un type de plateau associe les catégories de joueurs qu'il mélange. Pour
   l'instant un seul type existe (U9 : plateaux U8/U9 du club) ; un futur type
   U7 (U6/U7, pour un autre club) s'ajouterait ici sans toucher au reste. */
const TYPES_PLATEAU = {
  U9: { label: "U9", categoriesJoueurs: ["U8", "U9"] },
};

/* Secteur et groupe du club : pré-remplis, modifiables sur l'onglet Plateau. */
const SECTEUR_DEFAUT = "Sidérurgie";
const GROUPE_DEFAUT = "EST";

const PLATEAU_VIDE = {
  type: "U9",
  date: "",
  lieu: "",
  secteur: SECTEUR_DEFAUT,
  groupe: GROUPE_DEFAUT,
  defautsClub: true,   // marque les plateaux qui ont déjà reçu ces valeurs
  responsable: "",
};

const equipeVide = (n) => ({
  id: `e${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
  nom: `${CLUB.nom.toUpperCase()} ${n}`,
  joueurs: [],
  delegueId: null,
});

const estDelegue = (p) => p.categorie === DELEGUE;

const parNom = (a, b) =>
  a.nom.localeCompare(b.nom, "fr") || a.prenom.localeCompare(b.prenom, "fr");

const sansAccent = (s) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/* Identifiant stable : le numéro de licence, sinon le nom et le prénom. Deux
   lectures du même effectif donnent les mêmes identifiants. */
const idPersonne = (licence, nom, prenom) =>
  licence || `n:${sansAccent(nom)}|${sansAccent(prenom)}`;

const clePersonne = (p) => idPersonne(p.licence, p.nom, p.prenom);

/* ------------------------------------------------------------------ */
/*  CSV                                                                */
/* ------------------------------------------------------------------ */
const COLONNES = ["Nom", "Prénom", "Catégorie", "Licence", "Naissance", "Licence validée"];

const EXEMPLE_CSV = [
  "Nom;Prénom;Catégorie;Licence;Naissance;Licence validée",
  "DUPONT;Lucas;U8;9600000001;14/03/2019;oui",
  "MARTIN;Elsa;U9;9600000002;02/11/2018;oui",
  "BERNARD;Claire;Délégué;9600000003;;oui",
].join("\n");

function echappe(v) {
  const s = String(v ?? "");
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function versCSV(effectif) {
  const lignes = [COLONNES.join(";")];
  effectif.forEach((p) => {
    lignes.push(
      [p.nom, p.prenom, p.categorie, p.licence, p.naissance, p.valide ? "oui" : "non"]
        .map(echappe)
        .join(";")
    );
  });
  return lignes.join("\r\n");
}

/* Découpe une ligne en respectant les guillemets. */
function decoupe(ligne, sep) {
  const champs = [];
  let courant = "";
  let dansGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (dansGuillemets) {
      if (c === '"' && ligne[i + 1] === '"') { courant += '"'; i++; }
      else if (c === '"') dansGuillemets = false;
      else courant += c;
    } else if (c === '"') dansGuillemets = true;
    else if (c === sep) { champs.push(courant); courant = ""; }
    else courant += c;
  }
  champs.push(courant);
  return champs.map((s) => s.trim());
}

function depuisCSV(texte) {
  const propre = texte.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lignes = propre.split("\n").filter((l) => l.trim() !== "");
  if (!lignes.length) return { personnes: [], erreur: "Le fichier est vide." };

  const sep = [";", ",", "\t"]
    .map((s) => ({ s, n: lignes[0].split(s).length }))
    .sort((a, b) => b.n - a.n)[0].s;

  const premiere = decoupe(lignes[0], sep).map(sansAccent);
  const trouve = (...cles) => premiere.findIndex((t) => cles.some((c) => t.includes(c)));
  const iNom = trouve("nom");
  const aEntete = iNom !== -1 && premiere.some((t) => t.includes("licence") || t.includes("prenom"));

  const idx = aEntete
    ? {
        nom: iNom,
        prenom: trouve("prenom"),
        categorie: trouve("categorie", "section", "sous-cat", "role"),
        licence: premiere.findIndex((t) => t.includes("licence") && !t.includes("valid")),
        naissance: trouve("naissance", "date nais"),
        valide: premiere.findIndex((t) => t.includes("valid") || t.includes("etat")),
      }
    : { nom: 0, prenom: 1, categorie: 2, licence: 3, naissance: 4, valide: 5 };

  const personnes = [];
  const ignorees = [];
  lignes.slice(aEntete ? 1 : 0).forEach((ligne, n) => {
    const ch = decoupe(ligne, sep);
    const lire = (i) => (i >= 0 && i < ch.length ? ch[i] : "");
    let nom = lire(idx.nom);
    let prenom = lire(idx.prenom);
    if (nom && !prenom && idx.prenom === -1) {
      const mots = nom.split(/\s+/);
      nom = mots[0];
      prenom = mots.slice(1).join(" ");
    }
    if (!nom) { ignorees.push(n + 1); return; }

    const brut = sansAccent(lire(idx.categorie));
    const categorie = brut.includes("deleg") ? DELEGUE : brut.includes("9") ? "U9" : "U8";
    const etat = sansAccent(lire(idx.valide));
    const valide = !(etat.includes("non") || etat === "0" || etat === "false");
    const licence = lire(idx.licence).replace(/\s/g, "");

    personnes.push({
      id: idPersonne(licence, nom, prenom),
      nom: nom.toUpperCase(),
      prenom,
      categorie,
      licence,
      naissance: lire(idx.naissance),
      valide,
    });
  });

  return { personnes, ignorees };
}

/* ------------------------------------------------------------------ */
/*  Effectif publié                                                    */
/*  Un fichier chiffré est servi à côté de l'application. Il contient   */
/*  le CSV produit par l'export ci-dessus. Le code saisi une fois       */
/*  ouvre le fichier, le résultat reste sur l'appareil.                 */
/* ------------------------------------------------------------------ */
const depuisB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function versB64(octets) {
  let s = "";
  octets.forEach((o) => { s += String.fromCharCode(o); });
  return btoa(s);
}

async function cleAES(phrase, sel, iterations, usage = "decrypt") {
  const matiere = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(phrase), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: sel, iterations, hash: "SHA-256" },
    matiere, { name: "AES-GCM", length: 256 }, false, [usage]
  );
}

/* Le même paquet que chiffrer-effectif.mjs, fabriqué sur le téléphone : seul
   ce texte chiffré quitte l'appareil. */
async function chiffrerPaquet(texte, phrase) {
  if (typeof crypto === "undefined" || !crypto.subtle) throw new Error("CONTEXTE_NON_SUR");
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cle = await cleAES(phrase, sel, ITERATIONS, "encrypt");
  const chiffre = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, cle, new TextEncoder().encode(texte)
  );
  return {
    v: 1,
    algo: "AES-GCM-256",
    kdf: { nom: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, sel: versB64(sel) },
    iv: versB64(iv),
    donnees: versB64(new Uint8Array(chiffre)),
    empreinte: versB64(new Uint8Array(await crypto.subtle.digest("SHA-256", chiffre)).slice(0, 8)),
    genere: new Date().toISOString().slice(0, 10),
  };
}

/* Preuve que l'on connaît le code, sans le révéler : le relais n'en garde
   que l'empreinte (node chiffrer-effectif.mjs --jeton). */
async function jetonPublication(phrase) {
  const texte = new TextEncoder();
  const matiere = await crypto.subtle.importKey(
    "raw", texte.encode(phrase), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: texte.encode(SEL_PUBLICATION), iterations: ITERATIONS, hash: "SHA-256" },
    matiere, 256
  );
  return versB64(new Uint8Array(bits));
}

async function envoyerPaquet(paquet, jeton) {
  if (!URL_RELAIS) throw new Error("PUBLICATION_INACTIVE");
  let reponse;
  try {
    reponse = await fetch(URL_RELAIS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paquet, jeton }),
    });
  } catch (e) {
    throw new Error("RESEAU");
  }
  if (reponse.status === 403) throw new Error("CODE_REFUSE");
  if (!reponse.ok) throw new Error("PUBLICATION_ECHEC");
}

async function telechargerPaquet(url = URL_EFFECTIF) {
  let reponse;
  try {
    reponse = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  } catch (e) {
    throw new Error("FICHIER_INDISPONIBLE");
  }
  if (!reponse.ok) throw new Error("FICHIER_INDISPONIBLE");
  const paquet = await reponse.json().catch(() => null);
  if (!paquet || paquet.v !== 1) throw new Error("FORMAT_INCONNU");
  return paquet;
}

/* Rend le CSV en clair. AES-GCM refuse de déchiffrer si le code est faux :
   pas de données approximatives, une erreur franche. */
async function dechiffrerPaquet(paquet, phrase) {
  if (typeof crypto === "undefined" || !crypto.subtle) throw new Error("CONTEXTE_NON_SUR");
  const cle = await cleAES(phrase, depuisB64(paquet.kdf.sel), paquet.kdf.iterations);
  let clair;
  try {
    clair = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: depuisB64(paquet.iv) }, cle, depuisB64(paquet.donnees)
    );
  } catch (e) {
    throw new Error("CODE_INCORRECT");
  }
  return new TextDecoder().decode(clair);
}

/* Découpe « UN NOM COMPOSE Jean » en nom de famille et prénom : les mots en
   capitales du début appartiennent au nom. */
function coupeNom(entier) {
  const mots = entier.split(" ").filter(Boolean);
  if (!mots.length) return null;
  let i = 0;
  while (
    i < mots.length - 1 &&
    mots[i] === mots[i].toUpperCase() &&
    /[A-ZÀ-ÖØ-Þ]/.test(mots[i])
  ) i++;
  if (i === 0) i = 1;
  return { nom: mots.slice(0, i).join(" "), prenom: mots.slice(i).join(" ") };
}

/* Un effectif collé depuis une conversation : soit le CSV complet, soit des
   lignes libres du genre « NOM Prenom 19850521345480 U8 01/01/2000 ». */
function depuisColle(texte) {
  const lignes = (texte || "").replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (!lignes.length) return { personnes: [], erreur: "Rien n'a été collé." };

  const structurees = lignes.filter((l) => /[;,\t]/.test(l)).length;
  if (structurees >= lignes.length - 1) return depuisCSV(texte);

  const rangs = [];
  const ignorees = [];
  lignes.forEach((ligne, n) => {
    const licence = ligne.match(/\b(\d{9,12})\b/);
    if (!licence) { ignorees.push(n + 1); return; }
    const naissance = ligne.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
    const categorie = ligne.match(/\bU\d{1,2}\b|d[ée]l[ée]gu[a-zé]*/i);

    const reste = ligne
      .replace(licence[0], " ")
      .replace(naissance ? naissance[0] : "\u0000", " ")
      .replace(categorie ? categorie[0] : "\u0000", " ")
      .replace(/[;,\t|]+/g, " ")
      .replace(/\s[-–—]+(?=\s|$)/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s\-–—.:]+|[\s\-–—.:]+$/g, "");

    const coupe = coupeNom(reste);
    if (!coupe) { ignorees.push(n + 1); return; }
    rangs.push(
      [coupe.nom, coupe.prenom, categorie ? categorie[0] : "U8",
       licence[1], naissance ? naissance[1] : "", "oui"]
        .map(echappe).join(";")
    );
  });

  if (!rangs.length) {
    return { personnes: [], erreur: "Aucune ligne ne comporte de numéro de licence." };
  }
  const { personnes } = depuisCSV([COLONNES.join(";"), ...rangs].join("\n"));
  return { personnes, ignorees };
}

function bilan(ajoutes, majs, ignorees) {
  const bouts = [];
  if (ajoutes) bouts.push(`${ajoutes} ajouté${ajoutes > 1 ? "s" : ""}`);
  if (majs) bouts.push(`${majs} mis à jour`);
  if (ignorees) bouts.push(`${ignorees} ligne(s) ignorée(s)`);
  return (bouts.length ? bouts.join(", ") : "Aucun changement") + ".";
}

/* Ce qui arrive écrase ce qui porte le même numéro de licence (ou, sans
   licence, les mêmes nom et prénom) ; le reste de l'effectif local est
   conservé, délégués ajoutés à la main compris. L'identifiant local est
   gardé : les équipes déjà composées le référencent. */
function fusion(actuel, personnes) {
  const parCle = new Map(actuel.map((p) => [clePersonne(p), p]));
  let ajoutes = 0;
  let majs = 0;
  personnes.forEach((p) => {
    const cle = clePersonne(p);
    const ancien = parCle.get(cle);
    if (ancien) { parCle.set(cle, { ...ancien, ...p, id: ancien.id }); majs++; }
    else { parCle.set(cle, p); ajoutes++; }
  });
  return { liste: [...parCle.values()], ajoutes, majs };
}

/* ------------------------------------------------------------------ */
/*  Changements entre deux versions de l'effectif                      */
/* ------------------------------------------------------------------ */
const CHAMPS_FICHE = ["nom", "prenom", "licence", "naissance"];

function ecartEffectif(avant, apres) {
  const ancien = new Map(avant.map((p) => [clePersonne(p), p]));
  const nouveau = new Map(apres.map((p) => [clePersonne(p), p]));
  const e = { ajoutes: [], retires: [], validees: [], categories: [], corriges: [] };
  nouveau.forEach((p, cle) => {
    const a = ancien.get(cle);
    if (!a) { e.ajoutes.push(p); return; }
    if (!a.valide && p.valide) e.validees.push(p);
    if (a.categorie !== p.categorie) e.categories.push({ personne: p, de: a.categorie });
    if ((a.valide && !p.valide) || CHAMPS_FICHE.some((c) => (a[c] || "") !== (p[c] || "")))
      e.corriges.push(p);
  });
  ancien.forEach((p, cle) => { if (!nouveau.has(cle)) e.retires.push(p); });
  [e.ajoutes, e.retires, e.validees, e.corriges].forEach((l) => l.sort(parNom));
  e.categories.sort((x, y) => parNom(x.personne, y.personne));
  return e;
}

const ecartVide = (e) =>
  !e || Object.values(e).every((l) => l.length === 0);

const nomCourt = (p) => `${p.nom} ${p.prenom}`.trim();
const avecCategorie = (p) => `${nomCourt(p)} (${estDelegue(p) ? "délégué" : p.categorie})`;

function enumere(liste, f, max = 4) {
  const noms = liste.slice(0, max).map(f);
  const reste = liste.length - max;
  if (reste > 0) noms.push(`et ${reste} autre${reste > 1 ? "s" : ""}`);
  return noms.join(", ");
}

const nombre = (n, singulier, pluriel) => `${n} ${n > 1 ? pluriel : singulier}`;

/* joueur, délégué, ou personne quand la liste mélange les deux */
const sujet = (liste) =>
  liste.every(estDelegue) ? "délégué" : liste.some(estDelegue) ? "personne" : "joueur";

/* Le résumé lu par le délégué : une phrase par sorte de changement. */
function resumeEcart(e) {
  if (ecartVide(e)) return [];
  const lignes = [];
  const n = (l) => l.length;
  if (n(e.ajoutes)) {
    const s = sujet(e.ajoutes);
    const quoi = s === "personne"
      ? nombre(n(e.ajoutes), "nouvelle personne", "nouvelles personnes")
      : nombre(n(e.ajoutes), `nouveau ${s}`, `nouveaux ${s}s`);
    lignes.push(`${quoi} : ${enumere(e.ajoutes, avecCategorie)}`);
  }
  if (n(e.validees))
    lignes.push(`${nombre(n(e.validees), "licence validée", "licences validées")} : ${enumere(e.validees, nomCourt)}`);
  if (n(e.categories))
    lignes.push(`${nombre(n(e.categories), "changement de catégorie", "changements de catégorie")} : ${
      enumere(e.categories, (c) => `${nomCourt(c.personne)} (${c.de} → ${c.personne.categorie})`)}`);
  if (n(e.corriges))
    lignes.push(`${nombre(n(e.corriges), "fiche corrigée", "fiches corrigées")} : ${enumere(e.corriges, nomCourt)}`);
  if (n(e.retires)) {
    const s = sujet(e.retires);
    const quoi = s === "personne"
      ? nombre(n(e.retires), "personne retirée", "personnes retirées")
      : nombre(n(e.retires), `${s} retiré`, `${s}s retirés`);
    lignes.push(`${quoi} : ${enumere(e.retires, nomCourt)}`);
  }
  return lignes;
}

/* « 2026-09-17 » → « 17/09 » */
const jourMois = (iso) => (iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : "");

/* ------------------------------------------------------------------ */
/*  Feuille de match — mise en page du modèle officiel du District      */
/*  Mosellan (football à 5). Deux pages : 4 blocs d'équipe par page.    */
/*  L'aperçu HTML et le PDF suivent la même géométrie.                  */
/* ------------------------------------------------------------------ */
const BLOCS_PAR_PAGE = 4;   // quatre blocs d'équipe par page, comme sur le modèle

const intitule = (type) => TYPES_PLATEAU[type].categoriesJoueurs.join(" / ");

const dateFrancaise = (iso) =>
  iso ? new Date(iso + "T12:00").toLocaleDateString("fr-FR") : "";

/* Les quatre emplacements de la page existent toujours : sur le modèle
   papier ils sont vides, le responsable de plateau peut les remplir. */
function blocsDePage(equipes, page) {
  const debut = page * BLOCS_PAR_PAGE;
  return Array.from({ length: BLOCS_PAR_PAGE }, (_, i) => equipes[debut + i] || null);
}

/* ------------------------------------------------------------------ */
/*  Aperçu HTML — également le document envoyé à l'imprimante          */
/* ------------------------------------------------------------------ */
const CSS_FEUILLE = `
  .fm { font-family: "Times New Roman", Times, serif; color: #000; background: #fff;
        width: 184mm; margin: 0 auto; box-sizing: border-box; }
  .fm-page { padding: 4mm 0 8mm; }
  .fm-page + .fm-page { border-top: 1px dashed #bbb; }
  .fm-haut { display: flex; align-items: center; gap: 6mm; margin-bottom: 6mm; }
  .fm-haut img.district { width: 24mm; }
  .fm-haut img.grandir { width: 60mm; }
  .fm-encart { margin-left: auto; width: 54mm; border: 1px solid #000; background: #ccc;
               text-align: center; padding: 2mm 1mm 1mm; }
  .fm-encart .cat { font-family: "Courier New", Courier, monospace; font-size: 11pt; }
  .fm-encart .titre { font-family: Impact, Haettenschweiler, "Franklin Gothic Bold", Charcoal, "Helvetica Inserat", "Bitstream Vera Sans Bold", "Arial Black", "sans serif"; color: #000; font-weight: bold; font-size: 13pt; margin: 1mm 0 1mm; }
  .fm-encart img { width: 40mm; display: block; margin: 1mm auto 0; }
  .fm-titre { text-align: center; font-weight: bold; font-size: 14pt; margin: 0 0 3mm; }

  .fm-grille { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .fm-grille > tbody > tr > td { border: 1.4pt solid #000; padding: 0; vertical-align: top; }
  .fm-equipe { font-weight: bold; font-size: 11pt; padding: 1mm 1.5mm 0; }
  .fm-equipe u { text-decoration: none; border-bottom: 1px solid #000;
                 display: inline-block; min-width: 34mm; }
  .fm-joueurs { width: 100%; border-collapse: collapse; table-layout: fixed;
                font-size: 10.5pt; margin-top: 1mm; }
  .fm-joueurs th { font-weight: normal; text-align: center; padding: 0 1mm 0.5mm; }
  .fm-joueurs td { padding: 0.8mm 1.5mm; height: 5.2mm; }
  .fm-joueurs .lic { width: 42%; border-left: 1pt solid #000; text-align: center;
                     font-variant-numeric: tabular-nums; }
  .fm-joueurs tbody td { border-bottom: 0.5pt solid #777; }
  .fm-joueurs tbody tr:last-child td { border-bottom: none; }
  .fm-joueurs .num { color: #000; padding-right: 1.5mm; }
  .fm-joueurs .nom { display: inline-block; max-width: 42mm; overflow: hidden;
                     text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
  .fm-delegue td { font-size: 10pt; border-bottom: none !important; }

  .fm-section { text-align: center; font-weight: bold; font-size: 12pt;
                margin: 5mm 0 4mm; }
  .fm-section span { border-bottom: 1px solid #000; padding-bottom: 1px; }
  .fm-infos { width: 100%; border-collapse: collapse; font-size: 11pt; }
  .fm-infos td { padding: 1.5mm 0; }
  .fm-infos b { white-space: nowrap; }
  .fm-infos .val { border-bottom: 1px solid #000; }
  .fm-tsvp { text-align: right; font-weight: bold; font-size: 10pt; margin-top: 8mm; }
  .fm-bloc-bas { font-size: 10.5pt; margin-top: 4mm; }
  .fm-bloc-bas .lab { font-weight: bold; }
  .fm-bloc-bas .trait { border-bottom: 1px solid #000; height: 7mm; }
`;

const CSS_IMPRESSION = `
  @page { size: A4 portrait; margin: 12.7mm; }
  @media print {
    body { margin: 0; height: auto !important; }
    .fm { transform: none !important; }
    .fm { width: auto; }
    .fm-page { padding: 0; page-break-after: always; border-top: none; }
    .fm-page:last-child { page-break-after: auto; }
  }
`;

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const jpeg = (img) => `data:image/jpeg;base64,${img.b64}`;

function blocHTML(equipe, personneDe) {
  const lignes = Array.from({ length: MAX_JOUEURS }, (_, i) => {
    const j = equipe ? personneDe(equipe.joueurs[i]) : null;
    const nom = j ? `${esc(j.nom)} ${esc(j.prenom)}` : "";
    return `<tr><td><span class="num">${i + 1}</span><span class="nom">${nom}</span></td>
      <td class="lic">${esc(j?.licence || "")}</td></tr>`;
  }).join("");

  const d = equipe?.delegueId ? personneDe(equipe.delegueId) : null;

  return `
    <div class="fm-equipe">Equipe : <u>${esc(equipe?.nom || "")}</u></div>
    <table class="fm-joueurs">
      <thead><tr><th>Nom Prénom</th><th class="lic">N° Licence</th></tr></thead>
      <tbody>
        ${lignes}
        <tr class="fm-delegue">
          <td><b>Délégué :</b> ${d ? `${esc(d.nom)} ${esc(d.prenom)}` : ""}</td>
          <td class="lic">${esc(d?.licence || "")}</td>
        </tr>
      </tbody>
    </table>`;
}

function grilleHTML(equipes, page, personneDe) {
  const b = blocsDePage(equipes, page).map((e) => blocHTML(e, personneDe));
  return `<table class="fm-grille"><tbody>
      <tr><td>${b[0]}</td><td>${b[1]}</td></tr>
      <tr><td>${b[2]}</td><td>${b[3]}</td></tr>
    </tbody></table>`;
}

function feuilleHTML(plateau, equipes, personneDe) {
  const cat = intitule(plateau.type);
  const secondePage = equipes.length > BLOCS_PAR_PAGE;

  const entete = `
    <div class="fm-haut">
      <img class="district" src="${jpeg(IMG_DISTRICT)}" alt="District Mosellan de Football">
      <img class="grandir" src="${jpeg(IMG_GRANDIR)}" alt="Football des enfants — Jouer pour grandir">
      <div class="fm-encart">
        <div class="cat">FOOTBALL à 5 (${esc(cat)})</div>
        <div class="titre">FEUILLE DE MATCH</div>
        <img src="${jpeg(IMG_CRAMPONS)}" alt="">
      </div>
    </div>`;

  const infos = `
    <div class="fm-section"><span>SECTION FOOTBALL des ${esc(cat)}</span></div>
    <table class="fm-infos">
      <tr>
        <td width="16%"><b>SECTEUR DE :</b></td><td class="val" width="34%">&nbsp;${esc(plateau.secteur)}</td>
        <td width="12%" align="right"><b>GROUPE :</b></td><td class="val">&nbsp;${esc(plateau.groupe)}</td>
      </tr>
      <tr>
        <td><b>PLATEAU à :</b></td><td class="val">&nbsp;${esc(plateau.lieu)}</td>
        <td align="right"><b>DATE :</b></td><td class="val">&nbsp;${esc(dateFrancaise(plateau.date))}</td>
      </tr>
      <tr>
        <td colspan="2"><b>RESPONSABLE Du PLATEAU :</b></td>
        <td class="val" colspan="2">&nbsp;${esc(plateau.responsable || "")}</td>
      </tr>
    </table>
    <div class="fm-tsvp">T.S.V.P.</div>`;

  const bas = `
    <div class="fm-bloc-bas">
      <div class="lab">OBSERVATIONS ou RECLAMATIONS (SIGNEES) CLUB :</div>
      <div class="trait"></div><div class="trait"></div>
      <div class="lab" style="margin-top:4mm">JOUEURS BLESSES (Nom, Prénom, Club, N° licence et Nature de la blessure) :</div>
      <div class="trait"></div><div class="trait"></div><div class="trait"></div>
      <div class="lab" style="margin-top:6mm">Signature du Responsable de plateau :</div>
      <div style="height:16mm"></div>
    </div>`;

  return `
    <div class="fm">
      <div class="fm-page">
        ${entete}
        <h3 class="fm-titre">Composition des équipes :</h3>
        ${grilleHTML(equipes, 0, personneDe)}
        ${infos}
      </div>
      <div class="fm-page">
        ${secondePage ? grilleHTML(equipes, 1, personneDe) : ""}
        ${bas}
      </div>
    </div>`;
}

/* L'aperçu garde la largeur d'une A4 et se réduit pour tenir dans le
   cadre : sur un téléphone on voit la feuille entière, pas un morceau.
   L'impression, elle, reprend toujours l'échelle 1. */
const AJUSTEMENT = `
  const ajuster = () => {
    const f = document.querySelector(".fm");
    if (!f) return;
    f.style.transform = "none";
    const k = Math.min(1, document.documentElement.clientWidth / f.offsetWidth);
    f.style.transformOrigin = "top left";
    f.style.transform = "scale(" + k + ")";
    document.body.style.height = Math.ceil(f.offsetHeight * k) + "px";
  };
  addEventListener("load", ajuster);
  addEventListener("resize", ajuster);
`;

function documentFeuille(corps) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feuille de match</title>
<style>body{margin:0;background:#fff;overflow-x:auto;}${CSS_FEUILLE}${CSS_IMPRESSION}</style>
</head><body>${corps}<script>${AJUSTEMENT}<\/script></body></html>`;
}

/* ------------------------------------------------------------------ */
/*  PDF — fabriqué à la main : le bac à sable de l'aperçu interdit     */
/*  print() et l'ouverture d'onglets, un fichier reste la seule voie.  */
/*  Polices de base : Times (F1/F2) et Courier gras (F3).              */
/* ------------------------------------------------------------------ */
const A4 = { l: 595.28, h: 841.89 };
const MARGE = 36;

const latin1 = (s) =>
  String(s ?? "")
    .replace(/—/g, "-").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x00-\xFF]/g, "?");

const pdfEsc = (s) =>
  latin1(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/* Largeurs réelles des polices de base (millièmes de cadratin, codes 32 à 255),
   pour centrer et tronquer au plus juste. Courier-Bold : 600 partout. */
const L_TIMES = (
  "250,333,408,500,500,833,778,333,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,500,250,250,250,500,250,250,250,250,400,250,250,250,250,250,250,250,250,250,250,500,250,250,250,250,722,722,722,722,722,722,889,667,611,611,611,611,333,333,333,333,250,722,722,722,722,722,722,250,250,722,722,722,722,722,250,500,444,444,444,444,444,444,667,444,444,444,444,444,278,278,278,278,250,500,500,500,500,500,500,250,250,500,500,500,500,500,250,500"
).split(",").map(Number);

const L_TIMES_GRAS = (
  "250,333,555,500,500,1000,833,333,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,556,556,444,389,333,556,500,722,500,500,444,394,220,394,520,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,500,250,250,250,500,250,250,250,250,400,250,250,250,250,250,250,250,250,250,250,500,250,250,250,250,722,722,722,722,722,722,1000,722,667,667,667,667,389,389,389,389,250,722,778,778,778,778,778,250,250,722,722,722,722,722,250,556,500,500,500,500,500,500,722,444,444,444,444,444,278,278,278,278,250,556,500,500,500,500,500,250,250,556,556,556,556,500,250,500"
).split(",").map(Number);

const largeurTexte = (s, taille, police = "F1") => {
  const t = latin1(s);
  if (police === "F3") return t.length * taille * 0.6;   // Courier : chasse fixe
  const table = police === "F2" ? L_TIMES_GRAS : L_TIMES;
  let mille = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    mille += c >= 32 && c <= 255 ? table[c - 32] : 500;
  }
  return (mille * taille) / 1000;
};

function tronquer(s, maxi, taille, police = "F1") {
  let t = latin1(s);
  if (largeurTexte(t, taille, police) <= maxi) return t;
  while (t.length > 1 && largeurTexte(t + ".", taille, police) > maxi) t = t.slice(0, -1);
  return t + ".";
}

/* Géométrie partagée par les deux pages */
const xG = MARGE;
const xD = A4.l - MARGE;
const LARGEUR_BLOC = (xD - xG) / 2;
const HAUTEUR_BLOC = 208;
const PART_NOM = 0.58;          // part de la cellule réservée au nom

function crayon() {
  const ops = [];
  const y = (haut) => (A4.h - haut).toFixed(2);
  const api = {
    ops,
    texte(x, haut, taille, police, s) {
      ops.push(`BT /${police} ${taille} Tf 1 0 0 1 ${x.toFixed(2)} ${y(haut)} Tm (${pdfEsc(s)}) Tj ET`);
    },
    centre(xMil, haut, taille, police, s) {
      api.texte(xMil - largeurTexte(s, taille, police) / 2, haut, taille, police, s);
    },
    droite(xFin, haut, taille, police, s) {
      api.texte(xFin - largeurTexte(s, taille, police), haut, taille, police, s);
    },
    trait(x1, x2, haut, ep = 0.6) {
      ops.push(`${ep} w ${x1.toFixed(2)} ${y(haut)} m ${x2.toFixed(2)} ${y(haut)} l S`);
    },
    vertical(x, haut1, haut2, ep = 0.6) {
      ops.push(`${ep} w ${x.toFixed(2)} ${y(haut1)} m ${x.toFixed(2)} ${y(haut2)} l S`);
    },
    cadre(x, haut, l, h, ep = 0.6) {
      ops.push(`${ep} w ${x.toFixed(2)} ${y(haut + h)} ${l.toFixed(2)} ${h.toFixed(2)} re S`);
    },
    aplat(x, haut, l, h, gris) {
      ops.push(`${gris} g ${x.toFixed(2)} ${y(haut + h)} ${l.toFixed(2)} ${h.toFixed(2)} re f 0 g`);
    },
    rouge(on) { ops.push(on ? "0.78 0.08 0.08 rg" : "0 g"); },
    image(img, x, haut, l) {
      const h = (l * img.h) / img.l;
      ops.push(`q ${l.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y(haut + h)} cm /${img.nom} Do Q`);
      return h;
    },
  };
  return api;
}

/* Un bloc d'équipe, calqué sur les cases du modèle papier. */
function blocPDF(p, equipe, personneDe, bx, bt) {
  const cw = LARGEUR_BLOC;
  const xSep = bx + cw * PART_NOM;

  p.cadre(bx, bt, cw, HAUTEUR_BLOC, 1.2);

  const etiquette = "Equipe : ";
  p.texte(bx + 5, bt + 14, 11, "F2", etiquette);
  const xNomEq = bx + 5 + largeurTexte(etiquette, 11, "F2");
  if (equipe) p.texte(xNomEq, bt + 14, 11, "F2", tronquer(equipe.nom, cw - (xNomEq - bx) - 8, 11, "F2"));
  p.trait(xNomEq, bx + cw - 5, bt + 17, 0.6);

  p.centre(bx + (cw * PART_NOM) / 2, bt + 32, 10, "F1", "Nom Prénom");
  p.centre(xSep + (cw * (1 - PART_NOM)) / 2, bt + 32, 10, "F1", "N° Licence");
  p.vertical(xSep, bt + 21, bt + HAUTEUR_BLOC, 1);

  const hLigne = 18.5;
  for (let i = 0; i < MAX_JOUEURS; i++) {
    const hy = bt + 52 + i * hLigne;
    const j = equipe ? personneDe(equipe.joueurs[i]) : null;
    p.texte(bx + 5, hy, 10.5, "F1", String(i + 1));
    if (j) {
      p.texte(bx + 19, hy, 10.5, "F1",
        tronquer(`${j.nom} ${j.prenom}`, xSep - bx - 25, 10.5, "F1"));
      p.centre(xSep + (cw * (1 - PART_NOM)) / 2, hy, 10.5, "F1", j.licence || "");
    }
    p.trait(bx + 5, xSep - 3, hy + 3.5, 0.4);
    p.trait(xSep + 6, bx + cw - 6, hy + 3.5, 0.4);
  }

  const d = equipe?.delegueId ? personneDe(equipe.delegueId) : null;
  const hd = bt + HAUTEUR_BLOC - 8;
  p.texte(bx + 5, hd, 10, "F2", "Délégué :");
  if (d) {
    p.texte(bx + 52, hd, 10, "F1", tronquer(`${d.nom} ${d.prenom}`, xSep - bx - 58, 10, "F1"));
    p.centre(xSep + (cw * (1 - PART_NOM)) / 2, hd, 10, "F1", d.licence || "");
  }
}

function grillePDF(p, equipes, page, personneDe, htGrille) {
  blocsDePage(equipes, page).forEach((e, i) => {
    const bx = xG + (i % 2) * LARGEUR_BLOC;
    const bt = htGrille + Math.floor(i / 2) * HAUTEUR_BLOC;
    blocPDF(p, e, personneDe, bx, bt);
  });
  return htGrille + 2 * HAUTEUR_BLOC;
}

function pagePremiere(plateau, equipes, personneDe) {
  const p = crayon();
  const cat = intitule(plateau.type);

  /* En-tête : les trois visuels du modèle */
  p.image(IMAGES[0], xG + 4, 24, 74);
  p.image(IMAGES[1], xG + 130, 30, 172);

  const encX = 405;
  const encL = xD - encX;
  const encT = 20;
  const encH = 96;
  p.aplat(encX, encT, encL, encH, "0.8");
  p.cadre(encX, encT, encL, encH, 0.8);
  const encMil = encX + encL / 2;
  p.centre(encMil, encT + 18, 11, "F3", `FOOTBALL à 5 (${cat})`);
  //p.rouge(true);
  p.centre(encMil, encT + 40, 14, "F2", "FEUILLE DE MATCH");
  //p.rouge(false);
  p.image(IMAGES[2], encMil - 56, encT + 48, 112);

  p.centre(A4.l / 2, 186, 14, "F2", "Composition des équipes :");

  const basGrille = grillePDF(p, equipes, 0, personneDe, 200);

  /* Pied de page 1 */
  const titre = `SECTION FOOTBALL des ${cat}`;
  const hTitre = basGrille + 32;
  p.centre(A4.l / 2, hTitre, 12, "F2", titre);
  const lt = largeurTexte(titre, 12, "F2");
  p.trait(A4.l / 2 - lt / 2, A4.l / 2 + lt / 2, hTitre + 3, 0.8);

  const champ = (x, haut, label, valeur, xFin) => {
    p.texte(x, haut, 11, "F2", label);
    const xv = x + largeurTexte(label, 11, "F2") + 6;
    p.texte(xv, haut, 11, "F1", tronquer(valeur || "", xFin - xv - 4, 11, "F1"));
    p.trait(xv - 4, xFin, haut + 3, 0.6);
  };
  const milieu = xG + LARGEUR_BLOC;
  let h = hTitre + 34;
  champ(xG, h, "SECTEUR DE :", plateau.secteur, milieu - 12);
  champ(milieu + 10, h, "GROUPE :", plateau.groupe, xD);
  h += 26;
  champ(xG, h, "PLATEAU à :", plateau.lieu, milieu - 12);
  champ(milieu + 10, h, "DATE :", dateFrancaise(plateau.date), xD);
  h += 26;
  champ(xG, h, "RESPONSABLE Du PLATEAU :", plateau.responsable, xD);

  p.droite(xD, A4.h - 46, 10, "F2", "T.S.V.P.");
  return p.ops.join("\n");
}

function pageSeconde(plateau, equipes, personneDe) {
  const p = crayon();
  let h = 40;
  if (equipes.length > BLOCS_PAR_PAGE) h = grillePDF(p, equipes, 1, personneDe, h) + 30;

  const traits = (n, depart, pas = 22) => {
    for (let i = 0; i < n; i++) p.trait(xG, xD, depart + i * pas, 0.5);
    return depart + (n - 1) * pas;
  };

  p.texte(xG, h, 10.5, "F2", "OBSERVATIONS ou RECLAMATIONS (SIGNEES) CLUB :");
  h = traits(2, h + 20) + 34;
  p.texte(xG, h, 10.5, "F2", "JOUEURS BLESSES (Nom, Prénom, Club, N° licence et Nature de la blessure) :");
  h = traits(3, h + 20) + 44;
  p.texte(xG, h, 10.5, "F2", "Signature du Responsable de plateau :");
  return p.ops.join("\n");
}

function contenuPDF(plateau, equipes, personneDe) {
  return [
    pagePremiere(plateau, equipes, personneDe),
    pageSeconde(plateau, equipes, personneDe),
  ];
}

/* Assemblage du fichier : catalogue, polices, images, puis les pages. */
function construirePDF(pages) {
  const nPolices = 3;
  const premiereImage = 3 + nPolices;                 // 1 catalogue, 2 pages
  const premierePage = premiereImage + IMAGES.length;

  const refsPages = pages.map((_, i) => `${premierePage + i * 2} 0 R`).join(" ");
  const ressources =
    "/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> /XObject << " +
    IMAGES.map((im, i) => `/${im.nom} ${premiereImage + i} 0 R`).join(" ") +
    " >> >>";

  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${refsPages}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>",
  ];

  IMAGES.forEach((im) => {
    const donnees = atob(im.b64);
    objets.push(
      `<< /Type /XObject /Subtype /Image /Width ${im.l} /Height ${im.h} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
      `/Length ${donnees.length} >>\nstream\n${donnees}\nendstream`
    );
  });

  pages.forEach((contenu, i) => {
    objets.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.l} ${A4.h}] ` +
      `${ressources} /Contents ${premierePage + i * 2 + 1} 0 R >>`
    );
    objets.push(`<< /Length ${contenu.length} >>\nstream\n${contenu}\nendstream`);
  });

  let pdf = "%PDF-1.4\n";
  const positions = [];
  objets.forEach((o, i) => {
    positions.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const debutXref = pdf.length;
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  positions.forEach((p) => { pdf += String(p).padStart(10, "0") + " 00000 n \n"; });
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${debutXref}\n%%EOF`;

  const octets = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) octets[i] = pdf.charCodeAt(i) & 0xff;
  return octets;
}

/* ------------------------------------------------------------------ */
/*  Stockage : window.storage dans l'artifact, localStorage ailleurs    */
/* ------------------------------------------------------------------ */
const stockage = {
  async lire(cle) {
    if (typeof window !== "undefined" && window.storage) {
      const r = await window.storage.get(cle);
      return r?.value ?? null;
    }
    return window.localStorage.getItem(cle);
  },
  ecrire(cle, valeur) {
    if (typeof window !== "undefined" && window.storage) return window.storage.set(cle, valeur);
    window.localStorage.setItem(cle, valeur);
  },
};

/* ------------------------------------------------------------------ */
/*  Suivi d'usage — un compteur, rien de plus. Aucun nom, aucune       */
/*  licence, aucun lieu ni date de plateau ne sort d'ici.              */
/* ------------------------------------------------------------------ */
const SUIVI = typeof location !== "undefined" && location.protocol === "https:";

function suivi(evenement) {
  if (!SUIVI) return;
  try {
    window.goatcounter?.count({ path: evenement, title: evenement, event: true });
  } catch (e) { /* bloqueur, hors ligne : sans importance */ }
}


/* ------------------------------------------------------------------ */
/*  Application                                                        */
/* ------------------------------------------------------------------ */
export default function App() {
  const [effectif, setEffectif] = useState([]);
  const [plateau, setPlateau] = useState(PLATEAU_VIDE);
  const [equipes, setEquipes] = useState([equipeVide(1)]);
  const [equipeActive, setEquipeActive] = useState(null);
  const [onglet, setOnglet] = useState("effectif");
  const [pret, setPret] = useState(false);
  const [etatEffectif, setEtatEffectif] = useState("chargement");
  const [codeDemande, setCodeDemande] = useState(false);
  /* L'effectif tel qu'il a été publié la dernière fois que cet appareil l'a
     vu : la référence des changements reçus comme de ceux à publier. */
  const [publie, setPublie] = useState(null);
  const [nouveautes, setNouveautes] = useState(null);
  const [publicationOuverte, setPublicationOuverte] = useState(false);

  /* Arrivée d'une version publiée : les retraits sont appliqués, le reste
     passe par fusion() (les personnes jamais publiées restent). */
  const recevoir = (personnes, paquet, reference, annoncer) => {
    const ecart = reference ? ecartEffectif(reference, personnes) : null;
    const partis = new Set((ecart?.retires || []).map(clePersonne));
    setEffectif((prev) =>
      fusion(prev.filter((p) => !partis.has(clePersonne(p))), personnes).liste
    );
    setPublie(personnes);
    if (annoncer && !ecartVide(ecart)) {
      setNouveautes({ date: paquet.genere || "", lignes: resumeEcart(ecart) });
    }
    try {
      stockage.ecrire(CLE_EMPREINTE, paquet.empreinte || "");
      stockage.ecrire(CLE_REMPLACEE, "");
    } catch (e) { /* best effort */ }
  };

  /* Rien n'est embarqué dans le code. L'effectif vient du fichier chiffré
     publié à côté de l'application, et de ce qu'en a gardé le navigateur. */
  const synchroniser = async (liste, reference) => {
    let code = null;
    let empreinte = null;
    let remplacee = null;
    try {
      code = await stockage.lire(CLE_CODE);
      empreinte = await stockage.lire(CLE_EMPREINTE);
      remplacee = await stockage.lire(CLE_REMPLACEE);
    } catch (e) { /* stockage indisponible */ }
    if (!code) return liste.length ? "local" : "code_requis";

    let paquet;
    try {
      paquet = await telechargerPaquet();
    } catch (e) {
      return liste.length ? "hors_ligne" : "indisponible";
    }
    /* Juste après une publication depuis cet appareil, le site sert encore
       l'ancienne version quelques minutes : on ne revient pas en arrière. */
    if (remplacee && paquet.empreinte === remplacee) return "publication_en_cours";
    if (liste.length && reference && paquet.empreinte && paquet.empreinte === empreinte) {
      if (remplacee) try { stockage.ecrire(CLE_REMPLACEE, ""); } catch (e) { /* best effort */ }
      return "a_jour";
    }

    try {
      const { personnes } = depuisCSV(await dechiffrerPaquet(paquet, code));
      if (!personnes.length) return "a_jour";
      const nouvelle = liste.length > 0 && paquet.empreinte !== empreinte;
      recevoir(personnes, paquet, reference, nouvelle);
      return nouvelle ? "mis_a_jour" : "a_jour";
    } catch (e) {
      return "code_perime";
    }
  };

  /* Les vérifications en cours de navigation lisent l'état du moment. */
  const courant = useRef({});
  courant.current = { effectif, publie };
  const verification = useRef(false);

  const verifier = async () => {
    if (verification.current) return;
    verification.current = true;
    try {
      const etat = await synchroniser(courant.current.effectif, courant.current.publie);
      /* Sans code enregistré il n'y a rien à vérifier : l'état affiché reste. */
      if (etat !== "local" && etat !== "code_requis") setEtatEffectif(etat);
    } finally {
      verification.current = false;
    }
  };

  useEffect(() => {
    (async () => {
      let liste = [];
      let reference = null;
      try {
        const v = await stockage.lire(CLE_EFFECTIF);
        if (v) {
          liste = JSON.parse(v) || [];
          setEffectif(liste);
        }
      } catch (e) { /* première ouverture, ou stockage indisponible */ }
      try {
        const v = await stockage.lire(CLE_PUBLIE);
        if (v) {
          reference = JSON.parse(v);
          setPublie(reference);
        }
      } catch (e) { /* pas encore de version publiée connue */ }
      try {
        const v = await stockage.lire(CLE_NOUVEAUTES);
        if (v) setNouveautes(JSON.parse(v));
      } catch (e) { /* rien à annoncer */ }
      try {
        const v = await stockage.lire(CLE_PLATEAU);
        if (v) {
          const d = JSON.parse(v);
          if (d.plateau) {
            /* Un plateau sauvegardé avant l'introduction du type de plateau
               n'a pas de champ `type` (il avait `categorie`) : on retombe sur
               l'unique type existant plutôt que de planter. */
            const type = TYPES_PLATEAU[d.plateau.type] ? d.plateau.type : "U9";
            /* Un plateau enregistré avant les valeurs du club (sans
               `defautsClub`) les reçoit une fois ; ensuite, ce que le délégué
               a choisi au crayon est conservé. Vide : les valeurs du club. */
            const ancien = !d.plateau.defautsClub;
            setPlateau({
              ...d.plateau,
              type,
              secteur: (!ancien && d.plateau.secteur) || SECTEUR_DEFAUT,
              groupe: (!ancien && d.plateau.groupe) || GROUPE_DEFAUT,
              defautsClub: true,
            });
          }
          if (d.equipes?.length) {
            setEquipes(d.equipes);
            setEquipeActive(d.equipes[0].id);
          }
        }
      } catch (e) { /* pas de plateau en cours */ }

      /* Avec un effectif déjà là, on ouvre tout de suite et la vérification
         se fait derrière. Sans effectif, rien à montrer avant la réponse. */
      if (liste.length) {
        setOnglet("plateau");
        setPret(true);
      }
      const etat = await synchroniser(liste, reference);
      setEtatEffectif(etat);
      suivi(`ouverture/${etat}`);
      if (liste.length === 0) setOnglet("plateau");
      setPret(true);
    })();
  }, []);

  /* Pendant l'utilisation : au retour sur l'application, et régulièrement
     tant qu'elle est affichée. */
  useEffect(() => {
    if (!pret) return undefined;
    const auRetour = () => { if (document.visibilityState === "visible") verifier(); };
    const minuterie = setInterval(auRetour, INTERVALLE_VERIFICATION);
    document.addEventListener("visibilitychange", auRetour);
    return () => {
      clearInterval(minuterie);
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [pret]);

  /* Saisie du code : télécharge, déchiffre, mémorise. */
  const ouvrirAvecCode = async (code) => {
    const paquet = await telechargerPaquet();
    const { personnes } = depuisCSV(await dechiffrerPaquet(paquet, code));
    if (!personnes.length) throw new Error("FICHIER_VIDE");
    recevoir(personnes, paquet, publie, false);
    try { stockage.ecrire(CLE_CODE, code); } catch (e) { /* best effort */ }
    setEtatEffectif("a_jour");
    setCodeDemande(false);
    setOnglet("plateau");
  };

  /* Repli : une liste collée depuis une conversation. */
  const reprendreColle = (texte) => {
    const { personnes, erreur } = depuisColle(texte);
    if (erreur || !personnes.length) throw new Error(erreur || "Aucune ligne lisible dans ce texte.");
    setEffectif((prev) => fusion(prev, personnes).liste);
    setEtatEffectif("colle");
    setCodeDemande(false);
    setOnglet("plateau");
  };

  const oublierCode = () => {
    try {
      stockage.ecrire(CLE_CODE, "");
      stockage.ecrire(CLE_EMPREINTE, "");
      stockage.ecrire(CLE_REMPLACEE, "");
    } catch (e) { /* best effort */ }
    setEtatEffectif(effectif.length ? "local" : "code_requis");
    setCodeDemande(true);
  };

  const enregistre = (cle, valeur) => {
    try { stockage.ecrire(cle, JSON.stringify(valeur)); } catch (e) { /* best effort */ }
  };

  useEffect(() => { if (pret) enregistre(CLE_EFFECTIF, effectif); }, [effectif, pret]);
  useEffect(() => { if (pret) enregistre(CLE_PLATEAU, { plateau, equipes }); }, [plateau, equipes, pret]);
  useEffect(() => { if (pret && publie) enregistre(CLE_PUBLIE, publie); }, [publie, pret]);
  useEffect(() => { if (pret) enregistre(CLE_NOUVEAUTES, nouveautes); }, [nouveautes, pret]);

  /* Une personne retirée de l'effectif (à la main ou par une mise à jour)
     ne reste pas dans une équipe. */
  useEffect(() => {
    if (!pret || !effectif.length) return;
    const ids = new Set(effectif.map((p) => p.id));
    setEquipes((prev) => {
      const orphelin = prev.some((e) =>
        e.joueurs.some((i) => !ids.has(i)) || (e.delegueId && !ids.has(e.delegueId)));
      if (!orphelin) return prev;
      return prev.map((e) => ({
        ...e,
        joueurs: e.joueurs.filter((i) => ids.has(i)),
        delegueId: ids.has(e.delegueId) ? e.delegueId : null,
      }));
    });
  }, [effectif, pret]);

  /* Ce qui a changé sur cet appareil depuis la dernière version publiée. */
  const aPublier = useMemo(
    () => (publie ? ecartEffectif(publie, effectif) : null),
    [publie, effectif]
  );
  const modificationsEnAttente = publie
    ? !ecartVide(aPublier)
    : ["local", "colle"].includes(etatEffectif) && effectif.length > 0;

  /* Chiffre l'effectif avec le code de l'effectif et le confie au relais.
     En cas d'échec rien ne change sur l'appareil. */
  const publier = async (codeSaisi) => {
    let code = codeSaisi;
    try {
      if (!code) code = await stockage.lire(CLE_CODE);
    } catch (e) { /* stockage indisponible */ }
    if (!code) throw new Error("CODE_MANQUANT");
    /* La version en ligne au moment de publier : tant que le site la sert
       encore, synchroniser() ne la réapplique pas. */
    let remplacee = "";
    try {
      remplacee = (await telechargerPaquet()).empreinte || "";
    } catch (e) {
      try { remplacee = (await stockage.lire(CLE_EMPREINTE)) || ""; } catch (e2) { /* best effort */ }
    }
    const liste = effectif;
    const paquet = await chiffrerPaquet(versCSV(liste), code);
    await envoyerPaquet(paquet, await jetonPublication(code));
    try {
      stockage.ecrire(CLE_CODE, code);
      stockage.ecrire(CLE_EMPREINTE, paquet.empreinte);
      stockage.ecrire(CLE_REMPLACEE, remplacee);
    } catch (e) { /* best effort */ }
    setPublie(liste);
    setEtatEffectif("publication_en_cours");
    suivi("effectif/publie");
  };

  const personneDe = (id) => effectif.find((p) => p.id === id);

  const affectation = useMemo(() => {
    const m = {};
    equipes.forEach((e) => e.joueurs.forEach((id) => { m[id] = e; }));
    return m;
  }, [equipes]);

  const basculer = (equipeId, joueurId) => {
    setEquipes((prev) =>
      prev.map((e) => {
        if (e.id !== equipeId) return e;
        const dejaIci = e.joueurs.includes(joueurId);
        if (!dejaIci && e.joueurs.length >= MAX_JOUEURS) return e;
        return {
          ...e,
          joueurs: dejaIci ? e.joueurs.filter((i) => i !== joueurId) : [...e.joueurs, joueurId],
        };
      })
    );
  };

  const majEquipe = (id, patch) =>
    setEquipes((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const ajouterEquipe = () => {
    if (equipes.length >= MAX_EQUIPES) return;
    const e = equipeVide(equipes.length + 1);
    setEquipes((prev) => [...prev, e]);
    setEquipeActive(e.id);
  };

  const supprimerEquipe = (id) =>
    setEquipes((prev) => (prev.length === 1 ? prev : prev.filter((e) => e.id !== id)));

  const nouveauPlateau = () => {
    setPlateau({ ...PLATEAU_VIDE, secteur: plateau.secteur, groupe: plateau.groupe, type: plateau.type });
    const e = equipeVide(1);
    setEquipes([e]);
    setEquipeActive(e.id);
    setOnglet("plateau");
  };

  /* Une fiche corrigée garde sa place dans les équipes, même si son
     identifiant change avec le numéro de licence. */
  const modifierPersonne = (id, fiche) => {
    const nouvelId = idPersonne(fiche.licence, fiche.nom, fiche.prenom);
    setEffectif((prev) => prev.map((p) => (p.id === id ? { ...fiche, id: nouvelId } : p)));
    if (nouvelId === id) return;
    setEquipes((prev) =>
      prev.map((e) => ({
        ...e,
        joueurs: e.joueurs.map((i) => (i === id ? nouvelId : i)),
        delegueId: e.delegueId === id ? nouvelId : e.delegueId,
      }))
    );
  };

  /* Retirer quelqu'un de l'effectif le retire aussi des équipes. */
  const retirerDeLEffectif = (id) => {
    setEffectif((prev) => prev.filter((p) => p.id !== id));
    setEquipes((prev) =>
      prev.map((e) => ({
        ...e,
        joueurs: e.joueurs.filter((i) => i !== id),
        delegueId: e.delegueId === id ? null : e.delegueId,
      }))
    );
  };

  if (!pret) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm"
        style={{ background: C.craie, color: C.ink70 }}>
        Ouverture…
      </div>
    );
  }

  const sansEffectif = effectif.length === 0;
  const demandeCode =
    codeDemande ||
    (sansEffectif && ["code_requis", "code_perime", "indisponible"].includes(etatEffectif));

  if (demandeCode) {
    return (
      <Deverrouillage
        etat={etatEffectif}
        ouvrir={ouvrirAvecCode}
        coller={reprendreColle}
        annuler={sansEffectif ? null : () => setCodeDemande(false)}
      />
    );
  }

  const onglets = [
    { id: "plateau", label: "Plateau", icon: ClipboardList },
    { id: "equipes", label: "Équipes", icon: Users },
    { id: "feuille", label: "Feuille", icon: FileText },
    { id: "effectif", label: "Effectif", icon: UserPlus },
  ];

  return (
    <div className="min-h-screen pb-24" style={{ background: C.craie, color: C.ink }}>
      <style>{`
        input:focus, select:focus, button:focus-visible {
          outline: 2px solid ${C.terrain}; outline-offset: 1px;
        }
      `}</style>

      <header className="px-4 py-4 border-b" style={{ borderColor: C.ligne, background: C.papier }}>
        <div className="max-w-3xl mx-auto flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Feuilles de plateau</h1>
            <p className="text-xs" style={{ color: C.ink70 }}>
              {CLUB.nom} · {CLUB.numero}
            </p>
          </div>
          <button onClick={nouveauPlateau}
            className="text-xs px-3 py-2 rounded-md border flex items-center gap-1.5"
            style={{ borderColor: C.ligne, color: C.ink70 }}>
            <RotateCcw size={13} /> Nouveau plateau
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5">
        {nouveautes && (
          <BandeauNouveautes nouveautes={nouveautes} fermer={() => setNouveautes(null)} />
        )}
        <BandeauEffectif
          etat={etatEffectif}
          action={etatEffectif === "code_perime" ? () => setCodeDemande(true) : null}
          libelleAction="Saisir le code"
        />
        {modificationsEnAttente && onglet !== "effectif" && (
          <div className="rounded-lg border px-3 py-2.5 mb-4 text-sm flex items-start gap-2"
            style={{ borderColor: C.brassard, background: "#FBF3E2" }}>
            <Upload size={14} className="mt-0.5 shrink-0" style={{ color: C.brassard }} />
            <span className="flex-1">
              Vos modifications de l'effectif ne sont pas encore publiées.
            </span>
            <button onClick={() => { setOnglet("effectif"); setPublicationOuverte(true); }}
              className="shrink-0 font-medium" style={{ color: C.terrain }}>
              Publier
            </button>
          </div>
        )}
        {onglet === "plateau" && (
          <VuePlateau plateau={plateau} setPlateau={setPlateau} effectif={effectif}
            allerEffectif={() => setOnglet("effectif")} />
        )}
        {onglet === "equipes" && (
          <VueEquipes
            effectif={effectif}
            plateau={plateau}
            equipes={equipes}
            equipeActive={equipeActive}
            setEquipeActive={setEquipeActive}
            affectation={affectation}
            basculer={basculer}
            majEquipe={majEquipe}
            ajouterEquipe={ajouterEquipe}
            supprimerEquipe={supprimerEquipe}
            personneDe={personneDe}
            allerEffectif={() => setOnglet("effectif")}
          />
        )}
        {onglet === "feuille" && (
          <VueFeuille plateau={plateau} equipes={equipes} personneDe={personneDe} />
        )}
        {onglet === "effectif" && (
          <VueEffectif
            effectif={effectif}
            setEffectif={setEffectif}
            affectation={affectation}
            retirer={retirerDeLEffectif}
            modifier={modifierPersonne}
            aPublier={aPublier}
            modificationsEnAttente={modificationsEnAttente}
            publier={publier}
            publicationOuverte={publicationOuverte}
            setPublicationOuverte={setPublicationOuverte}
            etat={etatEffectif}
            demanderCode={() => setCodeDemande(true)}
            oublierCode={oublierCode}
          />
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 border-t"
        style={{ background: C.papier, borderColor: C.ligne }}>
        <div className="max-w-3xl mx-auto grid grid-cols-4">
          {onglets.map(({ id, label, icon: Icon }) => {
            const actif = onglet === id;
            return (
              <button key={id} onClick={() => setOnglet(id)}
                className="py-3 flex flex-col items-center gap-1 text-xs"
                style={{
                  color: actif ? C.terrain : C.ink70,
                  boxShadow: actif ? `inset 0 2px 0 ${C.terrain}` : "none",
                  fontWeight: actif ? 600 : 400,
                }}>
                <Icon size={18} />
                {label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Effectif : déverrouillage et état                                  */
/* ------------------------------------------------------------------ */
const ERREURS_CODE = {
  CODE_INCORRECT: "Ce code n'ouvre pas l'effectif. Vérifiez la saisie.",
  FICHIER_INDISPONIBLE: "L'effectif n'a pas pu être téléchargé. Vérifiez la connexion, puis réessayez.",
  FORMAT_INCONNU: "Le fichier d'effectif n'est pas dans un format reconnu.",
  FICHIER_VIDE: "Le fichier d'effectif ne contient aucune ligne.",
  CONTEXTE_NON_SUR: "Le déchiffrement demande une adresse en https.",
};

/* La mise à jour reçue est annoncée par BandeauNouveautes, avec son détail. */
const MESSAGES_EFFECTIF = {
  hors_ligne: "Pas de réseau : l'effectif enregistré sur cet appareil est utilisé.",
  code_perime: "L'effectif a été republié avec un autre code.",
  indisponible: "L'effectif publié est injoignable pour l'instant.",
};

const ETATS_AVEC_CODE = ["a_jour", "mis_a_jour", "hors_ligne", "code_perime", "publication_en_cours"];

const SOURCE_EFFECTIF = {
  chargement: "Vérification de l'effectif publié…",
  a_jour: "Effectif publié, à jour.",
  mis_a_jour: "Effectif publié, mis à jour.",
  publication_en_cours: "Effectif publié depuis cet appareil, visible par tous d'ici quelques minutes.",
  hors_ligne: "Effectif enregistré sur cet appareil, pas de réseau pour vérifier.",
  code_perime: "Le code enregistré n'ouvre plus l'effectif publié.",
  indisponible: "Effectif publié injoignable.",
  local: "Effectif importé sur cet appareil.",
  colle: "Effectif repris d'une liste collée.",
  code_requis: "Aucun effectif sur cet appareil.",
};

function BandeauEffectif({ etat, action, libelleAction }) {
  const texte = MESSAGES_EFFECTIF[etat];
  if (!texte) return null;
  const doux = etat === "mis_a_jour";
  return (
    <div className="rounded-lg border px-3 py-2.5 mb-4 text-sm flex items-start gap-2"
      style={{
        borderColor: doux ? C.terrain : C.brassard,
        background: doux ? C.terrainSoft : "#FBF3E2",
      }}>
      {doux
        ? <Check size={14} className="mt-0.5 shrink-0" style={{ color: C.terrain }} />
        : <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: C.brassard }} />}
      <span className="flex-1">{texte}</span>
      {action && (
        <button onClick={action} className="shrink-0 font-medium" style={{ color: C.terrain }}>
          {libelleAction}
        </button>
      )}
    </div>
  );
}

/* Une nouvelle version de l'effectif est arrivée : sa date et ce qui a
   changé, en clair. Reste affiché jusqu'à ce que le délégué le ferme. */
function BandeauNouveautes({ nouveautes, fermer }) {
  return (
    <div className="rounded-lg border px-3 py-2.5 mb-4 text-sm flex items-start gap-2"
      style={{ borderColor: C.terrain, background: C.terrainSoft }}>
      <Check size={14} className="mt-0.5 shrink-0" style={{ color: C.terrain }} />
      <div className="flex-1 min-w-0">
        <p className="font-medium">
          Effectif mis à jour{nouveautes.date ? ` le ${jourMois(nouveautes.date)}` : ""}
        </p>
        <ul className="mt-1 space-y-0.5">
          {nouveautes.lignes.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      </div>
      <button onClick={fermer} aria-label="Fermer" className="shrink-0"><X size={14} /></button>
    </div>
  );
}

/* Repérable d'un coup d'œil, dans l'effectif comme dans les équipes. */
function BadgeLicence() {
  return (
    <span className="text-xs shrink-0 px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
      style={{ background: "#F6E2DD", color: C.alerte }}>
      <AlertTriangle size={11} /> Licence non validée
    </span>
  );
}

/* Première ouverture sur un appareil : le code de l'effectif, ou une liste
   collée pour le soir où le code n'est pas sous la main. */
function Deverrouillage({ etat, ouvrir, coller, annuler }) {
  const [code, setCode] = useState("");
  const [texte, setTexte] = useState("");
  const [collageOuvert, setCollageOuvert] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);

  const valider = async () => {
    if (!code.trim() || enCours) return;
    setEnCours(true);
    setErreur(null);
    try {
      await ouvrir(code.trim());
    } catch (e) {
      setErreur(ERREURS_CODE[e.message] || "Le déverrouillage a échoué. Réessayez dans un instant.");
    } finally {
      setEnCours(false);
    }
  };

  const validerCollage = () => {
    setErreur(null);
    try {
      coller(texte);
    } catch (e) {
      setErreur(e.message);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: C.craie, color: C.ink }}>
      <div className="max-w-md mx-auto px-5 py-12">
        <h1 className="text-lg font-semibold tracking-tight">Feuilles de plateau</h1>
        <p className="text-xs mb-8" style={{ color: C.ink70 }}>
          {CLUB.nom} · {CLUB.numero}
        </p>

        <h2 className="text-base font-semibold mb-1">
          {etat === "code_perime" ? "Nouveau code" : "Code de l'effectif"}
        </h2>
        <p className="text-sm mb-6" style={{ color: C.ink70 }}>
          {etat === "code_perime"
            ? "L'effectif a été republié avec un autre code. Saisissez-le pour récupérer la liste à jour."
            : "Saisissez le code une fois : la liste des joueurs est ensuite conservée sur cet appareil."}
        </p>

        <input
          type="password"
          value={code}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && valider()}
          aria-label="Code de l'effectif"
          className="w-full border rounded-md px-3 py-3 text-base"
          style={styleInput}
        />

        <button onClick={valider} disabled={enCours || !code.trim()}
          className="w-full mt-3 py-3 rounded-md text-sm font-medium"
          style={{
            background: C.terrain,
            color: "#fff",
            opacity: enCours || !code.trim() ? 0.45 : 1,
          }}>
          {enCours ? "Ouverture…" : "Ouvrir l'effectif"}
        </button>

        {erreur && (
          <div className="rounded-lg border p-3 mt-4 text-sm flex items-start gap-2"
            style={{ borderColor: C.brassard, background: "#FBF3E2" }}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: C.brassard }} />
            <span className="flex-1">{erreur}</span>
          </div>
        )}

        <div className="mt-10 rounded-lg border" style={{ background: C.papier, borderColor: C.ligne }}>
          <button onClick={() => setCollageOuvert((v) => !v)}
            className="w-full flex items-center gap-1.5 px-3 py-2.5 text-sm text-left"
            aria-expanded={collageOuvert}>
            {collageOuvert ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            Pas de code sous la main ? Coller la liste
          </button>
          {collageOuvert && (
            <div className="px-3 pb-3">
              <p className="text-xs mb-2" style={{ color: C.ink70 }}>
                Copiez la liste depuis la conversation et collez-la ici. Une ligne par joueur,
                avec au minimum le nom et le numéro de licence.
              </p>
              <textarea rows={7} value={texte} onChange={(e) => setTexte(e.target.value)}
                placeholder={"DUPONT Jean 198052485354 U8\nBAR Joe 12647327 U9"}
                className="w-full border rounded-md px-3 py-2 text-xs font-mono"
                style={styleInput} />
              <button onClick={validerCollage} disabled={!texte.trim()}
                className="w-full mt-2 py-2.5 rounded-md border text-sm"
                style={{ borderColor: C.terrain, color: C.terrain, opacity: texte.trim() ? 1 : 0.45 }}>
                Reprendre cette liste
              </button>
            </div>
          )}
        </div>

        {annuler && (
          <button onClick={annuler} className="mt-6 text-sm" style={{ color: C.ink70 }}>
            Revenir à l'application
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Champs                                                             */
/* ------------------------------------------------------------------ */
function Champ({ label, children, aide }) {
  return (
    <label className="block mb-4">
      <span className="block text-xs mb-1.5" style={{ color: C.ink70 }}>{label}</span>
      {children}
      {aide && <span className="block text-xs mt-1" style={{ color: C.ink70 }}>{aide}</span>}
    </label>
  );
}

const styleInput = { background: C.papier, borderColor: C.ligne, color: C.ink };

/* Une valeur presque toujours la même : le champ est pré-rempli et grisé, le
   crayon le rend modifiable. Vidé, il reprend la valeur par défaut. */
function ChampModifiable({ label, valeur, defaut, changer }) {
  const [actif, setActif] = useState(false);
  const champ = useRef(null);
  const avant = useRef(valeur);

  useEffect(() => { if (actif) champ.current?.focus(); }, [actif]);

  const activer = () => {
    avant.current = valeur;
    setActif(true);
  };
  const terminer = () => {
    if (!valeur.trim()) changer(defaut);
    setActif(false);
  };

  return (
    <div className="mb-4">
      <span className="block text-xs mb-1.5" style={{ color: C.ink70 }}>{label}</span>
      <div className="flex items-center gap-2">
        <input ref={champ} value={valeur} disabled={!actif} aria-label={label}
          onChange={(e) => changer(e.target.value)}
          onBlur={terminer}
          onKeyDown={(e) => {
            if (e.key === "Enter") terminer();
            if (e.key === "Escape") { changer(avant.current); setActif(false); }
          }}
          className="flex-1 min-w-0 border rounded-md px-3 py-2 text-sm"
          style={actif ? styleInput : { ...styleInput, background: C.craie, color: C.ink70 }} />
        <button
          onMouseDown={(e) => actif && e.preventDefault()}
          onClick={actif ? terminer : activer}
          aria-label={actif ? `Valider ${label.toLowerCase()}` : `Modifier ${label.toLowerCase()}`}
          className="p-2 rounded-md border shrink-0"
          style={actif
            ? { background: C.terrain, borderColor: C.terrain, color: "#fff" }
            : { borderColor: C.ligne, color: C.terrain, background: C.papier }}>
          {actif ? <Check size={15} /> : <Pencil size={15} />}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Vue Plateau                                                        */
/* ------------------------------------------------------------------ */
function VuePlateau({ plateau, setPlateau, effectif, allerEffectif }) {
  const maj = (k) => (e) => setPlateau({ ...plateau, [k]: e.target.value });
  const samedi = plateau.date && new Date(plateau.date + "T12:00").getDay() === 6;

  return (
    <section>
      <h2 className="text-base font-semibold mb-1">Le plateau de samedi</h2>
      <p className="text-sm mb-5" style={{ color: C.ink70 }}>
        Ces informations remplissent le bas de la feuille de match.
      </p>

      {effectif.length === 0 && (
        <div className="rounded-lg border p-3 mb-5 text-sm"
          style={{ borderColor: C.brassard, background: "#FBF3E2" }}>
          L'effectif est vide.{" "}
          <button onClick={allerEffectif} className="underline" style={{ color: C.terrain }}>
            Importez le fichier CSV
          </button>{" "}
          avant de composer les équipes.
        </div>
      )}

      <Champ label="Type de plateau">
        <div className="flex gap-2">
          {Object.keys(TYPES_PLATEAU).map((t) => (
            <button key={t} onClick={() => setPlateau({ ...plateau, type: t })}
              className="px-4 py-2 rounded-md border text-sm"
              style={{
                borderColor: plateau.type === t ? C.terrain : C.ligne,
                background: plateau.type === t ? C.terrainSoft : C.papier,
                color: plateau.type === t ? C.terrain : C.ink70,
                fontWeight: plateau.type === t ? 600 : 400,
              }}>
              {TYPES_PLATEAU[t].label}
            </button>
          ))}
        </div>
      </Champ>

      <Champ label="Date" aide={plateau.date && !samedi ? "Cette date n'est pas un samedi." : null}>
        <input type="date" value={plateau.date} onChange={maj("date")}
          className="w-full border rounded-md px-3 py-2 text-sm" style={styleInput} />
      </Champ>

      <Champ label="Plateau à">
        <input value={plateau.lieu} onChange={maj("lieu")} placeholder="Garche"
          className="w-full border rounded-md px-3 py-2 text-sm" style={styleInput} />
      </Champ>

      <ChampModifiable label="Secteur" valeur={plateau.secteur} defaut={SECTEUR_DEFAUT}
        changer={(secteur) => setPlateau({ ...plateau, secteur })} />

      <ChampModifiable label="Groupe" valeur={plateau.groupe} defaut={GROUPE_DEFAUT}
        changer={(groupe) => setPlateau({ ...plateau, groupe })} />

      <Champ label="Responsable du plateau" aide="Laissez vide pour le remplir à la main sur place.">
        <input value={plateau.responsable || ""} onChange={maj("responsable")} placeholder="Nom Prénom"
          className="w-full border rounded-md px-3 py-2 text-sm" style={styleInput} />
      </Champ>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Vue Équipes                                                        */
/* ------------------------------------------------------------------ */
function VueEquipes({
  effectif, plateau, equipes, equipeActive, setEquipeActive, affectation,
  basculer, majEquipe, ajouterEquipe, supprimerEquipe, personneDe, allerEffectif,
}) {
  const [recherche, setRecherche] = useState("");
  const categoriesJoueurs = TYPES_PLATEAU[plateau.type].categoriesJoueurs;
  const [categoriesVisibles, setCategoriesVisibles] = useState(() =>
    Object.fromEntries(categoriesJoueurs.map((c) => [c, true]))
  );
  useEffect(() => {
    setCategoriesVisibles(Object.fromEntries(categoriesJoueurs.map((c) => [c, true])));
  }, [plateau.type]);
  const toggleCategorie = (cat) =>
    setCategoriesVisibles((v) => ({ ...v, [cat]: !v[cat] }));
  const active = equipes.find((e) => e.id === equipeActive) || equipes[0];

  useEffect(() => {
    if (!equipes.find((e) => e.id === equipeActive)) setEquipeActive(equipes[0]?.id ?? null);
  }, [equipes, equipeActive, setEquipeActive]);

  const delegues = useMemo(
    () => effectif.filter(estDelegue).sort(parNom),
    [effectif]
  );

  /* Une liste par catégorie de joueurs mélangée dans ce type de plateau ; une
     seule catégorie donne une liste sans titre. Toujours triées par nom. */
  const sections = useMemo(() => {
    const q = sansAccent(recherche);
    const filtre = (cat) =>
      effectif
        .filter((p) => !estDelegue(p) && p.categorie === cat)
        .filter((p) => !q || sansAccent(`${p.nom} ${p.prenom}`).includes(q))
        .sort(parNom);
    const categories = TYPES_PLATEAU[plateau.type].categoriesJoueurs;
    if (categories.length === 1) {
      return [{ titre: null, joueurs: filtre(categories[0]) }];
    }
    return categories.map((cat) => ({ titre: cat, joueurs: filtre(cat) }));
  }, [effectif, plateau.type, recherche]);

  const sectionsAffichees = useMemo(
    () => sections.filter((s) => !s.titre || categoriesVisibles[s.titre]),
    [sections, categoriesVisibles]
  );

  const total = sectionsAffichees.reduce((n, s) => n + s.joueurs.length, 0);

  if (!effectif.length) {
    return (
      <section className="text-center py-16">
        <Users size={28} style={{ color: C.ligne }} className="mx-auto mb-3" />
        <p className="text-sm mb-4" style={{ color: C.ink70 }}>
          Pas encore d'effectif à faire jouer.
        </p>
        <button onClick={allerEffectif} className="px-4 py-2 rounded-md text-sm"
          style={{ background: C.terrain, color: "#fff" }}>
          Importer l'effectif
        </button>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-4 overflow-x-auto">
        {equipes.map((e) => {
          const actif = e.id === active?.id;
          return (
            <button key={e.id} onClick={() => setEquipeActive(e.id)}
              className="px-3 py-2 rounded-md border text-sm whitespace-nowrap"
              style={{
                borderColor: actif ? C.terrain : C.ligne,
                background: actif ? C.terrainSoft : C.papier,
                color: actif ? C.terrain : C.ink70,
                fontWeight: actif ? 600 : 400,
              }}>
              {e.nom} · {e.joueurs.length}
            </button>
          );
        })}
        {equipes.length < MAX_EQUIPES && (
          <button onClick={ajouterEquipe} className="px-3 py-2 rounded-md border text-sm flex items-center gap-1"
            style={{ borderColor: C.ligne, color: C.ink70 }}>
            <Plus size={14} /> Équipe
          </button>
        )}
      </div>

      {active && (
        <>
          <div className="rounded-lg border p-3 mb-4" style={{ background: C.papier, borderColor: C.ligne }}>
            <div className="flex items-center gap-2 mb-3">
              <input value={active.nom} onChange={(e) => majEquipe(active.id, { nom: e.target.value })}
                className="flex-1 border rounded-md px-3 py-2 text-sm" style={styleInput} />
              {equipes.length > 1 && (
                <button onClick={() => supprimerEquipe(active.id)}
                  className="p-2 rounded-md border" style={{ borderColor: C.ligne, color: C.alerte }}
                  aria-label="Supprimer l'équipe">
                  <Trash2 size={15} />
                </button>
              )}
            </div>

            {delegues.length === 0 ? (
              <button onClick={allerEffectif}
                className="w-full rounded-md border border-dashed px-3 py-2 text-sm text-left mb-3"
                style={{ borderColor: C.ligne, color: C.ink70 }}>
                Aucun délégué enregistré — en ajouter dans Effectif
              </button>
            ) : (
              <select value={active.delegueId || ""}
                onChange={(e) => majEquipe(active.id, { delegueId: e.target.value || null })}
                className="w-full border rounded-md px-3 py-2 text-sm mb-3" style={styleInput}>
                <option value="">Délégué — à désigner</option>
                {delegues.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom} {d.prenom}{d.licence ? ` — ${d.licence}` : ""}
                    {d.valide ? "" : " (licence non validée)"}
                  </option>
                ))}
              </select>
            )}

            <JaugeEquipe n={active.joueurs.length} />

            {active.joueurs.length > 0 && (
              <ol className="mt-3 pt-3 border-t space-y-1 text-sm" style={{ borderColor: C.ligne }}>
                {active.joueurs.map((id, i) => {
                  const j = personneDe(id);
                  if (!j) return null;
                  return (
                    <li key={id} className="flex items-center gap-2">
                      <span className="w-4 text-right tabular-nums text-xs" style={{ color: C.ink70 }}>{i + 1}</span>
                      <span className="flex-1 truncate">
                        <span className="font-medium">{j.nom}</span> {j.prenom}
                        <span className="text-xs ml-1.5" style={{ color: C.ink70 }}>{j.categorie}</span>
                      </span>
                      <button onClick={() => basculer(active.id, id)} aria-label="Retirer de l'équipe"
                        style={{ color: C.ink70 }}>
                        <X size={14} />
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {categoriesJoueurs.length > 1 && (
            <div className="flex gap-2 mb-2">
              {categoriesJoueurs.map((cat) => {
                const actif = categoriesVisibles[cat];
                return (
                  <button key={cat} type="button" onClick={() => toggleCategorie(cat)}
                    aria-pressed={actif}
                    className="px-4 py-2 rounded-md border text-sm"
                    style={{
                      borderColor: actif ? C.terrain : C.ligne,
                      background: actif ? C.terrainSoft : C.papier,
                      color: actif ? C.terrain : C.ink70,
                      fontWeight: actif ? 600 : 400,
                    }}>
                    {cat}
                  </button>
                );
              })}
            </div>
          )}

          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.ink70 }} />
            <input value={recherche} onChange={(e) => setRecherche(e.target.value)}
              placeholder="Chercher un joueur"
              className="w-full border rounded-md pl-9 pr-3 py-2 text-sm" style={styleInput} />
          </div>

          {total === 0 && (
            <p className="text-sm py-6 text-center" style={{ color: C.ink70 }}>
              Aucun joueur ne correspond.
            </p>
          )}

          {sectionsAffichees.map((s) => (
            <div key={s.titre ?? "tous"} className="mb-4">
              {s.titre && (
                <div className="flex items-baseline gap-2 mb-2 pb-1 border-b" style={{ borderColor: C.ligne }}>
                  <span className="text-sm font-semibold" style={{ color: C.terrain }}>{s.titre}</span>
                  <span className="text-xs" style={{ color: C.ink70 }}>
                    {s.joueurs.length} joueur{s.joueurs.length > 1 ? "s" : ""}
                  </span>
                </div>
              )}
              <ul className="space-y-1.5">
                {s.joueurs.map((j) => {
                  const dans = affectation[j.id];
                  const ici = dans?.id === active.id;
                  const bloque = dans && !ici;
                  const complet = !ici && active.joueurs.length >= MAX_JOUEURS;
                  return (
                    <li key={j.id}>
                      <button onClick={() => !bloque && !complet && basculer(active.id, j.id)}
                        disabled={bloque || complet}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left"
                        style={{
                          borderColor: ici ? C.terrain : C.ligne,
                          background: ici ? C.terrainSoft : C.papier,
                          opacity: bloque || complet ? 0.5 : 1,
                        }}>
                        <span className="w-5 h-5 rounded-full border flex items-center justify-center shrink-0"
                          style={{
                            borderColor: ici ? C.terrain : C.ligne,
                            background: ici ? C.terrain : "transparent",
                            color: "#fff",
                          }}>
                          {ici && <Check size={13} />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm truncate">
                            <span className="font-medium">{j.nom}</span> {j.prenom}
                          </span>
                          <span className="block text-xs" style={{ color: C.ink70 }}>
                            {j.licence}{j.naissance ? ` · né le ${j.naissance}` : ""}
                          </span>
                        </span>
                        {!j.valide && <BadgeLicence />}
                        {bloque && <span className="text-xs shrink-0" style={{ color: C.ink70 }}>{dans.nom}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {s.titre && s.joueurs.length === 0 && (
                <p className="text-sm py-2" style={{ color: C.ink70 }}>Aucun {s.titre} disponible.</p>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function JaugeEquipe({ n }) {
  const manque = MIN_JOUEURS - n;
  const message =
    n === 0
      ? "Aucun joueur"
      : manque > 0
      ? `Il manque ${manque} joueur${manque > 1 ? "s" : ""} pour jouer à 5`
      : n === MAX_JOUEURS
      ? "Équipe au complet (5 + 3 remplaçants)"
      : `${n} joueurs · ${n - MIN_JOUEURS} remplaçant${n - MIN_JOUEURS > 1 ? "s" : ""}`;
  const couleur = manque > 0 ? C.brassard : C.terrain;
  return (
    <div className="flex items-center gap-2 text-xs" style={{ color: couleur }}>
      <div className="flex gap-1">
        {Array.from({ length: MAX_JOUEURS }, (_, i) => (
          <span key={i} className="w-4 h-1.5 rounded-full"
            style={{ background: i < n ? couleur : C.ligne, opacity: i >= MIN_JOUEURS ? 0.6 : 1 }} />
        ))}
      </div>
      {message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Vue Effectif — import / export CSV                                 */
/* ------------------------------------------------------------------ */
function VueEffectif({
  effectif, setEffectif, affectation, retirer, modifier, aPublier, modificationsEnAttente,
  publier, publicationOuverte, setPublicationOuverte, etat, demanderCode, oublierCode,
}) {
  const fichier = useRef(null);
  const [message, setMessage] = useState(null);
  const [replis, setReplis] = useState(null);
  const [exempleOuvert, setExempleOuvert] = useState(false);
  const [ajout, setAjout] = useState(null);
  const [edition, setEdition] = useState(null);
  const [erreurFiche, setErreurFiche] = useState(null);
  const [collageOuvert, setCollageOuvert] = useState(false);
  const [texteColle, setTexteColle] = useState("");

  /* Une fiche saisie à la main : même mise en forme que l'import, et pas deux
     personnes avec le même numéro de licence. */
  const ficheValide = (valeur, idActuel) => {
    const fiche = {
      ...valeur,
      nom: (valeur.nom || "").trim().toUpperCase(),
      prenom: (valeur.prenom || "").trim(),
      licence: (valeur.licence || "").replace(/\s/g, ""),
      naissance: (valeur.naissance || "").trim(),
    };
    if (!fiche.nom) { setErreurFiche("Le nom est obligatoire."); return null; }
    const cle = clePersonne(fiche);
    if (effectif.some((p) => p.id !== idActuel && clePersonne(p) === cle)) {
      setErreurFiche(fiche.licence
        ? "Une autre personne porte déjà ce numéro de licence."
        : "Cette personne est déjà dans l'effectif.");
      return null;
    }
    setErreurFiche(null);
    return fiche;
  };

  const ouvrirFiche = (p) => {
    setAjout(null);
    setErreurFiche(null);
    setEdition({ id: p.id, valeur: { ...p } });
  };

  const exporter = () => {
    const csv = versCSV(effectif);
    try {
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `effectif-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage({ ton: "ok", texte: `Effectif exporté (${effectif.length} ligne${effectif.length > 1 ? "s" : ""}).` });
    } catch (e) {
      setReplis(csv);
      setMessage({ ton: "alerte", texte: "Téléchargement impossible ici. Copiez le texte ci-dessous dans un fichier .csv." });
    }
  };

  const importer = (evt) => {
    const f = evt.target.files?.[0];
    if (!f) return;
    const lecteur = new FileReader();
    lecteur.onload = () => {
      const { personnes, erreur, ignorees } = depuisCSV(String(lecteur.result || ""));
      if (erreur || !personnes.length) {
        setMessage({ ton: "alerte", texte: erreur || "Aucune ligne lisible dans ce fichier." });
        return;
      }
      const { liste, ajoutes, majs } = fusion(effectif, personnes);
      setEffectif(liste);
      setMessage({ ton: "ok", texte: bilan(ajoutes, majs, ignorees?.length || 0) });
    };
    lecteur.readAsText(f, "utf-8");
    evt.target.value = "";
  };

  const reprendreColle = () => {
    const { personnes, erreur, ignorees } = depuisColle(texteColle);
    if (erreur || !personnes.length) {
      setMessage({ ton: "alerte", texte: erreur || "Aucune ligne lisible dans ce texte." });
      return;
    }
    const { liste, ajoutes, majs } = fusion(effectif, personnes);
    setEffectif(liste);
    setMessage({ ton: "ok", texte: bilan(ajoutes, majs, ignorees?.length || 0) });
    setCollageOuvert(false);
    setTexteColle("");
  };

  const viderEffectif = () => {
    if (!effectif.length) return;
    setMessage({ ton: "alerte", texte: "Effectif vidé. Rouvrez l'application pour le récupérer depuis l'effectif publié." });
    effectif.slice().forEach((p) => retirer(p.id));
  };

  const compte = (c) => effectif.filter((p) => p.categorie === c).length;

  const ordre = { U8: 0, U9: 1, [DELEGUE]: 2 };
  const liste = useMemo(
    () => effectif.slice().sort((a, b) =>
      (ordre[a.categorie] ?? 3) - (ordre[b.categorie] ?? 3) || parNom(a, b)
    ),
    [effectif]
  );

  return (
    <section>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-base font-semibold">Effectif</h2>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => fichier.current?.click()}
            className="px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5"
            style={{ background: C.terrain, color: "#fff" }}>
            <Upload size={13} /> Importer
          </button>
          <button onClick={exporter}
            className="px-3 py-1.5 rounded-md border text-xs flex items-center gap-1.5"
            style={{ borderColor: C.ligne, color: C.ink }}>
            <Download size={13} /> Exporter
          </button>
          <input ref={fichier} type="file" accept=".csv,.txt,text/csv" onChange={importer} className="hidden" />
        </div>
      </div>
      <p className="text-sm mb-3" style={{ color: C.ink70 }}>
        Touchez une ligne pour la corriger. Vos changements restent sur ce téléphone
        jusqu'à ce que vous les publiiez pour les autres.
      </p>

      <div className="rounded-lg border px-3 py-2.5 mb-4 flex items-center justify-between gap-3 text-xs"
        style={{ background: C.papier, borderColor: C.ligne }}>
        <span style={{ color: C.ink70 }}>{SOURCE_EFFECTIF[etat] || "Effectif local."}</span>
        <button
          onClick={ETATS_AVEC_CODE.includes(etat) ? oublierCode : demanderCode}
          className="shrink-0 font-medium" style={{ color: C.terrain }}>
          {ETATS_AVEC_CODE.includes(etat) ? "Changer le code" : "Saisir le code"}
        </button>
      </div>

      {(modificationsEnAttente || publicationOuverte) && (
        <Publication
          aPublier={aPublier}
          total={effectif.length}
          codeConnu={ETATS_AVEC_CODE.includes(etat) && etat !== "code_perime"}
          ouverte={publicationOuverte}
          ouvrir={() => setPublicationOuverte(true)}
          fermer={() => setPublicationOuverte(false)}
          publier={publier}
          reussite={() => {
            setPublicationOuverte(false);
            setMessage({ ton: "ok", texte: "Effectif publié, il sera visible par tous d'ici quelques minutes." });
          }}
        />
      )}

      {message && (
        <div className="rounded-lg border p-3 mb-4 text-sm flex items-start gap-2"
          style={{
            borderColor: message.ton === "ok" ? C.terrain : C.brassard,
            background: message.ton === "ok" ? C.terrainSoft : "#FBF3E2",
          }}>
          {message.ton === "ok"
            ? <Check size={14} className="mt-0.5 shrink-0" style={{ color: C.terrain }} />
            : <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: C.brassard }} />}
          <span className="flex-1">{message.texte}</span>
          <button onClick={() => setMessage(null)} aria-label="Fermer"><X size={14} /></button>
        </div>
      )}

      {replis && (
        <textarea readOnly value={replis} rows={8}
          className="w-full border rounded-md px-3 py-2 text-xs font-mono mb-4" style={styleInput} />
      )}

      <div className="rounded-lg border mb-4" style={{ background: C.papier, borderColor: C.ligne }}>
        <button onClick={() => setExempleOuvert((v) => !v)}
          className="w-full flex items-center gap-1.5 px-3 py-2.5 text-sm text-left"
          style={{ color: C.ink }} aria-expanded={exempleOuvert}>
          {exempleOuvert ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          Format du fichier CSV
        </button>
        {exempleOuvert && (
          <div className="px-3 pb-3 text-xs" style={{ color: C.ink70 }}>
            <pre className="overflow-x-auto p-2 rounded" style={{ background: C.craie, color: C.ink }}>
{EXEMPLE_CSV}
            </pre>
            <p className="mt-2">
              Séparateur point-virgule. La colonne Catégorie accepte U8, U9 ou Délégué.
              L'export produit exactement ce format : exportez une fois pour obtenir le modèle à remplir.
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-3 text-sm">
        <span style={{ color: C.ink70 }}>
          U8 {compte("U8")} · U9 {compte("U9")} · délégués {compte(DELEGUE)}
        </span>
        <div className="flex gap-3">
          <button onClick={() => {
            setEdition(null);
            setErreurFiche(null);
            setAjout({ nom: "", prenom: "", categorie: "U8", licence: "", naissance: "", valide: true });
          }}
            className="flex items-center gap-1" style={{ color: C.terrain }}>
            <Plus size={14} /> Ajouter
          </button>
          <button onClick={() => setCollageOuvert((v) => !v)} style={{ color: C.terrain }}>
            Coller
          </button>
          {effectif.length > 0 && (
            <button onClick={viderEffectif} style={{ color: C.alerte }}>Vider</button>
          )}
        </div>
      </div>

      {collageOuvert && (
        <div className="rounded-lg border p-3 mb-4" style={{ background: C.papier, borderColor: C.ligne }}>
          <p className="text-xs mb-2" style={{ color: C.ink70 }}>
            Collez la liste reçue par message. Une ligne par joueur, avec au minimum
            le nom et le numéro de licence.
          </p>
          <textarea rows={7} value={texteColle} onChange={(e) => setTexteColle(e.target.value)}
            placeholder={"DUPONT Jean 198052485354 U8\nBAR Joe 12647327 U9"}
            className="w-full border rounded-md px-3 py-2 text-xs font-mono" style={styleInput} />
          <div className="flex gap-2 mt-2">
            <button onClick={reprendreColle} disabled={!texteColle.trim()}
              className="px-3 py-1.5 rounded-md text-xs"
              style={{ background: C.terrain, color: "#fff", opacity: texteColle.trim() ? 1 : 0.45 }}>
              Reprendre cette liste
            </button>
            <button onClick={() => { setCollageOuvert(false); setTexteColle(""); }}
              className="px-3 py-1.5 rounded-md border text-xs"
              style={{ borderColor: C.ligne, color: C.ink70 }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {ajout && (
        <FormulairePersonne
          valeur={ajout}
          setValeur={setAjout}
          erreur={erreurFiche}
          libelle="Ajouter"
          annuler={() => setAjout(null)}
          valider={() => {
            const fiche = ficheValide(ajout, null);
            if (!fiche) return;
            setEffectif((prev) => [
              ...prev,
              { ...fiche, id: idPersonne(fiche.licence, fiche.nom, fiche.prenom) },
            ]);
            setAjout(null);
          }}
        />
      )}

      {liste.length === 0 ? (
        <div className="text-center py-12 rounded-lg border border-dashed" style={{ borderColor: C.ligne }}>
          <p className="text-sm" style={{ color: C.ink70 }}>
            Aucune ligne pour l'instant.<br />Saisissez le code de l'effectif, ou collez la liste reçue.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {liste.map((p) => (edition?.id === p.id ? (
            <li key={p.id}>
              <FormulairePersonne
                valeur={edition.valeur}
                setValeur={(valeur) => setEdition({ ...edition, valeur })}
                erreur={erreurFiche}
                libelle="Enregistrer"
                annuler={() => setEdition(null)}
                valider={() => {
                  const fiche = ficheValide(edition.valeur, p.id);
                  if (!fiche) return;
                  modifier(p.id, fiche);
                  setEdition(null);
                }}
              />
            </li>
          ) : (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border"
              style={{ background: C.papier, borderColor: C.ligne }}>
              <button onClick={() => ouvrirFiche(p)} aria-label={`Corriger ${nomCourt(p)}`}
                className="flex-1 min-w-0 flex items-center gap-3 text-left">
                <span className="text-xs w-12 shrink-0"
                  style={{ color: estDelegue(p) ? C.brassard : C.terrain }}>
                  {estDelegue(p) ? "Dél." : p.categorie}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm truncate">
                    <span className="font-medium">{p.nom}</span> {p.prenom}
                  </span>
                  <span className="block text-xs" style={{ color: C.ink70 }}>
                    {p.licence}{p.naissance ? ` · ${p.naissance}` : ""}
                    {affectation[p.id] ? ` · ${affectation[p.id].nom}` : ""}
                  </span>
                </span>
                {!p.valide && <BadgeLicence />}
              </button>
              <button onClick={() => retirer(p.id)} aria-label="Retirer" style={{ color: C.ink70 }}>
                <Trash2 size={14} />
              </button>
            </li>
          )))}
        </ul>
      )}
    </section>
  );
}

const ERREURS_PUBLICATION = {
  CODE_MANQUANT: "Saisissez le code de l'effectif pour publier.",
  CODE_REFUSE: "Ce code ne permet pas de publier l'effectif. Vérifiez la saisie.",
  RESEAU: "Pas de réseau : rien n'a été publié. Vos modifications restent sur ce téléphone, réessayez plus tard.",
  PUBLICATION_INACTIVE: "La publication n'est pas encore activée. Vos modifications restent sur ce téléphone.",
  CONTEXTE_NON_SUR: "La publication demande une adresse en https.",
};

/* « Publier » : le récapitulatif de ce qui va changer, puis une
   confirmation. Aucune notion de fichier ni de chiffrement ici. */
function Publication({ aPublier, total, codeConnu, ouverte, ouvrir, fermer, publier, reussite }) {
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);
  const lignes = resumeEcart(aPublier);

  const confirmer = async () => {
    if (enCours) return;
    setEnCours(true);
    setErreur(null);
    try {
      await publier(code.trim() || null);
      setCode("");
      reussite();
    } catch (e) {
      setErreur(ERREURS_PUBLICATION[e.message] ||
        "La publication a échoué. Vos modifications restent sur ce téléphone, réessayez dans un instant.");
    } finally {
      setEnCours(false);
    }
  };

  const bloque = enCours || (!codeConnu && !code.trim());

  return (
    <div className="rounded-lg border p-3 mb-4 text-sm"
      style={{ borderColor: C.brassard, background: "#FBF3E2" }}>
      <p className="font-medium mb-1">
        {ouverte ? "Publier ces changements pour tout le monde ?" : "Changements pas encore publiés"}
      </p>
      {lignes.length ? (
        <ul className="space-y-0.5 mb-3">
          {lignes.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      ) : (
        <p className="mb-3">
          L'effectif de ce téléphone ({total} personne{total > 1 ? "s" : ""}) deviendra
          l'effectif de tout le monde.
        </p>
      )}

      {!ouverte ? (
        <button onClick={ouvrir}
          className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-1.5"
          style={{ background: C.terrain, color: "#fff" }}>
          <Upload size={14} /> Publier
        </button>
      ) : (
        <>
          {!codeConnu && (
            <input type="password" value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="Code de l'effectif" aria-label="Code de l'effectif"
              autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              className="w-full border rounded-md px-3 py-2 text-base mb-2" style={styleInput} />
          )}
          <div className="flex gap-2">
            <button onClick={confirmer} disabled={bloque}
              className="px-4 py-2 rounded-md text-sm font-medium"
              style={{ background: C.terrain, color: "#fff", opacity: bloque ? 0.45 : 1 }}>
              {enCours ? "Publication…" : "Confirmer"}
            </button>
            <button onClick={() => { setErreur(null); fermer(); }} disabled={enCours}
              className="px-4 py-2 rounded-md border text-sm"
              style={{ borderColor: C.ligne, color: C.ink70, background: C.papier }}>
              Annuler
            </button>
          </div>
        </>
      )}

      {erreur && (
        <p className="mt-2 flex items-start gap-2" style={{ color: C.alerte }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {erreur}
        </p>
      )}
    </div>
  );
}

function FormulairePersonne({ valeur, setValeur, valider, annuler, libelle, erreur }) {
  const maj = (k) => (e) => setValeur({ ...valeur, [k]: e.target.value });
  const delegue = valeur.categorie === DELEGUE;
  return (
    <div className="rounded-lg border p-3 mb-4" style={{ background: C.papier, borderColor: C.terrain }}>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input value={valeur.nom} onChange={maj("nom")} placeholder="Nom"
          className="border rounded-md px-3 py-2 text-sm" style={styleInput} />
        <input value={valeur.prenom} onChange={maj("prenom")} placeholder="Prénom"
          className="border rounded-md px-3 py-2 text-sm" style={styleInput} />
        <input value={valeur.licence} onChange={maj("licence")} placeholder="N° de licence"
          className="border rounded-md px-3 py-2 text-sm" style={styleInput} />
        <input value={valeur.naissance} onChange={maj("naissance")}
          placeholder={delegue ? "Naissance (facultatif)" : "Naissance (JJ/MM/AAAA)"}
          className="border rounded-md px-3 py-2 text-sm" style={styleInput} />
        <select value={valeur.categorie} onChange={maj("categorie")}
          className="border rounded-md px-3 py-2 text-sm" style={styleInput}>
          <option value="U8">U8</option>
          <option value="U9">U9</option>
          <option value={DELEGUE}>{DELEGUE}</option>
        </select>
        <label className="flex items-center gap-2 text-sm px-1">
          <input type="checkbox" checked={valeur.valide}
            onChange={(e) => setValeur({ ...valeur, valide: e.target.checked })} />
          Licence validée
        </label>
      </div>
      {erreur && <p className="text-xs mb-2" style={{ color: C.alerte }}>{erreur}</p>}
      <div className="flex gap-2">
        <button onClick={valider} className="px-3 py-2 rounded-md text-sm"
          style={{ background: C.terrain, color: "#fff" }}>{libelle}</button>
        <button onClick={annuler} className="px-3 py-2 rounded-md border text-sm"
          style={{ borderColor: C.ligne, color: C.ink70 }}>Annuler</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Feuille de match — aperçu en iframe, impression depuis l'iframe    */
/* ------------------------------------------------------------------ */
function VueFeuille({ plateau, equipes, personneDe }) {
  const cadre = useRef(null);
  const [hauteur, setHauteur] = useState(600);
  const [message, setMessage] = useState(null);

  const corps = useMemo(
    () => feuilleHTML(plateau, equipes, personneDe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plateau, equipes, personneDe]
  );
  const doc = useMemo(() => documentFeuille(corps), [corps]);

  /* L'iframe s'ajuste à son contenu pour que l'aperçu défile avec la page. */
  const ajuster = () => {
    try {
      const d = cadre.current?.contentDocument;
      if (d?.body) setHauteur(d.body.scrollHeight + 16);
    } catch (e) { /* ignore */ }
  };

  /* print() est refusé dans le cadre de l'aperçu : on produit le fichier,
     que le téléphone ouvre ensuite dans sa visionneuse pour imprimer ou partager. */
  const telechargerPDF = () => {
    setMessage(null);
    try {
      const octets = construirePDF(contenuPDF(plateau, equipes, personneDe));
      const url = URL.createObjectURL(new Blob([octets], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `feuille-${plateau.date || "date"}-${plateau.lieu || "lieu"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMessage("PDF généré. Ouvrez-le pour l'imprimer ou l'envoyer.");
      suivi("pdf/genere");
    } catch (e) {
      suivi("pdf/echec")
      setMessage("Le PDF n'a pas pu être créé ici. Ouvrez l'application dans un onglet du navigateur et réessayez.");
    }
  };

  const problemes = [];
  if (!plateau.lieu) problemes.push("Le lieu du plateau n'est pas renseigné.");
  if (!plateau.date) problemes.push("La date du plateau n'est pas renseignée.");
  equipes.forEach((e) => {
    if (e.joueurs.length < MIN_JOUEURS)
      problemes.push(`${e.nom} : ${e.joueurs.length} joueur(s), il en faut au moins ${MIN_JOUEURS}.`);
    if (!e.delegueId) problemes.push(`${e.nom} : délégué non désigné.`);
    e.joueurs.forEach((id) => {
      const j = personneDe(id);
      if (j && !j.valide) problemes.push(`${j.nom} ${j.prenom} : licence non validée.`);
    });
  });

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold">Feuille de match</h2>
        <button onClick={telechargerPDF}
          className="px-3 py-2 rounded-md text-sm flex items-center gap-1.5"
          style={{ background: C.terrain, color: "#fff" }}>
          <Printer size={15} /> PDF à imprimer
        </button>
      </div>

      {message && (
        <p className="rounded-lg border p-3 mb-4 text-sm"
          style={{ borderColor: C.ligne, background: C.papier, color: C.ink70 }}>
          {message}
        </p>
      )}

      {problemes.length > 0 && (
        <ul className="rounded-lg border p-3 mb-4 text-sm space-y-1"
          style={{ borderColor: C.brassard, background: "#FBF3E2" }}>
          {problemes.map((p, i) => (
            <li key={i} className="flex gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: C.brassard }} />
              {p}
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border overflow-hidden" style={{ borderColor: C.ligne, background: C.papier }}>
        <iframe
          ref={cadre}
          title="Aperçu de la feuille de match"
          srcDoc={doc}
          onLoad={ajuster}
          style={{ width: "100%", height: hauteur, border: "none", display: "block" }}
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Visuels du modèle officiel — JPEG encodés en base64, utilisés par   */
/*  l'aperçu HTML comme par le PDF. Rien à lire ici.                    */
/* ------------------------------------------------------------------ */

const IMG_DISTRICT = { l: 183, h: 300, b64: "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" };

const IMG_GRANDIR = { l: 340, h: 121, b64: "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" };

const IMG_CRAMPONS = { l: 260, h: 91, b64: "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" };

const IMAGES = [
  { nom: "Im1", ...IMG_DISTRICT },
  { nom: "Im2", ...IMG_GRANDIR },
  { nom: "Im3", ...IMG_CRAMPONS },
];

/* ------------------------------------------------------------------ */
/*  Montage autonome (site statique). Sans élément #racine — dans      */
/*  l'artifact par exemple — ce bloc ne fait rien.                     */
/* ------------------------------------------------------------------ */
if (typeof document !== "undefined" && document.getElementById("racine")) {
  import("react-dom/client").then(({ createRoot }) => {
    createRoot(document.getElementById("racine")).render(<App />);
  });
}
