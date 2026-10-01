const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openDb, hashPassword, verifyPassword } = require('./db');
const { buildXlsx } = require('./xlsx');
const { tablePdf, raporPdf, kuitansiPdf } = require('./pdf');

const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

// Konfigurasi tiap resource CRUD.
//  a: alias tabel utama pada `sel`; scopeCol/scopeKey: kolom & properti baris penentu lembaga;
//  own: baris baru otomatis diberi lembaga aktif; writeRole: peran yang boleh menulis.
const LJ = 'LEFT JOIN lembaga l ON l.id = ';
const RES = {
  lembaga: {
    a: 'l', table: 'lembaga', cols: ['kode', 'nama', 'jenjang', 'alamat', 'telepon'], req: ['kode', 'nama'],
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
    a: 'g', table: 'guru', cols: ['nip', 'nama', 'jk', 'mapel', 'telepon', 'alamat'], req: ['nama'], own: true,
    sel: `SELECT g.*, l.kode lembaga_kode FROM guru g ${LJ}g.lembaga_id`,
    search: ['g.nama', 'g.nip', 'g.mapel'], filters: {}, order: 'l.id, g.nama', scopeCol: 'g.lembaga_id', scopeKey: 'lembaga_id',
  },
  siswa: {
    a: 's', table: 'siswa', own: true,
    cols: ['nis', 'nama', 'jk', 'tgl_lahir', 'kelas_id', 'wali', 'telepon', 'alamat', 'status'], req: ['nama'],
    sel: `SELECT s.*, l.kode lembaga_kode, k.nama kelas_nama FROM siswa s ${LJ}s.lembaga_id LEFT JOIN kelas k ON k.id = s.kelas_id`,
    search: ['s.nama', 's.nis'], filters: { kelas_id: 's.kelas_id', status: 's.status' }, order: 'l.id, s.nama',
    scopeCol: 's.lembaga_id', scopeKey: 'lembaga_id',
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
  'rekap-absensi': ['Rekap Absensi', [['NIS', 'nis'], ['Nama', 'nama'], ['Hadir', 'h'], ['Sakit', 's'], ['Izin', 'i'], ['Alpa', 'a']]],
};
const NUMERIC = new Set(['nilai', 'jumlah', 'aktif']);
const ABSEN = new Set(['H', 'S', 'I', 'A']);
const ROLES = ['yayasan', 'admin', 'staf'];
const ph = (a) => a.map(() => '?').join(',');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createApp(dbFile) {
  const db = openDb(dbFile);
  const sessions = new Map(); // token -> {userId, exp}
  const attempts = new Map(); // ip -> {n, until}
  const PUBLIC_DIR = path.join(__dirname, 'public');
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    db.prepare('INSERT INTO users (username, password, nama, role) VALUES (?,?,?,?)')
      .run('admin', hashPassword(pw), 'Admin Yayasan', 'yayasan');
    if (!process.env.ADMIN_PASSWORD) console.log(`Akun awal dibuat -> username: admin  password: ${pw}  (catat dan segera ganti)`);
  }

  // ---- pengguna & lingkup lembaga ----
  const allLembaga = () => db.prepare('SELECT id, kode, nama FROM lembaga ORDER BY id').all();
  const userLembagaIds = (u) => (u.role === 'yayasan'
    ? allLembaga().map((l) => l.id)
    : db.prepare('SELECT lembaga_id id FROM user_lembaga WHERE user_id = ?').all(u.id).map((r) => r.id));
  const publicUser = (u) => {
    const ids = userLembagaIds(u);
    return { id: u.id, username: u.username, nama: u.nama, role: u.role,
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
      const keys = Object.keys(d);
      const r = db.prepare(`INSERT INTO ${cfg.table} (${keys.join(',')}) VALUES (${ph(keys)})`).run(...keys.map((k) => d[k]));
      const newId = Number(r.lastInsertRowid);
      if (cfg.table === 'tahun_ajaran' && d.aktif === 1) db.prepare('UPDATE tahun_ajaran SET aktif = 0 WHERE id != ?').run(newId);
      return { id: newId };
    }
    if (method === 'PUT' && id) {
      const row = getRow(cfg, id, ctx);
      const d = clean(cfg, body, false);
      const keys = Object.keys(d);
      if (!keys.length) throw new HttpError(400, 'Tidak ada data untuk diubah');
      checkRefs(cfg, d, cfg.scopeKey ? row[cfg.scopeKey] : null, ctx);
      db.prepare(`UPDATE ${cfg.table} SET ${keys.map((k) => k + ' = ?').join(',')} WHERE id = ?`).run(...keys.map((k) => d[k]), id);
      if (cfg.table === 'tahun_ajaran' && d.aktif === 1) db.prepare('UPDATE tahun_ajaran SET aktif = 0 WHERE id != ?').run(id);
      return { ok: true };
    }
    if (method === 'DELETE' && id) {
      getRow(cfg, id, ctx);
      db.prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).run(id);
      return { ok: true };
    }
    throw new HttpError(405, 'Metode tidak didukung');
  }

  function absensi(method, q, body, ctx) {
    if (method === 'GET') {
      if (!q.kelas_id || !q.tanggal) throw new HttpError(400, 'kelas_id dan tanggal wajib diisi');
      lembagaOf('kelas', q.kelas_id, ctx);
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
    const siswa = db.prepare(`SELECT s.*, l.nama lembaga_nama, k.nama kelas_nama, g.nama wali_kelas FROM siswa s
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
    const canManage = (u) => me.role === 'yayasan' || (u.role === 'staf' && idsOf(u.id).length > 0 && idsOf(u.id).every((i) => myIds.includes(i)));
    const roleOk = (r) => (me.role === 'yayasan' ? ROLES.includes(r) : r === 'staf');
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
    if (id && (!target || !canManage(target))) throw new HttpError(404, 'Pengguna tidak ditemukan');

    if (method === 'GET') {
      return db.prepare('SELECT id, username, nama, role FROM users ORDER BY username').all()
        .map((u) => ({ ...u, lembaga_ids: idsOf(u.id) }))
        .filter((u) => me.role === 'yayasan' || (u.role !== 'yayasan' && u.lembaga_ids.some((i) => myIds.includes(i))));
    }
    if (method === 'POST') {
      const { username, password, nama, role = 'staf' } = body;
      if (!username || !password || !nama) throw new HttpError(400, 'Username, password, dan nama wajib diisi');
      if (String(password).length < 6) throw new HttpError(400, 'Password minimal 6 karakter');
      if (!roleOk(role)) throw new HttpError(400, 'Role tidak valid');
      const arr = parseIds(role, body.lembaga_ids);
      db.exec('BEGIN');
      try {
        const r = db.prepare('INSERT INTO users (username, password, nama, role) VALUES (?,?,?,?)')
          .run(String(username).trim(), hashPassword(String(password)), String(nama).trim(), role);
        setLembaga(Number(r.lastInsertRowid), arr);
        db.exec('COMMIT');
        return { id: Number(r.lastInsertRowid) };
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    if (method === 'PUT' && target) {
      const role = body.role || target.role;
      if (body.role && !roleOk(role)) throw new HttpError(400, 'Role tidak valid');
      if (role !== target.role && (target.id === me.id || lastYayasan(target))) throw new HttpError(400, 'Role akun ini tidak dapat diubah');
      if (body.password && String(body.password).length < 6) throw new HttpError(400, 'Password minimal 6 karakter');
      const arr = 'lembaga_ids' in body || role !== target.role ? parseIds(role, 'lembaga_ids' in body ? body.lembaga_ids : idsOf(target.id)) : null;
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE users SET nama = ?, role = ? WHERE id = ?').run(String(body.nama || target.nama).trim(), role, target.id);
        if (body.password) {
          db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(String(body.password)), target.id);
          for (const [t, s] of sessions) if (s.userId === target.id) sessions.delete(t);
        }
        if (arr) setLembaga(target.id, arr);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return { ok: true };
    }
    if (method === 'DELETE' && target) {
      if (target.id === me.id) throw new HttpError(400, 'Tidak dapat menghapus akun sendiri');
      if (lastYayasan(target)) throw new HttpError(400, 'Akun admin yayasan terakhir tidak dapat dihapus');
      db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
      for (const [t, s] of sessions) if (s.userId === target.id) sessions.delete(t);
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
      sessions.set(token, { userId: u.id, exp: Date.now() + 12 * 3600e3 });
      return send(res, 200, publicUser(u), { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
    }

    const sess = getSession(req);
    if (!sess) throw new HttpError(401, 'Silakan login terlebih dahulu');
    const ctx = { user: sess.user, scope: scopeOf(sess.user, req) };
    const q = Object.fromEntries(url.searchParams);

    if (name === 'logout' && method === 'POST') {
      sessions.delete(sess.token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
    }
    if (name === 'me') return send(res, 200, ctx.user);
    if (name === 'password' && method === 'POST') {
      const { lama, baru } = await readBody(req);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
      if (!verifyPassword(String(lama || ''), u.password)) throw new HttpError(400, 'Password lama salah');
      if (String(baru || '').length < 6) throw new HttpError(400, 'Password baru minimal 6 karakter');
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(String(baru)), u.id);
      return send(res, 200, { ok: true });
    }
    if ((name === 'export' || name === 'pdf') && method === 'GET') {
      const key = parts[1], today = todayWib();
      const file = (buf, type, fname) => {
        res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${fname}"` });
        return res.end(buf);
      };
      if (name === 'pdf' && key === 'rapor') return file(raporPdf(rapor(q, ctx)), 'application/pdf', `rapor-${q.siswa_id}.pdf`);
      if (name === 'pdf' && key === 'kuitansi') return file(kuitansiPdf(crud(RES.pembayaran, 'GET', Number(q.id), {}, {}, ctx), rp), 'application/pdf', `kuitansi-${q.id}.pdf`);
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
      return file(tablePdf({ title: ex[0], subtitle: sub, headers: cols.map((i) => ex[1][i][0]), rows: rows.map((r) => cols.map((i) => r[i])), footer: total }),
        'application/pdf', `${key}-${today}.pdf`);
    }
    if (name === 'dashboard') return send(res, 200, dashboard(ctx));
    if (name === 'rapor') return send(res, 200, rapor(q, ctx));
    if (name === 'rekap-absensi') return send(res, 200, rekapAbsensi(q, ctx));
    if (name === 'absensi') return send(res, 200, absensi(method, q, method === 'POST' ? await readBody(req) : {}, ctx));
    if (name === 'users') return send(res, 200, users(method, id, method === 'POST' || method === 'PUT' ? await readBody(req) : {}, ctx));
    if (RES[name]) {
      const body = method === 'POST' || method === 'PUT' ? await readBody(req) : {};
      return send(res, 200, crud(RES[name], method, id, q, body, ctx));
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
      if (/UNIQUE constraint/.test(msg)) { status = 409; msg = 'Data duplikat: NIS/NIP/username/kode sudah digunakan'; }
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
  createApp(file).server.listen(port, () => console.log(`Administrasi Yayasan berjalan di http://localhost:${port}`));
}
