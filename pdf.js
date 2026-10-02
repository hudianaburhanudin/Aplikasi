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
function raporPdf({ siswa, semester, nilai, absensi }, logo) {
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

module.exports = { tablePdf, raporPdf, kuitansiPdf, wrap, width, fmtDate };
