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
  if (!db.prepare('SELECT 1 FROM lembaga LIMIT 1').get()) {
    const ins = db.prepare('INSERT INTO lembaga (kode, nama, jenjang) VALUES (?,?,?)');
    for (const l of LEMBAGA) ins.run(...l);
  }
  if (!db.prepare('SELECT 1 FROM tahun_ajaran LIMIT 1').get()) {
    db.prepare('INSERT INTO tahun_ajaran (nama, mulai, selesai, aktif) VALUES (?,?,?,1)').run('2026/2027', '2026-07-01', '2027-06-30');
  }
  return db;
}

module.exports = { openDb, hashPassword, verifyPassword };
