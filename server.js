const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openDb, hashPassword, verifyPassword, seedJenis } = require('./db');
const { createWa, waNorm } = require('./wa');
const { backupNow, backupTerakhir } = require('./backup-lib');
const { buildXlsx } = require('./xlsx');
const { tablePdf, raporPdf, kuitansiPdf } = require('./pdf');

const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
// Logo per lembaga ada di public/logo/<kode>.png (web) dan public/logo/pdf/<kode>.jpg (kop PDF).
// Bila file lembaga belum ada, dipakai logo cadangan: madin-* -> madin -> yayasan -> ponpes.
const LOGO_DIR = path.join(__dirname, 'public', 'logo');
const logoChain = (kode) => { const k = String(kode || 'yayasan').toLowerCase(); return [k, k.startsWith('madin') ? 'madin' : null, 'yayasan', 'ponpes'].filter(Boolean); };
function logoFile(kode, ext) {
  for (const k of logoChain(kode)) {
    const f = path.join(LOGO_DIR, ext === 'jpg' ? 'pdf' : '', `${k}.${ext}`);
    try { if (fs.existsSync(f)) return f; } catch { /* abaikan */ }
  }
  return null;
}
function logoJpeg(kode) { const f = logoFile(kode, 'jpg'); try { return f ? fs.readFileSync(f) : null; } catch { return null; } }
const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

// Tagihan dianggap terbayar dari pembayaran dengan siswa, jenis, dan periode yang sama.
const TERBAYAR = `COALESCE((SELECT SUM(p.jumlah) FROM pembayaran p WHERE p.siswa_id = t.siswa_id AND p.jenis = t.jenis AND p.bulan IS t.periode), 0)`;
const TSISA = `MAX(t.jumlah - ${TERBAYAR}, 0)`;
const TSTATUS = `CASE WHEN ${TERBAYAR} >= t.jumlah THEN 'lunas' WHEN ${TERBAYAR} > 0 THEN 'sebagian' ELSE 'belum' END`;

// Konfigurasi tiap resource CRUD.
//  a: alias tabel utama pada `sel`; scopeCol/scopeKey: kolom & properti baris penentu lembaga;
//  own: baris baru otomatis diberi lembaga aktif; writeRole: peran yang boleh menulis.
const LJ = 'LEFT JOIN lembaga l ON l.id = ';
const RES = {
  lembaga: {
    a: 'l', table: 'lembaga', cols: ['kode', 'nama', 'jenjang', 'alamat', 'telepon', 'ppdb_buka'], req: ['kode', 'nama'],
    sel: 'SELECT l.* FROM lembaga l', search: ['l.nama', 'l.kode'], filters: {}, order: 'l.id',
    scopeCol: 'l.id', scopeKey: 'id', writeRole: 'yayasan',
  },
  tahun_ajaran: {
    a: 't', table: 'tahun_ajaran', cols: ['nama', 'mulai', 'selesai', 'aktif'], req: ['nama'],
    sel: 'SELECT t.* FROM tahun_ajaran t', search: ['t.nama'], filters: {}, order: 't.nama DESC', writeRole: 'yayasan',
  },
  kelas: {
    a: 'k', table: 'kelas', cols: ['nama', 'tahun_ajaran', 'wali_guru_id'], req: ['nama'], own: true,
    sel: `SELECT k.*, l.kode lembaga_kode, g.nama wali_nama,
            (SELECT COUNT(*) FROM siswa s WHERE s.kelas_id = k.id AND s.status = 'aktif') jumlah
          FROM kelas k ${LJ}k.lembaga_id LEFT JOIN guru g ON g.id = k.wali_guru_id`,
    search: ['k.nama'], filters: { tahun_ajaran: 'k.tahun_ajaran' }, order: 'l.id, k.nama', scopeCol: 'k.lembaga_id', scopeKey: 'lembaga_id',
  },
  guru: {
    a: 'g', table: 'guru', cols: ['nip', 'nama', 'jk', 'mapel', 'telepon', 'alamat'], req: ['nama'], own: true, enums: { jk: ['L', 'P'] },
    sel: `SELECT g.*, l.kode lembaga_kode FROM guru g ${LJ}g.lembaga_id`,
    search: ['g.nama', 'g.nip', 'g.mapel'], filters: {}, order: 'l.id, g.nama', scopeCol: 'g.lembaga_id', scopeKey: 'lembaga_id',
  },
  siswa: {
    a: 's', table: 'siswa', own: true,
    cols: ['nis', 'nama', 'jk', 'tempat_lahir', 'tgl_lahir', 'nik', 'kelas_id', 'wali', 'telepon', 'alamat', 'status', 'tahun_masuk', 'tahun_lulus'], req: ['nama'],
    enums: { jk: ['L', 'P'], status: ['aktif', 'lulus', 'pindah', 'keluar'] },
    sel: `SELECT s.*, l.kode lembaga_kode, k.nama kelas_nama FROM siswa s ${LJ}s.lembaga_id LEFT JOIN kelas k ON k.id = s.kelas_id`,
    search: ['s.nama', 's.nis'], filters: { kelas_id: 's.kelas_id', status: 's.status' }, order: 'l.id, s.nama',
    scopeCol: 's.lembaga_id', scopeKey: 'lembaga_id',
  },
  tagihan: {
    a: 't', table: 'tagihan', cols: ['siswa_id', 'jenis', 'periode', 'jumlah', 'jatuh_tempo', 'keterangan'], req: ['siswa_id', 'jumlah'],
    sel: `SELECT t.*, s.lembaga_id, l.kode lembaga_kode, s.nama siswa_nama, s.nis, k.nama kelas_nama,
            ${TERBAYAR} terbayar, ${TSISA} sisa, ${TSTATUS} status
          FROM tagihan t JOIN siswa s ON s.id = t.siswa_id ${LJ}s.lembaga_id LEFT JOIN kelas k ON k.id = s.kelas_id`,
    search: ['s.nama', 's.nis'],
    filters: { siswa_id: 't.siswa_id', kelas_id: 's.kelas_id', periode: 't.periode', status: `(${TSTATUS})` },
    order: 't.jatuh_tempo, t.id', scopeCol: 's.lembaga_id', scopeKey: 'lembaga_id',
  },
  pengumuman: {
    a: 'a', table: 'pengumuman', cols: ['judul', 'isi'], req: ['judul', 'isi'], own: true,
    sel: `SELECT a.*, l.kode lembaga_kode FROM pengumuman a ${LJ}a.lembaga_id`,
    search: ['a.judul', 'a.isi'], filters: {}, order: 'a.id DESC', scopeCol: 'a.lembaga_id', scopeKey: 'lembaga_id',
  },
  pelanggaran: {
    a: 'v', table: 'pelanggaran', cols: ['siswa_id', 'jenis_id', 'tanggal', 'keterangan'], req: ['siswa_id', 'jenis_id', 'tanggal'],
    sel: `SELECT v.*, s.lembaga_id, l.kode lembaga_kode, s.nama siswa_nama, s.nis, k.nama kelas_nama FROM pelanggaran v
          JOIN siswa s ON s.id = v.siswa_id ${LJ}s.lembaga_id LEFT JOIN kelas k ON k.id = s.kelas_id`,
    search: ['s.nama', 'v.jenis_nama', 'v.keterangan'], filters: { siswa_id: 'v.siswa_id', kelas_id: 's.kelas_id', jenis_id: 'v.jenis_id' },
    order: 'v.tanggal DESC, v.id DESC', scopeCol: 's.lembaga_id', scopeKey: 'lembaga_id',
  },
  jenis_pelanggaran: {
    a: 'j', table: 'jenis_pelanggaran', cols: ['kode', 'nama', 'poin', 'aktif'], req: ['kode', 'nama'], own: true,
    sel: `SELECT j.*, l.kode lembaga_kode FROM jenis_pelanggaran j ${LJ}j.lembaga_id`,
    search: ['j.nama', 'j.kode'], filters: {}, order: 'l.id, j.poin, j.nama', scopeCol: 'j.lembaga_id', scopeKey: 'lembaga_id',
  },
  pendaftar: {
    a: 'd', table: 'pendaftar', own: true,
    cols: ['nama', 'jk', 'tempat_lahir', 'tgl_lahir', 'nik', 'alamat', 'nama_ayah', 'nama_ibu', 'telepon', 'asal_sekolah', 'status', 'catatan'], req: ['nama'],
    enums: { jk: ['L', 'P'], status: ['baru', 'terverifikasi', 'diterima', 'cadangan', 'ditolak'] },
    sel: `SELECT d.*, l.kode lembaga_kode FROM pendaftar d ${LJ}d.lembaga_id`,
    search: ['d.nama', 'd.no_daftar', 'd.telepon'], filters: { status: 'd.status', tahun_ajaran: 'd.tahun_ajaran' },
    order: 'd.id DESC', scopeCol: 'd.lembaga_id', scopeKey: 'lembaga_id',
  },
  nilai: {
    a: 'n', table: 'nilai', cols: ['siswa_id', 'mapel', 'jenis', 'nilai', 'semester', 'tanggal'], req: ['siswa_id', 'mapel', 'nilai'],
    sel: `SELECT n.*, s.lembaga_id, l.kode lembaga_kode, s.nama siswa_nama, s.nis, k.nama kelas_nama FROM nilai n
          JOIN siswa s ON s.id = n.siswa_id ${LJ}s.lembaga_id LEFT JOIN kelas k ON k.id = s.kelas_id`,
    search: ['s.nama', 'n.mapel'], filters: { siswa_id: 'n.siswa_id', kelas_id: 's.kelas_id', semester: 'n.semester' },
    order: 'n.tanggal DESC, n.id DESC', scopeCol: 's.lembaga_id', scopeKey: 'lembaga_id',
  },
  pembayaran: {
    a: 'p', table: 'pembayaran', cols: ['siswa_id', 'jenis', 'bulan', 'jumlah', 'tanggal', 'keterangan'], req: ['siswa_id', 'jumlah', 'tanggal'],
    sel: `SELECT p.*, s.lembaga_id, l.kode lembaga_kode, l.nama lembaga_nama, s.nama siswa_nama, s.nis, k.nama kelas_nama FROM pembayaran p
          JOIN siswa s ON s.id = p.siswa_id ${LJ}s.lembaga_id LEFT JOIN kelas k ON k.id = s.kelas_id`,
    search: ['s.nama', 's.nis'], filters: { siswa_id: 'p.siswa_id', kelas_id: 's.kelas_id', bulan: 'p.bulan' },
    order: 'p.tanggal DESC, p.id DESC', scopeCol: 's.lembaga_id', scopeKey: 'lembaga_id',
  },
};

