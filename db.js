const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}

function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Lembaga di bawah Yayasan Miftahul Ulumillah
const LEMBAGA = [
  ['PONPES', 'Pondok Pesantren Miftahul Ulum', 'Pesantren'],
  ['SMK', 'SMK Miftahul Ulum', 'SMK'],
  ['SMP', 'SMP Plus Miftahul Ulum Tambakrejo', 'SMP'],
  ['MI', 'MI Miftahul Ulum', 'MI'],
  ['RA', 'RA Muslimat', 'RA'],
  ['MADIN-ULA', 'Madin Ula Miftahul Ulum', 'Madin'],
  ['MADIN-WUSTHO', 'Madin Wustho Miftahul Ulum', 'Madin'],
];

// Jenis pelanggaran bawaan (kode, nama, poin); admin dapat mengubah/menambah per lembaga.
const JENIS_DEFAULT = [
  ['terlambat', 'Terlambat', 5], ['seragam', 'Seragam/atribut tidak lengkap', 5], ['rambut', 'Rambut tidak sesuai aturan', 5],
  ['tugas', 'Tidak mengerjakan tugas', 5], ['gaduh', 'Mengganggu pembelajaran', 10], ['hp', 'Membawa/menggunakan HP', 15],
  ['jamaah', 'Tidak mengikuti jamaah/kegiatan', 10], ['bolos', 'Bolos/keluar kelas tanpa izin', 20],
  ['kabur', 'Keluar lingkungan tanpa izin', 30], ['berkelahi', 'Berkelahi', 50], ['merokok', 'Merokok/vape', 50], ['lainnya', 'Pelanggaran lainnya', 5],
];
function seedJenis(db, lembagaId) {
  const ins = db.prepare('INSERT OR IGNORE INTO jenis_pelanggaran (lembaga_id, kode, nama, poin) VALUES (?,?,?,?)');
  for (const [k, n, p] of JENIS_DEFAULT) ins.run(lembagaId, k, n, p);
}

