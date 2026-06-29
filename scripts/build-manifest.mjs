#!/usr/bin/env node
/**
 * build-manifest.mjs (varianta „navigare in trepte")
 * Scaneaza reports/ si injecteaza in index.html (intre marcaje):
 *   window.__CHANNELS__  = lista ordonata de rapoarte (din data/config.json)
 *   window.__REPORTS__   = [{c, y, mo, w, title, period, path}, ...]
 *
 * Cadenta e per CANAL (din config), nu per fisier:
 *   - canal lunar  -> raportul apartine unei luni (fara saptamana)
 *   - canal saptamanal -> saptamana din luna (1..4) calculata din zi
 * Rapoartele cu cadenta "daily" (quick-check) sunt sarite.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REPORTS_DIR = join(ROOT, "reports");
const CONFIG = JSON.parse(readFileSync(join(ROOT, "data", "config.json"), "utf8"));
const INDEX = join(ROOT, "index.html");

const byFolder = {};
for (const ch of CONFIG.channels) byFolder[ch.folder] = ch;

function walk(d) {
  const out = [];
  for (const e of readdirSync(d)) {
    const f = join(d, e);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else if (e.toLowerCase().endsWith(".html")) out.push(f);
  }
  return out;
}
function meta(html, name) {
  const re = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["']`, "i");
  const m = html.match(re);
  return m ? (m[1] ?? m[2] ?? "").trim() : null;
}
function title(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}
function weekOf(day) { return day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4; }

const reports = [];
const warnings = [];
for (const file of walk(REPORTS_DIR)) {
  const rel = file.substring(ROOT.length + 1).split("\\").join("/");
  const parts = rel.split("/");           // reports/brand/folder/file
  const folder = meta(readFileSync(file, "utf8"), "report:channel") || parts[2];
  const html = readFileSync(file, "utf8");
  const cadenceMeta = meta(html, "report:cadence");
  if (cadenceMeta === "daily") continue;  // quick-check exclus
  const ch = byFolder[folder];
  if (!ch) { warnings.push(`canal necunoscut: ${rel}`); continue; }

  const date = meta(html, "report:date") || (basename(file).match(/^(\d{4}-\d{2}-\d{2})/) || [])[1];
  if (!date) { warnings.push(`fara data: ${rel}`); continue; }
  const [y, mo, day] = date.split("-").map(Number);

  reports.push({
    c: ch.id,
    y, mo,
    w: ch.cadence === "weekly" ? weekOf(day) : null,
    title: title(html) || ch.name,
    period: meta(html, "report:period") || date,
    path: rel,
  });
}

reports.sort((a, b) => (a.y - b.y) || (a.mo - b.mo) || ((a.w || 0) - (b.w || 0)));

const channels = CONFIG.channels.map(c => ({ id: c.id, name: c.name, cad: c.cadence }));

let idx = readFileSync(INDEX, "utf8");
const S = "/* === DATA START";
const E = "/* === DATA END === */";
const s = idx.indexOf(S), e = idx.indexOf(E);
const block =
  "/* === DATA START (generat automat — NU edita intre marcaje) === */\n" +
  "window.__CHANNELS__ = " + JSON.stringify(channels) + ";\n" +
  "window.__REPORTS__ = " + JSON.stringify(reports) + ";\n" +
  E;
if (s === -1 || e === -1) { console.error("! Lipsesc marcajele DATA in index.html"); process.exit(1); }
idx = idx.slice(0, s) + block + idx.slice(e + E.length);
writeFileSync(INDEX, idx, "utf8");

console.log(`✓ ${reports.length} rapoarte injectate in index.html`);
if (warnings.length) { console.log("Atentionari:"); warnings.forEach(w => console.log("  " + w)); }