// Kolom ekspor Excel/PDF: [judul, kunci]
const EXPORTS = {
  siswa: ['Data Siswa', [['Lembaga', 'lembaga_kode'], ['NIS', 'nis'], ['Nama', 'nama'], ['L/P', 'jk'], ['Tanggal Lahir', 'tgl_lahir'], ['Kelas', 'kelas_nama'], ['Wali', 'wali'], ['Telepon', 'telepon'], ['Alamat', 'alamat'], ['Status', 'status']]],
  guru: ['Data Guru', [['Lembaga', 'lembaga_kode'], ['NIP', 'nip'], ['Nama', 'nama'], ['L/P', 'jk'], ['Mata Pelajaran', 'mapel'], ['Telepon', 'telepon'], ['Alamat', 'alamat']]],
  kelas: ['Data Kelas', [['Lembaga', 'lembaga_kode'], ['Kelas', 'nama'], ['Tahun Ajaran', 'tahun_ajaran'], ['Wali Kelas', 'wali_nama'], ['Jumlah Siswa', 'jumlah']]],
  nilai: ['Nilai Siswa', [['Lembaga', 'lembaga_kode'], ['Tanggal', 'tanggal'], ['NIS', 'nis'], ['Siswa', 'siswa_nama'], ['Kelas', 'kelas_nama'], ['Mapel', 'mapel'], ['Jenis', 'jenis'], ['Nilai', 'nilai'], ['Semester', 'semester']]],
  pembayaran: ['Pembayaran', [['Lembaga', 'lembaga_kode'], ['Tanggal', 'tanggal'], ['NIS', 'nis'], ['Siswa', 'siswa_nama'], ['Kelas', 'kelas_nama'], ['Jenis', 'jenis'], ['Periode', 'bulan'], ['Jumlah (Rp)', 'jumlah'], ['Keterangan', 'keterangan']]],
  tagihan: ['Tagihan', [['Lembaga', 'lembaga_kode'], ['NIS', 'nis'], ['Siswa', 'siswa_nama'], ['Kelas', 'kelas_nama'], ['Jenis', 'jenis'], ['Periode', 'periode'], ['Jatuh Tempo', 'jatuh_tempo'], ['Jumlah (Rp)', 'jumlah'], ['Terbayar (Rp)', 'terbayar'], ['Sisa (Rp)', 'sisa'], ['Status', 'status']]],
  pelanggaran: ['Pelanggaran Siswa', [['Lembaga', 'lembaga_kode'], ['Tanggal', 'tanggal'], ['NIS', 'nis'], ['Siswa', 'siswa_nama'], ['Kelas', 'kelas_nama'], ['Pelanggaran', 'jenis_nama'], ['Poin', 'poin'], ['Keterangan', 'keterangan'], ['Dicatat oleh', 'dicatat_oleh'], ['Sumber', 'sumber']]],
  pendaftar: ['Data Pendaftar', [['Lembaga', 'lembaga_kode'], ['No. Daftar', 'no_daftar'], ['Nama', 'nama'], ['L/P', 'jk'], ['Tgl Lahir', 'tgl_lahir'], ['Asal Sekolah', 'asal_sekolah'], ['Telepon', 'telepon'], ['Status', 'status']]],
  'rekap-absensi': ['Rekap Absensi', [['NIS', 'nis'], ['Nama', 'nama'], ['Hadir', 'h'], ['Sakit', 's'], ['Izin', 'i'], ['Alpa', 'a']]],
};
const NUMERIC = new Set(['nilai', 'jumlah', 'aktif', 'ppdb_buka', 'poin']);
const KENAIKAN = ['naik', 'lulus', 'pindah', 'keluar'];
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const str = (v, max) => String(v ?? '').trim().slice(0, max) || null;
const ABSEN = new Set(['H', 'S', 'I', 'A']);
const ROLES = ['yayasan', 'admin', 'staf', 'guru']; // 'wali' dikelola lewat /api/wali-akun
// Guru hanya boleh: absensi dan pelanggaran (tulis), serta melihat kelas/siswa/jenis pelanggaran.
const GURU_API = new Set(['me', 'logout', 'password', 'absensi', 'rekap-absensi', 'kelas', 'siswa', 'pelanggaran', 'jenis_pelanggaran']);
const GURU_BACA_SAJA = new Set(['kelas', 'siswa', 'jenis_pelanggaran']);
const MIN_PW = 8;
const PERMINTAAN_JENIS = { salinan: 'Salinan data anak', koreksi: 'Koreksi data anak', hapus_data: 'Penghapusan data anak', hapus_akun: 'Penghapusan akun wali' };
const PENDAFTAR_KEDALUWARSA = "status IN ('ditolak', 'cadangan', 'baru', 'terverifikasi')";   // belum menjadi siswa dan tidak sedang diproses
const PROFIL_PRIVASI = ['alamat_kantor', 'kontak_email', 'kontak_telepon', 'pejabat_pdp', 'tanggal_berlaku', 'penyedia_server', 'retensi_alumni', 'retensi_pendaftar'];   // tampil di halaman publik /privasi
const PROFIL_KEYS = ['hapus_pendaftar_bulan', 'nama_yayasan', 'sk_pengesahan', 'sk_perubahan', 'tanggal_sk_perubahan', 'akta_notaris', 'alamat', 'kecamatan', 'kabupaten', 'provinsi', ...PROFIL_PRIVASI];
const WA_LOG_HARI = 90;
const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const genPassword = () => Array.from({ length: 10 }, () => PW_CHARS[crypto.randomInt(PW_CHARS.length)]).join('');
const normPhone = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.startsWith('62') ? '0' + d.slice(2) : d; };
const ph = (a) => a.map(() => '?').join(',');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createApp(dbFile, opts = {}) {
  const db = openDb(dbFile);
  const wa = createWa(db, { todayWib, fetchImpl: opts.fetch });
  // Jejak audit: tindakan penting (hapus, akun, hak pemilik data). Tidak mencatat siapa yang melihat data.
  const catat = (u, aksi, detail) => db.prepare('INSERT INTO audit (aktor, aksi, detail) VALUES (?,?,?)').run(u ? `${u.nama} (${u.username || u.id})` : 'sistem', aksi, String(detail || '').slice(0, 300));
  const sessions = new Map(); // token -> {userId, exp}
  const attempts = new Map(); // ip -> {n, until}
  const buckets = new Map(); // "nama:ip" -> {n, reset}
  // Di belakang reverse proxy set TRUST_PROXY=1 agar IP asli dibaca dari X-Forwarded-For.
  const clientIp = (req) => (process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress;
  const limited = (name, req, max, ms) => {
    const k = name + ':' + clientIp(req), now = Date.now();
    let b = buckets.get(k);
    if (!b || b.reset < now) { b = { n: 0, reset: now + ms }; buckets.set(k, b); }
    if (buckets.size > 5000) for (const [kk, v] of buckets) if (v.reset < now) buckets.delete(kk);
    return ++b.n > max;
  };
  const activeTahun = () => (db.prepare('SELECT nama FROM tahun_ajaran WHERE aktif = 1').get() || {}).nama;
  const PUBLIC_DIR = path.join(__dirname, 'public');
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
  const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" };

  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    db.prepare('INSERT INTO users (username, password, nama, role, must_change) VALUES (?,?,?,?,?)')
      .run('admin', hashPassword(pw), 'Admin Yayasan', 'yayasan', process.env.ADMIN_PASSWORD ? 0 : 1);
    if (!process.env.ADMIN_PASSWORD) console.log(`Akun awal dibuat -> username: admin  password: ${pw}  (catat dan segera ganti)`);
  }

  // ---- pengguna & lingkup lembaga ----
  const allLembaga = () => db.prepare('SELECT id, kode, nama FROM lembaga ORDER BY id').all();
  const userLembagaIds = (u) => (u.role === 'yayasan'
    ? allLembaga().map((l) => l.id)
    : db.prepare('SELECT lembaga_id id FROM user_lembaga WHERE user_id = ?').all(u.id).map((r) => r.id));
  const publicUser = (u) => {
    const ids = userLembagaIds(u);
    return { id: u.id, username: u.username, nama: u.nama, role: u.role, wa: u.wa || null, must_change: !!u.must_change,
      lembagas: ids.length ? db.prepare(`SELECT id, kode, nama FROM lembaga WHERE id IN (${ph(ids)}) ORDER BY id`).all(...ids) : [] };
  };
  // Lembaga yang sedang aktif dipilih lewat header X-Lembaga ("all" = semua yang diizinkan)
  function scopeOf(user, req) {
    const allowed = user.lembagas.map((l) => l.id), h = req.headers['x-lembaga'];
    if (h && h !== 'all') {
      const n = Number(h);
      if (!allowed.includes(n)) throw new HttpError(403, 'Anda tidak memiliki akses ke lembaga ini');
      return { ids: [n], target: n };
    }
    return { ids: allowed, target: allowed.length === 1 ? allowed[0] : null };
  }
  const inScope = (cfg, row, ctx) => !cfg.scopeKey || ctx.scope.ids.includes(row[cfg.scopeKey]);
  const lembagaOf = (table, id, ctx) => {
    const r = db.prepare(`SELECT lembaga_id FROM ${table} WHERE id = ?`).get(id);
    if (!r || !ctx.scope.ids.includes(r.lembaga_id)) throw new HttpError(404, 'Data tidak ditemukan');
    return r.lembaga_id;
  };

  const clean = (cfg, body, create) => {
    const out = {};
    for (const c of cfg.cols) {
      if (!(c in body)) continue;
      let v = body[c];
      if (typeof v === 'string') v = v.trim();
      if (v === '' || v === undefined) v = null;
      if (v !== null && (NUMERIC.has(c) || c.endsWith('_id'))) {
        v = Number(v);
        if (!Number.isFinite(v)) throw new HttpError(400, `Nilai "${c}" harus berupa angka`);
      }
      if (v !== null && cfg.enums && cfg.enums[c] && !cfg.enums[c].includes(v)) throw new HttpError(400, `Nilai "${c}" tidak valid`);
      out[c] = v;
    }
    for (const r of cfg.req) {
      if ((out[r] === null || out[r] === undefined) && (r in out || create)) throw new HttpError(400, `Kolom "${r}" wajib diisi`);
    }
    return out;
  };

  // Pastikan data rujukan (kelas, guru, siswa) berada di lembaga yang sama / dalam lingkup.
  function checkRefs(cfg, d, lembagaId, ctx) {
    if (cfg.table === 'siswa' && d.kelas_id != null && lembagaOf('kelas', d.kelas_id, ctx) !== lembagaId) throw new HttpError(400, 'Kelas berasal dari lembaga lain');
    if (cfg.table === 'kelas' && d.wali_guru_id != null && lembagaOf('guru', d.wali_guru_id, ctx) !== lembagaId) throw new HttpError(400, 'Wali kelas berasal dari lembaga lain');
    if ((cfg.table === 'nilai' || cfg.table === 'pembayaran') && d.siswa_id != null) {
      const sl = lembagaOf('siswa', d.siswa_id, ctx);
      if (lembagaId != null && sl !== lembagaId) throw new HttpError(400, 'Siswa berasal dari lembaga lain');
    }
  }

  // ---- PPDB ----
  function fillPendaftar(d, lid, sumber) {
    const ta = activeTahun();
    if (!ta) throw new HttpError(400, 'Belum ada tahun ajaran aktif');
    const l = db.prepare('SELECT kode FROM lembaga WHERE id = ?').get(lid);
    const urut = db.prepare('SELECT COALESCE(MAX(urut), 0) + 1 n FROM pendaftar WHERE lembaga_id = ? AND tahun_ajaran = ?').get(lid, ta).n;
    Object.assign(d, { tahun_ajaran: ta, urut, no_daftar: `${l.kode}-${ta.slice(0, 4)}-${String(urut).padStart(4, '0')}`, sumber, status: d.status || 'baru' });
  }

  function terimaPendaftar(id, body, ctx) {
    const row = getRow(RES.pendaftar, id, ctx);
    if (row.siswa_id) throw new HttpError(400, 'Pendaftar ini sudah menjadi siswa');
    if (row.status !== 'diterima') throw new HttpError(400, 'Hanya pendaftar berstatus "diterima" yang dapat dijadikan siswa');
    const kid = body.kelas_id ? Number(body.kelas_id) : null;
    if (kid && lembagaOf('kelas', kid, ctx) !== row.lembaga_id) throw new HttpError(400, 'Kelas berasal dari lembaga lain');
    db.exec('BEGIN');
    try {
      const r = db.prepare(`INSERT INTO siswa (lembaga_id, nis, nama, jk, tempat_lahir, tgl_lahir, nik, alamat, wali, telepon, status, kelas_id, tahun_masuk)
        VALUES (?,?,?,?,?,?,?,?,?,?,'aktif',?,?)`).run(row.lembaga_id, str(body.nis, 30), row.nama, row.jk, row.tempat_lahir, row.tgl_lahir, row.nik,
        row.alamat, row.nama_ayah || row.nama_ibu, row.telepon, kid, row.tahun_ajaran);
      const sid = Number(r.lastInsertRowid);
      db.prepare("INSERT INTO mutasi (siswa_id, jenis, ke_kelas_id, tahun_ajaran, tanggal) VALUES (?, 'masuk', ?, ?, ?)").run(sid, kid, row.tahun_ajaran, todayWib());
      db.prepare("UPDATE pendaftar SET status = 'terdaftar', siswa_id = ? WHERE id = ?").run(sid, id);
      db.exec('COMMIT');
      return { siswa_id: sid };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  // Kenaikan kelas, kelulusan, pindah, keluar - massal dan atomik, dengan riwayat.
  function kenaikan(body, ctx) {
    const ids = [...new Set((Array.isArray(body.siswa_ids) ? body.siswa_ids : []).map(Number))];
    if (!ids.length || ids.length > 2000) throw new HttpError(400, 'Pilih siswa (maksimal 2000)');
    const aksi = body.aksi;
    if (!KENAIKAN.includes(aksi)) throw new HttpError(400, 'Aksi tidak valid');
    let ke = null;
    if (aksi === 'naik') {
      ke = db.prepare('SELECT * FROM kelas WHERE id = ?').get(Number(body.ke_kelas_id));
      if (!ke || !ctx.scope.ids.includes(ke.lembaga_id)) throw new HttpError(404, 'Kelas tujuan tidak ditemukan');
    }
    const tanggal = body.tanggal && isDate(body.tanggal) ? body.tanggal : todayWib();
    const tahunLulus = str(body.tahun_ajaran, 20) || activeTahun() || null;
    const ket = str(body.keterangan, 200);
    db.exec('BEGIN');
    try {
      for (const id of ids) {
        const s = db.prepare('SELECT * FROM siswa WHERE id = ?').get(id);
        if (!s || !ctx.scope.ids.includes(s.lembaga_id)) throw new HttpError(404, 'Siswa tidak ditemukan');
        if (s.status !== 'aktif') throw new HttpError(400, `${s.nama} bukan siswa aktif`);
        if (aksi === 'naik') {
          if (ke.lembaga_id !== s.lembaga_id) throw new HttpError(400, `Kelas tujuan berasal dari lembaga lain (${s.nama})`);
          if (ke.id === s.kelas_id) throw new HttpError(400, `Kelas tujuan sama dengan kelas asal (${s.nama})`);
          db.prepare('UPDATE siswa SET kelas_id = ? WHERE id = ?').run(ke.id, id);
        } else if (aksi === 'lulus') {
          db.prepare("UPDATE siswa SET status = 'lulus', tahun_lulus = ? WHERE id = ?").run(tahunLulus, id);
        } else {
          db.prepare('UPDATE siswa SET status = ? WHERE id = ?').run(aksi, id);
        }
        db.prepare('INSERT INTO mutasi (siswa_id, jenis, dari_kelas_id, ke_kelas_id, tahun_ajaran, tanggal, keterangan) VALUES (?,?,?,?,?,?,?)')
          .run(id, aksi, s.kelas_id, ke ? ke.id : null, ke ? ke.tahun_ajaran : tahunLulus, tanggal, ket);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { ok: true, jumlah: ids.length };
  }

  function riwayat(q, ctx) {
    if (!q.siswa_id) throw new HttpError(400, 'siswa_id wajib diisi');
    lembagaOf('siswa', Number(q.siswa_id), ctx);
    return db.prepare(`SELECT m.*, kd.nama dari_kelas, kk.nama ke_kelas FROM mutasi m
      LEFT JOIN kelas kd ON kd.id = m.dari_kelas_id LEFT JOIN kelas kk ON kk.id = m.ke_kelas_id
      WHERE m.siswa_id = ? ORDER BY m.id`).all(q.siswa_id);
  }

  // Endpoint publik (tanpa login) untuk pendaftaran online
  async function publicApi(req, res, parts) {
    const [, what] = parts, method = req.method;
    if (what === 'lembaga' && method === 'GET') {
      return send(res, 200, { tahun_ajaran: activeTahun() || null,
        lembaga: db.prepare('SELECT id, kode, nama, jenjang FROM lembaga WHERE ppdb_buka = 1 ORDER BY id').all() });
    }
    if (what === 'daftar' && method === 'POST') {
      if (limited('daftar', req, 60, 3600e3)) throw new HttpError(429, 'Terlalu banyak pendaftaran dari perangkat ini, coba lagi nanti');
      const b = await readBody(req);
      if (b.website) return send(res, 200, { no_daftar: 'OK' }); // honeypot: bot mengisi kolom tersembunyi
      const l = db.prepare('SELECT * FROM lembaga WHERE id = ? AND ppdb_buka = 1').get(Number(b.lembaga_id));
      if (!l) throw new HttpError(400, 'Pendaftaran untuk lembaga ini sedang ditutup');
      const d = { nama: str(b.nama, 100), jk: str(b.jk, 1), tempat_lahir: str(b.tempat_lahir, 60), tgl_lahir: str(b.tgl_lahir, 10), nik: str(b.nik, 20),
        alamat: str(b.alamat, 300), nama_ayah: str(b.nama_ayah, 100), nama_ibu: str(b.nama_ibu, 100), telepon: str(b.telepon, 20), asal_sekolah: str(b.asal_sekolah, 100) };
      if (!d.nama) throw new HttpError(400, 'Nama calon siswa wajib diisi');
      if (!['L', 'P'].includes(d.jk)) throw new HttpError(400, 'Jenis kelamin wajib dipilih');
      if (!d.tgl_lahir || !isDate(d.tgl_lahir)) throw new HttpError(400, 'Tanggal lahir tidak valid');
      if (!d.telepon) throw new HttpError(400, 'Nomor telepon/WhatsApp wajib diisi');
      if (!d.nama_ayah && !d.nama_ibu) throw new HttpError(400, 'Nama ayah atau ibu wajib diisi');
      if (!['on', 'true', '1', true, 1].includes(b.setuju)) throw new HttpError(400, 'Persetujuan orang tua/wali wajib dicentang');
      d.lembaga_id = l.id; d.persetujuan = new Date().toISOString();
      const ta = activeTahun();
      if (ta && db.prepare('SELECT 1 FROM pendaftar WHERE lembaga_id = ? AND tahun_ajaran = ? AND lower(nama) = lower(?) AND tgl_lahir = ?').get(l.id, ta, d.nama, d.tgl_lahir)) {
        throw new HttpError(409, 'Calon siswa ini sudah terdaftar. Gunakan menu cek status.');
      }
      fillPendaftar(d, l.id, 'online');
      const keys = Object.keys(d);
      db.prepare(`INSERT INTO pendaftar (${keys.join(',')}) VALUES (${ph(keys)})`).run(...keys.map((k) => d[k]));
      return send(res, 200, { no_daftar: d.no_daftar, nama: d.nama, lembaga: l.nama });
    }
    if (what === 'privasi' && method === 'GET') {                       // hanya data kontak kebijakan privasi; data SK tidak ikut
      const rows = db.prepare(`SELECT kunci, nilai FROM pengaturan WHERE kunci IN (${ph(PROFIL_PRIVASI)})`).all(...PROFIL_PRIVASI);
      return send(res, 200, { nama_yayasan: 'Yayasan Miftahul Ulumillah', ...Object.fromEntries(rows.filter((r) => r.nilai).map((r) => [r.kunci, r.nilai])) });
    }
    if (what === 'status' && method === 'POST') {
      if (limited('status', req, 30, 3600e3)) throw new HttpError(429, 'Terlalu banyak percobaan, coba lagi nanti');
      const b = await readBody(req);
      const r = db.prepare(`SELECT d.no_daftar, d.nama, d.status, l.nama lembaga FROM pendaftar d JOIN lembaga l ON l.id = d.lembaga_id
        WHERE d.no_daftar = ? AND d.tgl_lahir = ?`).get(String(b.no_daftar || '').trim().toUpperCase(), String(b.tgl_lahir || ''));
      if (!r) throw new HttpError(404, 'Data tidak ditemukan. Periksa nomor pendaftaran dan tanggal lahir.');
      return send(res, 200, r);
    }
    throw new HttpError(404, 'Endpoint tidak ditemukan');
  }

  // ---- pelanggaran siswa (input web; input WhatsApp ada di wa.js) ----
  function cekKodeJenis(d) {
    if (!/^[a-z0-9_]{2,20}$/.test(String(d.kode || ''))) throw new HttpError(400, 'Kode jenis 2-20 karakter: huruf kecil, angka, garis bawah');
  }
  // Mengisi nama jenis & poin dari master; `keluar` (opsional) menerima hasil pada objek lain saat ubah data.
  function fillPelanggaran(d, ctx, keluar = d) {
    const sis = db.prepare('SELECT lembaga_id FROM siswa WHERE id = ?').get(d.siswa_id);
    const j = db.prepare('SELECT * FROM jenis_pelanggaran WHERE id = ? AND lembaga_id = ?').get(d.jenis_id, sis && sis.lembaga_id);
    if (!j) throw new HttpError(400, 'Jenis pelanggaran tidak valid untuk lembaga siswa ini');
    Object.assign(keluar, { jenis_nama: j.nama, poin: j.poin });
    if (keluar === d) Object.assign(d, { dicatat_oleh: ctx.user.nama, sumber: 'web' });
  }
  function ringkasanPoin(ctx, q) {
    const ids = ctx.scope.ids;
    return db.prepare(`SELECT s.id siswa_id, s.nama, s.nis, k.nama kelas_nama, l.kode lembaga_kode, COUNT(v.id) jumlah, SUM(v.poin) total FROM pelanggaran v
      JOIN siswa s ON s.id = v.siswa_id JOIN lembaga l ON l.id = s.lembaga_id LEFT JOIN kelas k ON k.id = s.kelas_id
      WHERE s.lembaga_id IN (${ph(ids)}) ${q.kelas_id ? 'AND s.kelas_id = ' + Number(q.kelas_id) : ''} GROUP BY s.id ORDER BY total DESC, s.nama LIMIT 100`).all(...ids);
  }

  // ---- WhatsApp: pengaturan, simulator, dan log ----
  function waLog(ctx) {
    const ids = ctx.scope.ids;
    if (ctx.user.role === 'yayasan') {
      return db.prepare(`SELECT w.id, w.dibuat, w.nomor, w.pesan, w.balasan, w.status, w.sumber, u.nama pengirim FROM wa_log w LEFT JOIN users u ON u.id = w.user_id
        ORDER BY w.id DESC LIMIT 60`).all();
    }
    if (!ids.length) return [];
    return db.prepare(`SELECT w.id, w.dibuat, w.nomor, w.pesan, w.balasan, w.status, w.sumber, u.nama pengirim FROM wa_log w JOIN users u ON u.id = w.user_id
      WHERE w.user_id IN (SELECT user_id FROM user_lembaga WHERE lembaga_id IN (${ph(ids)})) ORDER BY w.id DESC LIMIT 60`).all(...ids);
  }
  function waStatus(ctx) {
    const penerima = db.prepare(`SELECT u.id, u.nama, u.role, u.wa FROM users u WHERE u.wa IS NOT NULL AND u.role != 'wali' ORDER BY u.nama`).all()
      .filter((u) => ctx.user.role === 'yayasan' || (u.role !== 'yayasan' && db.prepare(`SELECT 1 FROM user_lembaga WHERE user_id = ? AND lembaga_id IN (${ph(ctx.scope.ids.concat([0]))})`).get(u.id, ...ctx.scope.ids, 0)));
    return { provider: wa.provider(), bantuan: wa.BANTUAN, penerima };
  }
  function waSimulasi(body, ctx) {
    const u = db.prepare("SELECT * FROM users WHERE id = ? AND role != 'wali'").get(Number(body.user_id));
    const boleh = u && (ctx.user.role === 'yayasan' || waStatus(ctx).penerima.some((x) => x.id === u.id));
    if (!boleh) throw new HttpError(404, 'Pengguna tidak ditemukan');
    const r = wa.terima({ id: null, dari: u.wa, teks: String(body.pesan || '').slice(0, 2000), sumber: 'simulasi', userId: u.id });
    return { balasan: r.balasan, status: r.status };
  }

  // ---- penghapusan pendaftar otomatis (opsional, diatur yayasan) ----
  const pengaturan = (k) => (db.prepare('SELECT nilai FROM pengaturan WHERE kunci = ?').get(k) || {}).nilai;
  const bulanHapusPendaftar = () => Math.max(0, Math.floor(Number(pengaturan('hapus_pendaftar_bulan')) || 0));
  const pendaftarKedaluwarsa = (bulan) => (bulan > 0 ? Number(db.prepare(`SELECT COUNT(*) n FROM pendaftar WHERE ${PENDAFTAR_KEDALUWARSA} AND dibuat < datetime('now', ?)`).get(`-${bulan} months`).n) : 0);
  function purgePendaftar() {
    const bulan = bulanHapusPendaftar();
    if (!bulan) return 0;
    const n = Number(db.prepare(`DELETE FROM pendaftar WHERE ${PENDAFTAR_KEDALUWARSA} AND dibuat < datetime('now', ?)`).run(`-${bulan} months`).changes);
    if (n) catat(null, 'hapus_pendaftar_otomatis', `${n} pendaftar yang tidak menjadi siswa, lebih dari ${bulan} bulan`);
    return n;
  }

  // ---- permintaan data dari wali (hak pemilik data) ----
  function permintaanList(ctx) {
    const ids = ctx.scope.ids;
    if (!ids.length) return [];
    const lihat = (p) => ids.some((i) => String(p.lembaga_ids || '').includes(`,${i},`));
    return db.prepare(`SELECT p.*, s.nama anak, l.kode lembaga_kode FROM permintaan_data p LEFT JOIN siswa s ON s.id = p.siswa_id LEFT JOIN lembaga l ON l.id = s.lembaga_id
      ORDER BY (p.status IN ('baru', 'diproses')) DESC, p.id DESC LIMIT 600`).all().filter(lihat).slice(0, 200);
  }
  function prosesPermintaan(id, body, ctx) {
    if (ctx.user.role !== 'yayasan' && ctx.user.role !== 'admin') throw new HttpError(403, 'Hanya admin yang dapat memproses permintaan data');
    const r = permintaanList(ctx).find((x) => x.id === id);
    if (!r) throw new HttpError(404, 'Permintaan tidak ditemukan');
    if (!['baru', 'diproses'].includes(r.status)) throw new HttpError(400, 'Permintaan ini sudah selesai');
    const aksi = String(body.aksi || ''), catatan = str(body.catatan, 500);
    const tutup = (status, hasil) => db.prepare('UPDATE permintaan_data SET status = ?, diproses = datetime(\'now\'), diproses_oleh = ?, hasil = ? WHERE id = ?').run(status, ctx.user.nama, hasil, id);
    if (aksi === 'diproses') { db.prepare("UPDATE permintaan_data SET status = 'diproses', diproses_oleh = ? WHERE id = ?").run(ctx.user.nama, id); return { ok: true }; }
    if (aksi === 'tolak') {
      if (!catatan) throw new HttpError(400, 'Tuliskan alasan penolakan agar wali mengetahuinya');
      tutup('ditolak', catatan); catat(ctx.user, 'tolak_permintaan', `#${id} ${r.jenis}: ${catatan}`); return { ok: true };
    }
    if (aksi === 'selesai') { tutup('selesai', catatan || 'Permintaan telah diproses.'); catat(ctx.user, 'selesai_permintaan', `#${id} ${r.jenis}`); return { ok: true }; }
    if (aksi === 'hapus_akun') {
      if (r.jenis !== 'hapus_akun' || !r.user_id) throw new HttpError(400, 'Aksi ini hanya untuk permintaan penghapusan akun');
      const tertaut = db.prepare('SELECT s.lembaga_id FROM wali_siswa w JOIN siswa s ON s.id = w.siswa_id WHERE w.user_id = ?').all(r.user_id);
      if (tertaut.some((x) => !ctx.scope.ids.includes(x.lembaga_id))) throw new HttpError(403, 'Akun ini terhubung ke anak di lembaga lain. Minta admin yayasan memprosesnya.');
      db.exec('BEGIN');
      try {
        tutup('selesai', catatan || 'Akun wali telah dihapus.');
        db.prepare("DELETE FROM users WHERE id = ? AND role = 'wali'").run(r.user_id);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      for (const [t, s] of sessions) if (s.userId === r.user_id) sessions.delete(t);
      catat(ctx.user, 'hapus_akun_wali', `${r.wali_username} (permintaan #${id})`);
      return { ok: true };
    }
    throw new HttpError(400, 'Aksi tidak dikenal');
  }
  // Salinan seluruh data satu anak (hak akses pemilik data), diserahkan admin kepada wali.
  function salinanData(id, ctx) {
    const r = permintaanList(ctx).find((x) => x.id === id);
    if (!r || r.jenis !== 'salinan' || !r.siswa_id) throw new HttpError(404, 'Permintaan salinan tidak ditemukan');
    const s = db.prepare(`SELECT s.*, l.nama lembaga_nama, l.kode lembaga_kode, k.nama kelas_nama FROM siswa s JOIN lembaga l ON l.id = s.lembaga_id LEFT JOIN kelas k ON k.id = s.kelas_id WHERE s.id = ?`).get(r.siswa_id);
    if (!s || !ctx.scope.ids.includes(s.lembaga_id)) throw new HttpError(404, 'Data tidak ditemukan');
    const rows = [], add = (kat, tgl, uraian) => rows.push([kat, tgl || '', uraian]);
    for (const [k, v] of [['Nama', s.nama], ['NIS', s.nis], ['NIK', s.nik], ['Jenis kelamin', s.jk], ['Tempat lahir', s.tempat_lahir], ['Tanggal lahir', s.tgl_lahir], ['Alamat', s.alamat], ['Orang tua/wali', s.wali],
      ['Telepon', s.telepon], ['Kelas', s.kelas_nama], ['Status', s.status], ['Tahun masuk', s.tahun_masuk], ['Tahun lulus', s.tahun_lulus]]) if (v) add('Identitas', '', `${k}: ${v}`);
    for (const m of db.prepare('SELECT m.tanggal, m.jenis, kd.nama dari, kk.nama ke, m.keterangan FROM mutasi m LEFT JOIN kelas kd ON kd.id = m.dari_kelas_id LEFT JOIN kelas kk ON kk.id = m.ke_kelas_id WHERE m.siswa_id = ? ORDER BY m.id').all(s.id))
      add('Riwayat kelas', m.tanggal, `${m.jenis}${m.dari ? ' dari ' + m.dari : ''}${m.ke ? ' ke ' + m.ke : ''}${m.keterangan ? ' (' + m.keterangan + ')' : ''}`);
    const ab = db.prepare("SELECT COALESCE(SUM(status='H'),0) h, COALESCE(SUM(status='S'),0) s, COALESCE(SUM(status='I'),0) i, COALESCE(SUM(status='A'),0) a FROM absensi WHERE siswa_id = ?").get(s.id);
    add('Kehadiran', '', `Total: hadir ${ab.h}, sakit ${ab.s}, izin ${ab.i}, alpa ${ab.a}`);
    for (const a of db.prepare("SELECT tanggal, status, keterangan FROM absensi WHERE siswa_id = ? AND status != 'H' ORDER BY tanggal").all(s.id)) add('Kehadiran', a.tanggal, `${{ S: 'Sakit', I: 'Izin', A: 'Alpa' }[a.status]}${a.keterangan ? ' - ' + a.keterangan : ''}`);
    for (const n of db.prepare('SELECT tanggal, mapel, jenis, nilai, semester FROM nilai WHERE siswa_id = ? ORDER BY tanggal, id').all(s.id)) add('Nilai', n.tanggal, `${n.mapel}${n.jenis ? ' (' + n.jenis + ')' : ''}: ${n.nilai}${n.semester ? ', semester ' + n.semester : ''}`);
    for (const t of db.prepare('SELECT t.jenis, t.periode, t.jumlah, t.jatuh_tempo FROM tagihan t WHERE t.siswa_id = ? ORDER BY t.periode, t.id').all(s.id)) add('Tagihan', t.jatuh_tempo, `${t.jenis}${t.periode ? ' ' + t.periode : ''}: ${rp(t.jumlah)}`);
    for (const p of db.prepare('SELECT tanggal, jenis, bulan, jumlah FROM pembayaran WHERE siswa_id = ? ORDER BY tanggal, id').all(s.id)) add('Pembayaran', p.tanggal, `${p.jenis}${p.bulan ? ' ' + p.bulan : ''}: ${rp(p.jumlah)}`);
    for (const v of db.prepare('SELECT tanggal, jenis_nama, poin, keterangan FROM pelanggaran WHERE siswa_id = ? ORDER BY tanggal, id').all(s.id)) add('Pelanggaran', v.tanggal, `${v.jenis_nama} (+${v.poin})${v.keterangan ? ' - ' + v.keterangan : ''}`);
    catat(ctx.user, 'salinan_data', `siswa #${s.id} (permintaan #${id})`);
    return { siswa: s, rows };
  }

  // ---- tagihan massal ----
  function generateTagihan(body, ctx) {
    const kid = Number(body.kelas_id);
    if (!kid) throw new HttpError(400, 'Pilih kelas');
    lembagaOf('kelas', kid, ctx);
    const jumlah = Number(body.jumlah);
    if (!Number.isInteger(jumlah) || jumlah <= 0) throw new HttpError(400, 'Jumlah harus bilangan bulat positif');
    const periode = str(body.periode, 7);
    if (periode && !/^\d{4}-\d{2}$/.test(periode)) throw new HttpError(400, 'Periode harus berformat YYYY-MM');
    const tempo = str(body.jatuh_tempo, 10);
    if (tempo && !isDate(tempo)) throw new HttpError(400, 'Jatuh tempo tidak valid');
    const jenis = str(body.jenis, 40) || 'SPP', ket = str(body.keterangan, 200);
    const siswa = db.prepare("SELECT id FROM siswa WHERE kelas_id = ? AND status = 'aktif'").all(kid);
    const ins = db.prepare('INSERT OR IGNORE INTO tagihan (siswa_id, jenis, periode, jumlah, jatuh_tempo, keterangan) VALUES (?,?,?,?,?,?)');
    let dibuat = 0;
    db.exec('BEGIN');
    try { for (const s of siswa) dibuat += Number(ins.run(s.id, jenis, periode, jumlah, tempo, ket).changes); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
    return { dibuat, dilewati: siswa.length - dibuat };
  }

  // ---- akun wali murid (dibuat petugas; wali hanya bisa membaca data anaknya) ----
  function waliAkun(method, parts, q, body, ctx) {
    const sub = parts[1];
    const needSiswa = (v) => lembagaOf('siswa', Number(v) || 0, ctx);
    if (method === 'GET' && !sub) {
      needSiswa(q.siswa_id);
      return db.prepare(`SELECT u.id user_id, u.username, u.nama, u.must_change FROM wali_siswa w JOIN users u ON u.id = w.user_id
        WHERE w.siswa_id = ? ORDER BY u.username`).all(q.siswa_id);
    }
    if (method === 'POST' && !sub) {
      needSiswa(body.siswa_id);
      const siswa = db.prepare('SELECT * FROM siswa WHERE id = ?').get(body.siswa_id);
      const raw = String(body.username || '').trim().toLowerCase();
      const username = /^[\d+\s-]+$/.test(raw || siswa.telepon || '') ? normPhone(raw || siswa.telepon) : raw;
      if (!/^[a-z0-9._-]{4,30}$/.test(username)) throw new HttpError(400, 'Username 4-30 karakter (huruf kecil, angka, titik, strip). Isi nomor HP wali atau username.');
      const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (u && u.role !== 'wali') throw new HttpError(409, 'Username sudah dipakai akun petugas');
      db.exec('BEGIN');
      try {
        let uid, password = null;
        if (u) uid = u.id;
        else {
          password = genPassword();
          uid = Number(db.prepare('INSERT INTO users (username, password, nama, role, must_change) VALUES (?,?,?,?,1)')
            .run(username, hashPassword(password), str(body.nama, 100) || siswa.wali || 'Wali ' + siswa.nama, 'wali').lastInsertRowid);
        }
        db.prepare('INSERT OR IGNORE INTO wali_siswa (user_id, siswa_id) VALUES (?,?)').run(uid, siswa.id);
        db.exec('COMMIT');
        catat(ctx.user, u ? 'tautkan_wali' : 'buat_akun_wali', `${username} -> ${siswa.nama}`);
        return { user_id: uid, username, password, baru: !u };
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    if (method === 'POST' && sub === 'reset') {
      const uid = Number(body.user_id);
      const ok = db.prepare(`SELECT 1 FROM wali_siswa w JOIN siswa s ON s.id = w.siswa_id JOIN users u ON u.id = w.user_id
        WHERE w.user_id = ? AND u.role = 'wali' AND s.lembaga_id IN (${ph(ctx.scope.ids)})`).get(uid, ...ctx.scope.ids);
      if (!ok) throw new HttpError(404, 'Akun wali tidak ditemukan');
      const password = genPassword();
      db.prepare('UPDATE users SET password = ?, must_change = 1 WHERE id = ?').run(hashPassword(password), uid);
      for (const [t, s] of sessions) if (s.userId === uid) sessions.delete(t);
      catat(ctx.user, 'reset_password_wali', `user #${uid}`);
      return { password };
    }
    if (method === 'DELETE') {
      needSiswa(q.siswa_id);
      const uid = Number(q.user_id);
      const r = db.prepare('DELETE FROM wali_siswa WHERE user_id = ? AND siswa_id = ?').run(uid, q.siswa_id);
      if (!r.changes) throw new HttpError(404, 'Tautan tidak ditemukan');
      if (!db.prepare('SELECT 1 FROM wali_siswa WHERE user_id = ?').get(uid)) {
        db.prepare("DELETE FROM users WHERE id = ? AND role = 'wali'").run(uid);
        for (const [t, s] of sessions) if (s.userId === uid) sessions.delete(t);
      }
      catat(ctx.user, 'lepas_wali', `user #${uid} dari siswa #${q.siswa_id}`);
      return { ok: true };
    }
    throw new HttpError(405, 'Metode tidak didukung');
  }

  // ---- API untuk wali murid (hanya baca, hanya anak yang tertaut) ----
  function waliApi(parts, ctx, method = 'GET', body = {}) {
    const anak = () => db.prepare(`SELECT s.id, s.nis, s.nama, s.jk, s.status, s.lembaga_id, l.nama lembaga_nama, l.kode lembaga_kode, k.nama kelas_nama, g.nama wali_kelas
      FROM wali_siswa w JOIN siswa s ON s.id = w.siswa_id JOIN lembaga l ON l.id = s.lembaga_id
      LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN guru g ON g.id = k.wali_guru_id
      WHERE w.user_id = ? ORDER BY s.nama`).all(ctx.user.id);
    const what = parts[1];
    if (what === 'anak' && !parts[2]) return anak();
    if (what === 'anak') {
      const siswa = anak().find((a) => a.id === Number(parts[2]));
      if (!siswa) throw new HttpError(404, 'Data tidak ditemukan');
      const id = siswa.id, bulan = todayWib().slice(0, 7);
      const rek = (where, ...a) => db.prepare(`SELECT COALESCE(SUM(status = 'H'), 0) h, COALESCE(SUM(status = 'S'), 0) s, COALESCE(SUM(status = 'I'), 0) i, COALESCE(SUM(status = 'A'), 0) a
        FROM absensi WHERE siswa_id = ? ${where}`).get(id, ...a);
      return {
        siswa,
        absensi: { bulan, bulan_ini: rek("AND substr(tanggal, 1, 7) = ?", bulan), semua: rek(''),
          terbaru: db.prepare('SELECT tanggal, status FROM absensi WHERE siswa_id = ? ORDER BY tanggal DESC LIMIT 14').all(id) },
        nilai: { rata: db.prepare('SELECT mapel, ROUND(AVG(nilai), 1) rata, COUNT(*) jumlah FROM nilai WHERE siswa_id = ? GROUP BY mapel ORDER BY mapel').all(id),
          daftar: db.prepare('SELECT mapel, jenis, nilai, semester, tanggal FROM nilai WHERE siswa_id = ? ORDER BY tanggal DESC, id DESC LIMIT 300').all(id) },
        tagihan: db.prepare(`SELECT t.id, t.jenis, t.periode, t.jumlah, t.jatuh_tempo, t.keterangan, ${TERBAYAR} terbayar, ${TSISA} sisa, ${TSTATUS} status
          FROM tagihan t WHERE t.siswa_id = ? ORDER BY t.periode DESC, t.id DESC`).all(id),
        pembayaran: db.prepare('SELECT tanggal, jenis, bulan, jumlah, keterangan FROM pembayaran WHERE siswa_id = ? ORDER BY tanggal DESC, id DESC LIMIT 100').all(id),
        pelanggaran: { total_poin: db.prepare('SELECT COALESCE(SUM(poin), 0) n FROM pelanggaran WHERE siswa_id = ?').get(id).n,
          daftar: db.prepare('SELECT tanggal, jenis_nama, poin, keterangan FROM pelanggaran WHERE siswa_id = ? ORDER BY tanggal DESC, id DESC LIMIT 50').all(id) },
      };
    }
    if (what === 'permintaan') {
      if (method === 'GET') {
        return db.prepare(`SELECT p.id, p.jenis, p.catatan, p.status, p.dibuat, p.diproses, p.hasil, s.nama anak FROM permintaan_data p
          LEFT JOIN siswa s ON s.id = p.siswa_id WHERE p.user_id = ? ORDER BY p.id DESC LIMIT 30`).all(ctx.user.id);
      }
      if (method === 'POST') {
        const jenis = String(body.jenis || '');
        if (!PERMINTAAN_JENIS[jenis]) throw new HttpError(400, 'Jenis permintaan tidak valid');
        let sid = null;
        if (jenis !== 'hapus_akun') {
          sid = Number(body.siswa_id);
          if (!anak().some((a) => a.id === sid)) throw new HttpError(404, 'Data anak tidak ditemukan');
        }
        const catatan = str(body.catatan, 500);
        if (jenis === 'koreksi' && !catatan) throw new HttpError(400, 'Tuliskan data apa yang perlu dikoreksi');
        const terbuka = db.prepare("SELECT jenis, siswa_id FROM permintaan_data WHERE user_id = ? AND status IN ('baru', 'diproses')").all(ctx.user.id);
        if (terbuka.some((r) => r.jenis === jenis && r.siswa_id === sid)) throw new HttpError(409, 'Permintaan serupa masih diproses');
        if (terbuka.length >= 6) throw new HttpError(429, 'Terlalu banyak permintaan yang belum selesai');
        const kelompok = jenis === 'hapus_akun' ? anak() : anak().filter((a) => a.id === sid);
        const lembagaIds = `,${[...new Set(kelompok.map((a) => a.lembaga_id))].join(',')},`;
        const id = Number(db.prepare('INSERT INTO permintaan_data (user_id, wali_nama, wali_username, siswa_id, jenis, catatan, lembaga_ids, ringkasan) VALUES (?,?,?,?,?,?,?,?)')
          .run(ctx.user.id, ctx.user.nama, ctx.user.username, sid, jenis, catatan, lembagaIds, kelompok.map((a) => `${a.nama} (${a.lembaga_nama})`).join('; ')).lastInsertRowid);
        catat(ctx.user, 'permintaan_data', `${jenis}${sid ? ` siswa #${sid}` : ''} (permintaan #${id})`);
        return { id };
      }
    }
    if (what === 'pengumuman') {
      const lids = [...new Set(anak().map((a) => a.lembaga_id))];
      return lids.length ? db.prepare(`SELECT a.id, a.judul, a.isi, a.tanggal, l.nama lembaga FROM pengumuman a JOIN lembaga l ON l.id = a.lembaga_id
        WHERE a.lembaga_id IN (${ph(lids)}) ORDER BY a.id DESC LIMIT 30`).all(...lids) : [];
    }
    throw new HttpError(404, 'Endpoint tidak ditemukan');
  }

  function list(cfg, q, ctx) {
    const where = [], args = [];
    if (cfg.scopeCol) { where.push(`${cfg.scopeCol} IN (${ph(ctx.scope.ids)})`); args.push(...ctx.scope.ids); }
    if (q.q) {
      where.push('(' + cfg.search.map((c) => `${c} LIKE ?`).join(' OR ') + ')');
      cfg.search.forEach(() => args.push(`%${q.q}%`));
    }
    for (const [k, col] of Object.entries(cfg.filters)) {
      if (q[k]) { where.push(`${col} = ?`); args.push(q[k]); }
    }
    return db.prepare(`${cfg.sel}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${cfg.order}`).all(...args);
  }

  const getRow = (cfg, id, ctx) => {
    const row = db.prepare(`${cfg.sel} WHERE ${cfg.a}.id = ?`).get(id);
    if (!row || !inScope(cfg, row, ctx)) throw new HttpError(404, 'Data tidak ditemukan');
    return row;
  };

  function crud(cfg, method, id, q, body, ctx) {
    if (method !== 'GET' && cfg.writeRole && ctx.user.role !== cfg.writeRole) throw new HttpError(403, 'Hanya admin yayasan yang dapat mengubah data ini');
    if (method === 'GET') return id ? getRow(cfg, id, ctx) : list(cfg, q, ctx);
    if (method === 'POST' && !id) {
      const d = clean(cfg, body, true);
      let lid = null;
      if (cfg.own) {
        lid = ctx.scope.target;
        if (!lid) throw new HttpError(400, 'Pilih lembaga terlebih dahulu');
        d.lembaga_id = lid;
      }
      checkRefs(cfg, d, lid, ctx);
      if (cfg.table === 'pendaftar') fillPendaftar(d, lid, 'admin');
      if (cfg.table === 'pengumuman') Object.assign(d, { dibuat_oleh: ctx.user.nama, tanggal: todayWib() });
      if (cfg.table === 'pelanggaran') fillPelanggaran(d, ctx);
      if (cfg.table === 'jenis_pelanggaran') cekKodeJenis(d);
      const keys = Object.keys(d);
      const r = db.prepare(`INSERT INTO ${cfg.table} (${keys.join(',')}) VALUES (${ph(keys)})`).run(...keys.map((k) => d[k]));
      const newId = Number(r.lastInsertRowid);
      if (cfg.table === 'tahun_ajaran' && d.aktif === 1) db.prepare('UPDATE tahun_ajaran SET aktif = 0 WHERE id != ?').run(newId);
      if (cfg.table === 'lembaga') seedJenis(db, newId);
      return { id: newId };
    }
    if (method === 'PUT' && id) {
      const row = getRow(cfg, id, ctx);
      const d = clean(cfg, body, false);
      const keys = Object.keys(d);
      if (!keys.length) throw new HttpError(400, 'Tidak ada data untuk diubah');
      checkRefs(cfg, d, cfg.scopeKey ? row[cfg.scopeKey] : null, ctx);
      if (cfg.table === 'pelanggaran' && 'jenis_id' in d) fillPelanggaran({ ...d, siswa_id: row.siswa_id }, ctx, d);
      if (cfg.table === 'jenis_pelanggaran' && 'kode' in d) cekKodeJenis(d);
      if (cfg.table === 'pendaftar' && row.siswa_id && 'status' in d) throw new HttpError(400, 'Pendaftar sudah menjadi siswa, status tidak dapat diubah');
      const ks = Object.keys(d);                 // setelah hook, agar kolom turunan (poin, jenis_nama) ikut tersimpan
      db.prepare(`UPDATE ${cfg.table} SET ${ks.map((k) => k + ' = ?').join(',')} WHERE id = ?`).run(...ks.map((k) => d[k]), id);
      if (cfg.table === 'tahun_ajaran' && d.aktif === 1) db.prepare('UPDATE tahun_ajaran SET aktif = 0 WHERE id != ?').run(id);
      return { ok: true };
    }
    if (method === 'DELETE' && id) {
      const lama = getRow(cfg, id, ctx);
      db.prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).run(id);
      catat(ctx.user, 'hapus_' + cfg.table, `#${id} ${lama.nama || lama.siswa_nama || lama.judul || lama.no_daftar || ''}`.trim());
      return { ok: true };
    }
    throw new HttpError(405, 'Metode tidak didukung');
  }

  function absensi(method, q, body, ctx) {
    if (method === 'GET') {
      if (!q.kelas_id || !q.tanggal) throw new HttpError(400, 'kelas_id dan tanggal wajib diisi');
      lembagaOf('kelas', q.kelas_id, ctx);
      return db.prepare(`SELECT s.id siswa_id, s.nis, s.nama, a.status, a.keterangan FROM siswa s
        LEFT JOIN absensi a ON a.siswa_id = s.id AND a.tanggal = ?
        WHERE s.kelas_id = ? AND s.status = 'aktif' ORDER BY s.nama`).all(q.tanggal, q.kelas_id);
    }
    if (method === 'POST') {
      if (!body.tanggal || !Array.isArray(body.items)) throw new HttpError(400, 'Data absensi tidak valid');
      const up = db.prepare(`INSERT INTO absensi (siswa_id, tanggal, status) VALUES (?,?,?)
        ON CONFLICT (siswa_id, tanggal) DO UPDATE SET status = excluded.status`);
      db.exec('BEGIN');
      try {
        for (const it of body.items) {
          if (!ABSEN.has(it.status)) throw new HttpError(400, 'Status absensi tidak valid');
          lembagaOf('siswa', Number(it.siswa_id), ctx);
          up.run(Number(it.siswa_id), body.tanggal, it.status);
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return { ok: true };
    }
    throw new HttpError(405, 'Metode tidak didukung');
  }

  function rekapAbsensi(q, ctx) {
    if (!q.kelas_id || !q.bulan) throw new HttpError(400, 'kelas_id dan bulan (YYYY-MM) wajib diisi');
    lembagaOf('kelas', q.kelas_id, ctx);
    return db.prepare(`SELECT s.id siswa_id, s.nis, s.nama,
        SUM(a.status = 'H') h, SUM(a.status = 'S') s, SUM(a.status = 'I') i, SUM(a.status = 'A') a
      FROM siswa s LEFT JOIN absensi a ON a.siswa_id = s.id AND substr(a.tanggal, 1, 7) = ?
      WHERE s.kelas_id = ? AND s.status = 'aktif' GROUP BY s.id ORDER BY s.nama`).all(q.bulan, q.kelas_id);
  }

  function dashboard(ctx) {
    const ids = ctx.scope.ids, p = ph(ids), today = todayWib(), bulan = today.slice(0, 7);
    const n = (sql, ...a) => db.prepare(sql).get(...a).n;
    const abs = {};
    for (const r of db.prepare(`SELECT a.status, COUNT(*) n FROM absensi a JOIN siswa s ON s.id = a.siswa_id
        WHERE a.tanggal = ? AND s.lembaga_id IN (${p}) GROUP BY a.status`).all(today, ...ids)) abs[r.status] = r.n;
    return {
      siswa: n(`SELECT COUNT(*) n FROM siswa WHERE status = 'aktif' AND lembaga_id IN (${p})`, ...ids),
      guru: n(`SELECT COUNT(*) n FROM guru WHERE lembaga_id IN (${p})`, ...ids),
      kelas: n(`SELECT COUNT(*) n FROM kelas WHERE lembaga_id IN (${p})`, ...ids),
      pendaftar_baru: n(`SELECT COUNT(*) n FROM pendaftar WHERE status = 'baru' AND lembaga_id IN (${p})`, ...ids),
      permintaan_baru: permintaanList(ctx).filter((r) => r.status === 'baru').length,
      tunggakan: n(`SELECT COALESCE(SUM(sisa), 0) n FROM (SELECT ${TSISA} sisa FROM tagihan t JOIN siswa s ON s.id = t.siswa_id
        WHERE s.lembaga_id IN (${p}) AND t.jatuh_tempo < ?)`, ...ids, today),
      absensi_hari_ini: abs,
      pembayaran_bulan_ini: n(`SELECT COALESCE(SUM(p.jumlah), 0) n FROM pembayaran p JOIN siswa s ON s.id = p.siswa_id
        WHERE substr(p.tanggal, 1, 7) = ? AND s.lembaga_id IN (${p})`, bulan, ...ids),
      multi: ids.length > 1,
      per_lembaga: db.prepare(`SELECT l.kode, l.nama, COUNT(s.id) jumlah FROM lembaga l
        LEFT JOIN siswa s ON s.lembaga_id = l.id AND s.status = 'aktif' WHERE l.id IN (${p}) GROUP BY l.id ORDER BY l.id`).all(...ids),
      per_kelas: db.prepare(`SELECT k.nama, l.kode lembaga_kode, COUNT(s.id) jumlah FROM kelas k JOIN lembaga l ON l.id = k.lembaga_id
        LEFT JOIN siswa s ON s.kelas_id = k.id AND s.status = 'aktif' WHERE k.lembaga_id IN (${p}) GROUP BY k.id ORDER BY l.id, k.nama`).all(...ids),
    };
  }

  function rapor(q, ctx) {
    if (!q.siswa_id) throw new HttpError(400, 'siswa_id wajib diisi');
    const siswa = db.prepare(`SELECT s.*, l.nama lembaga_nama, l.kode lembaga_kode, k.nama kelas_nama, g.nama wali_kelas FROM siswa s
      JOIN lembaga l ON l.id = s.lembaga_id LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN guru g ON g.id = k.wali_guru_id WHERE s.id = ?`).get(q.siswa_id);
    if (!siswa || !ctx.scope.ids.includes(siswa.lembaga_id)) throw new HttpError(404, 'Siswa tidak ditemukan');
    const sem = q.semester || null;
    const nilai = db.prepare(`SELECT mapel, ROUND(AVG(nilai), 1) rata, COUNT(*) jumlah FROM nilai
      WHERE siswa_id = ? AND (? IS NULL OR semester = ?) GROUP BY mapel ORDER BY mapel`).all(siswa.id, sem, sem);
    const absen = db.prepare(`SELECT SUM(status = 'H') h, SUM(status = 'S') s, SUM(status = 'I') i, SUM(status = 'A') a
      FROM absensi WHERE siswa_id = ?`).get(siswa.id);
    return { siswa, semester: sem, nilai, absensi: absen };
  }

  // ---- manajemen pengguna: yayasan = semua; admin lembaga = hanya staf di lembaganya ----
  function users(method, id, body, ctx) {
    const me = ctx.user;
    if (me.role !== 'yayasan' && me.role !== 'admin') throw new HttpError(403, 'Anda tidak berhak mengelola pengguna');
    const myIds = me.lembagas.map((l) => l.id);
    const idsOf = (uid) => db.prepare('SELECT lembaga_id FROM user_lembaga WHERE user_id = ?').all(uid).map((r) => r.lembaga_id);
    const canManage = (u) => me.role === 'yayasan' || ((u.role === 'staf' || u.role === 'guru') && idsOf(u.id).length > 0 && idsOf(u.id).every((i) => myIds.includes(i)));
    const roleOk = (r) => (me.role === 'yayasan' ? ROLES.includes(r) : r === 'staf' || r === 'guru');
    const nomorWa = (v) => { if (v === undefined) return undefined; const n = waNorm(v); if (String(v).trim() && (n.length < 10 || n.length > 15)) throw new HttpError(400, 'Nomor WhatsApp tidak valid'); return n || null; };
    const parseIds = (role, v) => {
      if (role === 'yayasan') return [];
      const arr = [...new Set((Array.isArray(v) ? v : []).map(Number))];
      if (!arr.length) throw new HttpError(400, 'Pilih minimal satu lembaga');
      if (arr.some((i) => !myIds.includes(i))) throw new HttpError(403, 'Lembaga tidak diizinkan');
      return arr;
    };
    const setLembaga = (uid, arr) => {
      db.prepare('DELETE FROM user_lembaga WHERE user_id = ?').run(uid);
      for (const i of arr) db.prepare('INSERT INTO user_lembaga (user_id, lembaga_id) VALUES (?,?)').run(uid, i);
    };
    const lastYayasan = (u) => u.role === 'yayasan' && db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'yayasan'").get().n <= 1;
    const target = id ? db.prepare('SELECT * FROM users WHERE id = ?').get(id) : null;
    if (id && (!target || target.role === 'wali' || !canManage(target))) throw new HttpError(404, 'Pengguna tidak ditemukan');

    if (method === 'GET') {
      return db.prepare("SELECT id, username, nama, role, wa FROM users WHERE role != 'wali' ORDER BY username").all()
        .map((u) => ({ ...u, lembaga_ids: idsOf(u.id) }))
        .filter((u) => me.role === 'yayasan' || (u.role !== 'yayasan' && u.lembaga_ids.some((i) => myIds.includes(i))));
    }
    if (method === 'POST') {
      const { username, nama, role = 'staf' } = body;
      const nomor = nomorWa(body.wa) ?? null;
      // guru yang hanya memakai WhatsApp tidak perlu password: dibuatkan acak yang tidak diketahui siapa pun
      const password = body.password || (role === 'guru' && nomor ? genPassword() + genPassword() : '');
      if (!username || !password || !nama) throw new HttpError(400, 'Username, password, dan nama wajib diisi');
      if (String(password).length < MIN_PW) throw new HttpError(400, `Password minimal ${MIN_PW} karakter`);
      if (!roleOk(role)) throw new HttpError(400, 'Role tidak valid');
      const arr = parseIds(role, body.lembaga_ids);
      db.exec('BEGIN');
      try {
        const r = db.prepare('INSERT INTO users (username, password, nama, role, must_change, wa) VALUES (?,?,?,?,1,?)')
          .run(String(username).trim(), hashPassword(String(password)), String(nama).trim(), role, nomor);
        setLembaga(Number(r.lastInsertRowid), arr);
        db.exec('COMMIT');
        catat(me, 'tambah_pengguna', `${username} (${role})`);
        return { id: Number(r.lastInsertRowid) };
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    if (method === 'PUT' && target) {
      const role = body.role || target.role;
      if (body.role && !roleOk(role)) throw new HttpError(400, 'Role tidak valid');
      if (role !== target.role && (target.id === me.id || lastYayasan(target))) throw new HttpError(400, 'Role akun ini tidak dapat diubah');
      if (body.password && String(body.password).length < MIN_PW) throw new HttpError(400, `Password minimal ${MIN_PW} karakter`);
      const arr = 'lembaga_ids' in body || role !== target.role ? parseIds(role, 'lembaga_ids' in body ? body.lembaga_ids : idsOf(target.id)) : null;
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE users SET nama = ?, role = ? WHERE id = ?').run(String(body.nama || target.nama).trim(), role, target.id);
        if ('wa' in body) db.prepare('UPDATE users SET wa = ? WHERE id = ?').run(nomorWa(body.wa) ?? null, target.id);
        if (body.password) {
          db.prepare('UPDATE users SET password = ?, must_change = 1 WHERE id = ?').run(hashPassword(String(body.password)), target.id);
          for (const [t, s] of sessions) if (s.userId === target.id) sessions.delete(t);
        }
        if (arr) setLembaga(target.id, arr);
        db.exec('COMMIT');
        catat(me, 'ubah_pengguna', `${target.username}${role !== target.role ? ` peran ${target.role}->${role}` : ''}${body.password ? ' password direset' : ''}`);
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return { ok: true };
    }
    if (method === 'DELETE' && target) {
      if (target.id === me.id) throw new HttpError(400, 'Tidak dapat menghapus akun sendiri');
      if (lastYayasan(target)) throw new HttpError(400, 'Akun admin yayasan terakhir tidak dapat dihapus');
      db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
      for (const [t, s] of sessions) if (s.userId === target.id) sessions.delete(t);
      catat(me, 'hapus_pengguna', target.username);
      return { ok: true };
    }
    throw new HttpError(405, 'Metode tidak didukung');
  }

  const readRaw = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new HttpError(413, 'Data terlalu besar')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(new HttpError(413, 'Data terlalu besar')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch { reject(new HttpError(400, 'JSON tidak valid')); }
    });
    req.on('error', reject);
  });

  // Pengguna dibaca ulang dari DB di setiap request, sehingga perubahan peran/lembaga langsung berlaku.
  const getSession = (req) => {
    const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
    const s = m && sessions.get(m[1]);
    if (!s) return null;
    const u = s.exp > Date.now() && db.prepare('SELECT * FROM users WHERE id = ?').get(s.userId);
    if (!u) { sessions.delete(m[1]); return null; }
    return { token: m[1], user: publicUser(u) };
  };

  const send = (res, status, data, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(JSON.stringify(data));
  };

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // buang "api"
    const [name, idStr] = parts;
    const id = idStr ? Number(idStr) : null;
    const method = req.method;

    if (name === 'login' && method === 'POST') {
      const ip = clientIp(req);
      const { username, password } = await readBody(req);
      const uname = String(username || '').trim();
      // batas kegagalan: per IP (20 / 5 menit) dan per username (10 / 15 menit)
      const keys = [[ip, 20, 5 * 60e3], ['u:' + uname.toLowerCase(), 10, 15 * 60e3]];
      for (const [k, max] of keys) { const a = attempts.get(k); if (a && a.n >= max && a.until > Date.now()) throw new HttpError(429, 'Terlalu banyak percobaan, coba lagi nanti'); }
      const u = db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
      if (!u || !verifyPassword(String(password || ''), u.password)) {
        for (const [k, , win] of keys) { const a = attempts.get(k); attempts.set(k, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + win }); }
        throw new HttpError(401, 'Username atau password salah');
      }
      attempts.delete(ip); attempts.delete('u:' + uname.toLowerCase());
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, { userId: u.id, exp: Date.now() + 12 * 3600e3 });
      const secure = process.env.TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(res, 200, publicUser(u), { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}` });
    }

    if (name === 'public') return publicApi(req, res, parts);
    if (name === 'wa' && parts[1] === 'webhook') {                       // dipanggil penyedia WhatsApp, diamankan token/tanda tangan
      const raw = req.method === 'POST' ? await readRaw(req) : Buffer.alloc(0);
      const r = await wa.webhook({ method: req.method, query: Object.fromEntries(url.searchParams), headers: req.headers, raw });
      if (r.text !== undefined) { res.writeHead(r.status, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(r.text); }
      return send(res, r.status, r.json);
    }

    const sess = getSession(req);
    if (!sess) throw new HttpError(401, 'Silakan login terlebih dahulu');
    const ctx = { user: sess.user, scope: scopeOf(sess.user, req) };
    const q = Object.fromEntries(url.searchParams);

    // Wali hanya boleh mengakses /api/wali; akun yang wajib ganti password hanya boleh ganti password.
    if (ctx.user.role === 'wali' && !['me', 'logout', 'password', 'wali'].includes(name)) throw new HttpError(403, 'Akses ditolak');
    if (ctx.user.role === 'guru' && (!GURU_API.has(name) || (GURU_BACA_SAJA.has(name) && method !== 'GET'))) throw new HttpError(403, 'Akses ditolak');
    if (ctx.user.must_change && !['me', 'logout', 'password'].includes(name)) throw new HttpError(403, 'Anda harus mengganti password terlebih dahulu');

    if (name === 'logout' && method === 'POST') {
      sessions.delete(sess.token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
    }
    if (name === 'me') return send(res, 200, ctx.user);
    if (name === 'password' && method === 'POST') {
      const { lama, baru } = await readBody(req);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
      if (!verifyPassword(String(lama || ''), u.password)) throw new HttpError(400, 'Password lama salah');
      if (String(baru || '').length < MIN_PW) throw new HttpError(400, `Password baru minimal ${MIN_PW} karakter`);
      if (baru === lama) throw new HttpError(400, 'Password baru harus berbeda dari password lama');
      db.prepare('UPDATE users SET password = ?, must_change = 0 WHERE id = ?').run(hashPassword(String(baru)), u.id);
      return send(res, 200, { ok: true });
    }
    if ((name === 'export' || name === 'pdf') && method === 'GET') {
      const key = parts[1], today = todayWib();
      const file = (buf, type, fname) => {
        res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${fname}"` });
        return res.end(buf);
      };
      if (name === 'pdf' && key === 'salinan') {
        if (ctx.user.role !== 'yayasan' && ctx.user.role !== 'admin') throw new HttpError(403, 'Hanya admin yang dapat membuat salinan data');
        const d = salinanData(Number(q.id), ctx);
        return file(tablePdf({ title: 'Salinan Data Siswa', subtitle: `${d.siswa.nama} · ${d.siswa.lembaga_nama} · dibuat ${today} · diserahkan kepada orang tua/wali atas permintaan`,
          headers: ['Kategori', 'Tanggal', 'Uraian'], rows: d.rows, logo: logoJpeg(d.siswa.lembaga_kode) }), 'application/pdf', `salinan-data-${d.siswa.id}.pdf`);
      }
      if (name === 'pdf' && key === 'rapor') { const r = rapor(q, ctx); return file(raporPdf(r, logoJpeg(r.siswa.lembaga_kode)), 'application/pdf', `rapor-${q.siswa_id}.pdf`); }
      if (name === 'pdf' && key === 'kuitansi') { const pb = crud(RES.pembayaran, 'GET', Number(q.id), {}, {}, ctx); return file(kuitansiPdf(pb, rp, logoJpeg(pb.lembaga_kode)), 'application/pdf', `kuitansi-${q.id}.pdf`); }
      const ex = EXPORTS[key];
      if (!ex) throw new HttpError(404, 'Data ekspor tidak ditemukan');
      const data = key === 'rekap-absensi' ? rekapAbsensi(q, ctx) : list(RES[key], q, ctx);
      const rows = data.map((r) => ex[1].map((c) => r[c[1]] ?? (key === 'rekap-absensi' ? 0 : '')));
      if (name === 'export') {
        return file(buildXlsx(ex[0], ex[1].map((c) => c[0]), rows),
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${key}-${today}.xlsx`);
      }
      const scopeName = ctx.scope.target ? ctx.user.lembagas.find((l) => l.id === ctx.scope.target).nama : (ctx.scope.ids.length > 1 ? 'Semua lembaga' : '');
      const sub = `${scopeName ? scopeName + ' · ' : ''}Dicetak ${today} · ${rows.length} data` + (q.q ? ` · pencarian "${q.q}"` : '') + (q.bulan ? ` · ${q.bulan}` : '');
      const total = key === 'pembayaran' ? `Total: ${rp(data.reduce((a, r) => a + r.jumlah, 0))}` : null;
      const money = ex[1].findIndex((c) => c[1] === 'jumlah' && key === 'pembayaran');
      if (money >= 0) rows.forEach((r) => { r[money] = rp(r[money]); });
      const cols = ex[1].map((c, i) => i).filter((i) => ctx.scope.ids.length > 1 || ex[1][i][1] !== 'lembaga_kode');
      const logo = logoJpeg(ctx.scope.target ? ctx.user.lembagas.find((l) => l.id === ctx.scope.target).kode : 'yayasan');
      return file(tablePdf({ title: ex[0], subtitle: sub, headers: cols.map((i) => ex[1][i][0]), rows: rows.map((r) => cols.map((i) => r[i])), footer: total, logo }),
        'application/pdf', `${key}-${today}.pdf`);
    }
    if (name === 'wali') return send(res, 200, waliApi(parts, ctx, method, method === 'POST' ? await readBody(req) : {}));
    if (name === 'wa') {
      if (ctx.user.role !== 'yayasan' && ctx.user.role !== 'admin') throw new HttpError(403, 'Hanya admin yang dapat mengelola WhatsApp');
      if (parts[1] === 'status') return send(res, 200, waStatus(ctx));
      if (parts[1] === 'log') return send(res, 200, waLog(ctx));
      if (parts[1] === 'simulasi' && method === 'POST') return send(res, 200, waSimulasi(await readBody(req), ctx));
      throw new HttpError(404, 'Endpoint tidak ditemukan');
    }
    if (name === 'permintaan') {
      if (ctx.user.role !== 'yayasan' && ctx.user.role !== 'admin') throw new HttpError(403, 'Hanya admin yang dapat melihat permintaan data');
      if (method === 'GET' && !id) return send(res, 200, permintaanList(ctx));
      if (method === 'POST' && id && parts[2] === 'proses') return send(res, 200, prosesPermintaan(id, await readBody(req), ctx));
      throw new HttpError(404, 'Endpoint tidak ditemukan');
    }
    if (name === 'audit') {
      if (ctx.user.role !== 'yayasan') throw new HttpError(403, 'Hanya admin yayasan yang dapat melihat jejak audit');
      return send(res, 200, db.prepare('SELECT id, waktu, aktor, aksi, detail FROM audit ORDER BY id DESC LIMIT 300').all());
    }
    if (name === 'pelanggaran' && parts[1] === 'ringkasan') return send(res, 200, ringkasanPoin(ctx, q));
    if (name === 'wali-akun') return send(res, 200, waliAkun(method, parts, q, method === 'POST' ? await readBody(req) : {}, ctx));
    if (name === 'tagihan' && parts[1] === 'generate' && method === 'POST') return send(res, 200, generateTagihan(await readBody(req), ctx));
    if (name === 'pendaftar' && parts[2] === 'terima' && method === 'POST') return send(res, 200, terimaPendaftar(id, await readBody(req), ctx));
    if (name === 'kenaikan' && method === 'POST') return send(res, 200, kenaikan(await readBody(req), ctx));
    if (name === 'riwayat') return send(res, 200, riwayat(q, ctx));
    if (name === 'profil') {
      if (ctx.user.role !== 'yayasan') throw new HttpError(403, 'Hanya admin yayasan yang dapat melihat profil yayasan');
      if (method === 'PUT') {
        const b = await readBody(req);
        const up = db.prepare('INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?) ON CONFLICT (kunci) DO UPDATE SET nilai = excluded.nilai');
        if ('hapus_pendaftar_bulan' in b) {
          const n = Number(b.hapus_pendaftar_bulan || 0);
          if (!Number.isInteger(n) || n < 0 || n > 120) throw new HttpError(400, 'Batas hapus pendaftar harus 0 (nonaktif) sampai 120 bulan');
          if (n !== bulanHapusPendaftar()) catat(ctx.user, 'atur_hapus_pendaftar', n ? `otomatis setelah ${n} bulan` : 'dinonaktifkan');
        }
        for (const k of PROFIL_KEYS) if (k in b) up.run(k, str(b[k], 300));
      }
      const rows = db.prepare(`SELECT kunci, nilai FROM pengaturan WHERE kunci IN (${ph(PROFIL_KEYS)})`).all(...PROFIL_KEYS);
      return send(res, 200, { ...Object.fromEntries(rows.map((r) => [r.kunci, r.nilai])), _kedaluwarsa: pendaftarKedaluwarsa(bulanHapusPendaftar()) });
    }
    if (name === 'dashboard') return send(res, 200, dashboard(ctx));
    if (name === 'rapor') return send(res, 200, rapor(q, ctx));
    if (name === 'rekap-absensi') return send(res, 200, rekapAbsensi(q, ctx));
    if (name === 'absensi') return send(res, 200, absensi(method, q, method === 'POST' ? await readBody(req) : {}, ctx));
    if (name === 'users') return send(res, 200, users(method, id, method === 'POST' || method === 'PUT' ? await readBody(req) : {}, ctx));
    if (RES[name]) {
      const body = method === 'POST' || method === 'PUT' ? await readBody(req) : {};
      const hasil = crud(RES[name], method, id, q, body, ctx);
      if (ctx.user.role === 'guru' && name === 'siswa') for (const r of Array.isArray(hasil) ? hasil : [hasil]) { delete r.nik; delete r.alamat; }   // data pribadi tidak perlu untuk guru
      return send(res, 200, hasil);
    }
    throw new HttpError(404, 'Endpoint tidak ditemukan');
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz') { db.prepare('SELECT 1').get(); return send(res, 200, { ok: true }); }   // untuk Docker/pemantau uptime
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      const lg = /^\/logo\/([a-z0-9-]+)\.png$/.exec(url.pathname);
      if (lg) {
        const f = logoFile(lg[1], 'png');
        if (!f) { res.writeHead(404); return res.end('Tidak ditemukan'); }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', ...SEC });
        return fs.createReadStream(f).pipe(res);
      }
      const rel = url.pathname === '/' ? 'index.html' : url.pathname === '/daftar' ? 'daftar.html' : url.pathname === '/wali' ? 'wali.html' : url.pathname === '/privasi' ? 'privasi.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.join(PUBLIC_DIR, rel);
      if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); return res.end('Tidak ditemukan');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      let status = e.status || 500, msg = e.message;
      if (/UNIQUE constraint/.test(msg)) { status = 409; msg = 'Data duplikat: NIS/NIP/username/kode sudah digunakan'; }
      else if (/FOREIGN KEY|constraint/i.test(msg)) { status = 400; msg = 'Data terkait tidak valid atau masih digunakan'; }
      else if (status === 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'Kesalahan server' : msg });
    }
  });
  // Menghapus riwayat pesan WhatsApp yang lebih tua dari `hari` hari (sesuai Kebijakan Privasi).
  const purgeWaLog = (hari = WA_LOG_HARI) => Number(db.prepare("DELETE FROM wa_log WHERE dibuat < datetime('now', ?)").run(`-${Math.max(1, hari)} days`).changes);
  return { server, db, purgeWaLog, purgePendaftar };
}

module.exports = { createApp };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const file = process.env.DB_FILE || path.join(__dirname, 'data', 'sekolah.db');
  const app = createApp(file);
  const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(file), 'backup');
  const keep = Number(process.env.BACKUP_KEEP) || 14, jam = Number(process.env.BACKUP_EVERY_HOURS ?? 24);
  // Backup otomatis: bila backup terakhir lebih tua dari (jam - 1) jam. BACKUP_EVERY_HOURS=0 mematikannya.
  const cek = () => {
    try { if (jam > 0 && Date.now() - backupTerakhir(backupDir) > (jam - 1) * 3600e3) console.log('Backup otomatis:', backupNow(app.db, backupDir, keep).file); }
    catch (e) { console.error('Backup otomatis gagal:', e.message); }
  };
  const bersihkan = () => { try { app.purgePendaftar(); } catch (e) { console.error('Penghapusan pendaftar gagal:', e.message); } try { const n = app.purgeWaLog(Number(process.env.WA_LOG_DAYS) || WA_LOG_HARI); if (n) console.log(`Riwayat WhatsApp: ${n} pesan lama dihapus`); } catch (e) { console.error('Pembersihan riwayat gagal:', e.message); } };
  cek(); bersihkan(); const timer = setInterval(() => { cek(); bersihkan(); }, 3600e3);
  app.server.listen(port, () => console.log(`Administrasi Yayasan berjalan di http://localhost:${port}`));
  const berhenti = () => { clearInterval(timer); app.server.close(() => { try { app.db.close(); } catch { /* sudah tertutup */ } process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', berhenti); process.on('SIGINT', berhenti);
}
