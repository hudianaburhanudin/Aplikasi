// Backup database yang konsisten (aman saat server berjalan): node backup.js [folder-tujuan]
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const src = process.env.DB_FILE || path.join(__dirname, 'data', 'sekolah.db');
const dir = process.argv[2] || path.join(__dirname, 'data', 'backup');
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, `sekolah-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)}.db`);
const db = new DatabaseSync(src);
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
console.log('Backup dibuat:', out);
