import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Trash2, Printer, Users, FileText, ClipboardList, Search,
  RotateCcw, AlertTriangle, Check, UserPlus, X, Download, Upload,
  ChevronDown, ChevronRight,
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

const PLATEAU_VIDE = {
  categorie: "U8",   // U8 · U9 · Mixte
  date: "",
  lieu: "",
  secteur: "",
  groupe: "",
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

const sansAccent = (s) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

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
      id: licence || `p${n}${Math.random().toString(36).slice(2, 6)}`,
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
/*  Feuille de match — mise en page du modèle officiel du District      */
/*  Mosellan (football à 5). Deux pages : 4 blocs d'équipe par page.    */
/*  L'aperçu HTML et le PDF suivent la même géométrie.                  */
/* ------------------------------------------------------------------ */
const BLOCS_PAR_PAGE = 4;   // quatre blocs d'équipe par page, comme sur le modèle

const intitule = (categorie) => (categorie === "Mixte" ? "U8 / U9" : categorie);

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
  .fm-encart .titre { color: #c81414; font-weight: bold; font-size: 13pt; margin: 1mm 0 1mm; }
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
  const cat = intitule(plateau.categorie);
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
  const cat = intitule(plateau.categorie);

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
  p.rouge(true);
  p.centre(encMil, encT + 40, 14, "F2", "FEUILLE DE MATCH");
  p.rouge(false);
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
/*  Application                                                        */
/* ------------------------------------------------------------------ */
export default function App() {
  const [effectif, setEffectif] = useState([]);
  const [plateau, setPlateau] = useState(PLATEAU_VIDE);
  const [equipes, setEquipes] = useState([equipeVide(1)]);
  const [equipeActive, setEquipeActive] = useState(null);
  const [onglet, setOnglet] = useState("effectif");
  const [pret, setPret] = useState(false);

  /* Rien n'est embarqué dans le code : tout vient du navigateur. */
  useEffect(() => {
    (async () => {
      let aEffectif = false;
      try {
        const v = await stockage.lire(CLE_EFFECTIF);
        if (v) {
          const d = JSON.parse(v);
          setEffectif(d);
          aEffectif = d.length > 0;
        }
      } catch (e) { /* première ouverture, ou stockage indisponible */ }
      try {
        const v = await stockage.lire(CLE_PLATEAU);
        if (v) {
          const d = JSON.parse(v);
          if (d.plateau) setPlateau(d.plateau);
          if (d.equipes?.length) {
            setEquipes(d.equipes);
            setEquipeActive(d.equipes[0].id);
          }
        }
      } catch (e) { /* pas de plateau en cours */ }
      if (aEffectif) setOnglet("plateau");
      setPret(true);
    })();
  }, []);

  const enregistre = (cle, valeur) => {
    try { stockage.ecrire(cle, JSON.stringify(valeur)); } catch (e) { /* best effort */ }
  };

  useEffect(() => { if (pret) enregistre(CLE_EFFECTIF, effectif); }, [effectif, pret]);
  useEffect(() => { if (pret) enregistre(CLE_PLATEAU, { plateau, equipes }); }, [plateau, equipes, pret]);

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
    setPlateau({ ...PLATEAU_VIDE, secteur: plateau.secteur, groupe: plateau.groupe, categorie: plateau.categorie });
    const e = equipeVide(1);
    setEquipes([e]);
    setEquipeActive(e.id);
    setOnglet("plateau");
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

      <Champ label="Catégorie" aide="Mixte affiche les U8 et les U9 en deux listes séparées.">
        <div className="flex gap-2">
          {["U8", "U9", "Mixte"].map((c) => (
            <button key={c} onClick={() => setPlateau({ ...plateau, categorie: c })}
              className="px-4 py-2 rounded-md border text-sm"
              style={{
                borderColor: plateau.categorie === c ? C.terrain : C.ligne,
                background: plateau.categorie === c ? C.terrainSoft : C.papier,
                color: plateau.categorie === c ? C.terrain : C.ink70,
                fontWeight: plateau.categorie === c ? 600 : 400,
              }}>
              {c}
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

      <Champ label="Secteur">
        <input value={plateau.secteur} onChange={maj("secteur")} placeholder="Secteur Sidérurgie Ouest"
          className="w-full border rounded-md px-3 py-2 text-sm" style={styleInput} />
      </Champ>

      <Champ label="Groupe">
        <input value={plateau.groupe} onChange={maj("groupe")} placeholder="Niveau 2"
          className="w-full border rounded-md px-3 py-2 text-sm" style={styleInput} />
      </Champ>

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
  const active = equipes.find((e) => e.id === equipeActive) || equipes[0];

  useEffect(() => {
    if (!equipes.find((e) => e.id === equipeActive)) setEquipeActive(equipes[0]?.id ?? null);
  }, [equipes, equipeActive, setEquipeActive]);

  const delegues = useMemo(
    () => effectif.filter(estDelegue).sort(parNom),
    [effectif]
  );

  /* En mixte, deux listes distinctes ; sinon une seule. Toujours triées par nom. */
  const sections = useMemo(() => {
    const q = sansAccent(recherche);
    const filtre = (cat) =>
      effectif
        .filter((p) => !estDelegue(p) && p.categorie === cat)
        .filter((p) => !q || sansAccent(`${p.nom} ${p.prenom}`).includes(q))
        .sort(parNom);
    if (plateau.categorie === "Mixte") {
      return [
        { titre: "U8", joueurs: filtre("U8") },
        { titre: "U9", joueurs: filtre("U9") },
      ];
    }
    return [{ titre: null, joueurs: filtre(plateau.categorie) }];
  }, [effectif, plateau.categorie, recherche]);

  const total = sections.reduce((n, s) => n + s.joueurs.length, 0);

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

          {sections.map((s) => (
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
                        {!j.valide && (
                          <span className="text-xs shrink-0" style={{ color: C.alerte }}>non validée</span>
                        )}
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
function VueEffectif({ effectif, setEffectif, affectation, retirer }) {
  const fichier = useRef(null);
  const [message, setMessage] = useState(null);
  const [replis, setReplis] = useState(null);
  const [exempleOuvert, setExempleOuvert] = useState(false);
  const [ajout, setAjout] = useState(null);

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
      const parId = new Map(effectif.map((p) => [p.id, p]));
      let ajoutes = 0, majs = 0;
      personnes.forEach((p) => {
        if (parId.has(p.id)) { parId.set(p.id, { ...parId.get(p.id), ...p }); majs++; }
        else { parId.set(p.id, p); ajoutes++; }
      });
      setEffectif([...parId.values()]);
      const bouts = [];
      if (ajoutes) bouts.push(`${ajoutes} ajouté${ajoutes > 1 ? "s" : ""}`);
      if (majs) bouts.push(`${majs} mis à jour`);
      if (ignorees?.length) bouts.push(`${ignorees.length} ligne(s) ignorée(s)`);
      setMessage({ ton: "ok", texte: bouts.join(", ") + "." });
    };
    lecteur.readAsText(f, "utf-8");
    evt.target.value = "";
  };

  const viderEffectif = () => {
    if (!effectif.length) return;
    setMessage({ ton: "alerte", texte: "Effectif vidé. Réimportez le CSV pour le retrouver." });
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
      <p className="text-sm mb-4" style={{ color: C.ink70 }}>
        Joueurs et délégués restent dans ce navigateur. Ils ne sont envoyés nulle part.
      </p>

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
          <button onClick={() => setAjout({ nom: "", prenom: "", categorie: "U8", licence: "", naissance: "", valide: true })}
            className="flex items-center gap-1" style={{ color: C.terrain }}>
            <Plus size={14} /> Ajouter
          </button>
          {effectif.length > 0 && (
            <button onClick={viderEffectif} style={{ color: C.alerte }}>Vider</button>
          )}
        </div>
      </div>

      {ajout && (
        <FormulairePersonne
          valeur={ajout}
          setValeur={setAjout}
          annuler={() => setAjout(null)}
          valider={() => {
            if (!ajout.nom.trim()) return;
            setEffectif((prev) => [
              ...prev,
              {
                ...ajout,
                nom: ajout.nom.trim().toUpperCase(),
                prenom: ajout.prenom.trim(),
                id: ajout.licence.trim() || `m${Date.now()}`,
              },
            ]);
            setAjout(null);
          }}
        />
      )}

      {liste.length === 0 ? (
        <div className="text-center py-12 rounded-lg border border-dashed" style={{ borderColor: C.ligne }}>
          <p className="text-sm" style={{ color: C.ink70 }}>
            Aucune ligne pour l'instant.<br />Importez le CSV des licenciés pour commencer.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {liste.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border"
              style={{ background: C.papier, borderColor: C.ligne }}>
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
              {!p.valide && <span className="text-xs" style={{ color: C.alerte }}>non validée</span>}
              <button onClick={() => retirer(p.id)} aria-label="Retirer" style={{ color: C.ink70 }}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FormulairePersonne({ valeur, setValeur, valider, annuler }) {
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
      <div className="flex gap-2">
        <button onClick={valider} className="px-3 py-2 rounded-md text-sm"
          style={{ background: C.terrain, color: "#fff" }}>Ajouter</button>
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
      a.download = `feuille-${plateau.date || "plateau"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMessage("PDF généré. Ouvrez-le pour l'imprimer ou l'envoyer.");
    } catch (e) {
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
const IMG_DISTRICT = { l: 190, h: 119, b64: "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" };

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