// Migrasi skema berversi (PRAGMA user_version). Skema dasar = versi 1; MIGRATIONS[i] membawa ke versi i + 2.
const MIGRATIONS = [
  `ALTER TABLE lembaga ADD COLUMN ppdb_buka INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE siswa ADD COLUMN tempat_lahir TEXT;
   ALTER TABLE siswa ADD COLUMN nik TEXT;
   ALTER TABLE siswa ADD COLUMN tahun_masuk TEXT;
   ALTER TABLE siswa ADD COLUMN tahun_lulus TEXT;
   CREATE TABLE pendaftar (
     id INTEGER PRIMARY KEY, lembaga_id INTEGER NOT NULL REFERENCES lembaga(id), tahun_ajaran TEXT NOT NULL,
     urut INTEGER NOT NULL, no_daftar TEXT NOT NULL UNIQUE, nama TEXT NOT NULL, jk TEXT, tempat_lahir TEXT,
     tgl_lahir TEXT, nik TEXT, alamat TEXT, nama_ayah TEXT, nama_ibu TEXT, telepon TEXT, asal_sekolah TEXT,
     status TEXT NOT NULL DEFAULT 'baru', catatan TEXT, siswa_id INTEGER REFERENCES siswa(id) ON DELETE SET NULL,
     sumber TEXT NOT NULL DEFAULT 'admin', dibuat TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (lembaga_id, tahun_ajaran, urut));
   CREATE INDEX idx_pendaftar_lembaga ON pendaftar(lembaga_id, status);
   CREATE TABLE mutasi (
     id INTEGER PRIMARY KEY, siswa_id INTEGER NOT NULL REFERENCES siswa(id) ON DELETE CASCADE,
     jenis TEXT NOT NULL, dari_kelas_id INTEGER REFERENCES kelas(id) ON DELETE SET NULL,
     ke_kelas_id INTEGER REFERENCES kelas(id) ON DELETE SET NULL, tahun_ajaran TEXT, tanggal TEXT NOT NULL, keterangan TEXT);
   CREATE INDEX idx_mutasi_siswa ON mutasi(siswa_id);`,
  // v3: portal wali, tagihan, pengumuman
  `ALTER TABLE users ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE wali_siswa (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     siswa_id INTEGER NOT NULL REFERENCES siswa(id) ON DELETE CASCADE, PRIMARY KEY (user_id, siswa_id));
   CREATE INDEX idx_wali_siswa ON wali_siswa(siswa_id);
   CREATE TABLE tagihan (
     id INTEGER PRIMARY KEY, siswa_id INTEGER NOT NULL REFERENCES siswa(id) ON DELETE CASCADE,
     jenis TEXT NOT NULL DEFAULT 'SPP', periode TEXT, jumlah INTEGER NOT NULL, jatuh_tempo TEXT, keterangan TEXT);
   CREATE UNIQUE INDEX uq_tagihan ON tagihan(siswa_id, jenis, COALESCE(periode, ''));
   CREATE TABLE pengumuman (
     id INTEGER PRIMARY KEY, lembaga_id INTEGER NOT NULL REFERENCES lembaga(id), judul TEXT NOT NULL, isi TEXT NOT NULL,
     tanggal TEXT NOT NULL, dibuat_oleh TEXT);
   CREATE INDEX idx_pengumuman ON pengumuman(lembaga_id, id);`,
  // v4: profil yayasan (data legalitas; hanya untuk admin yayasan, tidak dicetak)
  `CREATE TABLE pengaturan (kunci TEXT PRIMARY KEY, nilai TEXT);
   INSERT INTO pengaturan (kunci, nilai) VALUES
     ('nama_yayasan', 'Yayasan Miftahul Ulumillah'),
     ('sk_pengesahan', 'AHU-0004853.AH.01.04.Tahun 2015'),
     ('sk_perubahan', 'AHU-AH.01.06-0008992'),
     ('tanggal_sk_perubahan', '2024-02-07'),
     ('akta_notaris', 'No. 01 tanggal 5 Februari 2024, Notaris Laila, S.H. (Kab. Bojonegoro)'),
     ('alamat', 'Jalan Kartini RT 06 RW 02'),
     ('kecamatan', 'Tambakrejo'),
     ('kabupaten', 'Kabupaten Bojonegoro'),
     ('provinsi', 'Jawa Timur');`,
  // v5: absensi via WhatsApp, pelanggaran siswa
  `ALTER TABLE absensi ADD COLUMN keterangan TEXT;
   ALTER TABLE users ADD COLUMN wa TEXT;
   CREATE UNIQUE INDEX uq_users_wa ON users(wa) WHERE wa IS NOT NULL;
   CREATE TABLE jenis_pelanggaran (
     id INTEGER PRIMARY KEY, lembaga_id INTEGER NOT NULL REFERENCES lembaga(id), kode TEXT NOT NULL, nama TEXT NOT NULL,
     poin INTEGER NOT NULL DEFAULT 0, aktif INTEGER NOT NULL DEFAULT 1, UNIQUE (lembaga_id, kode));
   CREATE TABLE pelanggaran (
     id INTEGER PRIMARY KEY, siswa_id INTEGER NOT NULL REFERENCES siswa(id) ON DELETE CASCADE,
     jenis_id INTEGER REFERENCES jenis_pelanggaran(id) ON DELETE SET NULL, jenis_nama TEXT NOT NULL, poin INTEGER NOT NULL DEFAULT 0,
     tanggal TEXT NOT NULL, keterangan TEXT, dicatat_oleh TEXT, sumber TEXT NOT NULL DEFAULT 'web', dibuat TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE INDEX idx_pelanggaran_siswa ON pelanggaran(siswa_id, tanggal);
   CREATE TABLE wa_log (
     id INTEGER PRIMARY KEY, message_id TEXT UNIQUE, user_id INTEGER, nomor TEXT, pesan TEXT, balasan TEXT, status TEXT,
     undo TEXT, sumber TEXT NOT NULL DEFAULT 'wa', dibuat TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE INDEX idx_wa_log_user ON wa_log(user_id, id);
   INSERT INTO jenis_pelanggaran (lembaga_id, kode, nama, poin)
     SELECT l.id, d.kode, d.nama, d.poin FROM lembaga l CROSS JOIN (${JENIS_DEFAULT.map(([k, n, p]) => `SELECT '${k}' kode, '${n}' nama, ${p} poin`).join(' UNION ALL ')}) d;`,
  // v6: persetujuan orang tua pada pendaftaran online (waktu dicatat)
  `ALTER TABLE pendaftar ADD COLUMN persetujuan TEXT;`,
  // v7: jejak audit dan permintaan data dari wali (hak pemilik data)
  `CREATE TABLE audit (id INTEGER PRIMARY KEY, waktu TEXT NOT NULL DEFAULT (datetime('now')), aktor TEXT, aksi TEXT NOT NULL, detail TEXT);
   CREATE INDEX idx_audit_waktu ON audit(id);
   CREATE TABLE permintaan_data (
     id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, wali_nama TEXT, wali_username TEXT,
     siswa_id INTEGER REFERENCES siswa(id) ON DELETE SET NULL, jenis TEXT NOT NULL, catatan TEXT, status TEXT NOT NULL DEFAULT 'baru',
     lembaga_ids TEXT, ringkasan TEXT,   -- lingkup lembaga dan nama anak saat permintaan dibuat (tetap ada setelah akun dihapus)
     dibuat TEXT NOT NULL DEFAULT (datetime('now')), diproses TEXT, diproses_oleh TEXT, hasil TEXT);
   CREATE INDEX idx_permintaan_status ON permintaan_data(status, id);`,
  // v8: jadwal pelajaran (kelas_id kosong = berlaku untuk semua kelas di lembaga), mapel rapor, catatan rapor
  `CREATE TABLE jadwal (
     id INTEGER PRIMARY KEY, lembaga_id INTEGER NOT NULL REFERENCES lembaga(id),
     kelas_id INTEGER REFERENCES kelas(id) ON DELETE CASCADE,
     hari INTEGER NOT NULL, mulai TEXT NOT NULL, selesai TEXT NOT NULL, judul TEXT NOT NULL, guru TEXT);
   ALTER TABLE lembaga ADD COLUMN kepala TEXT;
   CREATE INDEX idx_jadwal ON jadwal(lembaga_id, kelas_id, hari, mulai);
   CREATE TABLE mapel_rapor (
     id INTEGER PRIMARY KEY, lembaga_id INTEGER NOT NULL REFERENCES lembaga(id),
     nama TEXT NOT NULL, kategori TEXT NOT NULL DEFAULT 'pokok', kkm REAL, urut INTEGER NOT NULL DEFAULT 0,
     UNIQUE (lembaga_id, nama));
   CREATE TABLE rapor_catatan (
     siswa_id INTEGER NOT NULL REFERENCES siswa(id) ON DELETE CASCADE, semester TEXT NOT NULL, kunci TEXT NOT NULL, nilai TEXT,
     PRIMARY KEY (siswa_id, semester, kunci));`,
  // v9: data siswa lengkap (EMIS/Dapodik/MBG): identitas, orang tua, alamat, bantuan; NSM/NPSN lembaga
  `ALTER TABLE siswa ADD COLUMN nisn TEXT;
   ALTER TABLE siswa ADD COLUMN nis_lokal TEXT;
   ALTER TABLE siswa ADD COLUMN no_kk TEXT;
   ALTER TABLE siswa ADD COLUMN agama TEXT;
   ALTER TABLE siswa ADD COLUMN jurusan TEXT;
   ALTER TABLE siswa ADD COLUMN rt TEXT;
   ALTER TABLE siswa ADD COLUMN rw TEXT;
   ALTER TABLE siswa ADD COLUMN dusun TEXT;
   ALTER TABLE siswa ADD COLUMN desa TEXT;
   ALTER TABLE siswa ADD COLUMN kecamatan TEXT;
   ALTER TABLE siswa ADD COLUMN kabupaten TEXT;
   ALTER TABLE siswa ADD COLUMN kode_pos TEXT;
   ALTER TABLE siswa ADD COLUMN jenis_tinggal TEXT;
   ALTER TABLE siswa ADD COLUMN transportasi TEXT;
   ALTER TABLE siswa ADD COLUMN email TEXT;
   ALTER TABLE siswa ADD COLUMN nama_ayah TEXT;
   ALTER TABLE siswa ADD COLUMN nik_ayah TEXT;
   ALTER TABLE siswa ADD COLUMN lahir_ayah TEXT;
   ALTER TABLE siswa ADD COLUMN pendidikan_ayah TEXT;
   ALTER TABLE siswa ADD COLUMN pekerjaan_ayah TEXT;
   ALTER TABLE siswa ADD COLUMN penghasilan_ayah TEXT;
   ALTER TABLE siswa ADD COLUMN nama_ibu TEXT;
   ALTER TABLE siswa ADD COLUMN nik_ibu TEXT;
   ALTER TABLE siswa ADD COLUMN lahir_ibu TEXT;
   ALTER TABLE siswa ADD COLUMN pendidikan_ibu TEXT;
   ALTER TABLE siswa ADD COLUMN pekerjaan_ibu TEXT;
   ALTER TABLE siswa ADD COLUMN penghasilan_ibu TEXT;
   ALTER TABLE siswa ADD COLUMN kip_kemenag TEXT;
   ALTER TABLE siswa ADD COLUMN kip_diknas TEXT;
   ALTER TABLE siswa ADD COLUMN kps TEXT;
   ALTER TABLE siswa ADD COLUMN pkh TEXT;
   ALTER TABLE siswa ADD COLUMN sktm TEXT;
   ALTER TABLE siswa ADD COLUMN mengulang INTEGER NOT NULL DEFAULT 0;
   CREATE UNIQUE INDEX idx_siswa_nisn ON siswa(lembaga_id, nisn) WHERE nisn IS NOT NULL;
   ALTER TABLE lembaga ADD COLUMN nsm TEXT;
   ALTER TABLE lembaga ADD COLUMN npsn TEXT;
   UPDATE lembaga SET nsm = '111235220242', npsn = '69854240' WHERE kode = 'MI';
   UPDATE lembaga SET nsm = '101235220248' WHERE kode = 'RA';`,
  // v10: riwayat pengingat tagihan (mencegah pesan berulang)
  `CREATE TABLE pengingat_log (id INTEGER PRIMARY KEY, tagihan_id INTEGER NOT NULL, siswa_id INTEGER, nomor TEXT, waktu TEXT NOT NULL DEFAULT (datetime('now')), berhasil INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX idx_pengingat ON pengingat_log(tagihan_id, waktu);`,
  // v11: aplikasi belajar siswa - akun siswa, materi, ujian (harian/UTS/semester), soal, dan pengerjaan
  `CREATE TABLE siswa_user (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, siswa_id INTEGER NOT NULL UNIQUE REFERENCES siswa(id) ON DELETE CASCADE);
   CREATE TABLE materi (
     id INTEGER PRIMARY KEY, lembaga_id INTEGER NOT NULL REFERENCES lembaga(id), kelas_id INTEGER REFERENCES kelas(id) ON DELETE CASCADE,
     mapel TEXT, judul TEXT NOT NULL, isi TEXT, tautan TEXT, dibuat_oleh TEXT, dibuat TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE INDEX idx_materi ON materi(lembaga_id, kelas_id);
   CREATE TABLE ujian (
     id INTEGER PRIMARY KEY, lembaga_id INTEGER NOT NULL REFERENCES lembaga(id), kelas_id INTEGER NOT NULL REFERENCES kelas(id) ON DELETE CASCADE,
     mapel TEXT NOT NULL, judul TEXT NOT NULL, jenis TEXT NOT NULL DEFAULT 'harian', semester TEXT,
     mulai TEXT NOT NULL, selesai TEXT NOT NULL, durasi INTEGER NOT NULL DEFAULT 60,
     acak INTEGER NOT NULL DEFAULT 1, tampil_nilai INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'draft',
     petunjuk TEXT, dibuat_oleh TEXT, dibuat TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE INDEX idx_ujian ON ujian(kelas_id, status);
   CREATE TABLE soal (
     id INTEGER PRIMARY KEY, ujian_id INTEGER NOT NULL REFERENCES ujian(id) ON DELETE CASCADE, urut INTEGER NOT NULL,
     tipe TEXT NOT NULL, teks TEXT NOT NULL, opsi TEXT, kunci INTEGER, bobot REAL NOT NULL DEFAULT 1);
   CREATE INDEX idx_soal ON soal(ujian_id, urut);
   CREATE TABLE ujian_peserta (
     id INTEGER PRIMARY KEY, ujian_id INTEGER NOT NULL REFERENCES ujian(id) ON DELETE CASCADE, siswa_id INTEGER NOT NULL REFERENCES siswa(id) ON DELETE CASCADE,
     mulai_at INTEGER NOT NULL, batas INTEGER NOT NULL, selesai_at INTEGER,
     jawaban TEXT NOT NULL DEFAULT '{}', skor TEXT NOT NULL DEFAULT '{}', nilai REAL, status TEXT NOT NULL DEFAULT 'berjalan',
     pindah_tab INTEGER NOT NULL DEFAULT 0, nilai_id INTEGER, UNIQUE (ujian_id, siswa_id));
   CREATE INDEX idx_peserta_status ON ujian_peserta(status, batas);`,
];

