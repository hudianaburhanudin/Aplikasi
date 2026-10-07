// Aplikasi belajar siswa: akun siswa, materi, ujian online (soal pilihan ganda & uraian), penilaian, dan penulisan ke tabel nilai.
// Semua pemeriksaan waktu dan kunci jawaban dilakukan di server; kunci tidak pernah dikirim ke siswa.
const crypto = require('crypto');

const JENIS_NILAI = { harian: 'Ulangan Harian', uts: 'UTS', semester: 'UAS' };
const MAKS_SOAL = 200;
const WIB = 7 * 3600e3;
const nowWibStr = () => new Date(Date.now() + WIB).toISOString().slice(0, 16);   // 'YYYY-MM-DDTHH:MM' WIB
const waktuMs = (s) => Date.parse(String(s).replace(' ', 'T') + ':00+07:00');
// 'YYYY-MM-DDTHH:MM' atau 'YYYY-MM-DD HH:MM' -> 'YYYY-MM-DDTHH:MM' (WIB), null bila tidak valid
const normWaktu = (v) => {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(String(v ?? '').trim());
  if (!m || Number.isNaN(waktuMs(`${m[1]}T${m[2]}:${m[3]}`)) || +m[2] > 23 || +m[3] > 59) return null;
  return `${m[1]}T${m[2]}:${m[3]}`;
};
const semesterSekarang = () => (new Date(Date.now() + WIB).getUTCMonth() >= 6 ? 'Ganjil' : 'Genap');

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function acakTetap(arr, seed) { const r = mulberry32(seed), a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function createUjian({ db, HttpError, catat, str, ph, todayWib, hashPassword, genPassword, sessions, lembagaOf }) {
  const J = (v, d) => { try { return JSON.parse(v); } catch { return d; } };

  // ---------- penilaian ----------
  function hitung(ujian, soalList, peserta) {
    const jawab = J(peserta.jawaban, {}), skor = J(peserta.skor, {});
    let adaUraian = false, bobot = 0, dapat = 0, benar = 0, pg = 0;
    for (const s of soalList) {
      bobot += s.bobot;
      if (s.tipe === 'pg') {
        pg++;
        const ok = Number.isInteger(jawab[s.id]) && jawab[s.id] === s.kunci;
        skor[s.id] = ok ? s.bobot : 0; if (ok) benar++;
      } else if (skor[s.id] === undefined) adaUraian = true;
      dapat += Number(skor[s.id]) || 0;
    }
    return { skor, nilai: adaUraian || !bobot ? null : Math.round(dapat / bobot * 1000) / 10, menunggu: adaUraian, benar, pg };
  }
  function tulisNilai(peserta, ujian, nilai) {
    if (nilai === null) return peserta.nilai_id;
    const jenis = JENIS_NILAI[ujian.jenis] || 'Ulangan Harian', tgl = todayWib();
    const ada = peserta.nilai_id && db.prepare('SELECT id FROM nilai WHERE id = ? AND siswa_id = ?').get(peserta.nilai_id, peserta.siswa_id);
    if (ada) { db.prepare('UPDATE nilai SET mapel = ?, jenis = ?, nilai = ?, semester = ?, tanggal = ? WHERE id = ?').run(ujian.mapel, jenis, nilai, ujian.semester, tgl, ada.id); return ada.id; }
    return Number(db.prepare('INSERT INTO nilai (siswa_id, mapel, jenis, nilai, semester, tanggal) VALUES (?,?,?,?,?,?)').run(peserta.siswa_id, ujian.mapel, jenis, nilai, ujian.semester, tgl).lastInsertRowid);
  }
  function selesaikan(pesertaId) {
    const p = db.prepare('SELECT * FROM ujian_peserta WHERE id = ?').get(pesertaId);
    if (!p) return null;
    const u = db.prepare('SELECT * FROM ujian WHERE id = ?').get(p.ujian_id);
    const soalList = db.prepare('SELECT * FROM soal WHERE ujian_id = ? ORDER BY urut').all(u.id);
    const h = hitung(u, soalList, p);
    db.exec('BEGIN');
    try {
      const nid = tulisNilai(p, u, h.nilai);
      db.prepare("UPDATE ujian_peserta SET status = 'selesai', selesai_at = COALESCE(selesai_at, ?), skor = ?, nilai = ?, nilai_id = ? WHERE id = ?")
        .run(Math.min(Date.now(), p.batas), JSON.stringify(h.skor), h.nilai, nid ?? null, p.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { ...h, id: p.id };
  }
  // Pengerjaan yang waktunya habis ditutup otomatis (dipanggil saat ada akses dan berkala)
  function tutupKadaluwarsa(ujianId) {
    const rows = db.prepare(`SELECT id FROM ujian_peserta WHERE status = 'berjalan' AND batas < ? ${ujianId ? 'AND ujian_id = ?' : ''}`).all(Date.now(), ...(ujianId ? [ujianId] : []));
    for (const r of rows) selesaikan(r.id);
    return rows.length;
  }

  // ---------- validasi & soal (sisi guru/admin) ----------
  function cekUjian(d, row) {
    for (const k of ['mulai', 'selesai']) if (k in d && d[k] !== null) { d[k] = normWaktu(d[k]); if (!d[k]) throw new HttpError(400, 'Waktu harus berformat tanggal dan jam yang valid'); }
    const m = d.mulai ?? (row && row.mulai), s = d.selesai ?? (row && row.selesai);
    if (m && s && waktuMs(s) <= waktuMs(m)) throw new HttpError(400, 'Waktu selesai harus setelah waktu mulai');
    if ('durasi' in d && !(Number.isInteger(d.durasi) && d.durasi >= 1 && d.durasi <= 600)) throw new HttpError(400, 'Durasi 1-600 menit');
    for (const k of ['acak', 'tampil_nilai']) if (k in d && ![0, 1].includes(d[k])) throw new HttpError(400, `Nilai "${k}" tidak valid`);
    if ('judul' in d && d.judul) d.judul = d.judul.slice(0, 150);
    if ('mapel' in d && d.mapel) d.mapel = d.mapel.slice(0, 100);
    if ('petunjuk' in d && d.petunjuk) d.petunjuk = d.petunjuk.slice(0, 2000);
    if (row) {
      const mulaiKerja = db.prepare('SELECT COUNT(*) n FROM ujian_peserta WHERE ujian_id = ?').get(row.id).n;
      if (mulaiKerja && ('kelas_id' in d && d.kelas_id !== row.kelas_id)) throw new HttpError(409, 'Kelas tidak dapat diubah karena sudah ada siswa yang mengerjakan');
      if (mulaiKerja && d.status === 'draft') throw new HttpError(409, 'Ujian yang sudah dikerjakan tidak dapat dikembalikan ke draf');
      if (d.status === 'terbit' && !db.prepare('SELECT 1 FROM soal WHERE ujian_id = ?').get(row.id)) throw new HttpError(400, 'Tambahkan soal sebelum menerbitkan ujian');
    } else if (d.status === 'terbit') throw new HttpError(400, 'Simpan ujian dan tambahkan soal dulu, baru diterbitkan');
    if (!row && !d.semester) d.semester = semesterSekarang();
  }
  const ujianTerlihat = (id, ctx) => {
    const u = db.prepare('SELECT u.*, k.nama kelas_nama FROM ujian u JOIN kelas k ON k.id = u.kelas_id WHERE u.id = ?').get(Number(id));
    if (!u || !ctx.scope.ids.includes(u.lembaga_id)) throw new HttpError(404, 'Ujian tidak ditemukan');
    return u;
  };
  function soalAdmin(q, ctx) {
    const u = ujianTerlihat(q.ujian_id, ctx);
    const kerja = db.prepare('SELECT COUNT(*) n FROM ujian_peserta WHERE ujian_id = ?').get(u.id).n;
    return { ujian: u, terkunci: kerja > 0, soal: db.prepare('SELECT id, urut, tipe, teks, opsi, kunci, bobot FROM soal WHERE ujian_id = ? ORDER BY urut').all(u.id).map((s) => ({ ...s, opsi: J(s.opsi, null) })) };
  }
  function simpanSoal(body, ctx) {
    const u = ujianTerlihat(body.ujian_id, ctx);
    if (db.prepare('SELECT 1 FROM ujian_peserta WHERE ujian_id = ?').get(u.id)) throw new HttpError(409, 'Soal tidak dapat diubah karena sudah ada siswa yang mengerjakan');
    const list = Array.isArray(body.soal) ? body.soal : [];
    if (list.length > MAKS_SOAL) throw new HttpError(400, `Maksimal ${MAKS_SOAL} soal`);
    const bersih = list.map((s, i) => {
      const no = `Soal ${i + 1}`, tipe = s.tipe === 'uraian' ? 'uraian' : s.tipe === 'pg' ? 'pg' : null;
      if (!tipe) throw new HttpError(400, `${no}: tipe harus pg atau uraian`);
      const teks = str(s.teks, 3000);
      if (!teks) throw new HttpError(400, `${no}: teks soal kosong`);
      const bobot = Number(s.bobot ?? 1);
      if (!(bobot > 0 && bobot <= 1000)) throw new HttpError(400, `${no}: bobot harus lebih dari 0`);
      if (tipe === 'uraian') return { tipe, teks, opsi: null, kunci: null, bobot };
      const opsi = (Array.isArray(s.opsi) ? s.opsi : []).map((o) => str(o, 500)).filter((o) => o !== null);
      if (opsi.length < 2 || opsi.length > 6) throw new HttpError(400, `${no}: pilihan jawaban 2-6`);
      const kunci = Number(s.kunci);
      if (!Number.isInteger(kunci) || kunci < 0 || kunci >= opsi.length) throw new HttpError(400, `${no}: kunci jawaban belum dipilih`);
      return { tipe, teks, opsi, kunci, bobot };
    });
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM soal WHERE ujian_id = ?').run(u.id);
      const ins = db.prepare('INSERT INTO soal (ujian_id, urut, tipe, teks, opsi, kunci, bobot) VALUES (?,?,?,?,?,?,?)');
      bersih.forEach((s, i) => ins.run(u.id, i + 1, s.tipe, s.teks, s.opsi && JSON.stringify(s.opsi), s.kunci, s.bobot));
      if (!bersih.length && u.status === 'terbit') db.prepare("UPDATE ujian SET status = 'draft' WHERE id = ?").run(u.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    catat(ctx.user, 'simpan_soal', `ujian #${u.id} ${u.judul}: ${bersih.length} soal`);
    return { ok: true, jumlah: bersih.length };
  }

  // ---------- hasil (sisi guru/admin) ----------
  function hasilList(q, ctx) {
    const u = ujianTerlihat(q.ujian_id, ctx);
    tutupKadaluwarsa(u.id);
    const jml = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(bobot), 0) b FROM soal WHERE ujian_id = ?').get(u.id);
    const rows = db.prepare(`SELECT s.id siswa_id, s.nama, s.nis, p.id peserta_id, p.status, p.nilai, p.mulai_at, p.selesai_at, p.pindah_tab
      FROM siswa s LEFT JOIN ujian_peserta p ON p.siswa_id = s.id AND p.ujian_id = ? WHERE s.kelas_id = ? AND s.status = 'aktif' ORDER BY s.nama`).all(u.id, u.kelas_id);
    const nilai = rows.filter((r) => r.nilai !== null && r.nilai !== undefined).map((r) => r.nilai);
    return { ujian: u, jumlah_soal: jml.n, ringkas: { siswa: rows.length, mengerjakan: rows.filter((r) => r.peserta_id).length, selesai: rows.filter((r) => r.status === 'selesai').length,
      menunggu_nilai: rows.filter((r) => r.status === 'selesai' && r.nilai === null).length, rata: nilai.length ? Math.round(nilai.reduce((a, b) => a + b, 0) / nilai.length * 10) / 10 : null,
      tertinggi: nilai.length ? Math.max(...nilai) : null, terendah: nilai.length ? Math.min(...nilai) : null }, peserta: rows };
  }
  function pesertaTerlihat(pid, ctx) {
    const p = db.prepare('SELECT p.*, s.nama siswa_nama FROM ujian_peserta p JOIN siswa s ON s.id = p.siswa_id WHERE p.id = ?').get(Number(pid));
    if (!p) throw new HttpError(404, 'Data tidak ditemukan');
    return { p, u: ujianTerlihat(p.ujian_id, ctx) };
  }
  function hasilDetail(pid, ctx) {
    const { p, u } = pesertaTerlihat(pid, ctx);
    if (p.status === 'berjalan' && p.batas < Date.now()) selesaikan(p.id);
    const p2 = db.prepare('SELECT * FROM ujian_peserta WHERE id = ?').get(p.id), jawab = J(p2.jawaban, {}), skor = J(p2.skor, {});
    return { ujian: u, siswa: p.siswa_nama, status: p2.status, nilai: p2.nilai, pindah_tab: p2.pindah_tab,
      soal: db.prepare('SELECT id, urut, tipe, teks, opsi, kunci, bobot FROM soal WHERE ujian_id = ? ORDER BY urut').all(u.id).map((s) => ({ ...s, opsi: J(s.opsi, null), jawaban: jawab[s.id] ?? null, skor: skor[s.id] ?? null })) };
  }
  // Guru memberi skor soal uraian: body.skor = { soal_id: angka (0..bobot) }
  function nilaiUraian(pid, body, ctx) {
    const { p, u } = pesertaTerlihat(pid, ctx);
    if (p.status !== 'selesai') throw new HttpError(409, 'Siswa belum selesai mengerjakan');
    const soalList = db.prepare('SELECT * FROM soal WHERE ujian_id = ?').all(u.id), skor = J(p.skor, {});
    for (const [sid, v] of Object.entries(body.skor || {})) {
      const s = soalList.find((x) => x.id === Number(sid));
      if (!s || s.tipe !== 'uraian') throw new HttpError(400, 'Hanya soal uraian yang dapat diberi skor manual');
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > s.bobot) throw new HttpError(400, `Skor 0 sampai ${s.bobot}`);
      skor[sid] = n;
    }
    db.prepare('UPDATE ujian_peserta SET skor = ? WHERE id = ?').run(JSON.stringify(skor), p.id);
    const r = selesaikan(p.id);
    catat(ctx.user, 'nilai_uraian', `ujian #${u.id}, siswa ${p.siswa_nama}`);
    return { ok: true, nilai: r.nilai, menunggu: r.menunggu };
  }
  function hasilExport(q, ctx) {
    const h = hasilList(q, ctx);
    const label = { selesai: 'Selesai', berjalan: 'Sedang mengerjakan' };
    return { judul: `Hasil ${h.ujian.judul}`, header: ['No', 'NIS', 'Nama', 'Status', 'Nilai', 'Pindah tab'],
      rows: h.peserta.map((r, i) => [i + 1, r.nis || '', r.nama, label[r.status] || 'Belum mengerjakan', r.nilai === null || r.nilai === undefined ? '' : r.nilai, r.pindah_tab ?? '']) };
  }

  // ---------- akun siswa ----------
  const adaAkun = (siswaId) => db.prepare('SELECT u.id, u.username, u.must_change FROM siswa_user su JOIN users u ON u.id = su.user_id WHERE su.siswa_id = ?').get(siswaId);
  function usernameUntuk(s) {
    const dasar = String(s.nisn || (s.nis ? `${s.lembaga_kode}.${s.nis}` : `s${s.id}`)).toLowerCase().replace(/[^a-z0-9._-]/g, '');
    let u = dasar.length >= 4 ? dasar : `s${s.id}`;
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(u)) u = `${u}-${s.id}`;
    return u;
  }
  function akunSiswa(method, q, body, ctx) {
    const pilih = (b) => {
      if (b.siswa_id) { lembagaOf('siswa', Number(b.siswa_id), ctx); return [Number(b.siswa_id)]; }
      if (!b.kelas_id) throw new HttpError(400, 'Pilih kelas atau siswa');
      lembagaOf('kelas', Number(b.kelas_id), ctx);
      return db.prepare("SELECT id FROM siswa WHERE kelas_id = ? AND status = 'aktif' ORDER BY nama").all(Number(b.kelas_id)).map((r) => r.id);
    };
    const info = (id) => db.prepare('SELECT s.id, s.nama, s.nis, s.nisn, s.status, l.kode lembaga_kode, k.nama kelas_nama FROM siswa s JOIN lembaga l ON l.id = s.lembaga_id LEFT JOIN kelas k ON k.id = s.kelas_id WHERE s.id = ?').get(id);
    if (method === 'GET') {
      return pilih(q).map((id) => { const s = info(id), a = adaAkun(id); return { siswa_id: id, nama: s.nama, nis: s.nis, kelas: s.kelas_nama, username: a ? a.username : null, must_change: a ? !!a.must_change : null }; });
    }
    if (method !== 'POST') throw new HttpError(405, 'Metode tidak didukung');
    const ids = pilih(body);
    if (ids.length > 400) throw new HttpError(400, 'Maksimal 400 siswa sekaligus');
    const hasil = [];
    db.exec('BEGIN');
    try {
      for (const id of ids) {
        const s = info(id), a = adaAkun(id);
        if (s.status !== 'aktif') continue;
        if (a && !body.reset) continue;                        // sudah punya akun: tidak diubah kecuali reset
        const password = genPassword().slice(0, 8);
        if (a) {
          db.prepare('UPDATE users SET password = ?, must_change = 1 WHERE id = ?').run(hashPassword(password), a.id);
          for (const [t, ses] of sessions) if (ses.userId === a.id) sessions.delete(t);
          hasil.push({ siswa_id: id, nama: s.nama, kelas: s.kelas_nama, username: a.username, password, baru: false });
        } else {
          const username = usernameUntuk(s);
          const uid = Number(db.prepare("INSERT INTO users (username, password, nama, role, must_change) VALUES (?,?,?,'siswa',1)").run(username, hashPassword(password), s.nama).lastInsertRowid);
          db.prepare('INSERT INTO siswa_user (user_id, siswa_id) VALUES (?,?)').run(uid, id);
          hasil.push({ siswa_id: id, nama: s.nama, kelas: s.kelas_nama, username, password, baru: true });
        }
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    catat(ctx.user, body.reset ? 'reset_akun_siswa' : 'buat_akun_siswa', `${hasil.length} akun`);
    return { akun: hasil, dilewati: ids.length - hasil.length };
  }

  // ---------- API siswa (aplikasi belajar) ----------
  function siswaDariAkun(ctx) {
    const s = db.prepare(`SELECT s.id, s.nama, s.nis, s.status, s.kelas_id, s.lembaga_id, l.nama lembaga_nama, l.kode lembaga_kode, k.nama kelas_nama
      FROM siswa_user su JOIN siswa s ON s.id = su.siswa_id JOIN lembaga l ON l.id = s.lembaga_id LEFT JOIN kelas k ON k.id = s.kelas_id WHERE su.user_id = ?`).get(ctx.user.id);
    if (!s) throw new HttpError(403, 'Akun belum tertaut ke data siswa');
    if (s.status !== 'aktif') throw new HttpError(403, 'Akun siswa tidak aktif');
    return s;
  }
  function statusUjian(u, p) {
    const sk = nowWibStr();
    if (p && p.status === 'selesai') return 'selesai';
    if (p && p.status === 'berjalan' && p.batas >= Date.now()) return 'berjalan';
    if (p) return 'selesai';
    if (sk < u.mulai) return 'belum';
    if (sk > u.selesai) return 'terlewat';
    return 'buka';
  }
  function ringkasUjian(u, p) {
    const st = statusUjian(u, p), tampil = !!u.tampil_nilai;
    return { id: u.id, mapel: u.mapel, judul: u.judul, jenis: u.jenis, mulai: u.mulai, selesai: u.selesai, durasi: u.durasi, jumlah_soal: u.jumlah_soal, status: st,
      nilai: st === 'selesai' && tampil && p && p.nilai !== null ? p.nilai : null, menunggu_nilai: st === 'selesai' && p && p.nilai === null };
  }
  const ujianKelas = (s) => db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM soal WHERE ujian_id = u.id) jumlah_soal FROM ujian u
    WHERE u.kelas_id = ? AND u.status = 'terbit' ORDER BY u.mulai DESC`).all(s.kelas_id || -1);
  function soalUntukSiswa(u, p, siswaId) {
    let list = db.prepare('SELECT id, tipe, teks, opsi, bobot FROM soal WHERE ujian_id = ? ORDER BY urut').all(u.id).map((s) => ({ ...s, opsi: J(s.opsi, null) }));
    if (u.acak) list = acakTetap(list, siswaId * 100003 + u.id);
    return list.map((s, i) => {
      let opsi = s.opsi && s.opsi.map((t, idx) => ({ i: idx, t }));
      if (opsi && u.acak) opsi = acakTetap(opsi, siswaId * 7919 + s.id);
      return { id: s.id, no: i + 1, tipe: s.tipe, teks: s.teks, opsi, bobot: s.bobot };
    });
  }
  function sesiUjian(u, p, siswaId) {
    return { ujian: { id: u.id, mapel: u.mapel, judul: u.judul, durasi: u.durasi, petunjuk: u.petunjuk }, batas: p.batas, sekarang: Date.now(),
      soal: soalUntukSiswa(u, p, siswaId), jawaban: J(p.jawaban, {}) };
  }
  function belajar(parts, method, body, ctx) {
    const s = siswaDariAkun(ctx), what = parts[1];
    tutupKadaluwarsa();
    if (what === 'profil') return { siswa: { nama: s.nama, nis: s.nis, kelas_nama: s.kelas_nama, lembaga_nama: s.lembaga_nama, lembaga_kode: s.lembaga_kode }, sekarang: Date.now() };
    if (what === 'materi') {
      return db.prepare(`SELECT id, mapel, judul, isi, tautan, dibuat FROM materi WHERE lembaga_id = ? AND (kelas_id = ? OR kelas_id IS NULL) ORDER BY id DESC LIMIT 200`).all(s.lembaga_id, s.kelas_id || -1);
    }
    if (what === 'ujian' && !parts[2]) {
      const pes = new Map(db.prepare('SELECT * FROM ujian_peserta WHERE siswa_id = ?').all(s.id).map((p) => [p.ujian_id, p]));
      return { sekarang: Date.now(), ujian: ujianKelas(s).map((u) => ringkasUjian(u, pes.get(u.id))) };
    }
    if (what === 'nilai') {
      const pes = new Map(db.prepare("SELECT * FROM ujian_peserta WHERE siswa_id = ? AND status = 'selesai'").all(s.id).map((p) => [p.ujian_id, p]));
      return ujianKelas(s).filter((u) => pes.has(u.id) && u.tampil_nilai).map((u) => ({ ...ringkasUjian(u, pes.get(u.id)), selesai_at: pes.get(u.id).selesai_at }));
    }
    if (what !== 'ujian') throw new HttpError(404, 'Endpoint tidak ditemukan');
    const u = ujianKelas(s).find((x) => x.id === Number(parts[2]));
    if (!u) throw new HttpError(404, 'Ujian tidak ditemukan');
    let p = db.prepare('SELECT * FROM ujian_peserta WHERE ujian_id = ? AND siswa_id = ?').get(u.id, s.id);
    const aksi = parts[3];
    if (aksi === 'mulai' && method === 'POST') {
      if (p && p.status === 'selesai') throw new HttpError(409, 'Anda sudah mengerjakan ujian ini');
      if (!p) {
        const st = statusUjian(u, null);
        if (st === 'belum') throw new HttpError(403, `Ujian dibuka ${u.mulai.replace('T', ' pukul ')} WIB`);
        if (st === 'terlewat') throw new HttpError(403, 'Waktu ujian sudah berakhir');
        if (!u.jumlah_soal) throw new HttpError(409, 'Ujian belum memiliki soal');
        const now = Date.now(), batas = Math.min(waktuMs(u.selesai), now + u.durasi * 60000);
        db.prepare('INSERT INTO ujian_peserta (ujian_id, siswa_id, mulai_at, batas) VALUES (?,?,?,?)').run(u.id, s.id, now, batas);
        p = db.prepare('SELECT * FROM ujian_peserta WHERE ujian_id = ? AND siswa_id = ?').get(u.id, s.id);
      }
      return sesiUjian(u, p, s.id);
    }
    if (aksi === 'jawab' && method === 'POST') {
      if (!p || p.status !== 'berjalan') throw new HttpError(409, 'Ujian tidak sedang berlangsung');
      if (Date.now() > p.batas + 5000) { selesaikan(p.id); throw new HttpError(409, 'Waktu ujian habis. Jawaban Anda sudah dikumpulkan otomatis.'); }
      const sl = db.prepare('SELECT * FROM soal WHERE id = ? AND ujian_id = ?').get(Number(body.soal_id), u.id);
      if (!sl) throw new HttpError(400, 'Soal tidak valid');
      const jawab = J(p.jawaban, {});
      if (sl.tipe === 'pg') {
        const n = body.jawaban === null ? null : Number(body.jawaban), maks = J(sl.opsi, []).length;
        if (n !== null && !(Number.isInteger(n) && n >= 0 && n < maks)) throw new HttpError(400, 'Pilihan tidak valid');
        if (n === null) delete jawab[sl.id]; else jawab[sl.id] = n;
      } else {
        const t = String(body.jawaban ?? '').slice(0, 5000);
        if (!t.trim()) delete jawab[sl.id]; else jawab[sl.id] = t;
      }
      const pindah = Math.max(0, Math.min(5, Number(body.pindah) || 0));
      db.prepare('UPDATE ujian_peserta SET jawaban = ?, pindah_tab = pindah_tab + ? WHERE id = ?').run(JSON.stringify(jawab), pindah, p.id);
      return { ok: true, sisa_ms: Math.max(0, p.batas - Date.now()) };
    }
    if (aksi === 'kumpul' && method === 'POST') {
      if (!p) throw new HttpError(409, 'Anda belum memulai ujian ini');
      if (p.status === 'berjalan') selesaikan(p.id);
      p = db.prepare('SELECT * FROM ujian_peserta WHERE id = ?').get(p.id);
      return { ok: true, ...hasilSiswa(u, p) };
    }
    if (aksi === 'hasil' && method === 'GET') {
      if (!p || p.status !== 'selesai') throw new HttpError(404, 'Hasil belum tersedia');
      return hasilSiswa(u, p);
    }
    if (!aksi && method === 'GET') return ringkasUjian(u, p);
    throw new HttpError(404, 'Endpoint tidak ditemukan');
  }
  function hasilSiswa(u, p) {
    const tampil = !!u.tampil_nilai;
    const soalList = db.prepare('SELECT * FROM soal WHERE ujian_id = ?').all(u.id), h = hitung(u, soalList, p);
    return { judul: u.judul, mapel: u.mapel, selesai: true, tampil_nilai: tampil, menunggu_nilai: p.nilai === null, nilai: tampil ? p.nilai : null,
      benar: tampil ? h.benar : null, total_pg: h.pg, dijawab: Object.keys(J(p.jawaban, {})).length, total_soal: soalList.length };
  }

  return { cekUjian, soalAdmin, simpanSoal, hasilList, hasilDetail, nilaiUraian, hasilExport, akunSiswa, belajar, tutupKadaluwarsa, normWaktu };
}

module.exports = { createUjian, normWaktu };
