// Backup manual: node backup.js [folder-tujuan]   (aman saat server berjalan)
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { backupNow } = require('./backup-lib');
const src = process.env.DB_FILE || path.join(__dirname, 'data', 'sekolah.db');
const dir = process.argv[2] || process.env.BACKUP_DIR || path.join(path.dirname(src), 'backup');
const r = backupNow(new DatabaseSync(src), dir, Number(process.env.BACKUP_KEEP) || 14);
console.log('Backup dibuat:', r.file, r.dihapus.length ? `(${r.dihapus.length} backup lama dihapus)` : '');