function migrate(db) {
  let v = db.prepare('PRAGMA user_version').get().user_version || 1;
  for (; v - 1 < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[v - 1]); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  const old = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='siswa'").get()
    && !db.prepare('PRAGMA table_info(siswa)').all().some((c) => c.name === 'lembaga_id');
  if (old) throw new Error('Database lama (sebelum fitur multi-lembaga) tidak kompatibel. Hapus file database lama lalu jalankan ulang (belum ada data produksi).');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS lembaga (
      id INTEGER PRIMARY KEY, kode TEXT NOT NULL UNIQUE, nama TEXT NOT NULL, jenjang TEXT,
      alamat TEXT, telepon TEXT);
    CREATE TABLE IF NOT EXISTS tahun_ajaran (
      id INTEGER PRIMARY KEY, nama TEXT NOT NULL UNIQUE, mulai TEXT, selesai TEXT, aktif INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
      nama TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staf');
    CREATE TABLE IF NOT EXISTS user_lembaga (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lembaga_id INTEGER NOT NULL REFERENCES lembaga(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, lembaga_id));
    CREATE TABLE IF NOT EXISTS guru (
      id INTEGER PRIMARY KEY, lembaga_id INTEGER NOT NULL REFERENCES lembaga(id), nip TEXT,
      nama TEXT NOT NULL, jk TEXT, mapel TEXT, telepon TEXT, alamat TEXT, UNIQUE (lembaga_id, nip));
    CREATE TABLE IF NOT EXISTS kelas (
      id INTEGER PRIMARY KEY, lembaga_id INTEGER NOT NULL REFERENCES lembaga(id), nama TEXT NOT NULL,
      tahun_ajaran TEXT, wali_guru_id INTEGER REFERENCES guru(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS siswa (
      id INTEGER PRIMARY KEY, lembaga_id INTEGER NOT NULL REFERENCES lembaga(id), nis TEXT,
      nama TEXT NOT NULL, jk TEXT, tgl_lahir TEXT,
      alamat TEXT, wali TEXT, telepon TEXT, status TEXT NOT NULL DEFAULT 'aktif',
      kelas_id INTEGER REFERENCES kelas(id) ON DELETE SET NULL, UNIQUE (lembaga_id, nis));
    CREATE TABLE IF NOT EXISTS absensi (
      id INTEGER PRIMARY KEY, siswa_id INTEGER NOT NULL REFERENCES siswa(id) ON DELETE CASCADE,
      tanggal TEXT NOT NULL, status TEXT NOT NULL, UNIQUE (siswa_id, tanggal));
    CREATE TABLE IF NOT EXISTS nilai (
      id INTEGER PRIMARY KEY, siswa_id INTEGER NOT NULL REFERENCES siswa(id) ON DELETE CASCADE,
      mapel TEXT NOT NULL, jenis TEXT, nilai REAL NOT NULL, semester TEXT, tanggal TEXT);
    CREATE TABLE IF NOT EXISTS pembayaran (
      id INTEGER PRIMARY KEY, siswa_id INTEGER NOT NULL REFERENCES siswa(id) ON DELETE CASCADE,
      jenis TEXT NOT NULL DEFAULT 'SPP', bulan TEXT, jumlah INTEGER NOT NULL,
      tanggal TEXT NOT NULL, keterangan TEXT);
    CREATE INDEX IF NOT EXISTS idx_siswa_lembaga ON siswa(lembaga_id, kelas_id);
    CREATE INDEX IF NOT EXISTS idx_kelas_lembaga ON kelas(lembaga_id);
    CREATE INDEX IF NOT EXISTS idx_guru_lembaga ON guru(lembaga_id);
    CREATE INDEX IF NOT EXISTS idx_absensi_tgl ON absensi(tanggal);
  `);
  migrate(db);
  if (!db.prepare('SELECT 1 FROM lembaga LIMIT 1').get()) {
    const ins = db.prepare('INSERT INTO lembaga (kode, nama, jenjang) VALUES (?,?,?)');
    for (const l of LEMBAGA) ins.run(...l);
    for (const r of db.prepare('SELECT id FROM lembaga').all()) seedJenis(db, r.id);   // hanya saat database baru dibuat
  }
  if (!db.prepare('SELECT 1 FROM tahun_ajaran LIMIT 1').get()) {
    db.prepare('INSERT INTO tahun_ajaran (nama, mulai, selesai, aktif) VALUES (?,?,?,1)').run('2026/2027', '2026-07-01', '2027-06-30');
  }
  return db;
}

module.exports = { openDb, hashPassword, verifyPassword, seedJenis };
