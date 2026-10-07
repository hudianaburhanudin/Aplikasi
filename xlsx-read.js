// Pembaca .xlsx minimal tanpa dependensi (zip + SpreadsheetML): membaca nilai sel, string bersama, dan tanggal.
const zlib = require('zlib');

function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Bukan berkas .xlsx yang valid');
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const files = new Map();
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Berkas .xlsx rusak');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    p += 46 + nl + xl + cl;
    if (usize > 60e6) throw new Error('Isi berkas terlalu besar');
    files.set(name, () => {
      const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28), start = off + 30 + lnl + lxl;
      const raw = buf.subarray(start, start + csize);
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: 60e6 });
      throw new Error('Kompresi berkas tidak didukung');
    });
  }
  return files;
}

const unesc = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, g) => {
  if (g[0] === '#') return String.fromCodePoint(g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
  return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[g.toLowerCase()];
});
const attr = (tag, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag); return m ? unesc(m[1]) : null; };
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join('');
const colIndex = (ref) => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const serialToIso = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400e3).toISOString().slice(0, 10);

// Mengembalikan [{ name, rows: [[nilai|null, ...], ...] }]; tanggal bertipe tanggal diubah ke "YYYY-MM-DD".
function readXlsx(buf, { maxRows = 20000 } = {}) {
  const files = unzip(buf), get = (f) => (files.has(f) ? files.get(f)().toString('utf8') : null);
  const wb = get('xl/workbook.xml');
  if (!wb) throw new Error('Bukan berkas .xlsx yang valid');
  const rels = get('xl/_rels/workbook.xml.rels') || '';
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const ss = get('xl/sharedStrings.xml');
  const shared = ss ? [...ss.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const styles = get('xl/styles.xml') || '';
  const customDate = new Set([...styles.matchAll(/<numFmt\b[^>]*>/g)].filter((m) => /[dmy]/i.test((attr(m[0], 'formatCode') || '').replace(/"[^"]*"|\[[^\]]*\]/g, '')) ).map((m) => Number(attr(m[0], 'numFmtId'))));
  const xfs = (/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles) || [, ''])[1];
  const dateXf = [...xfs.matchAll(/<xf\b[^>]*?(?:\/>|>)/g)].map((m) => { const id = Number(attr(m[0], 'numFmtId')); return BUILTIN_DATE.has(id) || customDate.has(id); });
  const out = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name'), rid = attr(m[0], 'r:id') || attr(m[0], 'id');
    let t = target.get(rid) || '';
    t = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    const x = get(t);
    if (!x) continue;
    const rows = [];
    for (const rm of x.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const ri = Number(attr(rm[1], 'r')) - 1;
      if (ri >= maxRows) break;
      const row = [];
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], 'r'), type = attr(cm[1], 't'), body = cm[2] || '';
        const v = (/<v>([\s\S]*?)<\/v>/.exec(body) || [, null])[1];
        let val = null;
        if (type === 's' && v !== null) val = shared[Number(v)] ?? null;
        else if (type === 'inlineStr') val = textOf(body);
        else if (type === 'str' || type === 'e') val = v === null ? null : unesc(v);
        else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== null && v !== '') { val = Number(v); if (dateXf[Number(attr(cm[1], 's'))] && Number.isFinite(val)) val = serialToIso(val); }
        if (typeof val === 'string' && val.trim() === '') val = null;
        if (val !== null) row[colIndex(ref)] = val;
      }
      rows[ri] = row;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    out.push({ name, rows });
  }
  return out;
}

// CSV/TSV sederhana (pemisah , ; atau tab terdeteksi dari baris pertama; tanda kutip ganda didukung) -> baris-baris array
function readCsv(text, { maxRows = 20000 } = {}) {
  text = String(text).replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const sep = [',', ';', '\t'].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  const end = () => { row.push(cur.trim() === '' ? null : cur.trim()); cur = ''; };
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"' && cur === '') q = true;
    else if (ch === sep) end();
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; end(); rows.push(row); row = []; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { end(); rows.push(row); }
  return rows.filter((r) => r.some((v) => v !== null));
}

// Teks paragraf berkas Word (.docx), satu paragraf per baris
function readDocxText(buf) {
  const files = unzip(buf), f = files.get('word/document.xml');
  if (!f) throw new Error('Bukan berkas Word (.docx) yang valid');
  const x = f().toString('utf8');
  return [...x.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
    .map((t) => (t[1] !== undefined ? unesc(t[1]) : t[0] === '<w:tab/>' ? '\t' : '\n')).join('')).join('\n');
}

module.exports = { readXlsx, readCsv, readDocxText };
