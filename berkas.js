// Penyimpanan berkas unggahan (materi pelajaran, gambar soal): di disk (bukan di database), diberi nama acak,
// dibatasi jenis/ukuran, diperiksa tanda awal berkas (magic bytes), dan hanya dilayani lewat pemeriksaan hak akses.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const isi = (b, s, off = 0) => b.length >= off + s.length && b.subarray(off, off + s.length).toString('latin1') === s;
const zipOffice = (b) => isi(b, 'PK\x03\x04');
const oleOffice = (b) => b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
const teks = (b) => !b.subarray(0, 4096).includes(0);
// ext -> { mime, ok(buffer), inline (boleh dibuka di peramban), gambar }
const TIPE = {
  pdf: { mime: 'application/pdf', ok: (b) => isi(b, '%PDF'), inline: true },
  jpg: { mime: 'image/jpeg', ok: (b) => b[0] === 0xff && b[1] === 0xd8, inline: true, gambar: true },
  jpeg: { mime: 'image/jpeg', ok: (b) => b[0] === 0xff && b[1] === 0xd8, inline: true, gambar: true },
  png: { mime: 'image/png', ok: (b) => isi(b, '\x89PNG'), inline: true, gambar: true },
  gif: { mime: 'image/gif', ok: (b) => isi(b, 'GIF8'), inline: true, gambar: true },
  webp: { mime: 'image/webp', ok: (b) => isi(b, 'RIFF') && isi(b, 'WEBP', 8), inline: true, gambar: true },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ok: zipOffice },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ok: zipOffice },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ok: zipOffice },
  doc: { mime: 'application/msword', ok: oleOffice },
  xls: { mime: 'application/vnd.ms-excel', ok: oleOffice },
  ppt: { mime: 'application/vnd.ms-powerpoint', ok: oleOffice },
  txt: { mime: 'text/plain; charset=utf-8', ok: teks },
  csv: { mime: 'text/csv; charset=utf-8', ok: teks },
  mp3: { mime: 'audio/mpeg', ok: (b) => isi(b, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0), inline: true },
  mp4: { mime: 'video/mp4', ok: (b) => isi(b, 'ftyp', 4), inline: true },
};

function createBerkas({ db, dir, HttpError, maksMb = 20 }) {
  fs.mkdirSync(dir, { recursive: true });
  const MAKS = maksMb * 1024 * 1024, MAKS_GAMBAR = 3 * 1024 * 1024;
  const extDari = (nama) => (String(nama || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/) || [])[1];
  const namaAman = (n) => String(n || 'berkas').replace(/[\x00-\x1f\x7f"\\/:*?<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'berkas';

  function simpan({ lembagaId, materiId = null, ujianId = null, nama, buf, oleh, hanyaGambar = false }) {
    const ext = extDari(nama), t = ext && TIPE[ext];
    if (!t) throw new HttpError(400, `Jenis berkas ."${ext || '?'}" tidak diizinkan. Boleh: ${Object.keys(TIPE).join(', ')}`);
    if (hanyaGambar && !t.gambar) throw new HttpError(400, 'Hanya gambar (jpg, png, gif, webp)');
    if (!buf.length) throw new HttpError(400, 'Berkas kosong');
    if (buf.length > (hanyaGambar ? MAKS_GAMBAR : MAKS)) throw new HttpError(413, `Ukuran maksimal ${hanyaGambar ? 3 : maksMb} MB`);
    if (!t.ok(buf)) throw new HttpError(400, 'Isi berkas tidak sesuai dengan jenisnya');
    const simpanNama = crypto.randomBytes(16).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(dir, simpanNama), buf, { mode: 0o640 });
    const id = Number(db.prepare('INSERT INTO berkas (lembaga_id, materi_id, ujian_id, nama, ext, ukuran, simpan, dibuat_oleh) VALUES (?,?,?,?,?,?,?,?)')
      .run(lembagaId, materiId, ujianId, namaAman(nama), ext, buf.length, simpanNama, oleh || null).lastInsertRowid);
    return { id, nama: namaAman(nama), ext, ukuran: buf.length };
  }
  const info = (id) => db.prepare('SELECT * FROM berkas WHERE id = ?').get(Number(id));
  const isiBerkas = (row) => { try { return fs.readFileSync(path.join(dir, row.simpan)); } catch { return null; } };
  function hapus(id) {
    const r = info(id); if (!r) return false;
    db.prepare('DELETE FROM berkas WHERE id = ?').run(r.id);
    try { fs.unlinkSync(path.join(dir, r.simpan)); } catch { /* sudah hilang */ }
    return true;
  }
  // Header unduhan: hanya jenis non-aktif (pdf, gambar, audio, video; bukan HTML/SVG/skrip) yang dibuka di peramban; selebihnya diunduh
  function header(row) {
    const t = TIPE[row.ext], nama = encodeURIComponent(row.nama).replace(/['()]/g, escape);
    return { 'Content-Type': t.mime, 'Content-Length': row.ukuran, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `${t.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${nama}` };
  }
  // Hapus berkas di disk yang tidak lagi tercatat (mis. materinya dihapus) dan sudah lebih dari 1 jam
  function bersihkanYatim() {
    const ada = new Set(db.prepare('SELECT simpan FROM berkas').all().map((r) => r.simpan));
    let n = 0;
    for (const f of fs.readdirSync(dir)) {
      if (ada.has(f)) continue;
      const p = path.join(dir, f);
      try { if (fs.statSync(p).isFile() && Date.now() - fs.statSync(p).mtimeMs > 3600e3) { fs.unlinkSync(p); n++; } } catch { /* abaikan */ }
    }
    return n;
  }
  return { simpan, info, isiBerkas, hapus, header, bersihkanYatim, dir, TIPE, maksMb };
}

module.exports = { createBerkas, TIPE };
