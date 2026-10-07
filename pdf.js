// Penulis PDF minimal tanpa dependensi (font Helvetica bawaan PDF, encoding WinAnsi).
const zlib = require('zlib');

// Lebar glyph Helvetica (per 1000 unit) untuk ASCII 32..126
const HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584];
const MAP = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '•': '*', '\u00a0': ' ' };

// Ubah ke string latin1 aman (karakter di luar jangkauan diganti)
const enc = (s) => String(s ?? '').replace(/[^\x00-\xff]|[\x00-\x1f]/g, (c) => MAP[c] || (c < ' ' ? ' ' : '?'));
const esc = (s) => enc(s).replace(/[\\()]/g, '\\$&').replace(/[\x80-\xff]/g, (c) => '\\' + c.charCodeAt(0).toString(8));
const width = (s, size, bold) => {
  let w = 0;
  for (const ch of enc(s)) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? HW[c - 32] : 556; }
  return (w / 1000) * size * (bold ? 1.06 : 1);
};

function wrap(s, maxW, size, bold, maxLines = 4) {
  const lines = [];
  let cur = '';
  const push = () => { lines.push(cur); cur = ''; };
  for (const word of String(s ?? '').split(/\s+/).filter(Boolean)) {
    let w = word;
    while (width(w, size, bold) > maxW) { // pecah kata yang terlalu panjang
      let i = 1;
      while (i < w.length && width(w.slice(0, i + 1), size, bold) <= maxW) i++;
      if (cur) push();
      cur = w.slice(0, i); push(); w = w.slice(i);
    }
    const t = cur ? cur + ' ' + w : w;
    if (width(t, size, bold) <= maxW) cur = t; else { push(); cur = w; }
  }
  if (cur || !lines.length) push();
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,3}$/, '') + '...';
  }
  return lines;
}

// Ukuran gambar JPEG (penanda SOF), untuk menyisipkan logo apa adanya (DCTDecode)
function jpegSize(b) {
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

class Pdf {
  constructor(w, h) { this.w = w; this.h = h; this.pages = []; this.images = []; this.addPage(); }
  // Gambar JPEG setinggi h pt; lebar mengikuti rasio. Mengembalikan lebar yang dipakai (0 bila tidak ada gambar).
  image(jpeg, x, y, h) {
    const sz = jpeg && jpegSize(jpeg);
    if (!sz) return 0;
    let idx = this.images.findIndex((im) => im.buf === jpeg);
    if (idx < 0) { this.images.push({ buf: jpeg, ...sz }); idx = this.images.length - 1; }
    const w = h * sz.w / sz.h;
    this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(this.h - y - h).toFixed(2)} cm /Im${idx} Do Q`);
    return w;
  }
  addPage() { this.ops = []; this.pages.push(this.ops); }
  // y diukur dari atas halaman; (x, y) = baseline teks
  text(x, y, s, size = 10, { bold = false, gray = 0, align = 'left', w = 0 } = {}) {
    if (align === 'right') x += w - width(s, size, bold);
    else if (align === 'center') x += (w - width(s, size, bold)) / 2;
    this.ops.push(`${gray} g BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${(this.h - y).toFixed(2)} Td (${esc(s)}) Tj ET`);
  }
  rect(x, y, w, h, gray) { this.ops.push(`${gray} g ${x.toFixed(2)} ${(this.h - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); }
  line(x1, y1, x2, y2, gray = 0.75, lw = 0.5) {
    this.ops.push(`${gray} G ${lw} w ${x1.toFixed(2)} ${(this.h - y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.h - y2).toFixed(2)} l S`);
  }
  build() {
    const n = this.pages.length, chunks = [], offs = [];
    let len = 0;
    const out = (b) => { b = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); chunks.push(b); len += b.length; };
    const obj = (id, body) => { offs[id] = len; out(`${id} 0 obj\n`); out(body); out('\nendobj\n'); };
    out('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Count ${n} /Kids [${this.pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ')}] >>`);
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imgBase = 5 + 2 * n;
    const xo = this.images.length ? ` /XObject << ${this.images.map((_, k) => `/Im${k} ${imgBase + k} 0 R`).join(' ')} >>` : '';
    this.pages.forEach((ops, i) => {
      obj(5 + 2 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.w} ${this.h}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xo} >> /Contents ${6 + 2 * i} 0 R >>`);
      const data = zlib.deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
      offs[6 + 2 * i] = len;
      out(`${6 + 2 * i} 0 obj\n<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`); out(data); out('\nendstream\nendobj\n');
    });
    this.images.forEach((im, k) => {
      offs[imgBase + k] = len;
      out(`${imgBase + k} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.buf.length} >>\nstream\n`);
      out(im.buf); out('\nendstream\nendobj\n');
    });
    const total = imgBase + this.images.length, xref = len;
    out(`xref\n0 ${total}\n0000000000 65535 f \n`);
    for (let i = 1; i < total; i++) out(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
    out(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return Buffer.concat(chunks);
  }
}

