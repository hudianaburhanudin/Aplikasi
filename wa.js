'use strict';
// Perintah lewat WhatsApp: absensi, pelanggaran, rekap, poin. Mesin ini tidak bergantung pada penyedia WhatsApp:
// pesan masuk dinormalkan oleh adapter webhook, balasan dikirim lewat adapter pengirim (atau hanya dikembalikan).
const crypto = require('crypto');

const ENV = (typeof process !== 'undefined' && process.env) || {};
const MAX_AGE_DAYS = 14;              // absensi/pelanggaran boleh diisi mundur sampai 14 hari
const UNDO_MENIT = 30;
const BATAS_POIN = [[50, 'perlu pemanggilan orang tua'], [100, 'perlu tindak lanjut pimpinan']];

// ---------- teks ----------
const waNorm = (v) => {
  let d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = '62' + d.slice(1); else if (d.startsWith('8')) d = '62' + d;
  return d;
};
const strip = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const clean = (s) => strip(s).replace(/['’‘`´]/g, '').replace(/[\p{Extended_Pictographic}\u200d\ufe0f*_~"“”]/gu, ' ').replace(/[\u00a0\t ]+/g, ' ');   // Ma'ruf -> maruf
const toks = (s) => clean(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
// untuk bagian awal pesan: mempertahankan "5/10", "2026-10-05", "vii-a"
const toksK = (s) => clean(s).replace(/[^a-z0-9 /.\-]/g, ' ').split(/\s+/).map((x) => x.replace(/^[.\-/]+|[.\-/]+$/g, '')).filter(Boolean);
const titleCase = (s) => String(s).replace(/\b\p{L}/gu, (c) => c.toUpperCase());

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// ---------- kelas: "7a", "VII-A", "vii a", "X IPA" dianggap sama ----------
const ROMAN = { xii: 12, xi: 11, x: 10, ix: 9, viii: 8, vii: 7, vi: 6, v: 5, iv: 4, iii: 3, ii: 2, i: 1 };
const ROMAN_RE = /^(xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)(.*)$/;
function kelasKeys(raw) {
  const parts = clean(raw).replace(/\bkelas\b/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
  if (!parts.length) return new Set();
  const conv = (t) => (ROMAN[t] ? String(ROMAN[t]) : t);
  const keys = new Set();
  if (parts.length > 1) keys.add(conv(parts[0]) + parts.slice(1).join(''));
  const joined = parts.join(''); keys.add(joined);
  const m = ROMAN_RE.exec(joined);
  if (m) {                                   // "xipa" bisa 10+ipa atau 11+pa: simpan semua kemungkinan
    for (let len = 1; len <= 4; len++) { const r = joined.slice(0, len); if (ROMAN[r]) keys.add(ROMAN[r] + joined.slice(len)); }
  }
  return keys;
}
const sameKelas = (a, b) => { const A = kelasKeys(a); for (const k of kelasKeys(b)) if (A.has(k)) return true; return false; };

// ---------- tanggal ----------
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const labelTanggal = (iso) => new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));
const BULAN = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, jun: 6, jul: 7, agu: 8, agt: 8, sep: 9, okt: 10, nov: 11, des: 12 };
function parseTanggal(tokens, today) {
  // mengembalikan {tanggal, pakai: jumlah token yang dipakai} atau null
  const t = tokens[0];
  if (!t) return null;
  if (t === 'kemarin') return { tanggal: addDays(today, -1), pakai: 1 };
  if (t === 'hari' && tokens[1] === 'ini') return { tanggal: today, pakai: 2 };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  let y, mo, d;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(t))) { d = +m[1]; mo = +m[2]; y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : +today.slice(0, 4); }
  else if (/^\d{1,2}$/.test(t) && BULAN[(tokens[1] || '').slice(0, 3)] && /^[a-z]{3,}$/.test(tokens[1])) { d = +t; mo = BULAN[tokens[1].slice(0, 3)]; y = +today.slice(0, 4); return fin(y, mo, d, 2); }
  else return null;
  return fin(y, mo, d, 1);
  function fin(Y, M, D, pakai) {
    const iso = `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
    if (Number.isNaN(Date.parse(iso)) || new Date(iso + 'T00:00:00Z').getUTCDate() !== D) return { err: `Tanggal "${iso}" tidak valid` };
    return { tanggal: iso, pakai };
  }
}

// ---------- status & jenis pelanggaran ----------
const STATUS_KATA = {
  sakit: 'S', skt: 'S', sakt: 'S',
  izin: 'I', ijin: 'I', ijn: 'I',
  alpa: 'A', alpha: 'A', alfa: 'A', bolos: 'A', mangkir: 'A', tk: 'A',
  hadir: 'H', masuk: 'H',
  terlambat: 'H', telat: 'H',
};
const STATUS_NAMA = { H: 'Hadir', S: 'Sakit', I: 'Izin', A: 'Alpa' };
const ALIAS_BAWAAN = {
  terlambat: ['terlambat', 'telat', 'kesiangan'], seragam: ['seragam', 'atribut'], rambut: ['rambut', 'gondrong'],
  tugas: ['tugas', 'pr'], gaduh: ['gaduh', 'ribut', 'mengganggu'], hp: ['hp', 'handphone', 'gawai'],
  jamaah: ['jamaah', 'jemaah'], bolos: ['bolos', 'membolos', 'cabut'], kabur: ['kabur', 'minggat'],
  berkelahi: ['berkelahi', 'berantem', 'kelahi', 'tawuran'], merokok: ['merokok', 'rokok', 'vape'], lainnya: ['lainnya', 'lain'],
};
const KATA_UMUM = new Set(['tidak', 'dengan', 'lengkap', 'sesuai', 'aturan', 'tanpa', 'dalam', 'yang', 'siswa', 'sekolah', 'pelanggaran', 'kegiatan']);
const SEMUA_HADIR = [/\bsemua (hadir|masuk)\b/, /\b(hadir|masuk) semua\b/, /\blengkap\b/, /\bnihil\b/, /\bkecuali\b/, /\bsemua\b/];

// ---------- pencocokan nama siswa ----------
function matchSiswa(query, list) {
  const qt = toks(query);
  if (!qt.length) return { none: true };
  const rows = list.map((s) => ({ s, t: toks(s.nama) }));
  const full = qt.join(' ');
  const steps = [
    (r) => r.t.join(' ') === full,
    (r) => qt.every((w) => r.t.includes(w)),
    (r) => qt.every((w) => w.length >= 2 && r.t.some((x) => x.startsWith(w))),
    (r) => qt.every((w) => w.length >= 4 && r.t.some((x) => lev(w, x) <= 1)),
  ];
  for (const f of steps) {
    const c = rows.filter(f);
    if (c.length === 1) return { siswa: c[0].s };
    if (c.length > 1) return { ambig: c.map((r) => r.s) };
  }
  const batas = Math.max(...qt.map((w) => w.length)) >= 6 ? 2 : 1;           // saran "Maksud: ..." hanya yang benar-benar mirip
  const dekat = rows.map((r) => ({ s: r.s, d: Math.min(...r.t.map((x) => Math.min(...qt.map((w) => lev(w, x))))) })).filter((x) => x.d <= batas).sort((a, b) => a.d - b.d).slice(0, 3);
  return { none: true, mirip: dekat.map((x) => x.s) };
}

// ---------- pemisahan pesan menjadi segmen ----------
function segmen(text) {
  return String(text || '').replace(/\r/g, '').split(/\n+|;|,|\s&\s|\sdan\s/i).map((x) => x.trim()).filter(Boolean);
}

function createWa(db, { todayWib, fetchImpl } = {}) {
  const doFetch = () => fetchImpl || globalThis.fetch;
  const rate = new Map();
  const tooFast = (key) => {
    const now = Date.now(); const r = rate.get(key) || { n: 0, reset: now + 60e3 };
    if (r.reset < now) { r.n = 0; r.reset = now + 60e3; }
    rate.set(key, r); if (rate.size > 2000) for (const [k, v] of rate) if (v.reset < now) rate.delete(k);
    return ++r.n > 20;
  };

  // ---- data pengguna & lingkup ----
  function loadUser(row) {
    const ids = row.role === 'yayasan' ? db.prepare('SELECT id FROM lembaga').all().map((r) => r.id)
      : db.prepare('SELECT lembaga_id id FROM user_lembaga WHERE user_id = ?').all(row.id).map((r) => r.id);
    const lembagas = ids.length ? db.prepare(`SELECT id, kode, nama FROM lembaga WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids) : [];
    return { id: row.id, nama: row.nama, role: row.role, wa: row.wa, lembagas };
  }
  const userByWa = (wa) => { const r = wa && db.prepare('SELECT * FROM users WHERE wa = ?').get(wa); return r && r.role !== 'wali' ? loadUser(r) : null; };
  const ph = (a) => a.map(() => '?').join(',');

  function kelasScope(u) {
    const ids = u.lembagas.map((l) => l.id);
    return ids.length ? db.prepare(`SELECT k.id, k.nama, k.lembaga_id, k.wali_guru_id, l.kode lembaga_kode FROM kelas k JOIN lembaga l ON l.id = k.lembaga_id
      WHERE k.lembaga_id IN (${ph(ids)}) ORDER BY l.id, k.nama`).all(...ids) : [];
  }
  function kelasDefault(u, semua) {
    if (!u.wa || !u.lembagas.length) return [];
    const lid = u.lembagas.map((l) => l.id);
    const gids = db.prepare(`SELECT id, telepon FROM guru WHERE lembaga_id IN (${ph(lid)})`).all(...lid).filter((g) => waNorm(g.telepon) === u.wa).map((g) => g.id);
    return semua.filter((k) => gids.includes(k.wali_guru_id));
  }
  const siswaKelas = (kid) => db.prepare("SELECT id, nama, nis, lembaga_id FROM siswa WHERE kelas_id = ? AND status = 'aktif' ORDER BY nama").all(kid);
  const siswaScope = (u, kelasId) => {
    const ids = u.lembagas.map((l) => l.id); if (!ids.length) return [];
    return db.prepare(`SELECT s.id, s.nama, s.nis, s.lembaga_id, s.kelas_id, k.nama kelas_nama, l.kode lembaga_kode FROM siswa s
      JOIN lembaga l ON l.id = s.lembaga_id LEFT JOIN kelas k ON k.id = s.kelas_id WHERE s.status = 'aktif' AND s.lembaga_id IN (${ph(ids)})
      ${kelasId ? 'AND s.kelas_id = ' + Number(kelasId) : ''} ORDER BY s.nama`).all(...ids);
  };
  const multi = (u) => u.lembagas.length > 1;
  const namaKelas = (u, k) => (multi(u) ? `${k.lembaga_kode} ${k.nama}` : k.nama);

  // ---- pengenalan kelas di awal pesan ----
  // Mengambil token awal yang cocok dengan nama kelas (1-3 token), dengan awalan lembaga opsional.
  function ambilKelas(tokens, u, kelasAll) {
    let t = tokens.slice(), lembaga = null;
    if (t[0] === 'kelas') t = t.slice(1);
    const kodeLembaga = (x) => u.lembagas.find((l) => strip(l.kode).replace(/[^a-z0-9]/g, '') === String(x).replace(/[^a-z0-9]/g, ''));
    const lk = kodeLembaga(t[0]);
    if (lk && t.length > 1) { lembaga = lk; t = t.slice(1); }
    for (let n = Math.min(3, t.length); n >= 1; n--) {
      const cand = t.slice(0, n).join(' ');
      const hit = kelasAll.filter((k) => (!lembaga || k.lembaga_id === lembaga.id) && sameKelas(k.nama, cand));
      if (hit.length) return { kelas: hit, sisa: t.slice(n), dipakai: true };
    }
    return { kelas: [], sisa: t, dipakai: false };
  }

  // ---- penyimpanan log ----
  const simpanLog = (m) => db.prepare('INSERT INTO wa_log (message_id, user_id, nomor, pesan, balasan, status, undo, sumber) VALUES (?,?,?,?,?,?,?,?)')
    .run(m.message_id || null, m.user_id || null, m.nomor || null, String(m.pesan || '').slice(0, 2000), String(m.balasan || '').slice(0, 4000), m.status, m.undo ? JSON.stringify(m.undo) : null, m.sumber || 'wa');

  // ================= PERINTAH =================
  const BANTUAN = `*Perintah WhatsApp*

*ABSENSI* (semua dianggap hadir, tulis hanya yang tidak masuk)
absen 7A andin sakit, budi izin, citra alpa
absen 7A semua hadir
absen 7A kemarin andin sakit demam
_Boleh juga satu baris per siswa. Alasan ditulis setelah status._

*PELANGGARAN*
langgar andin terlambat
langgar 7A budi bolos, citra hp
_Ketik JENIS untuk melihat daftar pelanggaran dan poinnya._

*LAINNYA*
rekap 7A → absensi hari ini
poin andin → total poin pelanggaran
batal → batalkan input terakhir (${UNDO_MENIT} menit)

Kalau Anda wali kelas, nama kelas boleh dilewati.`;

  function cmdAbsen(u, rest, today) {
    const kelasAll = kelasScope(u);
    let segs = segmen(rest);
    if (!segs.length) return { gagal: 'Tulis kelas dan nama siswa yang tidak masuk. Contoh:\nabsen 7A andin sakit, budi izin' };
    // segmen pertama: kelas / tanggal / "semua hadir" sebelum entri pertama
    let first = toksK(segs[0]);
    let kelas = null, tanggal = today;
    const kk = ambilKelas(first, u, kelasAll);
    if (kk.dipakai) {
      if (kk.kelas.length > 1) return { gagal: `Kelas "${kk.kelas[0].nama}" ada di beberapa lembaga: ${kk.kelas.map((k) => k.lembaga_kode).join(', ')}. Tulis dengan awalan lembaga, mis: absen ${strip(kk.kelas[0].lembaga_kode)} ${kk.kelas[0].nama.toLowerCase()} ...` };
      kelas = kk.kelas[0]; first = kk.sisa;
    }
    // tanggal & kata "semua hadir" boleh di mana saja pada segmen pertama
    for (let guard = 0; guard < 6; guard++) {
      const pd = parseTanggal(first, today);
      if (pd && pd.err) return { gagal: pd.err };
      if (pd) { tanggal = pd.tanggal; first = first.slice(pd.pakai); continue; }
      const joined = first.join(' ');
      let hit = false;
      for (const re of SEMUA_HADIR) { const m = re.exec(joined); if (m && m.index === 0) { first = toksK(joined.slice(m[0].length)); hit = true; break; } }
      if (!hit) break;
    }
    if (!kelas) {
      const def = kelasDefault(u, kelasAll);
      if (def.length === 1) kelas = def[0];
      else return { gagal: 'Kelas mana? Contoh:\nabsen 7A andin sakit, budi izin' + (kelasAll.length ? `\n\nKelas Anda: ${kelasAll.slice(0, 12).map((k) => namaKelas(u, k)).join(', ')}` : '') };
    }
    if (tanggal > today) return { gagal: 'Tanggal tidak boleh di masa depan.' };
    if (tanggal < addDays(today, -MAX_AGE_DAYS)) return { gagal: `Absensi hanya bisa diisi sampai ${MAX_AGE_DAYS} hari ke belakang. Untuk tanggal lebih lama, ubah lewat aplikasi.` };
    const murid = siswaKelas(kelas.id);
    if (!murid.length) return { gagal: `Kelas ${namaKelas(u, kelas)} belum memiliki siswa aktif.` };

    segs = [first.join(' '), ...segs.slice(1)].filter(Boolean);
    // entri
    const dipilih = new Map(), galat = [];
    let statusAktif = null, terakhir = null;
    for (const seg of segs) {
      const t = toks(seg).filter((x) => x !== 'kecuali' && x !== 'tapi' && x !== 'minus');
      const j = t.join(' ');
      if (!t.length || SEMUA_HADIR.some((re) => { const m = re.exec(j); return m && m[0] === j; })) continue;
      const k = t.findIndex((x) => STATUS_KATA[x]);
      let nama, status, ket;
      if (k === 0) {
        status = STATUS_KATA[t[0]]; statusAktif = { status, kata: t[0] };
        const sisa = t.slice(1);
        if (!sisa.length) continue;                      // "Sakit:" lalu nama di baris berikutnya
        nama = sisa.join(' '); ket = null;
      } else if (k > 0) {
        status = STATUS_KATA[t[k]]; nama = t.slice(0, k).join(' '); ket = t.slice(k + 1).join(' ') || null; statusAktif = null;
        if (['terlambat', 'telat'].includes(t[k])) ket = ('terlambat ' + (ket || '')).trim();
      } else if (statusAktif) { status = statusAktif.status; nama = t.join(' '); ket = null; }
      else {
        // potongan tanpa status yang bukan nama siswa = lanjutan alasan sebelumnya ("andin sakit, demam tinggi")
        if (terakhir && matchSiswa(j, murid).none) { terakhir.ket = [terakhir.ket, seg.trim()].filter(Boolean).join(', '); continue; }
        galat.push(`Status untuk "${titleCase(j)}" tidak jelas (sakit/izin/alpa?).`); continue;
      }
      const mm = matchSiswa(nama, murid);
      if (mm.siswa) {
        const prev = dipilih.get(mm.siswa.id);
        if (prev && prev.status !== status) galat.push(`${mm.siswa.nama} disebut dua kali dengan status berbeda.`);
        else { terakhir = { siswa: mm.siswa, status, ket }; dipilih.set(mm.siswa.id, terakhir); }
      } else if (mm.ambig) galat.push(`"${nama}" cocok dengan ${mm.ambig.length} siswa: ${mm.ambig.map((s) => s.nama).join(', ')}. Tulis nama lebih lengkap.`);
      else galat.push(`Nama "${nama}" tidak ditemukan di ${namaKelas(u, kelas)}.` + (mm.mirip && mm.mirip.length ? ` Maksud: ${mm.mirip.map((s) => s.nama).join(' / ')}?` : ''));
    }
    if (galat.length) return { gagal: galat.map((g) => '• ' + g).join('\n') + '\n\nBelum ada yang disimpan. Perbaiki lalu kirim ulang.' };

    // simpan (semua hadir kecuali yang disebut)
    const prev = db.prepare(`SELECT siswa_id, status, keterangan FROM absensi WHERE tanggal = ? AND siswa_id IN (${ph(murid)})`).all(tanggal, ...murid.map((s) => s.id));
    const prevMap = new Map(prev.map((r) => [r.siswa_id, r]));
    const up = db.prepare(`INSERT INTO absensi (siswa_id, tanggal, status, keterangan) VALUES (?,?,?,?)
      ON CONFLICT (siswa_id, tanggal) DO UPDATE SET status = excluded.status, keterangan = excluded.keterangan`);
    db.exec('BEGIN');
    try {
      for (const s of murid) { const d = dipilih.get(s.id); up.run(s.id, tanggal, d ? d.status : 'H', d ? d.ket : null); }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const undo = { type: 'absen', tanggal, rows: murid.map((s) => (prevMap.has(s.id) ? { siswa_id: s.id, status: prevMap.get(s.id).status, keterangan: prevMap.get(s.id).keterangan } : { siswa_id: s.id, hapus: true })) };
    const grup = { S: [], I: [], A: [], H: [] };
    for (const d of dipilih.values()) grup[d.status].push(d);
    const baris2 = [`✅ *Absensi ${namaKelas(u, kelas)}* • ${labelTanggal(tanggal)} tersimpan${prev.length ? ' (memperbarui data sebelumnya)' : ''}`];
    const hadir = murid.length - grup.S.length - grup.I.length - grup.A.length;
    baris2.push(grup.S.length + grup.I.length + grup.A.length === 0 ? `Semua hadir (${murid.length} siswa)` : `Hadir ${hadir} dari ${murid.length} siswa`);
    for (const k2 of ['S', 'I', 'A']) if (grup[k2].length) baris2.push(`${STATUS_NAMA[k2]} (${grup[k2].length}): ${grup[k2].map((d) => d.siswa.nama + (d.ket ? ' – ' + d.ket : '')).join('; ')}`);
    const telat = grup.H.filter((d) => d.ket); if (telat.length) baris2.push(`Terlambat: ${telat.map((d) => d.siswa.nama).join('; ')}`);
    baris2.push('', '_Salah? Kirim ulang pesan yang benar, atau balas BATAL._');
    return { balasan: baris2.join('\n'), undo };
  }

  function indeksJenis(u) {
    const ids = u.lembagas.map((l) => l.id); if (!ids.length) return { map: new Map(), rows: [] };
    const rows = db.prepare(`SELECT id, lembaga_id, kode, nama, poin FROM jenis_pelanggaran WHERE aktif = 1 AND lembaga_id IN (${ph(ids)})`).all(...ids);
    const map = new Map();                                  // alias -> kode
    for (const r of rows) {
      const turunan = ALIAS_BAWAAN[r.kode] ? [] : toks(r.nama).filter((w) => w.length >= 5 && !KATA_UMUM.has(w));   // jenis buatan admin
      const al = [r.kode, ...(ALIAS_BAWAAN[r.kode] || []), ...turunan];
      for (const a of al) if (!map.has(a)) map.set(a, r.kode);
    }
    return { map, rows };
  }

  function cmdLanggar(u, rest, today) {
    const kelasAll = kelasScope(u);
    const segs = segmen(rest);
    if (!segs.length) return { gagal: 'Tulis nama siswa dan jenis pelanggarannya. Contoh:\nlanggar andin terlambat\nKetik JENIS untuk melihat daftar.' };
    let first = toksK(segs[0]), tanggal = today, kelas = null;
    const kk = ambilKelas(first, u, kelasAll);
    if (kk.dipakai && kk.kelas.length === 1 && kk.sisa.length) { kelas = kk.kelas[0]; first = kk.sisa; }
    for (let g = 0; g < 3; g++) {                           // tanggal boleh di awal
      const pd = parseTanggal(first, today);
      if (pd && pd.err) return { gagal: pd.err };
      if (!pd) break; tanggal = pd.tanggal; first = first.slice(pd.pakai);
    }
    if (tanggal > today) return { gagal: 'Tanggal tidak boleh di masa depan.' };
    if (tanggal < addDays(today, -MAX_AGE_DAYS)) return { gagal: `Pelanggaran hanya bisa dicatat sampai ${MAX_AGE_DAYS} hari ke belakang. Untuk tanggal lebih lama, ubah lewat aplikasi.` };
    const { map, rows: jenisRows } = indeksJenis(u);
    const murid = siswaScope(u, kelas && kelas.id);
    const entri = [], galat = [];
    let jenisAktif = null;
    const semuaSeg = [first.join(' '), ...segs.slice(1)].filter(Boolean);
    for (const seg of semuaSeg) {
      let t = toksK(seg).map((x) => x.replace(/[./-]+/g, ' ')).join(' ').split(' ').filter(Boolean);
      const kl = ambilKelas(toksK(seg), u, kelasAll);                // kelas boleh di awal tiap entri
      let muridSeg = murid;
      if (kl.dipakai && kl.kelas.length === 1 && kl.sisa.length) { muridSeg = siswaScope(u, kl.kelas[0].id); t = kl.sisa; }
      const k = t.findIndex((x) => map.has(x));
      let nama, kode, catatan;
      if (k === 0) {
        kode = map.get(t[0]); jenisAktif = kode; const sisa = t.slice(1);
        if (!sisa.length) continue; nama = sisa.join(' '); catatan = null;
      } else if (k > 0) { kode = map.get(t[k]); nama = t.slice(0, k).join(' '); catatan = t.slice(k + 1).join(' ') || null; jenisAktif = null; }
      else if (jenisAktif) { kode = jenisAktif; nama = t.join(' '); catatan = null; }
      else { galat.push(`Jenis pelanggaran untuk "${titleCase(t.join(' '))}" tidak dikenali. Ketik JENIS untuk melihat daftar.`); continue; }
      const mm = matchSiswa(nama, muridSeg);
      if (mm.siswa) entri.push({ siswa: mm.siswa, kode, catatan });
      else if (mm.ambig) galat.push(`"${nama}" cocok dengan ${mm.ambig.length} siswa: ${mm.ambig.slice(0, 5).map((s) => `${s.nama} (${s.lembaga_kode} ${s.kelas_nama || '-'})`).join(', ')}. Tambahkan kelas, mis: langgar 7A ${nama} ${kode}`);
      else galat.push(`Siswa "${nama}" tidak ditemukan.` + (mm.mirip && mm.mirip.length ? ` Maksud: ${mm.mirip.map((s) => s.nama).join(' / ')}?` : ''));
    }
    if (galat.length) return { gagal: galat.map((g) => '• ' + g).join('\n') + '\n\nBelum ada yang disimpan. Perbaiki lalu kirim ulang.' };
    if (!entri.length) return { gagal: 'Tidak ada pelanggaran yang bisa dibaca. Contoh:\nlanggar andin terlambat' };
    const jenisDi = (lembagaId, kode) => jenisRows.find((j) => j.lembaga_id === lembagaId && j.kode === kode);
    for (const e of entri) { e.jenis = jenisDi(e.siswa.lembaga_id, e.kode); if (!e.jenis) galat.push(`Jenis "${e.kode}" tidak tersedia di lembaga ${e.siswa.nama}.`); }
    if (galat.length) return { gagal: galat.map((g) => '• ' + g).join('\n') };

    const total = db.prepare('SELECT COALESCE(SUM(poin), 0) n FROM pelanggaran WHERE siswa_id = ?');
    const ins = db.prepare("INSERT INTO pelanggaran (siswa_id, jenis_id, jenis_nama, poin, tanggal, keterangan, dicatat_oleh, sumber) VALUES (?,?,?,?,?,?,?, 'wa')");
    const ids = [], baris = [`⚠️ *Pelanggaran tercatat* • ${labelTanggal(tanggal)}`];
    db.exec('BEGIN');
    try {
      entri.forEach((e, i) => {
        const sebelum = total.get(e.siswa.id).n;
        ids.push(Number(ins.run(e.siswa.id, e.jenis.id, e.jenis.nama, e.jenis.poin, tanggal, e.catatan, u.nama).lastInsertRowid));
        const sesudah = sebelum + e.jenis.poin;
        const lewat = BATAS_POIN.filter(([b]) => sebelum < b && sesudah >= b).map(([b, t]) => `${b} poin: ${t}`);
        baris.push(`${i + 1}. ${e.siswa.nama} (${e.siswa.kelas_nama ? (multi(u) ? e.siswa.lembaga_kode + ' ' : '') + e.siswa.kelas_nama : e.siswa.lembaga_kode}) – ${e.jenis.nama} (+${e.jenis.poin})${e.catatan ? ' – ' + e.catatan : ''} → total ${sesudah} poin${lewat.length ? '\n   🔔 Mencapai ' + lewat.join('; ') : ''}`);
      });
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    baris.push('', '_Salah? Balas BATAL._');
    return { balasan: baris.join('\n'), undo: { type: 'pelanggaran', ids } };
  }

  function cmdRekap(u, rest, today) {
    const kelasAll = kelasScope(u);
    let t = toks(rest), tanggal = today;
    const pd = parseTanggal(t, today); if (pd && !pd.err) { tanggal = pd.tanggal; t = t.slice(pd.pakai); }
    const kk = t.length ? ambilKelas(t, u, kelasAll) : { kelas: [], dipakai: false };
    let kelas = kk.dipakai && kk.kelas.length === 1 ? kk.kelas[0] : null;
    if (kk.dipakai && kk.kelas.length > 1) return { gagal: `Kelas itu ada di beberapa lembaga (${kk.kelas.map((k) => k.lembaga_kode).join(', ')}). Tambahkan awalan lembaga.` };
    if (!kelas && !t.length) { const def = kelasDefault(u, kelasAll); if (def.length === 1) kelas = def[0]; }
    if (!kelas) {
      if (!kelasAll.length) return { gagal: 'Tidak ada kelas pada lembaga Anda.' };
      const baris = [`📋 *Status absensi* • ${labelTanggal(tanggal)}`];
      for (const k of kelasAll.slice(0, 40)) {
        const r = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(a.status = 'H'), 0) h FROM siswa s LEFT JOIN absensi a ON a.siswa_id = s.id AND a.tanggal = ? WHERE s.kelas_id = ? AND s.status = 'aktif' AND a.id IS NOT NULL`).get(tanggal, k.id);
        const n = db.prepare("SELECT COUNT(*) n FROM siswa WHERE kelas_id = ? AND status = 'aktif'").get(k.id).n;
        baris.push(r.n ? `✅ ${namaKelas(u, k)}: hadir ${r.h}/${n}` : `⏳ ${namaKelas(u, k)}: belum diisi`);
      }
      return { balasan: baris.join('\n') };
    }
    const r = db.prepare(`SELECT s.nama, a.status, a.keterangan FROM siswa s LEFT JOIN absensi a ON a.siswa_id = s.id AND a.tanggal = ? WHERE s.kelas_id = ? AND s.status = 'aktif' ORDER BY s.nama`).all(tanggal, kelas.id);
    if (!r.length) return { gagal: `Kelas ${namaKelas(u, kelas)} belum memiliki siswa aktif.` };
    if (r.every((x) => !x.status)) return { balasan: `⏳ Absensi ${namaKelas(u, kelas)} • ${labelTanggal(tanggal)} belum diisi.` };
    const g = { H: 0, S: [], I: [], A: [], K: [] };
    for (const x of r) { if (!x.status) g.K.push(x.nama); else if (x.status === 'H') g.H++; else g[x.status].push(x.nama + (x.keterangan ? ` (${x.keterangan})` : '')); }
    const b = [`📋 *Absensi ${namaKelas(u, kelas)}* • ${labelTanggal(tanggal)}`, `Hadir ${g.H} dari ${r.length}`];
    for (const k of ['S', 'I', 'A']) if (g[k].length) b.push(`${STATUS_NAMA[k]} (${g[k].length}): ${g[k].join('; ')}`);
    if (g.K.length) b.push(`Belum tercatat: ${g.K.join('; ')}`);
    return { balasan: b.join('\n') };
  }

  function cmdPoin(u, rest) {
    const nama = rest.trim();
    if (!nama) return { gagal: 'Tulis nama siswa. Contoh: poin andin' };
    const t = toks(nama); const kelasAll = kelasScope(u);
    const kk = ambilKelas(t, u, kelasAll);
    const kelas = kk.dipakai && kk.kelas.length === 1 && kk.sisa.length ? kk.kelas[0] : null;
    const mm = matchSiswa(kelas ? kk.sisa.join(' ') : nama, siswaScope(u, kelas && kelas.id));
    if (mm.ambig) return { gagal: `"${nama}" cocok dengan ${mm.ambig.length} siswa: ${mm.ambig.slice(0, 6).map((s) => `${s.nama} (${s.lembaga_kode} ${s.kelas_nama || '-'})`).join(', ')}. Tambahkan kelas, mis: poin 7A ${nama}` };
    if (!mm.siswa) return { gagal: `Siswa "${nama}" tidak ditemukan.` + (mm.mirip && mm.mirip.length ? ` Maksud: ${mm.mirip.map((s) => s.nama).join(' / ')}?` : '') };
    const s = mm.siswa;
    const tot = db.prepare('SELECT COALESCE(SUM(poin), 0) n, COUNT(*) c FROM pelanggaran WHERE siswa_id = ?').get(s.id);
    const last = db.prepare('SELECT tanggal, jenis_nama, poin, keterangan FROM pelanggaran WHERE siswa_id = ? ORDER BY tanggal DESC, id DESC LIMIT 5').all(s.id);
    if (!tot.c) return { balasan: `*${s.nama}* (${s.kelas_nama || '-'})\nBelum ada catatan pelanggaran. 👍` };
    return { balasan: [`*${s.nama}* (${s.kelas_nama || '-'})`, `Total ${tot.n} poin dari ${tot.c} pelanggaran`, ...last.map((x) => `• ${x.tanggal} ${x.jenis_nama} (+${x.poin})${x.keterangan ? ' – ' + x.keterangan : ''}`)].join('\n') };
  }

  function cmdJenis(u) {
    const { rows } = indeksJenis(u);
    if (!rows.length) return { balasan: 'Belum ada jenis pelanggaran. Admin dapat menambahkannya di aplikasi.' };
    const per = new Map();
    for (const r of rows) { if (!per.has(r.lembaga_id)) per.set(r.lembaga_id, []); per.get(r.lembaga_id).push(r); }
    const b = ['*Jenis pelanggaran* (tulis kata kuncinya)'];
    for (const [lid, arr] of per) {
      if (per.size > 1) b.push('', `_${u.lembagas.find((l) => l.id === lid).kode}_`);
      for (const r of arr) b.push(`• ${(ALIAS_BAWAAN[r.kode] || [r.kode])[0]} – ${r.nama} (${r.poin})`);
    }
    return { balasan: b.join('\n') };
  }

  function cmdBatal(u) {
    const r = db.prepare(`SELECT * FROM wa_log WHERE user_id = ? AND undo IS NOT NULL AND dibuat >= datetime('now', ?) ORDER BY id DESC LIMIT 1`).get(u.id, `-${UNDO_MENIT} minutes`);
    if (!r) return { gagal: `Tidak ada input yang bisa dibatalkan (batas ${UNDO_MENIT} menit).` };
    const undo = JSON.parse(r.undo);
    db.exec('BEGIN');
    try {
      if (undo.type === 'absen') {
        const up = db.prepare(`INSERT INTO absensi (siswa_id, tanggal, status, keterangan) VALUES (?,?,?,?) ON CONFLICT (siswa_id, tanggal) DO UPDATE SET status = excluded.status, keterangan = excluded.keterangan`);
        const del = db.prepare('DELETE FROM absensi WHERE siswa_id = ? AND tanggal = ?');
        for (const x of undo.rows) { if (x.hapus) del.run(x.siswa_id, undo.tanggal); else up.run(x.siswa_id, undo.tanggal, x.status, x.keterangan); }
      } else if (undo.type === 'pelanggaran') {
        const del = db.prepare('DELETE FROM pelanggaran WHERE id = ?');
        for (const id of undo.ids) del.run(id);
      }
      db.prepare("UPDATE wa_log SET undo = NULL, status = 'dibatalkan' WHERE id = ?").run(r.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { balasan: undo.type === 'absen' ? `↩️ Absensi ${labelTanggal(undo.tanggal)} dikembalikan seperti sebelumnya.` : `↩️ ${undo.ids.length} catatan pelanggaran dibatalkan.` };
  }

  // ---- pintu masuk: satu pesan dari satu pengguna terdaftar ----
  function proses(u, text) {
    const today = todayWib();
    const raw = String(text || '').replace(/\r/g, '').trim();
    const m = /^\s*([^\s:]+)\s*:?\s*([\s\S]*)$/.exec(raw);
    const kata = m ? (toks(m[1])[0] || '') : '';
    const rest = m ? m[2] : '';
    const salam = () => ({ balasan: `Halo ${u.nama} 👋\nKetik *BANTUAN* untuk melihat perintah.` });
    const cmd = {
      absen: () => cmdAbsen(u, rest, today), absensi: () => cmdAbsen(u, rest, today),
      langgar: () => cmdLanggar(u, rest, today), pelanggaran: () => cmdLanggar(u, rest, today),
      melanggar: () => cmdLanggar(u, rest, today), langgaran: () => cmdLanggar(u, rest, today),
      rekap: () => cmdRekap(u, rest, today), cek: () => cmdRekap(u, rest, today),
      poin: () => cmdPoin(u, rest), jenis: () => cmdJenis(u),
      batal: () => cmdBatal(u), undo: () => cmdBatal(u),
      bantuan: () => ({ balasan: BANTUAN }), help: () => ({ balasan: BANTUAN }), menu: () => ({ balasan: BANTUAN }),
      halo: salam, hai: salam, p: salam,
      assalamualaikum: () => ({ balasan: `Wa'alaikumussalam ${u.nama} 👋\nKetik *BANTUAN* untuk melihat perintah.` }),
    }[kata];
    if (!cmd) return { balasan: '❌ Perintah tidak dikenali. Ketik *BANTUAN* untuk melihat contoh.', status: 'tidak_dikenal' };
    if (!['yayasan', 'admin', 'staf', 'guru'].includes(u.role)) return { balasan: '❌ Akun ini tidak memiliki izin.', status: 'gagal' };
    try {
      const r = cmd();
      if (r.gagal) return { balasan: '❌ ' + r.gagal, status: 'gagal' };
      return { balasan: r.balasan, undo: r.undo, status: 'ok' };
    } catch (e) {
      console.error('wa error', e);
      return { balasan: '❌ Terjadi kesalahan di server. Coba lagi sebentar.', status: 'error' };
    }
  }

  // Menerima satu pesan (dari webhook atau simulator). Mengembalikan balasan; pengiriman dilakukan pemanggil.
  function terima({ id, dari, teks, sumber = 'wa', userId = null }) {
    if (id && db.prepare('SELECT 1 FROM wa_log WHERE message_id = ?').get(id)) return { duplikat: true };
    const row = userId ? db.prepare('SELECT * FROM users WHERE id = ?').get(userId) : (dari ? db.prepare('SELECT * FROM users WHERE wa = ?').get(dari) : null);
    const u = row && row.role !== 'wali' ? loadUser(row) : null;
    if (!u) {
      const diam = tooFast('x:' + dari) || db.prepare("SELECT COUNT(*) n FROM wa_log WHERE nomor = ? AND status = 'tidak_terdaftar' AND dibuat >= datetime('now','-1 hour')").get(dari).n >= 3;
      const balasan = 'Nomor ini belum terdaftar. Hubungi admin sekolah agar nomor WhatsApp Anda didaftarkan.';
      simpanLog({ message_id: id, nomor: dari, pesan: teks, balasan: diam ? '(tidak dibalas)' : balasan, status: 'tidak_terdaftar', sumber });
      return { balasan: diam ? null : balasan, status: 'tidak_terdaftar' };
    }
    if (tooFast('u:' + u.id)) { simpanLog({ message_id: id, user_id: u.id, nomor: dari, pesan: teks, balasan: '(dibatasi)', status: 'dibatasi', sumber }); return { balasan: null, status: 'dibatasi' }; }
    const r = proses(u, teks);
    simpanLog({ message_id: id, user_id: u.id, nomor: dari || u.wa, pesan: teks, balasan: r.balasan, status: r.status, undo: r.undo, sumber });
    return { balasan: r.balasan, status: r.status, user: u };
  }

  // ================= PENYEDIA WHATSAPP =================
  const provider = () => String(ENV.WA_PROVIDER || 'none').toLowerCase();
  const sama = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

  async function kirim(ke, teks) {
    const p = provider(), f = doFetch();
    if (p === 'none' || !ke || !teks || !f) return false;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), 10000);
    try {
      let r;
      if (p === 'meta') {
        r = await f(`https://graph.facebook.com/v21.0/${ENV.WA_PHONE_NUMBER_ID}/messages`, { method: 'POST', signal: ctl && ctl.signal,
          headers: { Authorization: `Bearer ${ENV.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: ke, type: 'text', text: { preview_url: false, body: teks } }) });
      } else if (p === 'fonnte') {
        r = await f('https://api.fonnte.com/send', { method: 'POST', signal: ctl && ctl.signal, headers: { Authorization: ENV.FONNTE_TOKEN, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ target: ke, message: teks }).toString() });
      } else if (p === 'waha') {
        r = await f(`${String(ENV.WAHA_URL || '').replace(/\/$/, '')}/api/sendText`, { method: 'POST', signal: ctl && ctl.signal,
          headers: { 'Content-Type': 'application/json', ...(ENV.WAHA_API_KEY ? { 'X-Api-Key': ENV.WAHA_API_KEY } : {}) },
          body: JSON.stringify({ session: ENV.WAHA_SESSION || 'default', chatId: `${ke}@c.us`, text: teks }) });
      } else return false;
      if (!r.ok) console.error('WA kirim gagal', p, r.status);
      return r.ok;
    } catch (e) { console.error('WA kirim error', p, e.message); return false; } finally { if (timer) clearTimeout(timer); }
  }

  // Webhook publik. req: {method, query, headers, raw(Buffer)}. Mengembalikan {status, text|json}.
  async function webhook(req) {
    const p = provider();
    if (p === 'none') return { status: 404, json: { error: 'WhatsApp belum dikonfigurasi (WA_PROVIDER)' } };
    const h = (k) => req.headers[k] || req.headers[k.toLowerCase()];
    let pesan = [];
    if (p === 'meta') {
      if (req.method === 'GET') {
        if (req.query['hub.mode'] === 'subscribe' && ENV.WA_VERIFY_TOKEN && sama(req.query['hub.verify_token'] || '', ENV.WA_VERIFY_TOKEN)) return { status: 200, text: String(req.query['hub.challenge'] || '') };
        return { status: 403, json: { error: 'Token verifikasi salah' } };
      }
      if (!ENV.WA_APP_SECRET) return { status: 503, json: { error: 'WA_APP_SECRET belum diatur' } };
      const sig = String(h('x-hub-signature-256') || '');
      const exp = 'sha256=' + crypto.createHmac('sha256', ENV.WA_APP_SECRET).update(req.raw).digest('hex');
      if (!sig || !sama(sig, exp)) return { status: 401, json: { error: 'Tanda tangan tidak valid' } };
      let body; try { body = JSON.parse(req.raw.toString() || '{}'); } catch { return { status: 400, json: { error: 'JSON tidak valid' } }; }
      for (const en of body.entry || []) for (const ch of en.changes || []) for (const m of (ch.value && ch.value.messages) || []) {
        pesan.push({ id: m.id, dari: waNorm(m.from), teks: m.type === 'text' ? m.text && m.text.body : null, ts: Number(m.timestamp) || null });
      }
    } else {
      if (!ENV.WA_WEBHOOK_TOKEN) return { status: 503, json: { error: 'WA_WEBHOOK_TOKEN belum diatur' } };
      if (!sama(req.query.token || h('x-webhook-token') || '', ENV.WA_WEBHOOK_TOKEN)) return { status: 401, json: { error: 'Token webhook salah' } };
      let body = {};
      const ct = String(h('content-type') || '');
      try { body = ct.includes('json') ? JSON.parse(req.raw.toString() || '{}') : Object.fromEntries(new URLSearchParams(req.raw.toString())); } catch { return { status: 400, json: { error: 'Body tidak valid' } }; }
      if (p === 'fonnte') {
        pesan.push({ id: body.id || body.inboxid || null, dari: waNorm(body.sender), teks: body.message || body.text || null, ts: null });
      } else if (p === 'waha') {
        const pl = body.payload || {};
        if (body.event && body.event !== 'message') return { status: 200, json: { ok: true, abaikan: body.event } };
        if (pl.fromMe) return { status: 200, json: { ok: true, abaikan: 'fromMe' } };
        if (String(pl.from || '').endsWith('@g.us')) return { status: 200, json: { ok: true, abaikan: 'grup' } };
        pesan.push({ id: pl.id || null, dari: waNorm(pl.from), teks: pl.body || null, ts: Number(pl.timestamp) || null });
      }
    }
    const hasil = [];
    for (const m of pesan) {
      if (!m.dari) continue;
      if (m.ts && Math.abs(Date.now() / 1000 - m.ts) > 3600) { hasil.push({ id: m.id, status: 'kedaluwarsa' }); continue; }   // abaikan antrean lama
      let r;
      if (m.teks == null) r = (() => { const t = 'Saya hanya mengerti pesan teks. Ketik *BANTUAN* untuk contoh perintah.'; return userByWa(m.dari) ? { balasan: t, status: 'bukan_teks' } : { balasan: null, status: 'tidak_terdaftar' }; })();
      else r = terima({ id: m.id, dari: m.dari, teks: m.teks });
      if (r.balasan && !r.duplikat) await kirim(m.dari, r.balasan);
      hasil.push({ id: m.id, status: r.duplikat ? 'duplikat' : r.status });
    }
    return { status: 200, json: { ok: true, hasil } };
  }

  return { terima, proses, webhook, kirim, provider, userByWa, BANTUAN };
}

module.exports = { createWa, waNorm, matchSiswa, kelasKeys, sameKelas, parseTanggal, segmen, toks };
