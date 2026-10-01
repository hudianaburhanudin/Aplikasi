const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openDb, hashPassword, verifyPassword } = require('./db');

// Konfigurasi tiap resource CRUD. `a` = alias tabel utama pada query `sel`.
const RES = {
  kelas: {
    a: 'k', table: 'kelas', cols: ['nama', 'tahun_ajaran', 'wali_guru_id'], req: ['nama'],
    sel: `SELECT k.*, g.nama wali_nama,
            (SELECT COUNT(*) FROM siswa s WHERE s.kelas_id = k.id AND s.status = 'aktif') jumlah
          FROM kelas k LEFT JOIN guru g ON g.id = k.wali_guru_id`,
    search: ['k.nama'], filters: {}, order: 'k.nama',
  },
  guru: {
    a: 'g', table: 'guru', cols: ['nip', 'nama', 'jk', 'mapel', 'telepon', 'alamat'], req: ['nama'],
    sel: 'SELECT g.* FROM guru g', search: ['g.nama', 'g.nip', 'g.mapel'], filters: {}, order: 'g.nama',
  },
  siswa: {
    a: 's', table: 'siswa',
    cols: ['nis', 'nama', 'jk', 'tgl_lahir', 'kelas_id', 'wali', 'telepon', 'alamat', 'status'], req: ['nama'],
    sel: 'SELECT s.*, k.nama kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id = s.kelas_id',
    search: ['s.nama', 's.nis'], filters: { kelas_id: 's.kelas_id', status: 's.status' }, order: 's.nama',
  },
  nilai: {
    a: 'n', table: 'nilai', cols: ['siswa_id', 'mapel', 'jenis', 'nilai', 'semester', 'tanggal'],
    req: ['siswa_id', 'mapel', 'nilai'],
    sel: `SELECT n.*, s.nama siswa_nama, s.nis, k.nama kelas_nama FROM nilai n
          JOIN siswa s ON s.id = n.siswa_id LEFT JOIN kelas k ON k.id = s.kelas_id`,
    search: ['s.nama', 'n.mapel'],
    filters: { siswa_id: 'n.siswa_id', kelas_id: 's.kelas_id', semester: 'n.semester' },
    order: 'n.tanggal DESC, n.id DESC',
  },
  pembayaran: {
    a: 'p', table: 'pembayaran', cols: ['siswa_id', 'jenis', 'bulan', 'jumlah', 'tanggal', 'keterangan'],
    req: ['siswa_id', 'jumlah', 'tanggal'],
    sel: `SELECT p.*, s.nama siswa_nama, s.nis, k.nama kelas_nama FROM pembayaran p
          JOIN siswa s ON s.id = p.siswa_id LEFT JOIN kelas k ON k.id = s.kelas_id`,
    search: ['s.nama', 's.nis'],
    filters: { siswa_id: 'p.siswa_id', kelas_id: 's.kelas_id', bulan: 'p.bulan' },
    order: 'p.tanggal DESC, p.id DESC',
  },
};
const NUMERIC = new Set(['nilai', 'jumlah']);
const ABSEN = new Set(['H', 'S', 'I', 'A']);
const ROLES = new Set(['admin', 'staf']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createApp(dbFile) {
  const db = openDb(dbFile);
  const sessions = new Map(); // token -> {user, exp}
  const attempts = new Map(); // ip -> {n, until}
  const PUBLIC_DIR = path.join(__dirname, 'public');
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const pw = process.env.ADMIN_PASSWORD || 'admin123';
    db.prepare('INSERT INTO users (username, password, nama, role) VALUES (?,?,?,?)')
      .run('admin', hashPassword(pw), 'Administrator', 'admin');
  }

  const clean = (cfg, body) => {
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
      out[c] = v;
    }
    for (const r of cfg.req) {
      if (out[r] === null || out[r] === undefined) {
        if (r in out || body.__create) throw new HttpError(400, `Kolom "${r}" wajib diisi`);
      }
    }
    return out;
  };

  function list(cfg, q) {
    const where = [], args = [];
    if (q.q) {
      where.push('(' + cfg.search.map((c) => `${c} LIKE ?`).join(' OR ') + ')');
      cfg.search.forEach(() => args.push(`%${q.q}%`));
    }
    for (const [k, col] of Object.entries(cfg.filters)) {
      if (q[k]) { where.push(`${col} = ?`); args.push(q[k]); }
    }
    const sql = `${cfg.sel}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${cfg.order}`;
    return db.prepare(sql).all(...args);
  }

  function crud(cfg, method, id, q, body) {
    if (method === 'GET' && !id) return list(cfg, q);
    if (method === 'GET') {
      const row = db.prepare(`${cfg.sel} WHERE ${cfg.a}.id = ?`).get(id);
      if (!row) throw new HttpError(404, 'Data tidak ditemukan');
      return row;
    }
    if (method === 'POST' && !id) {
      const d = clean(cfg, { ...body, __create: true });
      const keys = Object.keys(d);
      const r = db.prepare(`INSERT INTO ${cfg.table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
        .run(...keys.map((k) => d[k]));
      return { id: Number(r.lastInsertRowid) };
    }
    if (method === 'PUT' && id) {
      const d = clean(cfg, body);
      const keys = Object.keys(d);
      if (!keys.length) throw new HttpError(400, 'Tidak ada data untuk diubah');
      const r = db.prepare(`UPDATE ${cfg.table} SET ${keys.map((k) => k + ' = ?').join(',')} WHERE id = ?`)
        .run(...keys.map((k) => d[k]), id);
      if (!r.changes) throw new HttpError(404, 'Data tidak ditemukan');
      return { ok: true };
    }
    if (method === 'DELETE' && id) {
      const r = db.prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).run(id);
      if (!r.changes) throw new HttpError(404, 'Data tidak ditemukan');
      return { ok: true };
    }
    throw new HttpError(405, 'Metode tidak didukung');
  }

  function absensi(method, q, body) {
    if (method === 'GET') {
      if (!q.kelas_id || !q.tanggal) throw new HttpError(400, 'kelas_id dan tanggal wajib diisi');
      return db.prepare(`SELECT s.id siswa_id, s.nis, s.nama, a.status FROM siswa s
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
          up.run(Number(it.siswa_id), body.tanggal, it.status);
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return { ok: true };
    }
    throw new HttpError(405, 'Metode tidak didukung');
  }

  function rekapAbsensi(q) {
    if (!q.kelas_id || !q.bulan) throw new HttpError(400, 'kelas_id dan bulan (YYYY-MM) wajib diisi');
    return db.prepare(`SELECT s.id siswa_id, s.nis, s.nama,
        SUM(a.status = 'H') h, SUM(a.status = 'S') s, SUM(a.status = 'I') i, SUM(a.status = 'A') a
      FROM siswa s LEFT JOIN absensi a ON a.siswa_id = s.id AND substr(a.tanggal, 1, 7) = ?
      WHERE s.kelas_id = ? AND s.status = 'aktif' GROUP BY s.id ORDER BY s.nama`).all(q.bulan, q.kelas_id);
  }

  function dashboard() {
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const today = new Date().toISOString().slice(0, 10);
    const bulan = today.slice(0, 7);
    const abs = {};
    for (const r of db.prepare('SELECT status, COUNT(*) n FROM absensi WHERE tanggal = ? GROUP BY status').all(today)) abs[r.status] = r.n;
    return {
      siswa: one("SELECT COUNT(*) n FROM siswa WHERE status = 'aktif'").n,
      guru: one('SELECT COUNT(*) n FROM guru').n,
      kelas: one('SELECT COUNT(*) n FROM kelas').n,
      absensi_hari_ini: abs,
      pembayaran_bulan_ini: one('SELECT COALESCE(SUM(jumlah), 0) n FROM pembayaran WHERE substr(tanggal, 1, 7) = ?', bulan).n,
      per_kelas: db.prepare(`SELECT k.nama, COUNT(s.id) jumlah FROM kelas k
        LEFT JOIN siswa s ON s.kelas_id = k.id AND s.status = 'aktif' GROUP BY k.id ORDER BY k.nama`).all(),
    };
  }

  function rapor(q) {
    if (!q.siswa_id) throw new HttpError(400, 'siswa_id wajib diisi');
    const siswa = db.prepare(`SELECT s.*, k.nama kelas_nama, g.nama wali_kelas FROM siswa s
      LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN guru g ON g.id = k.wali_guru_id WHERE s.id = ?`).get(q.siswa_id);
    if (!siswa) throw new HttpError(404, 'Siswa tidak ditemukan');
    const sem = q.semester || null;
    const nilai = db.prepare(`SELECT mapel, ROUND(AVG(nilai), 1) rata, COUNT(*) jumlah FROM nilai
      WHERE siswa_id = ? AND (? IS NULL OR semester = ?) GROUP BY mapel ORDER BY mapel`).all(siswa.id, sem, sem);
    const absen = db.prepare(`SELECT SUM(status = 'H') h, SUM(status = 'S') s, SUM(status = 'I') i, SUM(status = 'A') a
      FROM absensi WHERE siswa_id = ?`).get(siswa.id);
    return { siswa, semester: sem, nilai, absensi: absen };
  }

  function users(method, id, body, me) {
    if (me.role !== 'admin') throw new HttpError(403, 'Hanya admin yang dapat mengelola pengguna');
    if (method === 'GET') return db.prepare('SELECT id, username, nama, role FROM users ORDER BY username').all();
    if (method === 'POST') {
      const { username, password, nama, role = 'staf' } = body;
      if (!username || !password || !nama) throw new HttpError(400, 'Username, password, dan nama wajib diisi');
      if (String(password).length < 6) throw new HttpError(400, 'Password minimal 6 karakter');
      if (!ROLES.has(role)) throw new HttpError(400, 'Role tidak valid');
      const r = db.prepare('INSERT INTO users (username, password, nama, role) VALUES (?,?,?,?)')
        .run(String(username).trim(), hashPassword(String(password)), String(nama).trim(), role);
      return { id: Number(r.lastInsertRowid) };
    }
    if (method === 'DELETE' && id) {
      if (id === me.id) throw new HttpError(400, 'Tidak dapat menghapus akun sendiri');
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      for (const [t, s] of sessions) if (s.user.id === id) sessions.delete(t);
      return { ok: true };
    }
    throw new HttpError(405, 'Metode tidak didukung');
  }

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

  const getSession = (req) => {
    const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
    const s = m && sessions.get(m[1]);
    if (!s) return null;
    if (s.exp < Date.now()) { sessions.delete(m[1]); return null; }
    return { token: m[1], user: s.user };
  };

  const send = (res, status, data, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(data));
  };

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // buang "api"
    const [name, idStr] = parts;
    const id = idStr ? Number(idStr) : null;
    const method = req.method;

    if (name === 'login' && method === 'POST') {
      const ip = req.socket.remoteAddress;
      const at = attempts.get(ip);
      if (at && at.n >= 5 && at.until > Date.now()) throw new HttpError(429, 'Terlalu banyak percobaan, coba lagi nanti');
      const { username, password } = await readBody(req);
      const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
      if (!u || !verifyPassword(String(password || ''), u.password)) {
        attempts.set(ip, { n: (at && at.until > Date.now() ? at.n : 0) + 1, until: Date.now() + 5 * 60e3 });
        throw new HttpError(401, 'Username atau password salah');
      }
      attempts.delete(ip);
      const token = crypto.randomBytes(24).toString('hex');
      const user = { id: u.id, username: u.username, nama: u.nama, role: u.role };
      sessions.set(token, { user, exp: Date.now() + 12 * 3600e3 });
      return send(res, 200, user, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
    }

    const sess = getSession(req);
    if (!sess) throw new HttpError(401, 'Silakan login terlebih dahulu');
    const me = sess.user;
    const q = Object.fromEntries(url.searchParams);

    if (name === 'logout' && method === 'POST') {
      sessions.delete(sess.token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
    }
    if (name === 'me') return send(res, 200, me);
    if (name === 'password' && method === 'POST') {
      const { lama, baru } = await readBody(req);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id);
      if (!verifyPassword(String(lama || ''), u.password)) throw new HttpError(400, 'Password lama salah');
      if (String(baru || '').length < 6) throw new HttpError(400, 'Password baru minimal 6 karakter');
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(String(baru)), me.id);
      return send(res, 200, { ok: true });
    }
    if (name === 'dashboard') return send(res, 200, dashboard());
    if (name === 'rapor') return send(res, 200, rapor(q));
    if (name === 'rekap-absensi') return send(res, 200, rekapAbsensi(q));
    if (name === 'absensi') return send(res, 200, absensi(method, q, method === 'POST' ? await readBody(req) : {}));
    if (name === 'users') return send(res, 200, users(method, id, method === 'POST' ? await readBody(req) : {}, me));
    if (RES[name]) {
      const body = method === 'POST' || method === 'PUT' ? await readBody(req) : {};
      return send(res, 200, crud(RES[name], method, id, q, body));
    }
    throw new HttpError(404, 'Endpoint tidak ditemukan');
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.join(PUBLIC_DIR, rel);
      if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); return res.end('Tidak ditemukan');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      let status = e.status || 500, msg = e.message;
      if (/UNIQUE constraint/.test(msg)) { status = 409; msg = 'Data duplikat: NIS/NIP/username sudah digunakan'; }
      else if (/FOREIGN KEY|constraint/i.test(msg)) { status = 400; msg = 'Data terkait tidak valid atau masih digunakan'; }
      else if (status === 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'Kesalahan server' : msg });
    }
  });
  return { server, db };
}

module.exports = { createApp };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const file = process.env.DB_FILE || path.join(__dirname, 'data', 'sekolah.db');
  createApp(file).server.listen(port, () => {
    console.log(`Administrasi Sekolah berjalan di http://localhost:${port}`);
    console.log('Login awal: admin / admin123 (segera ganti password)');
  });
}