const fmtDate = (d = new Date()) => d.toISOString().slice(0, 10);

// Tabel multi-halaman (A4 landscape). rows: array of array (angka rata kanan).
function tablePdf({ title, subtitle, headers, rows, footer, logo }) {
  const M = 36, size = 9, lh = 12, pad = 4;
  const pdf = new Pdf(842, 595), avail = pdf.w - 2 * M;
  let nat = headers.map((h, c) => Math.min(260, Math.max(width(h, size, true), ...rows.slice(0, 200).map((r) => width(r[c], size))) + 2 * pad + 2));
  const sum = nat.reduce((a, b) => a + b, 0);
  const cw = sum > avail ? nat.map((x) => x * avail / sum) : nat;
  const bottom = pdf.h - M - 14;
  let y;
  const head = () => {
    const lw = pdf.image(logo, M, M - 4, 34), tx = M + (lw ? lw + 10 : 0);
    pdf.text(tx, M + 12, title, 15, { bold: true });
    pdf.text(tx, M + 27, subtitle, 9, { gray: 0.4 });
    y = M + 40;
    pdf.rect(M, y, cw.reduce((a, b) => a + b, 0), lh + 2 * pad - 2, 0.9);
    let x = M;
    headers.forEach((h, c) => { pdf.text(x + pad, y + pad + 8, h, size, { bold: true }); x += cw[c]; });
    y += lh + 2 * pad - 2;
  };
  head();
  for (const r of rows) {
    const cells = r.map((v, c) => (typeof v === 'number' ? [String(v)] : wrap(v, cw[c] - 2 * pad, size, false)));
    const h = Math.max(...cells.map((l) => l.length)) * lh + 2 * pad - 2;
    if (y + h > bottom) { pdf.addPage(); head(); }
    let x = M;
    cells.forEach((lines, c) => {
      lines.forEach((l, i) => pdf.text(x + pad, y + pad + 8 + i * lh, l, size, typeof r[c] === 'number' ? { align: 'right', w: cw[c] - 2 * pad } : {}));
      x += cw[c];
    });
    y += h;
    pdf.line(M, y, M + cw.reduce((a, b) => a + b, 0), y);
  }
  if (!rows.length) pdf.text(M, y + 16, 'Tidak ada data.', 10, { gray: 0.4 });
  if (footer) {
    if (y + 30 > bottom) { pdf.addPage(); y = M; }
    pdf.text(M, y + 20, footer, 10, { bold: true });
  }
  pdf.pages.forEach((ops, i) => {
    pdf.ops = ops;
    pdf.text(M, pdf.h - M + 4, 'Yayasan Miftahul Ulumillah', 8, { gray: 0.5 });
    pdf.text(M, pdf.h - M + 4, `Halaman ${i + 1}/${pdf.pages.length}`, 8, { gray: 0.5, align: 'right', w: avail });
  });
  return pdf.build();
}

