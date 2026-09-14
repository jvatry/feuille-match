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
const MAX_EQUIPES = 6;   // la feuille du district comporte 6 blocs
const DELEGUE = "Délégué";

const CLE_EFFECTIF = "feuilles:effectif";
const CLE_PLATEAU = "feuilles:plateau";

const PLATEAU_VIDE = {
  categorie: "U8",   // U8 · U9 · Mixte
  date: "",
  lieu: "",
  secteur: "",
  groupe: "",
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
/*  Feuille : un seul gabarit HTML, affiché à l'écran et imprimé       */
/* ------------------------------------------------------------------ */
const CSS_FEUILLE = `
  .fm { font-family: Georgia, "Times New Roman", serif; color: #000; background: #fff;
        max-width: 190mm; margin: 0 auto; padding: 6mm; box-sizing: border-box; }
  .fm-haut { display: flex; justify-content: space-between; align-items: flex-start;
             border-bottom: 1px solid #000; padding-bottom: 6px; margin-bottom: 10px; }
  .fm-district { font-size: 11px; line-height: 1.3; }
  .fm-district strong { display: block; }
  .fm-cat { border: 1px solid #000; padding: 3px 10px; text-align: center; }
  .fm-cat small { display: block; font-size: 9px; font-weight: bold; letter-spacing: .04em; }
  .fm-cat b { display: block; font-size: 17px; line-height: 1.1; }
  .fm-titre { text-align: center; font-weight: bold; font-size: 13px; margin: 0 0 8px; }
  .fm-grille { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .fm-equipe { border: 1px solid #000; padding: 5px; font-size: 11px; }
  .fm-nom { font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 3px; margin-bottom: 3px; }
  .fm-tete { display: flex; justify-content: space-between; font-weight: bold; margin-bottom: 2px; }
  .fm-ligne { display: flex; justify-content: space-between; gap: 6px;
              border-bottom: 1px dotted #555; padding: 1px 0; }
  .fm-ligne span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fm-ligne span:last-child { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
  .fm-delegue { display: flex; justify-content: space-between; gap: 6px; padding-top: 4px; }
  .fm-bas { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; font-size: 11px;
            border-top: 1px solid #000; margin-top: 10px; padding-top: 8px; }
  .fm-bas div { border-bottom: 1px solid #000; padding-bottom: 2px; }
  .fm-bas b { margin-right: 6px; }
  .fm-pied { border-top: 1px solid #000; margin-top: 10px; padding-top: 8px; font-size: 11px; }
  .fm-pied div { margin-bottom: 18px; }
  .fm-pied div:last-child { margin-bottom: 0; }
`;

const CSS_IMPRESSION = `
  @page { size: A4 portrait; margin: 10mm; }
  @media print { body { margin: 0; } .fm { padding: 0; max-width: none; } }
`;

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function feuilleHTML(plateau, equipes, personneDe) {
  const categorie = plateau.categorie === "Mixte" ? "U8 / U9" : plateau.categorie;
  const dateFr = plateau.date ? new Date(plateau.date + "T12:00").toLocaleDateString("fr-FR") : "";

  const blocs = equipes.map((e) => {
    const n = Math.max(MAX_JOUEURS, e.joueurs.length);
    const lignes = Array.from({ length: n }, (_, i) => {
      const j = personneDe(e.joueurs[i]);
      const nom = j ? `${i + 1} ${esc(j.nom)} ${esc(j.prenom)}` : `${i + 1}`;
      return `<div class="fm-ligne"><span>${nom}</span><span>${esc(j?.licence || "")}</span></div>`;
    }).join("");
    const d = e.delegueId ? personneDe(e.delegueId) : null;
    return `
      <div class="fm-equipe">
        <div class="fm-nom">Équipe : ${esc(e.nom)}</div>
        <div class="fm-tete"><span>Nom Prénom</span><span>N° Licence</span></div>
        ${lignes}
        <div class="fm-delegue">
          <span><b>Délégué :</b> ${d ? `${esc(d.nom)} ${esc(d.prenom)}` : ""}</span>
          <span>${esc(d?.licence || "")}</span>
        </div>
      </div>`;
  }).join("");

  return `
    <div class="fm">
      <div class="fm-haut">
        <div class="fm-district">
          <strong>District Mosellan de Football</strong>
          Football des enfants — Football à 5
        </div>
        <div class="fm-cat"><small>FEUILLE DE MATCH</small><b>${esc(categorie)}</b></div>
      </div>
      <h3 class="fm-titre">Composition des équipes :</h3>
      <div class="fm-grille">${blocs}</div>
      <div class="fm-bas">
        <div><b>SECTEUR DE :</b>${esc(plateau.secteur)}</div>
        <div><b>GROUPE :</b>${esc(plateau.groupe)}</div>
        <div><b>PLATEAU à :</b>${esc(plateau.lieu)}</div>
        <div><b>DATE :</b>${esc(dateFr)}</div>
      </div>
      <div class="fm-pied">
        <div>Observations ou réclamations (signées) — club :</div>
        <div>Joueurs blessés (nom, prénom, club, n° licence, nature) :</div>
        <div>Nom et signature du responsable de plateau :</div>
      </div>
    </div>`;
}

/* L'aperçu vit dans une iframe : l'impression échappe ainsi aux
   restrictions de la page hôte, et ce qui s'imprime est ce qui est vu. */
function documentFeuille(corps) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feuille de match</title>
<style>body{margin:0;background:#fff;}${CSS_FEUILLE}${CSS_IMPRESSION}</style>
</head><body>${corps}</body></html>`;
}

/* ------------------------------------------------------------------ */
/*  PDF — fabriqué à la main : le bac à sable de l'aperçu interdit     */
/*  print() et l'ouverture d'onglets, un fichier reste la seule voie.  */
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

/* Helvetica : approximation suffisante pour aligner et tronquer. */
const largeurTexte = (s, taille, gras) => latin1(s).length * taille * (gras ? 0.55 : 0.5);

function tronquer(s, maxi, taille, gras) {
  let t = latin1(s);
  if (largeurTexte(t, taille, gras) <= maxi) return t;
  while (t.length > 1 && largeurTexte(t + "…", taille, gras) > maxi) t = t.slice(0, -1);
  return t + ".";
}

function contenuPDF(plateau, equipes, personneDe) {
  const ops = [];
  const y = (haut) => (A4.h - haut).toFixed(2);
  const texte = (x, haut, taille, gras, s) =>
    ops.push(`BT /${gras ? "F2" : "F1"} ${taille} Tf 1 0 0 1 ${x.toFixed(2)} ${y(haut)} Tm (${pdfEsc(s)}) Tj ET`);
  const texteDroite = (xFin, haut, taille, gras, s) =>
    texte(xFin - largeurTexte(s, taille, gras), haut, taille, gras, s);
  const texteCentre = (xMil, haut, taille, gras, s) =>
    texte(xMil - largeurTexte(s, taille, gras) / 2, haut, taille, gras, s);
  const trait = (x1, x2, haut, ep = 0.6) =>
    ops.push(`${ep} w ${x1.toFixed(2)} ${y(haut)} m ${x2.toFixed(2)} ${y(haut)} l S`);
  const cadre = (x, haut, l, h, ep = 0.6) =>
    ops.push(`${ep} w ${x.toFixed(2)} ${(A4.h - haut - h).toFixed(2)} ${l.toFixed(2)} ${h.toFixed(2)} re S`);

  const xG = MARGE;
  const xD = A4.l - MARGE;
  const categorie = plateau.categorie === "Mixte" ? "U8 / U9" : plateau.categorie;
  const dateFr = plateau.date ? new Date(plateau.date + "T12:00").toLocaleDateString("fr-FR") : "";

  /* En-tête */
  texte(xG, 50, 11, true, "District Mosellan de Football");
  texte(xG, 63, 9, false, "Football des enfants — Football à 5");
  cadre(xD - 120, 34, 120, 36);
  texteCentre(xD - 60, 49, 8, true, "FEUILLE DE MATCH");
  texteCentre(xD - 60, 65, 14, true, categorie);
  trait(xG, xD, 78, 0.8);
  texteCentre(A4.l / 2, 96, 11, true, "Composition des équipes :");

  /* Blocs équipes, deux colonnes */
  const largeurBloc = (xD - xG - 12) / 2;
  const hauteurBloc = 128;
  equipes.slice(0, MAX_EQUIPES).forEach((e, n) => {
    const bx = n % 2 === 0 ? xG : xG + largeurBloc + 12;
    const bh = 108 + Math.floor(n / 2) * (hauteurBloc + 8);
    cadre(bx, bh, largeurBloc, hauteurBloc);
    texte(bx + 4, bh + 12, 9, true, tronquer(`Équipe : ${e.nom}`, largeurBloc - 8, 9, true));
    trait(bx, bx + largeurBloc, bh + 16);
    texte(bx + 4, bh + 27, 8, true, "Nom Prénom");
    texteDroite(bx + largeurBloc - 4, bh + 27, 8, true, "N° Licence");

    const nbLignes = Math.max(MAX_JOUEURS, e.joueurs.length);
    for (let i = 0; i < nbLignes; i++) {
      const hy = bh + 38 + i * 10.5;
      const j = personneDe(e.joueurs[i]);
      const nom = j ? `${i + 1}  ${j.nom} ${j.prenom}` : `${i + 1}`;
      texte(bx + 4, hy, 8.5, false, tronquer(nom, largeurBloc - 78, 8.5, false));
      if (j?.licence) texteDroite(bx + largeurBloc - 4, hy, 8.5, false, j.licence);
      trait(bx + 4, bx + largeurBloc - 4, hy + 2.5, 0.25);
    }

    const d = e.delegueId ? personneDe(e.delegueId) : null;
    const hd = bh + hauteurBloc - 5;
    texte(bx + 4, hd, 8, true, "Délégué :");
    if (d) texte(bx + 46, hd, 8, false, tronquer(`${d.nom} ${d.prenom}`, largeurBloc - 130, 8, false));
    if (d?.licence) texteDroite(bx + largeurBloc - 4, hd, 8, false, d.licence);
  });

  /* Bas de feuille */
  const hBas = 108 + Math.ceil(Math.min(equipes.length, MAX_EQUIPES) / 2) * (hauteurBloc + 8) + 18;
  const colonne = (x, haut, etiquette, valeur, l) => {
    texte(x, haut, 9, true, etiquette);
    texte(x + largeurTexte(etiquette, 9, true) + 6, haut, 9, false, tronquer(valeur, l - 90, 9, false));
    trait(x, x + l, haut + 3);
  };
  colonne(xG, hBas, "SECTEUR DE :", plateau.secteur, largeurBloc);
  colonne(xG + largeurBloc + 12, hBas, "GROUPE :", plateau.groupe, largeurBloc);
  colonne(xG, hBas + 22, "PLATEAU à :", plateau.lieu, largeurBloc);
  colonne(xG + largeurBloc + 12, hBas + 22, "DATE :", dateFr, largeurBloc);

  let hPied = hBas + 52;
  [
    "Observations ou réclamations (signées) — club :",
    "Joueurs blessés (nom, prénom, club, n° licence, nature) :",
    "Nom et signature du responsable de plateau :",
  ].forEach((t) => {
    texte(xG, hPied, 9, false, t);
    trait(xG, xD, hPied + 20, 0.4);
    hPied += 40;
  });

  return ops.join("\n");
}

function construirePDF(contenu) {
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.l} ${A4.h}] ` +
      "/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${contenu.length} >>\nstream\n${contenu}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];

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
        const r = await window.storage.get(CLE_EFFECTIF);
        if (r?.value) {
          const d = JSON.parse(r.value);
          setEffectif(d);
          aEffectif = d.length > 0;
        }
      } catch (e) { /* première ouverture, ou stockage indisponible */ }
      try {
        const r = await window.storage.get(CLE_PLATEAU);
        if (r?.value) {
          const d = JSON.parse(r.value);
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
    try { window.storage.set(cle, JSON.stringify(valeur)); } catch (e) { /* best effort */ }
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
