// Backup SQLite yang konsisten (VACUUM INTO) dengan rotasi. Dipakai server (otomatis) dan backup.js (manual).
const fs = require('fs');
const path = require('path');

const POLA = /^sekolah-\d{8}-\d{6}\.db$/;
const stempel = (d) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);   // 20261002-010500 (UTC)

function daftar(dir) {
  try { return fs.readdirSync(dir).filter((f) => POLA.test(f)).sort().reverse(); } catch { return []; }
}
function backupTerakhir(dir) {
  const f = daftar(dir)[0];
  try { return f ? fs.statSync(path.join(dir, f)).mtimeMs : 0; } catch { return 0; }
}
// Membuat salinan database lalu menghapus yang lebih lama dari `simpan` file terbaru.
function backupNow(db, dir, simpan = 14, sekarang = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `sekolah-${stempel(sekarang)}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const hapus = daftar(dir).slice(Math.max(1, simpan));
  for (const f of hapus) fs.unlinkSync(path.join(dir, f));
  return { file, dihapus: hapus };
}

module.exports = { backupNow, backupTerakhir, daftar };