// Rapor satu siswa (A4 portrait)
const HARI_NAMA = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', "Jum'at", 'Sabtu', 'Ahad'];
const BULAN_NAMA = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const tglPanjang = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return y ? `${d} ${BULAN_NAMA[m - 1]} ${y}` : ''; };
const box = (pdf, x, y, w, h, g = 0.35) => { pdf.line(x, y, x + w, y, g); pdf.line(x, y + h, x + w, y + h, g); pdf.line(x, y, x, y + h, g); pdf.line(x + w, y, x + w, y + h, g); };

// Jadwal pelajaran satu kelas: baris = jam, kolom = hari. Sel yang sama di semua hari digabung (mis. Qiro'atul Yaumiyah).
function jadwalPdf({ lembaga, kelas, tahun, rows, logo }) {
  const M = 30, size = 8, lh = 10, pad = 3, pdf = new Pdf(842, 595), W = pdf.w - 2 * M;
  const hari = [...new Set(rows.map((r) => r.hari))].sort((a, b) => a - b);
  const slots = [...new Map(rows.map((r) => [r.mulai + '-' + r.selesai, [r.mulai, r.selesai]])).values()].sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  const lw = pdf.image(logo, M, 24, 40), tx = M + (lw ? lw + 10 : 0);
  pdf.text(tx, 36, 'YAYASAN MIFTAHUL ULUMILLAH', 9, { gray: 0.4 });
  pdf.text(tx, 52, (lembaga || '').toUpperCase(), 14, { bold: true });
  pdf.text(tx, 66, `JADWAL PELAJARAN KELAS ${kelas}${tahun ? ' - TAHUN PELAJARAN ' + tahun : ''}`, 10, { bold: true });
  let y = 80;
  if (!hari.length) { pdf.text(M, y + 30, 'Belum ada jadwal.', 10, { gray: 0.4 }); return pdf.build(); }
  const wt = 62, cw = (W - wt) / hari.length, bottom = pdf.h - M;
  const head = () => {
    pdf.rect(M, y, W, 16, 0.88); box(pdf, M, y, W, 16);
    pdf.text(M, y + 11, 'Waktu', size + 1, { bold: true, align: 'center', w: wt });
    hari.forEach((h, i) => pdf.text(M + wt + i * cw, y + 11, HARI_NAMA[h], size + 1, { bold: true, align: 'center', w: cw }));
    y += 16;
  };
  head();
  for (const [a, b] of slots) {
    const cells = hari.map((h) => rows.filter((r) => r.hari === h && r.mulai === a && r.selesai === b).map((r) => ({ t: r.judul, g: r.guru || '' })));
    const key = (c) => JSON.stringify(c);
    const spans = [];   // sel bersebelahan yang sama (mis. Qiro'atul Yaumiyah Senin-Kamis) digabung
    for (let d = 0; d < cells.length; d++) {
      let e = d;
      while (cells[d].length && e + 1 < cells.length && key(cells[e + 1]) === key(cells[d])) e++;
      spans.push({ d, e, items: cells[d] }); d = e;
    }
    const laid = spans.map((sp) => {
      const w = (sp.e - sp.d + 1) * cw - 2 * pad, multi = sp.e > sp.d;
      const lines = [];
      sp.items.forEach((it) => {
        wrap(it.t, w, size, multi, 3).forEach((l) => lines.push([l, multi ? 'b' : '']));
        if (it.g) wrap(it.g, w, 7, false, 2).forEach((l) => lines.push([l, 'g']));
      });
      return { ...sp, lines, multi };
    });
    const h = Math.max(1, ...laid.map((sp) => sp.lines.reduce((a, [, k]) => a + (k === 'g' ? 9 : lh), 0))) + 2 * pad;
    if (y + h > bottom) { pdf.addPage(); y = M; head(); }
    pdf.text(M, y + pad + 7, `${a.replace(':', '.')}-${b.replace(':', '.')}`, size, { align: 'center', w: wt });
    pdf.line(M, y, M, y + h, 0.35); pdf.line(M + wt, y, M + wt, y + h, 0.35); pdf.line(M + W, y, M + W, y + h, 0.35);
    for (const sp of laid) {
      const x = M + wt + sp.d * cw, wcell = (sp.e - sp.d + 1) * cw;
      if (sp.d) pdf.line(x, y, x, y + h, 0.35);
      if (sp.multi) pdf.rect(x + 0.4, y + 0.4, wcell - 0.8, h - 0.8, 0.93);
      let ly = y + pad + 7;
      for (const [l, k] of sp.lines) {
        if (k === 'g') { pdf.text(x + pad, ly, l, 7, { gray: 0.4, ...(sp.multi ? { align: 'center', w: wcell - 2 * pad } : {}) }); ly += 9; }
        else { pdf.text(x + pad, ly, l, size, { bold: k === 'b', ...(sp.multi ? { align: 'center', w: wcell - 2 * pad } : {}) }); ly += lh; }
      }
    }
    y += h; pdf.line(M, y, M + W, y, 0.35);
  }
  return pdf.build();
}

