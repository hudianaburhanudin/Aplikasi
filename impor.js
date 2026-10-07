// Impor Excel/CSV serta template unduhan: guru, nilai, pembayaran, jadwal, dan soal ujian.
// Alur sama untuk semua jenis: baca berkas -> kenali kolom dari judulnya -> validasi per baris -> pratinjau -> simpan (atomik).
const { readXlsx, readCsv, readDocxText } = require('./xlsx-read');
const { buildXlsx } = require('./xlsx');

const baris_contoh = (row) => (row || []).some((c) => typeof c === 'string' && /^(diisi|contoh)\b/i.test(c.trim()));
const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const txt = (v) => { if (v == null) return null; const s = String(v).replace(/\s+/g, ' ').trim(); return s && s !== '-' ? s : null; };
const angka = (v) => { if (v == null || v === '') return null; if (typeof v === 'number') return v; const s = String(v).replace(/rp\.?|\s/gi, ''); const t = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/[.,](?=\d{3}(\D|$))/g, ''); const n = Number(t); return Number.isFinite(n) ? n : NaN; };
const tanggal = (v) => {
  const s = txt(v); if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (!m && (m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) m = [null, m[3], m[2], m[1]];
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])], dt = new Date(Date.UTC(y, mo - 1, d));
  return y > 1990 && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : undefined;
};
const bulan = (v) => { const s = txt(v); if (!s) return null; let m = /^(\d{4})-(\d{1,2})/.exec(s); if (!m && (m = /^(\d{1,2})[/-](\d{4})$/.exec(s))) m = [null, m[2], m[1]]; return m && +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}-${String(+m[2]).padStart(2, '0')}` : undefined; };
const jk = (v) => { const s = norm(v); return s === 'l' || s.startsWith('laki') ? 'L' : s === 'p' || s.startsWith('perem') ? 'P' : null; };

// kolom: k = nama internal, h = judul yang dikenali (dinormalkan), t = teks contoh/petunjuk untuk template
const DEF = {
  guru: { judul: 'Data Guru', sheet: 'Guru', cols: [
    { k: 'nip', h: ['nip', 'nuptk', 'nomorinduk'], petunjuk: 'diisi NIP/NUPTK (boleh kosong)', contoh: '198501012010011001' },
    { k: 'nama', h: ['nama', 'namaguru', 'namalengkap'], req: true, petunjuk: 'diisi nama lengkap', contoh: 'Ahmad Fauzi, S.Pd' },
    { k: 'jk', h: ['jk', 'jeniskelamin', 'lp'], petunjuk: 'diisi L / P', contoh: 'L' },
    { k: 'mapel', h: ['mapel', 'matapelajaran', 'mengajar', 'bidangstudi'], petunjuk: 'diisi mata pelajaran', contoh: 'Matematika' },
    { k: 'telepon', h: ['telepon', 'teleponhp', 'hp', 'nohp', 'telp', 'wa', 'whatsapp'], petunjuk: 'diisi nomor HP/WA', contoh: '081234567890' },
    { k: 'alamat', h: ['alamat'], petunjuk: 'diisi alamat', contoh: 'Dsn. Jawik, Tambakrejo' }] },
  nilai: { judul: 'Nilai Siswa', sheet: 'Nilai', ident: true, cols: [
    { k: 'nisn', h: ['nisn'], petunjuk: 'diisi NISN (atau NIS / nama)', contoh: '3174237254' },
    { k: 'nis', h: ['nis', 'noinduk', 'nipd'], petunjuk: 'diisi No Induk (NIS)', contoh: '0334' },
    { k: 'nama', h: ['nama', 'namasiswa'], petunjuk: 'diisi nama siswa', contoh: 'Adiba Shakila Khoironi' },
    { k: 'mapel', h: ['mapel', 'matapelajaran', 'bidangstudi'], req: true, petunjuk: 'diisi mata pelajaran', contoh: 'Matematika' },
    { k: 'jenis', h: ['jenis', 'jenisnilai'], petunjuk: 'Tugas / Ulangan Harian / UTS / UAS', contoh: 'Ulangan Harian' },
    { k: 'nilai', h: ['nilai', 'skor'], req: true, petunjuk: 'diisi angka 0-100', contoh: '85' },
    { k: 'semester', h: ['semester'], petunjuk: 'Ganjil / Genap', contoh: 'Ganjil' },
    { k: 'tanggal', h: ['tanggal', 'tgl'], petunjuk: 'diisi tanggal (2026-10-15 atau 15/10/2026)', contoh: '2026-10-15' }] },
  pembayaran: { judul: 'Pembayaran', sheet: 'Pembayaran', ident: true, cols: [
    { k: 'nisn', h: ['nisn'], petunjuk: 'diisi NISN (atau NIS / nama)', contoh: '3174237254' },
    { k: 'nis', h: ['nis', 'noinduk', 'nipd'], petunjuk: 'diisi No Induk (NIS)', contoh: '0334' },
    { k: 'nama', h: ['nama', 'namasiswa'], petunjuk: 'diisi nama siswa', contoh: 'Adiba Shakila Khoironi' },
    { k: 'jenis', h: ['jenis', 'jenispembayaran'], petunjuk: 'SPP / Uang Gedung / Seragam / Kegiatan / Lainnya', contoh: 'SPP' },
    { k: 'bulan', h: ['bulan', 'periode'], petunjuk: 'diisi periode (2026-10 atau 10/2026)', contoh: '2026-10' },
    { k: 'jumlah', h: ['jumlah', 'nominal', 'bayar', 'jumlahrp'], req: true, petunjuk: 'diisi angka rupiah', contoh: '150000' },
    { k: 'tanggal', h: ['tanggal', 'tgl', 'tanggalbayar'], petunjuk: 'diisi tanggal bayar', contoh: '2026-10-05' },
    { k: 'keterangan', h: ['keterangan', 'catatan'], petunjuk: 'diisi catatan (boleh kosong)', contoh: '' }] },
  jadwal: { judul: 'Jadwal Pelajaran', sheet: 'Jadwal', cols: [
    { k: 'kelas', h: ['kelas'], req: true, petunjuk: 'diisi nama kelas; tanda * = semua kelas', contoh: '7A' },
    { k: 'hari', h: ['hari'], req: true, petunjuk: 'diisi hari (Senin ... Sabtu)', contoh: 'Senin' },
    { k: 'mulai', h: ['mulai', 'jammulai'], req: true, petunjuk: 'diisi jam mulai (07.40)', contoh: '07.40' },
    { k: 'selesai', h: ['selesai', 'jamselesai'], req: true, petunjuk: 'diisi jam selesai (08.20)', contoh: '08.20' },
    { k: 'judul', h: ['judul', 'mapel', 'matapelajaran', 'kegiatan', 'matapelajarankegiatan'], req: true, petunjuk: 'diisi mata pelajaran/kegiatan', contoh: 'Matematika' },
    { k: 'guru', h: ['guru', 'pengajar'], petunjuk: 'diisi nama guru (boleh kosong)', contoh: 'Bu Sari' }] },
  kurikulum: { judul: 'Beban Mengajar', sheet: 'Beban Mengajar', cols: [
    { k: 'kelas', h: ['kelas'], req: true, petunjuk: 'diisi nama kelas; tanda * = semua kelas', contoh: '7A' },
    { k: 'mapel', h: ['mapel', 'matapelajaran', 'bidangstudi'], req: true, petunjuk: 'diisi mata pelajaran', contoh: 'Matematika' },
    { k: 'jam', h: ['jam', 'jamminggu', 'jamperminggu', 'jampelajaran', 'jammgg'], req: true, petunjuk: 'diisi jam per minggu (1-20)', contoh: '5' },
    { k: 'guru', h: ['guru', 'pengajar', 'namaguru'], petunjuk: 'diisi nama guru seperti di menu Guru (boleh kosong)', contoh: 'Ahmad Fauzi, S.Pd' },
    { k: 'blok', h: ['blok', 'jamberurutan', 'blokjam'], petunjuk: 'diisi 1-4: jam yang dipasang berurutan (bawaan 1)', contoh: '2' }] },
  soal: { judul: 'Soal Ujian', sheet: 'Soal', cols: [
    { k: 'tipe', h: ['tipe', 'jenis', 'jenissoal'], petunjuk: 'diisi PG atau URAIAN', contoh: 'PG' },
    { k: 'soal', h: ['soal', 'pertanyaan', 'teksoal'], req: true, petunjuk: 'diisi teks soal', contoh: 'Berapakah 2 + 3?' },
    ...'abcdef'.split('').map((c) => ({ k: 'opsi_' + c, h: ['opsi' + c, 'pilihan' + c, c], petunjuk: c === 'a' ? 'diisi pilihan jawaban (kosongkan untuk uraian)' : '', contoh: { a: '4', b: '5', c: '6' }[c] || '' })),
    { k: 'kunci', h: ['kunci', 'jawaban', 'kuncijawaban'], petunjuk: 'diisi huruf pilihan yang benar (A-F)', contoh: 'B' },
    { k: 'bobot', h: ['bobot', 'skor', 'poin'], petunjuk: 'diisi bobot (bawaan 1)', contoh: '1' }] },
};

function baca(nama, buf) {
  const ext = String(nama || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') return [{ name: 'CSV', rows: readCsv(buf.toString('utf8')) }];
  return readXlsx(buf);
}

// Cari baris judul pada sheet; kembalikan { header, first, map: {indeks -> k}, tidakDikenal }
function petakan(def, rows) {
  const lookup = new Map(); for (const c of def.cols) for (const h of c.h) if (!lookup.has(h)) lookup.set(h, c.k);
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const cells = rows[r] || [], map = {}; const dipakai = new Set();
    cells.forEach((c, i) => { const k = c != null && lookup.get(norm(String(c).replace(/\(.*?\)/g, ''))); if (k && !dipakai.has(k)) { map[i] = k; dipakai.add(k); } });
    const ada = (k) => dipakai.has(k);
    const butuh = def.cols.filter((c) => c.req).every((c) => ada(c.k)) && (!def.ident || ada('nisn') || ada('nis') || ada('nama'));
    if (butuh && dipakai.size >= 2) return { header: r + 1, first: r + 1, map, tidakDikenal: cells.map((c, i) => [c, i]).filter(([c, i]) => c != null && !(i in map)).map(([c]) => String(c).trim()) };
  }
  return null;
}

function createImpor({ db, HttpError, catat, todayWib, activeTahun }) {
  const cari = (lid) => {
    const rows = db.prepare("SELECT id, nama, nis, nisn, nis_lokal, kelas_id FROM siswa WHERE lembaga_id = ? AND status = 'aktif'").all(lid);
    const idx = (f) => new Map(rows.filter((r) => r[f]).map((r) => [String(r[f]), r]));
    const [bNisn, bNis, bLokal] = [idx('nisn'), idx('nis'), idx('nis_lokal')], bNama = new Map();
    for (const r of rows) { const k = r.nama.toLowerCase(); bNama.set(k, [...(bNama.get(k) || []), r]); }
    return (it) => {
      const v = (x) => (x == null ? null : String(x).replace(/\s/g, ''));
      for (const [m, key] of [[bNisn, v(it.nisn)], [bNis, v(it.nis)], [bLokal, v(it.nis)]]) if (key && m.has(key)) return { siswa: m.get(key) };
      if (it.nama) { const l = bNama.get(String(it.nama).toLowerCase()) || []; if (l.length === 1) return { siswa: l[0] }; if (l.length > 1) return { galat: `nama "${it.nama}" ada ${l.length} siswa; isi NISN atau NIS` }; }
      return { galat: 'siswa tidak ditemukan (periksa NISN/NIS/nama dan lembaga yang dipilih)' };
    };
  };

  // ---- validasi + simpan per jenis ----
  const J = {
    guru(items, lid) {
      const ok = [], galat = [];
      for (const it of items) {
        const jkv = it.jk ? jk(it.jk) : null;
        if (it.jk && !jkv) { galat.push([it._baris, `jenis kelamin "${it.jk}" harus L atau P`]); continue; }
        ok.push({ nip: txt(it.nip), nama: txt(it.nama).slice(0, 100), jk: jkv, mapel: txt(it.mapel), telepon: txt(it.telepon), alamat: txt(it.alamat), _baris: it._baris });
      }
      const sudahNip = new Set();
      for (const o of ok) { if (o.nip && sudahNip.has(o.nip)) galat.push([o._baris, `NIP ${o.nip} muncul dua kali pada berkas`]); if (o.nip) sudahNip.add(o.nip); }
      const lama = db.prepare('SELECT id, nip, nama FROM guru WHERE lembaga_id = ?').all(lid);
      const plan = ok.map((o) => ({ o, id: (o.nip && (lama.find((g) => g.nip === o.nip) || {}).id) || (!o.nip && (lama.find((g) => g.nama.toLowerCase() === o.nama.toLowerCase()) || {}).id) || null }));
      return { galat, plan, simpan() {
        let baru = 0, ubah = 0;
        for (const { o, id } of plan) {
          if (id) { const d = Object.entries({ nip: o.nip, nama: o.nama, jk: o.jk, mapel: o.mapel, telepon: o.telepon, alamat: o.alamat }).filter(([, v]) => v != null); db.prepare(`UPDATE guru SET ${d.map(([k]) => k + ' = ?').join(',')} WHERE id = ?`).run(...d.map(([, v]) => v), id); ubah++; }
          else { db.prepare('INSERT INTO guru (lembaga_id, nip, nama, jk, mapel, telepon, alamat) VALUES (?,?,?,?,?,?,?)').run(lid, o.nip, o.nama, o.jk, o.mapel, o.telepon, o.alamat); baru++; }
        }
        return { baru, diperbarui: ubah };
      }, ringkas: { baru: plan.filter((p) => !p.id).length, diperbarui: plan.filter((p) => p.id).length } };
    },
    nilai(items, lid) {
      const cariSiswa = cari(lid), galat = [], plan = [];
      for (const it of items) {
        const r = cariSiswa(it); if (r.galat) { galat.push([it._baris, r.galat]); continue; }
        const n = angka(it.nilai);
        if (n === null || Number.isNaN(n) || n < 0 || n > 100) { galat.push([it._baris, `nilai "${it.nilai}" harus angka 0-100`]); continue; }
        const t = it.tanggal ? tanggal(it.tanggal) : todayWib();
        if (t === undefined) { galat.push([it._baris, `tanggal "${it.tanggal}" tidak dikenali`]); continue; }
        const sm = norm(it.semester), semester = sm === 'ganjil' || sm === '1' ? 'Ganjil' : sm === 'genap' || sm === '2' ? 'Genap' : (it.semester ? null : undefined);
        if (semester === null) { galat.push([it._baris, `semester "${it.semester}" harus Ganjil atau Genap`]); continue; }
        plan.push({ siswa: r.siswa, mapel: txt(it.mapel).slice(0, 100), jenis: (txt(it.jenis) || 'Ulangan Harian').slice(0, 40), nilai: Math.round(n * 100) / 100, semester: semester || null, tanggal: t, _baris: it._baris });
      }
      const keys = new Set();
      for (const p of plan) { const k = [p.siswa.id, p.mapel.toLowerCase(), p.jenis.toLowerCase(), p.semester].join('|'); if (keys.has(k)) galat.push([p._baris, `nilai ${p.siswa.nama} / ${p.mapel} / ${p.jenis} muncul dua kali`]); keys.add(k); }
      const ada = (p) => db.prepare('SELECT id FROM nilai WHERE siswa_id = ? AND lower(mapel) = lower(?) AND lower(COALESCE(jenis, \'\')) = lower(?) AND semester IS ?').get(p.siswa.id, p.mapel, p.jenis, p.semester);
      const status = plan.map((p) => ({ p, id: (ada(p) || {}).id || null }));
      return { galat, plan, simpan() {
        for (const { p, id } of status) {
          if (id) db.prepare('UPDATE nilai SET nilai = ?, tanggal = ? WHERE id = ?').run(p.nilai, p.tanggal, id);
          else db.prepare('INSERT INTO nilai (siswa_id, mapel, jenis, nilai, semester, tanggal) VALUES (?,?,?,?,?,?)').run(p.siswa.id, p.mapel, p.jenis, p.nilai, p.semester, p.tanggal);
        }
        return { baru: status.filter((x) => !x.id).length, diperbarui: status.filter((x) => x.id).length };
      }, ringkas: { baru: status.filter((x) => !x.id).length, diperbarui: status.filter((x) => x.id).length } };
    },
    kurikulum(items, lid) {
      const kelas = db.prepare('SELECT id, nama FROM kelas WHERE lembaga_id = ?').all(lid), kMap = new Map(kelas.map((k) => [k.nama.toLowerCase(), k.id]));
      const gMap = new Map(); for (const g of db.prepare('SELECT id, nama FROM guru WHERE lembaga_id = ?').all(lid)) gMap.set(g.nama.toLowerCase(), [...(gMap.get(g.nama.toLowerCase()) || []), g.id]);
      const galat = [], plan = [], lihat = new Set();
      for (const it of items) {
        const jam = angka(it.jam), blok = it.blok == null ? 1 : angka(it.blok);
        if (!Number.isInteger(jam) || jam < 1 || jam > 20) { galat.push([it._baris, `jam "${it.jam}" harus bilangan bulat 1-20`]); continue; }
        if (!Number.isInteger(blok) || blok < 1 || blok > 4 || blok > jam) { galat.push([it._baris, `blok "${it.blok}" harus 1-4 dan tidak lebih besar dari jam`]); continue; }
        let gid = null;
        if (txt(it.guru)) { const l = gMap.get(txt(it.guru).toLowerCase()) || []; if (l.length !== 1) { galat.push([it._baris, l.length ? `guru "${it.guru}" ada ${l.length} orang` : `guru "${it.guru}" belum ada di menu Guru`]); continue; } gid = l[0]; }
        const target = txt(it.kelas) === '*' ? kelas.map((k) => k.id) : [kMap.get(String(txt(it.kelas)).toLowerCase())];
        if (target.some((x) => !x)) { galat.push([it._baris, `kelas "${it.kelas}" belum ada`]); continue; }
        for (const kid of target) {
          const key = kid + '|' + txt(it.mapel).toLowerCase();
          if (lihat.has(key)) { galat.push([it._baris, `mapel "${it.mapel}" muncul dua kali untuk kelas yang sama`]); continue; }
          lihat.add(key); plan.push({ kid, mapel: txt(it.mapel).slice(0, 100), jam, guru_id: gid, blok, _baris: it._baris });
        }
      }
      const ada = (p) => db.prepare('SELECT id FROM beban_ajar WHERE kelas_id = ? AND lower(mapel) = lower(?)').get(p.kid, p.mapel);
      const st = plan.map((p) => ({ p, id: (ada(p) || {}).id || null }));
      return { galat, plan, simpan() {
        for (const { p, id } of st) {
          if (id) db.prepare('UPDATE beban_ajar SET jam = ?, guru_id = ?, blok = ? WHERE id = ?').run(p.jam, p.guru_id, p.blok, id);
          else db.prepare('INSERT INTO beban_ajar (lembaga_id, kelas_id, mapel, jam, guru_id, blok) VALUES (?,?,?,?,?,?)').run(lid, p.kid, p.mapel, p.jam, p.guru_id, p.blok);
        }
        return { baru: st.filter((x) => !x.id).length, diperbarui: st.filter((x) => x.id).length };
      }, ringkas: { baru: st.filter((x) => !x.id).length, diperbarui: st.filter((x) => x.id).length } };
    },
    pembayaran(items, lid) {
      const cariSiswa = cari(lid), galat = [], plan = [];
      for (const it of items) {
        const r = cariSiswa(it); if (r.galat) { galat.push([it._baris, r.galat]); continue; }
        const n = angka(it.jumlah);
        if (n === null || !Number.isFinite(n) || n <= 0 || n > 1e10 || !Number.isInteger(Math.round(n))) { galat.push([it._baris, `jumlah "${it.jumlah}" harus angka rupiah lebih dari 0`]); continue; }
        const t = it.tanggal ? tanggal(it.tanggal) : todayWib(), b = bulan(it.bulan);
        if (t === undefined) { galat.push([it._baris, `tanggal "${it.tanggal}" tidak dikenali`]); continue; }
        if (b === undefined) { galat.push([it._baris, `periode "${it.bulan}" tidak dikenali (pakai 2026-10)`]); continue; }
        plan.push({ siswa: r.siswa, jenis: (txt(it.jenis) || 'SPP').slice(0, 40), bulan: b, jumlah: Math.round(n), tanggal: t, keterangan: (txt(it.keterangan) || '').slice(0, 200) || null, _baris: it._baris });
      }
      const dobel = (p) => db.prepare('SELECT 1 FROM pembayaran WHERE siswa_id = ? AND jenis = ? AND bulan IS ? AND jumlah = ? AND tanggal = ?').get(p.siswa.id, p.jenis, p.bulan, p.jumlah, p.tanggal);
      const baru = plan.filter((p) => !dobel(p));
      return { galat, plan, simpan() {
        for (const p of baru) db.prepare('INSERT INTO pembayaran (siswa_id, jenis, bulan, jumlah, tanggal, keterangan) VALUES (?,?,?,?,?,?)').run(p.siswa.id, p.jenis, p.bulan, p.jumlah, p.tanggal, p.keterangan);
        return { baru: baru.length, dilewati: plan.length - baru.length };
      }, ringkas: { baru: baru.length, dilewati: plan.length - baru.length, total_rp: baru.reduce((a, p) => a + p.jumlah, 0) } };
    },
  };

  const OPSI = 'abcdef';
  // Soal dari tabel (Excel/CSV) -> [{tipe, teks, opsi, kunci, bobot}] dengan galat per baris
  function soalDariTabel(items) {
    const soal = [], galat = [];
    for (const it of items) {
      const opsi = OPSI.split('').map((c) => txt(it['opsi_' + c])).filter((o) => o !== null);
      const t = norm(it.tipe), tipe = t.startsWith('ur') || t.startsWith('es') ? 'uraian' : t === 'pg' || t.startsWith('pil') ? 'pg' : (opsi.length ? 'pg' : 'uraian');
      const bobot = it.bobot == null ? 1 : angka(it.bobot);
      if (!(bobot > 0 && bobot <= 1000)) { galat.push([it._baris, `bobot "${it.bobot}" harus lebih dari 0`]); continue; }
      if (tipe === 'uraian') { soal.push({ tipe, teks: txt(it.soal), opsi: null, kunci: null, bobot, _baris: it._baris }); continue; }
      if (opsi.length < 2) { galat.push([it._baris, 'soal pilihan ganda butuh minimal 2 pilihan (kolom A, B, ...)']); continue; }
      const kk = norm(it.kunci), kunci = kk.length === 1 && OPSI.indexOf(kk) >= 0 ? OPSI.indexOf(kk) : /^[1-6]$/.test(kk) ? Number(kk) - 1 : -1;
      if (kunci < 0 || kunci >= opsi.length) { galat.push([it._baris, `kunci "${it.kunci ?? ''}" harus salah satu huruf pilihan (A-${'ABCDEF'[opsi.length - 1]})`]); continue; }
      soal.push({ tipe, teks: txt(it.soal), opsi, kunci, bobot, _baris: it._baris });
    }
    return { soal, galat };
  }
  // Soal dari teks/Word: "1. Soal?" lalu "A. pilihan" (tanda * di depan = benar, atau baris "Kunci: B"); tanpa pilihan = uraian
  function soalDariTeks(teks) {
    const hasil = []; let cur = null, no = 0;
    const tutup = () => {
      if (cur && cur.teks.trim()) {
        cur.teks = cur.teks.trim();
        if (cur.opsi.length >= 2) { cur.tipe = 'pg'; if (cur.kunci < 0) cur.galat = 'kunci jawaban belum ditandai (*) atau "Kunci: B"'; }
        else { cur.tipe = 'uraian'; cur.opsi = null; cur.kunci = null; }
        hasil.push(cur);
      }
      cur = null;
    };
    for (const raw of String(teks).split(/\r?\n/)) {
      const ln = raw.trim(); if (!ln) continue;
      let m;
      if ((m = /^(\d+)[.)]\s*(.*)$/.exec(ln))) { tutup(); cur = { teks: m[2], opsi: [], kunci: -1, bobot: 1, _baris: ++no }; }
      else if (cur && (m = /^(\*?)\s*([A-Fa-f])[.)]\s*(.*)$/.exec(ln))) { cur.opsi.push(m[3]); if (m[1]) cur.kunci = cur.opsi.length - 1; }
      else if (cur && (m = /^kunci\s*(?:jawaban)?\s*[:=]\s*([A-Fa-f])/i.exec(ln))) cur.kunci = m[1].toUpperCase().charCodeAt(0) - 65;
      else if (cur && (m = /^bobot\s*[:=]\s*(\d+(?:[.,]\d+)?)/i.exec(ln))) cur.bobot = Number(m[1].replace(',', '.'));
      else if (cur && !cur.opsi.length) cur.teks += '\n' + ln;
      else if (!cur) cur = { teks: ln, opsi: [], kunci: -1, bobot: 1, _baris: ++no };
    }
    tutup();
    const soal = [], galat = [];
    for (const s of hasil) { if (s.galat) galat.push([s._baris, `soal ${s._baris}: ${s.galat}`]); else soal.push(s); }
    return { soal, galat };
  }
  function bacaSoal(body) {
    const nama = String(body.nama_file || ''), buf = Buffer.from(String(body.file || ''), 'base64');
    if (buf.length < 4) throw new HttpError(400, 'Berkas kosong');
    const ext = (nama.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1];
    let hasil;
    try {
      if (ext === 'docx') hasil = soalDariTeks(readDocxText(buf));
      else if (ext === 'txt' && !/[\t;,]\s*.*\n.*[\t;,]/.test(buf.toString('utf8').split('\n', 2).join('\n')) || ext === 'md') hasil = soalDariTeks(buf.toString('utf8'));
      else {
        const sheets = baca(nama, buf), def = DEF.soal;
        for (const sh of sheets) {
          const pt = petakan(def, sh.rows); if (!pt) continue;
          const items = [];
          for (let r = pt.first; r < sh.rows.length; r++) {
            const row = sh.rows[r] || [], it = { _baris: r + 1 };
            for (const [i, k] of Object.entries(pt.map)) it[k] = row[i];
            if (baris_contoh(row) || !txt(it.soal)) continue;
            items.push(it);
          }
          hasil = soalDariTabel(items); break;
        }
        if (!hasil) throw new HttpError(400, 'Kolom "Soal" tidak ditemukan. Unduh template soal dan isi sesuai kolomnya.');
      }
    } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, e.message || 'Berkas tidak dapat dibaca. Gunakan .xlsx, .csv, .docx, atau .txt'); }
    return hasil;
  }

  // ---- antarmuka utama ----
  function template(jenis) {
    const def = DEF[jenis]; if (!def) throw new HttpError(404, 'Template tidak ditemukan');
    const heads = def.cols.map((c) => c.k === 'kelas' ? 'Kelas' : c.h[0].replace(/^./, (x) => x.toUpperCase()));
    const labels = { nisn: 'NISN', nis: 'No Induk (NIS)', nip: 'NIP', jk: 'L/P', telepon: 'Telepon/HP', opsi_a: 'A', opsi_b: 'B', opsi_c: 'C', opsi_d: 'D', opsi_e: 'E', opsi_f: 'F', judul: 'Mata pelajaran / kegiatan', nilai: 'Nilai', jam: 'Jam per minggu', blok: 'Blok (jam berurutan)', guru: 'Guru', kelas: 'Kelas', jumlah: 'Jumlah (Rp)', bulan: 'Periode (bulan)', mapel: 'Mata pelajaran', soal: 'Soal', tipe: 'Tipe (PG/URAIAN)', kunci: 'Kunci (A-F)', bobot: 'Bobot' };
    const header = def.cols.map((c, i) => labels[c.k] || heads[i]);
    const hint = def.cols.map((c) => c.petunjuk || '');
    const contoh = def.cols.map((c) => `contoh: ${c.contoh}`.replace(/^contoh: $/, ''));
    return buildXlsx(def.sheet, header, [hint, contoh.map((v, i) => (i === 0 ? v : def.cols[i].contoh))]);
  }

  function proses(jenis, body, ctx) {
    const def = DEF[jenis]; if (!def || jenis === 'jadwal' || jenis === 'soal') throw new HttpError(404, 'Jenis impor tidak dikenal');
    const lid = ctx.scope.target; if (!lid) throw new HttpError(400, 'Pilih lembaga terlebih dahulu');
    let buf; try { buf = Buffer.from(String(body.file || ''), 'base64'); } catch { buf = Buffer.alloc(0); }
    if (buf.length < 4) throw new HttpError(400, 'Berkas kosong atau tidak valid');
    let sheets; try { sheets = baca(body.nama_file, buf); } catch (e) { throw new HttpError(400, e.message || 'Berkas tidak dapat dibaca. Gunakan .xlsx atau .csv'); }
    const pilih = body.sheet ? sheets.find((s) => s.name === body.sheet) : (sheets.find((s) => petakan(def, s.rows)) || sheets[0]);
    if (!pilih) throw new HttpError(400, 'Sheet tidak ditemukan');
    const pt = petakan(def, pilih.rows);
    if (!pt) throw new HttpError(400, `Judul kolom tidak dikenali. Unduh template "${def.judul}" dan isi sesuai kolomnya.`);
    const items = [];
    for (let r = pt.first; r < pilih.rows.length; r++) {
      const row = pilih.rows[r] || [], it = { _baris: r + 1 };
      for (const [i, k] of Object.entries(pt.map)) it[k] = row[i] === undefined ? null : row[i];
      if (baris_contoh(row) || !row.some((c) => c != null)) continue;
      if (def.cols.filter((c) => c.req).some((c) => txt(it[c.k]) === null)) { items.push({ ...it, _kosong: true }); continue; }
      items.push(it);
    }
    if (!items.length) throw new HttpError(400, 'Tidak ada baris data pada berkas');
    if (items.length > 5000) throw new HttpError(400, 'Maksimal 5000 baris per impor');
    const salah = items.filter((i) => i._kosong).map((i) => [i._baris, 'kolom wajib belum diisi']);
    const r = J[jenis](items.filter((i) => !i._kosong), lid, ctx);
    const galat = [...salah, ...r.galat].sort((a, b) => a[0] - b[0]);
    const out = { jenis, sheet: pilih.name, sheets: sheets.map((s) => s.name), total: items.length, valid: items.length - galat.length, galat: galat.slice(0, 50).map(([baris, pesan]) => ({ baris, pesan })), jumlah_galat: galat.length,
      kolom_diabaikan: pt.tidakDikenal, ...r.ringkas, disimpan: false };
    if (!body.simpan) return out;
    if (galat.length) throw new HttpError(400, `${galat.length} baris bermasalah (mis. baris ${galat[0][0]}: ${galat[0][1]}). Perbaiki berkasnya, tidak ada yang disimpan.`);
    let hasil;
    db.exec('BEGIN');
    try { hasil = r.simpan(); catat(ctx.user, 'impor_' + jenis, `${items.length} baris, lembaga #${lid}`); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { ...out, ...hasil, disimpan: true };
  }

  // Jadwal dari Excel/CSV -> teks "kelas;hari;mulai;selesai;judul;guru" untuk imporJadwal
  function jadwalDariBerkas(body) {
    const buf = Buffer.from(String(body.file || ''), 'base64');
    if (buf.length < 4) throw new HttpError(400, 'Berkas kosong');
    let sheets; try { sheets = baca(body.nama_file, buf); } catch (e) { throw new HttpError(400, e.message || 'Berkas tidak dapat dibaca'); }
    for (const sh of sheets) {
      const pt = petakan(DEF.jadwal, sh.rows); if (!pt) continue;
      const lines = [];
      for (let r = pt.first; r < sh.rows.length; r++) {
        const row = sh.rows[r] || [], it = {};
        for (const [i, k] of Object.entries(pt.map)) it[k] = row[i];
        const j = txt(it.judul); if (!j || baris_contoh(row)) continue;
        const f = (v) => String(v ?? '').replace(/[;\t\r\n]/g, ' ').trim();
        lines.push([f(it.kelas), f(it.hari), f(it.mulai), f(it.selesai), f(j), f(it.guru)].join(';'));
      }
      return lines.join('\n');
    }
    throw new HttpError(400, 'Judul kolom jadwal tidak dikenali. Unduh template jadwal dan isi sesuai kolomnya.');
  }

  return { template, proses, bacaSoal, jadwalDariBerkas, DEF };
}

module.exports = { createImpor, DEF };
