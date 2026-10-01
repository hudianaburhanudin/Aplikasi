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

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
      nama TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staf');
    CREATE TABLE IF NOT EXISTS guru (
      id INTEGER PRIMARY KEY, nip TEXT UNIQUE, nama TEXT NOT NULL, jk TEXT,
      mapel TEXT, telepon TEXT, alamat TEXT);
    CREATE TABLE IF NOT EXISTS kelas (
      id INTEGER PRIMARY KEY, nama TEXT NOT NULL, tahun_ajaran TEXT,
      wali_guru_id INTEGER REFERENCES guru(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS siswa (
      id INTEGER PRIMARY KEY, nis TEXT UNIQUE, nama TEXT NOT NULL, jk TEXT, tgl_lahir TEXT,
      alamat TEXT, wali TEXT, telepon TEXT, status TEXT NOT NULL DEFAULT 'aktif',
      kelas_id INTEGER REFERENCES kelas(id) ON DELETE SET NULL);
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
  `);
  return db;
}

module.exports = { openDb, hashPassword, verifyPassword };