// Rapor format Madin (ASAT): mengikuti contoh rapor madin yayasan
function raporMadinPdf({ siswa, semester, madin }, logo) {
  const M = 40, pdf = new Pdf(595, 842), W = pdf.w - 2 * M, size = 9;
  const lw = pdf.image(logo, M, 24, 56);
  pdf.text(M, 38, 'YAYASAN MIFTAHUL ULUMILLAH', 10, { bold: true, align: 'center', w: W });
  pdf.text(M, 53, (siswa.lembaga_nama || '').toUpperCase(), 13, { bold: true, align: 'center', w: W });
  pdf.text(M, 66, 'TAMBAKREJO BOJONEGORO', 9, { align: 'center', w: W });
  if (siswa.lembaga_alamat) pdf.text(M, 78, siswa.lembaga_alamat, 7.5, { gray: 0.4, align: 'center', w: W });
  pdf.line(M, 86, M + W, 86, 0, 1.2);
  pdf.text(M, 106, 'ASESMEN SUMATIF AKHIR TAHUN (ASAT)', 12, { bold: true, align: 'center', w: W });
  const info = (x, y, k, v) => { pdf.text(x, y, k, size); pdf.text(x + 48, y, ': ' + (v || '-'), size, { bold: true }); };
  info(M, 128, 'Nama', siswa.nama); info(M, 142, 'Kelas', siswa.kelas_nama);
  info(M + W - 190, 128, 'Semester', semester || '-'); info(M + W - 190, 142, 'Tahun', madin.tahun_ajaran);
  // tabel nilai
  const cx = [M, M + 22, M + 142, M + 174, M + 212, M + 297, M + 345]; // No | Bidang studi | KKM | Angka | Huruf | Rata kelas | Catatan
  const cw = [22, 120, 32, 38, 85, 48, M + W - (M + 345)];
  let y = 156; const rh = 16;
  const rowBox = (h, fill, inner = [1, 2, 3, 4, 5, 6]) => { if (fill) pdf.rect(M, y, W, h, fill); box(pdf, M, y, W, h); inner.forEach((i) => pdf.line(cx[i], y, cx[i], y + h, 0.35)); };
  pdf.rect(M, y, W, 30, 0.88); box(pdf, M, y, W, 30);
  pdf.line(cx[3], y + 15, cx[5], y + 15, 0.35);
  [1, 2, 3, 5, 6].forEach((i) => pdf.line(cx[i], y, cx[i], y + 30, 0.35)); pdf.line(cx[4], y + 15, cx[4], y + 30, 0.35);
  pdf.text(cx[0], y + 18, 'No.', 8, { bold: true, align: 'center', w: cw[0] });
  pdf.text(cx[1], y + 18, 'Bidang Studi', 8, { bold: true, align: 'center', w: cw[1] });
  pdf.text(cx[2], y + 18, 'KKM', 8, { bold: true, align: 'center', w: cw[2] });
  pdf.text(cx[3], y + 10, 'Nilai', 8, { bold: true, align: 'center', w: cw[3] + cw[4] });
  pdf.text(cx[3], y + 25, 'Angka', 8, { bold: true, align: 'center', w: cw[3] });
  pdf.text(cx[4], y + 25, 'Huruf', 8, { bold: true, align: 'center', w: cw[4] });
  pdf.text(cx[5], y + 12, 'Rata-rata', 7.5, { bold: true, align: 'center', w: cw[5] });
  pdf.text(cx[5], y + 23, 'Kelas', 7.5, { bold: true, align: 'center', w: cw[5] });
  pdf.text(cx[6], y + 18, 'Catatan Guru', 8, { bold: true, align: 'center', w: cw[6] });
  y += 30;
  const group = (t) => { rowBox(rh, 0.94, []); pdf.text(M + 4, y + 11, t, size, { bold: true }); y += rh; };
  let no = 0;
  const item = (m) => {
    no++;
    const cat = wrap(m.catatan, cw[6] - 6, 7.5, false, 2), nm = wrap(m.mapel, cw[1] - 6, size, false, 2), hr = wrap(m.huruf, cw[4] - 6, 8, false, 2);
    const h = Math.max(rh, Math.max(cat.length, nm.length, hr.length) * 10 + 6);
    rowBox(h);
    pdf.text(cx[0], y + 11, String(no), size, { align: 'center', w: cw[0] });
    nm.forEach((l, k) => pdf.text(cx[1] + 3, y + 11 + k * 10, l, size));
    if (m.kkm != null) pdf.text(cx[2], y + 11, String(m.kkm), size, { align: 'center', w: cw[2] });
    if (m.rata !== null) {
      pdf.text(cx[3], y + 11, String(m.rata), size, { bold: true, align: 'center', w: cw[3] });
      hr.forEach((l, k) => pdf.text(cx[4], y + 11 + k * 10, l, 8, { align: 'center', w: cw[4] }));
    }
    if (m.kelas_rata !== null) pdf.text(cx[5], y + 11, String(m.kelas_rata), size, { align: 'center', w: cw[5] });
    cat.forEach((l, k) => pdf.text(cx[6] + 3, y + 10 + k * 10, l, 7.5));
    y += h;
  };
  group('A. MATA PELAJARAN POKOK'); madin.pokok.forEach(item);
  if (!madin.pokok.length) { rowBox(rh, 0, []); pdf.text(M + 28, y + 11, 'Belum ada mata pelajaran / nilai.', size, { gray: 0.4 }); y += rh; }
  if (madin.kecakapan.length) { group('B. KECAKAPAN'); madin.kecakapan.forEach(item); }
  for (const [t, v] of [['Jumlah Nilai', madin.jumlah], ['Nilai Rata-Rata', madin.rata]]) {
    rowBox(rh, 0.94, [3, 4]); pdf.text(M + 4, y + 11, t, size, { bold: true });
    pdf.text(cx[3], y + 11, v === null ? '-' : String(Math.round(v * 10) / 10), size, { bold: true, align: 'center', w: cw[3] }); y += rh;
  }
  // kepribadian + ketidakhadiran
  y += 14;
  const sw = 345, kx = M + sw + 10, kw = W - sw - 10;
  pdf.rect(M, y, sw, 16, 0.88); box(pdf, M, y, sw, 16); pdf.line(M + 22, y, M + 22, y + 16, 0.35); pdf.line(M + sw - 45, y, M + sw - 45, y + 16, 0.35);
  pdf.text(M, y + 11, 'No.', 8, { bold: true, align: 'center', w: 22 });
  pdf.text(M + 26, y + 11, 'Kepribadian dan Pergaulan', 8, { bold: true });
  pdf.text(M + sw - 45, y + 11, 'Nilai', 8, { bold: true, align: 'center', w: 45 });
  pdf.rect(kx, y, kw, 16, 0.88); box(pdf, kx, y, kw, 16);
  pdf.text(kx, y + 11, 'Ketidakhadiran', 8, { bold: true, align: 'center', w: kw });
  const top = y; y += 16;
  madin.sikap.forEach((s, i) => {
    const l = wrap(s.teks, sw - 22 - 45 - 6, 8, false, 2), h = Math.max(rh, l.length * 10 + 6);
    box(pdf, M, y, sw, h); pdf.line(M + 22, y, M + 22, y + h, 0.35); pdf.line(M + sw - 45, y, M + sw - 45, y + h, 0.35);
    pdf.text(M, y + 11, String(i + 1), size, { align: 'center', w: 22 });
    l.forEach((t, k) => pdf.text(M + 25, y + 11 + k * 10, t, 8));
    pdf.text(M + sw - 45, y + 11, s.nilai, size, { bold: true, align: 'center', w: 45 });
    y += h;
  });
  let ky = top + 16;
  for (const [k, v] of [['Sakit', madin.ketidakhadiran.sakit], ['Izin', madin.ketidakhadiran.izin], ['Tanpa keterangan', madin.ketidakhadiran.alpa]]) {
    box(pdf, kx, ky, kw, rh); pdf.text(kx + 4, ky + 11, k, 8); pdf.text(kx, ky + 11, `${v} hari`, 8, { bold: true, align: 'right', w: kw - 4 }); ky += rh;
  }
  // tanda tangan
  y += 28;
  pdf.text(M + W - 190, y, `Tambakrejo, ${tglPanjang(madin.tanggal)}`, size, { align: 'center', w: 190 });
  y += 13;
  pdf.text(M, y, 'Wali Kelas,', size, { align: 'center', w: 190 });
  pdf.text(M + W - 190, y, 'Kepala ' + (siswa.lembaga_nama || 'Madrasah Diniyah'), size, { align: 'center', w: 190 });
  y += 62;
  pdf.text(M, y, siswa.wali_kelas || '(................................)', size, { bold: true, align: 'center', w: 190 });
  pdf.text(M + W - 190, y, siswa.kepala_lembaga || '(................................)', size, { bold: true, align: 'center', w: 190 });
  return pdf.build();
}

