// Mengisi data contoh: node seed.js
const path = require('path');
const { openDb } = require('./db');
const db = openDb(process.env.DB_FILE || path.join(__dirname, 'data', 'sekolah.db'));
if (db.prepare('SELECT 1 FROM siswa LIMIT 1').get()) { console.log('Data sudah ada, seed dilewati.'); process.exit(0); }

const lid = db.prepare("SELECT id FROM lembaga WHERE kode = 'SMP'").get().id;
const guru = [['198001012005011001', 'Budi Santoso, S.Pd', 'L', 'Matematika'],
  ['198505152010012002', 'Siti Aminah, S.Pd', 'P', 'Bahasa Indonesia'],
  ['199002202015011003', 'Ahmad Fauzi, S.Ag', 'L', 'Pendidikan Agama']];
const g = db.prepare('INSERT INTO guru (lembaga_id, nip, nama, jk, mapel) VALUES (?,?,?,?,?)');
const gid = guru.map((x) => Number(g.run(lid, ...x).lastInsertRowid));
const k = db.prepare('INSERT INTO kelas (lembaga_id, nama, tahun_ajaran, wali_guru_id) VALUES (?,?,?,?)');
const kid = ['VII-A', 'VII-B'].map((n, i) => Number(k.run(lid, n, '2026/2027', gid[i]).lastInsertRowid));
const names = ['Andi Pratama', 'Budi Hartono', 'Citra Dewi', 'Dian Lestari', 'Eko Prasetyo', 'Fitri Handayani'];
const s = db.prepare('INSERT INTO siswa (lembaga_id, nis, nama, jk, kelas_id, wali) VALUES (?,?,?,?,?,?)');
names.forEach((n, i) => s.run(lid, '2026' + String(i + 1).padStart(3, '0'), n, i % 2 ? 'P' : 'L', kid[i % 2], 'Wali ' + n));
console.log('Data contoh dimasukkan ke SMP Plus Miftahul Ulum.');
