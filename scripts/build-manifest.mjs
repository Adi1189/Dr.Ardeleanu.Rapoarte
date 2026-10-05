#!/usr/bin/env node
/**
 * build-manifest.mjs (varianta „navigare pe saptamani ISO")
 * Scaneaza reports/adult/ si injecteaza in index.html (intre marcaje):
 *   window.__CHANNELS__  = lista ordonata de rapoarte (din data/config.json)
 *   window.__REPORTS__   = [{c, wy, wk, title, period, path}, ...]
 *                          wy/wk = anul si saptamana ISO (luni–duminica) acoperite de raport
 *
 * Saptamana se ia din INTERVALUL raportului, nu din data din numele fisierului
 * (data din nume e uneori inceputul saptamanii, alteori ziua publicarii).
 * Ordinea surselor:
 *   1. titlu „Comparativ · Sapt. N vs. M"  -> saptamana M
 *   2. <meta name="report:week" content="2026-W37">   (recomandat in sablonul nou)
 *   3. <meta name="report:period">, apoi <title>, apoi inceputul paginii (ex. „7–13 sep 2026")
 *   4. data din numele fisierului (cu avertisment)
 * Daca intervalul gasit difera cu >10 zile de data din nume, e considerat suspect
 * si se foloseste data din nume (cu avertisment).
 *
 * Sunt sarite: rapoartele care nu sunt in reports/adult/, quick-check-urile (cadenta „daily"
 * sau „quick-check" in nume) si fisierele al caror nume nu incepe cu AAAA-LL-ZZ.
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
function decode(s) {
  return s.replace(/&ndash;|&#8211;/g, "–").replace(/&mdash;|&#8212;/g, "—")
          .replace(/&middot;|&#183;/g, "·").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
}
function title(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1]).trim().replace(/\s+/g, " ") : null;
}

/* ---------- saptamana ISO a unui raport ---------- */
const DAY = 86400000;
const MONTHS = { ian: 1, feb: 2, mar: 3, apr: 4, mai: 5, iun: 6, iul: 7, aug: 8, sep: 9, oct: 10, noi: 11, dec: 12 };
const MON_SHORT = ["", "ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "noi", "dec"];
const WORD = "[A-Za-z\\u00C0-\\u024F]+";
// „7-13 sep 2026", „26 mai – 1 iunie", „29 iunie – 5 iulie 2026"
const RANGE_TXT = new RegExp("(\\d{1,2})\\s*(?:(" + WORD + ")\\.?)?\\s*[\\u2013\\u2014-]\\s*(\\d{1,2})\\s+(" + WORD + ")\\.?,?(?:\\s+(\\d{4}))?");
// „27.07–02.08.2026"
const RANGE_NUM = /(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s*[\u2013\u2014-]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/;

function monthOf(word) {
  return MONTHS[word.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0, 3)] || null;
}
function isoOf(date) { // {y, w} pentru o data UTC
  const t = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return { y: t.getUTCFullYear(), w: Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7) };
}
function mondayOf(y, w) {
  const j4 = new Date(Date.UTC(y, 0, 4));
  return new Date(j4.getTime() + ((w - 1) * 7 - ((j4.getUTCDay() || 7) - 1)) * DAY);
}
function middle(y, sm, sd, em, ed) { // mijlocul unui interval de zile
  const a = Date.UTC(sm > em ? y - 1 : y, sm - 1, sd), b = Date.UTC(y, em - 1, ed);
  return new Date((a + b) / 2);
}
function rangeMiddle(text, defaultYear) {
  let m = text.match(RANGE_NUM);
  if (m) return middle(+m[6], +m[2], +m[1], +m[5], +m[4]);
  m = text.match(RANGE_TXT);
  if (!m) return null;
  const em = monthOf(m[4]), y = m[5] ? +m[5] : defaultYear;
  if (!em || !y) return null;
  let sm = m[2] ? monthOf(m[2]) : null;
  if (m[2] && !sm) return null;
  if (!sm) sm = +m[1] > +m[3] ? (em === 1 ? 12 : em - 1) : em;
  return middle(y, sm, +m[1], em, +m[3]);
}
function weekLabel(y, w) { // „7–13 sep 2026" sau „29 iun – 5 iul 2026"
  const a = mondayOf(y, w), b = new Date(a.getTime() + 6 * DAY);
  const da = a.getUTCDate(), db = b.getUTCDate(), ma = MON_SHORT[a.getUTCMonth() + 1], mb = MON_SHORT[b.getUTCMonth() + 1];
  return ma === mb ? `${da}–${db} ${ma} ${b.getUTCFullYear()}` : `${da} ${ma} – ${db} ${mb} ${b.getUTCFullYear()}`;
}
function startOfPage(html) {
  const body = (html.match(/<body[^>]*>([\s\S]*)/i) || [, html])[1];
  return decode(body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim().slice(0, 400);
}
function guessYear(w, d) { // anul unei saptamani cunoscute doar dupa numar
  const y = d.getUTCFullYear(), mo = d.getUTCMonth();
  if (w >= 50 && mo === 0) return y - 1;
  if (w <= 2 && mo === 11) return y + 1;
  return y;
}

function weekInfo(html, file) {
  const fd = basename(file).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const fileDate = fd ? new Date(Date.UTC(+fd[1], +fd[2] - 1, +fd[3])) : null;

  const cmp = (title(html) || "").match(/S[^\s\d]*\.?\s*(\d{1,2})\s*vs\.?\s*(\d{1,2})/i);
  if (cmp && fileDate) return { y: guessYear(+cmp[2], fileDate), w: +cmp[2], src: "comparativ" };

  const mw = (meta(html, "report:week") || "").match(/^(\d{4})-?W(\d{1,2})$/i);
  if (mw) return { y: +mw[1], w: +mw[2], src: "meta-week" };

  let suspect = false;
  for (const [src, text] of [["meta", meta(html, "report:period")], ["titlu", title(html)], ["antet", startOfPage(html)]]) {
    if (!text) continue;
    const mid = rangeMiddle(text, fileDate ? fileDate.getUTCFullYear() : null);
    if (!mid) continue;
    if (fileDate && Math.abs(mid - fileDate) > 10 * DAY) { suspect = true; continue; }
    return { ...isoOf(mid), src };
  }
  if (fileDate) {
    return { ...isoOf(fileDate), src: "fisier",
      warn: suspect ? "interval suspect in raport — folosita data din numele fisierului"
                    : "fara interval in raport — folosita data din numele fisierului" };
  }
  return null;
}

/* ---------- construieste lista ---------- */
const reports = [];
const warnings = [];
for (const file of walk(REPORTS_DIR)) {
  const rel = file.substring(ROOT.length + 1).split("\\").join("/");
  const parts = rel.split("/");           // reports/brand/folder/file
  if (parts[1] !== "adult") continue;     // kids etc. nu apar in acest index
  const name = basename(file);
  if (/quick-check/i.test(name)) continue;
  if (!/^\d{4}-\d{2}-\d{2}/.test(name)) { warnings.push(`nume fara data (sarit): ${rel}`); continue; }
  const yr = +name.slice(0, 4);
  if (yr < 2024 || yr > 2099) { warnings.push(`an improbabil in numele fisierului (sarit) — redenumeste fisierul: ${rel}`); continue; }

  const html = readFileSync(file, "utf8");
  if (meta(html, "report:cadence") === "daily") continue;  // quick-check exclus
  const folder = meta(html, "report:channel") || parts[2];
  const ch = byFolder[folder];
  if (!ch) { warnings.push(`canal necunoscut: ${rel}`); continue; }

  const wi = weekInfo(html, file);
  if (!wi) { warnings.push(`nu pot stabili saptamana: ${rel}`); continue; }
  if (wi.warn) warnings.push(`${rel}: ${wi.warn}`);

  reports.push({
    c: ch.id,
    wy: wi.y,
    wk: wi.w,
    title: title(html) || ch.name,
    period: meta(html, "report:period") || weekLabel(wi.y, wi.w),
    path: rel,
  });
}

reports.sort((a, b) => (a.wy - b.wy) || (a.wk - b.wk) || a.path.localeCompare(b.path));

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