function raporPdf(r, logo) {
  if (r.format === 'madin') return raporMadinPdf(r, logo);
  return raporUmumPdf(r, logo);
}

function raporUmumPdf({ siswa, semester, nilai, absensi }, logo) {
  const M = 50, pdf = new Pdf(595, 842), W = pdf.w - 2 * M;
  pdf.image(logo, M, 26, 62);
  pdf.text(M, 40, 'YAYASAN MIFTAHUL ULUMILLAH', 9, { gray: 0.4, align: 'center', w: W });
  pdf.text(M, 56, (siswa.lembaga_nama || '').toUpperCase(), 13, { bold: true, align: 'center', w: W });
  pdf.text(M, 76, 'LAPORAN HASIL BELAJAR', 14, { bold: true, align: 'center', w: W });
  pdf.text(M, 91, semester ? `Semester ${semester}` : 'Semua semester', 10, { gray: 0.4, align: 'center', w: W });
  pdf.line(M, 100, M + W, 100, 0, 1);
  let y = 125;
  for (const [k, v] of [['Nama', siswa.nama], ['NIS', siswa.nis], ['Kelas', siswa.kelas_nama], ['Wali kelas', siswa.wali_kelas]]) {
    pdf.text(M, y, k, 10, { gray: 0.4 }); pdf.text(M + 90, y, ': ' + (v || '-'), 10); y += 16;
  }
  y += 10;
  const cols = [[M + 6, 'Mata pelajaran', W - 170], [M + W - 160, 'Jml nilai', 70], [M + W - 80, 'Rata-rata', 70]];
  pdf.rect(M, y, W, 20, 0.9);
  cols.forEach(([x, t], i) => pdf.text(x, y + 14, t, 10, i ? { bold: true, align: 'right', w: 60 } : { bold: true }));
  y += 20;
  for (const n of nilai) {
    pdf.text(cols[0][0], y + 14, n.mapel, 10);
    pdf.text(cols[1][0], y + 14, String(n.jumlah), 10, { align: 'right', w: 60 });
    pdf.text(cols[2][0], y + 14, String(n.rata), 10, { align: 'right', w: 60 });
    y += 20; pdf.line(M, y, M + W, y);
  }
  if (!nilai.length) { pdf.text(M + 6, y + 14, 'Belum ada nilai.', 10, { gray: 0.4 }); y += 20; }
  const avg = nilai.length ? (nilai.reduce((a, n) => a + n.rata, 0) / nilai.length).toFixed(1) : '-';
  pdf.text(M + 6, y + 15, 'Rata-rata keseluruhan', 10, { bold: true });
  pdf.text(cols[2][0], y + 15, avg, 10, { bold: true, align: 'right', w: 60 });
  y += 40;
  pdf.text(M, y, `Kehadiran: Hadir ${absensi.h || 0}  |  Sakit ${absensi.s || 0}  |  Izin ${absensi.i || 0}  |  Alpa ${absensi.a || 0}`, 10);
  y += 70;
  pdf.text(M, y, 'Wali Kelas,', 10, { align: 'center', w: 180 });
  pdf.text(M + W - 180, y, 'Orang Tua/Wali,', 10, { align: 'center', w: 180 });
  y += 60;
  pdf.text(M, y, siswa.wali_kelas || '(................)', 10, { bold: true, align: 'center', w: 180 });
  pdf.text(M + W - 180, y, siswa.wali || '(................)', 10, { bold: true, align: 'center', w: 180 });
  return pdf.build();
}

