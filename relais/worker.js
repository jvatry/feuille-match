/**
 * Relais de publication de l'effectif — Cloudflare Worker.
 *
 * L'application envoie { paquet, jeton } :
 *   - paquet : effectif.enc.json déjà chiffré sur le téléphone (AES-256-GCM) ;
 *   - jeton  : preuve dérivée du code de l'effectif (PBKDF2), jamais le code.
 * Le relais vérifie le jeton contre son empreinte, contrôle la forme du paquet
 * et le commite dans le dépôt avec un jeton GitHub qu'il est seul à connaître.
 * Il ne voit jamais l'effectif en clair.
 *
 * Variables (wrangler.toml) : DEPOT, BRANCHE, FICHIER, ORIGINES.
 * Secrets : GITHUB_TOKEN, EMPREINTE_JETON (node chiffrer-effectif.mjs --jeton).
 */

const TAILLE_MAX = 200_000;
const CLES_PAQUET = ["algo", "donnees", "empreinte", "genere", "iv", "kdf", "v"];
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export default {
  async fetch(requete, env) {
    const origine = requete.headers.get("Origin") || "";
    const autorisees = (env.ORIGINES || "").split(",").map((s) => s.trim()).filter(Boolean);
    const permise = autorisees.includes(origine);
    const cors = permise
      ? {
          "Access-Control-Allow-Origin": origine,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        }
      : { Vary: "Origin" };
    const reponse = (statut, corps) =>
      new Response(JSON.stringify(corps), {
        status: statut,
        headers: { "Content-Type": "application/json", ...cors },
      });

    if (requete.method === "OPTIONS") return new Response(null, { status: permise ? 204 : 403, headers: cors });
    if (requete.method !== "POST") return reponse(405, { erreur: "METHODE" });
    if (!permise) return reponse(403, { erreur: "ORIGINE" });

    const texte = await requete.text();
    if (texte.length > TAILLE_MAX) return reponse(413, { erreur: "TROP_GROS" });
    let corps;
    try {
      corps = JSON.parse(texte);
    } catch (e) {
      return reponse(400, { erreur: "JSON" });
    }

    if (!(await jetonValide(corps?.jeton, env.EMPREINTE_JETON))) return reponse(403, { erreur: "CODE_REFUSE" });
    if (!paquetValide(corps.paquet)) return reponse(400, { erreur: "PAQUET_INVALIDE" });

    try {
      await commiter(corps.paquet, env);
    } catch (e) {
      console.error(e.message);
      return reponse(502, { erreur: "GITHUB" });
    }
    return reponse(200, { ok: true, empreinte: corps.paquet.empreinte });
  },
};

async function jetonValide(jeton, attendu) {
  if (typeof jeton !== "string" || !jeton || typeof attendu !== "string" || !attendu) return false;
  const hache = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jeton));
  const hex = [...new Uint8Array(hache)].map((o) => o.toString(16).padStart(2, "0")).join("");
  const cible = attendu.trim().toLowerCase();
  if (hex.length !== cible.length) return false;
  let difference = 0;
  for (let i = 0; i < hex.length; i++) difference |= hex.charCodeAt(i) ^ cible.charCodeAt(i);
  return difference === 0;
}

/* Exactement la forme produite par l'application et chiffrer-effectif.mjs :
   rien d'autre ne peut être glissé dans le fichier publié. */
function paquetValide(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  if (Object.keys(p).sort().join() !== CLES_PAQUET.join()) return false;
  const k = p.kdf;
  return (
    p.v === 1 &&
    p.algo === "AES-GCM-256" &&
    k && typeof k === "object" &&
    Object.keys(k).sort().join() === "hash,iterations,nom,sel" &&
    k.nom === "PBKDF2" && k.hash === "SHA-256" &&
    Number.isInteger(k.iterations) && k.iterations >= 100_000 &&
    [k.sel, p.iv, p.donnees, p.empreinte].every((s) => typeof s === "string" && B64.test(s)) &&
    typeof p.genere === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.genere)
  );
}

async function commiter(paquet, env) {
  const branche = env.BRANCHE || "main";
  const url = `https://api.github.com/repos/${env.DEPOT}/contents/${env.FICHIER || "effectif.enc.json"}`;
  const entetes = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "feuille-match-relais",
  };

  const actuel = await fetch(`${url}?ref=${encodeURIComponent(branche)}`, { headers: entetes });
  if (!actuel.ok && actuel.status !== 404) throw new Error(`lecture ${actuel.status}`);
  const sha = actuel.ok ? (await actuel.json()).sha : undefined;

  const contenu = JSON.stringify(paquet, null, 2) + "\n";   // ASCII seulement : btoa suffit
  const ecriture = await fetch(url, {
    method: "PUT",
    headers: { ...entetes, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `chore: publier l'effectif du ${paquet.genere} depuis l'application`,
      content: btoa(contenu),
      branch: branche,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!ecriture.ok) throw new Error(`écriture ${ecriture.status}`);
}