// Kuitansi pembayaran
function kuitansiPdf(p, rp, logo) {
  const M = 36, pdf = new Pdf(595, 330), W = pdf.w - 2 * M;
  pdf.line(M, M, M + W, M, 0, 1.5);
  const lw = pdf.image(logo, M, M + 8, 40), tx = M + (lw ? lw + 10 : 0);
  pdf.text(tx, M + 26, 'KUITANSI PEMBAYARAN', 16, { bold: true });
  pdf.text(tx, M + 42, `${p.lembaga_nama || ''} - Yayasan Miftahul Ulumillah`, 9, { gray: 0.4 });
  pdf.text(M, M + 26, `No. ${String(p.id).padStart(6, '0')}`, 10, { align: 'right', w: W });
  pdf.line(M, M + 54, M + W, M + 54, 0, 0.5);
  let y = M + 74;
  const rows = [['Telah terima dari', `${p.siswa_nama}${p.nis ? ' (NIS ' + p.nis + ')' : ''}`], ['Kelas', p.kelas_nama || '-'],
    ['Untuk pembayaran', p.jenis + (p.bulan ? ' - ' + p.bulan : '')], ['Keterangan', p.keterangan || '-'], ['Tanggal', p.tanggal]];
  for (const [k, v] of rows) { pdf.text(M, y, k, 10, { gray: 0.4 }); pdf.text(M + 120, y, ': ' + v, 10); y += 18; }
  pdf.rect(M, y + 6, 230, 34, 0.93);
  pdf.text(M + 10, y + 29, rp(p.jumlah), 15, { bold: true });
  pdf.text(M + W - 160, y + 20, 'Petugas,', 10, { align: 'center', w: 160 });
  pdf.text(M + W - 160, y + 68, '(................)', 10, { align: 'center', w: 160 });
  return pdf.build();
}

module.exports = { tablePdf, raporPdf, kuitansiPdf, jadwalPdf, wrap, width, fmtDate };
