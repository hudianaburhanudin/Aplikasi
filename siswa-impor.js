// Pemetaan kolom berkas Excel siswa (By Name By Address EMIS, Dapodik, format MBG/SPPG) ke kolom tabel siswa.
const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// kunci judul kolom (sudah dinormalkan) -> kolom siswa
const ALIAS = {
  nama: ['namasiswa', 'nama', 'namalengkap', 'namapesertadidik'],
  nis: ['noinduk', 'nis', 'nipd', 'nisinternal', 'nomorinduk'],
  nis_lokal: ['nislokalemis', 'nislokal', 'nisemis'],
  nisn: ['nisn', 'nomorindukSiswanasional'.toLowerCase()],
  tempat_lahir: ['tempatlahir'],
  tgl_lahir: ['tanggallahir', 'tgllahir'],
  nik: ['niksiswa', 'nik', 'nikpesertadidik'],
  no_kk: ['nomorkk', 'nokk', 'nomorkartukeluarga'],
  jk: ['jeniskelamin', 'jk', 'lp', 'lakilakiperempuan'],
  kelas: ['kelas', 'tingkat', 'rombel', 'rombonganbelajar'],
  jurusan: ['jurusan'],
  agama: ['agama'],
  kip_kemenag: ['kipkemenag'], kip_diknas: ['kipdiknas', 'kip'], kps: ['kps', 'nokps'], pkh: ['pkh'], sktm: ['sktm'],
  nama_ayah: ['namaayah', 'dataayahnama'], nik_ayah: ['nikayah', 'dataayahnik'],
  lahir_ayah: ['dataayahtahunlahir'], pendidikan_ayah: ['dataayahjenjangpendidikan'], pekerjaan_ayah: ['dataayahpekerjaan'], penghasilan_ayah: ['dataayahpenghasilan'],
  nama_ibu: ['namaibu', 'dataibunama'], nik_ibu: ['nikibu', 'dataibunik'],
  lahir_ibu: ['dataibutahunlahir'], pendidikan_ibu: ['dataibujenjangpendidikan'], pekerjaan_ibu: ['dataibupekerjaan'], penghasilan_ibu: ['dataibupenghasilan'],
  wali: ['namaorangtuawali', 'namawali', 'datawalinama', 'namaorangtua'],
  alamat: ['alamatsiswa', 'alamat', 'alamatorangtua'],
  rt: ['rt'], rw: ['rw'], dusun: ['dusun'],
  desa: ['desa', 'kelurahan', 'desakelurahan', 'desakel'], kecamatan: ['kecamatan'], kabupaten: ['kabupaten', 'kabupatenkota', 'kota'],
  kode_pos: ['kodepos'], jenis_tinggal: ['jenistinggal'], transportasi: ['alattransportasi', 'transportasi'],
  telepon: ['telepon', 'notelepon', 'telp'], hp: ['hp', 'nohp', 'nomorhp'], email: ['email'],
  status_ulang: ['status'],
};
const LOOKUP = new Map();
for (const [field, keys] of Object.entries(ALIAS)) for (const k of keys) if (!LOOKUP.has(k)) LOOKUP.set(k, field);
const SUBS = new Set(['nama', 'tahunlahir', 'jenjangpendidikan', 'pekerjaan', 'penghasilan', 'nik']);

const mapHeader = (h) => {
  const k = norm(String(h ?? '').replace(/\(.*?\)/g, ''));
  if (LOOKUP.has(k)) return LOOKUP.get(k);
  if (k.startsWith('nomorindukSiswanasional'.toLowerCase())) return 'nisn';
  if (k.startsWith('namaorangtua')) return 'wali';
  return null;
};

// Cari baris judul (dan sub-judul bertingkat seperti "Data Ayah" / "Nama"); kembalikan { header, first, cols }
function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const cells = rows[r] || [];
    const hits = cells.filter((c) => c != null && mapHeader(c)).length;
    if (!(hits >= 3 && cells.some((c) => c != null && mapHeader(c) === 'nama'))) continue;
    const next = rows[r + 1] || [];
    const sub = next.filter((c) => c != null && SUBS.has(norm(c))).length >= 3;
    const cols = {};
    let group = '';
    for (let i = 0; i < Math.max(cells.length, next.length); i++) {
      const c = cells[i];
      if (c != null) group = norm(c);
      const own = c != null ? mapHeader(c) : null;
      if (sub && next[i] != null) {
        const f = LOOKUP.get(group + norm(next[i]));
        if (f) { cols[i] = f; continue; }
      }
      if (own && !Object.values(cols).includes(own)) cols[i] = own;
    }
    return { header: r, first: r + (sub ? 2 : 1), cols, labels: cells };
  }
  return null;
}

const str = (v) => {
  if (v == null) return null;
  const s = (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : String(v)).replace(/\s+/g, ' ').trim();
  return s && s !== '-' ? s : null;
};
const digits = (v) => { const s = str(v); return s ? s.replace(/[\s'.]/g, '') : null; };
const tanggal = (v) => {
  const s = str(v); if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (!m && (m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) m = [null, m[3], m[2], m[1]];
  if (!m) return undefined;     // tidak dikenali
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return y > 1900 && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : undefined;
};
const jk = (v) => { const s = norm(v); return s === 'l' || s.startsWith('laki') ? 'L' : s === 'p' || s.startsWith('perem') ? 'P' : null; };
const bersih = (v, prefix) => { const s = str(v); return s ? s.replace(prefix, '').trim() || null : null; };

// Ubah satu sheet menjadi daftar rekaman siswa. Mengembalikan { ok, records, unmapped, warnings, header }.
function parseSheet(rows) {
  const h = findHeader(rows);
  if (!h) return { ok: false, error: 'Baris judul kolom (mis. "Nama Siswa") tidak ditemukan pada sheet ini' };
  const records = [], warnings = [];
  for (let r = h.first; r < rows.length; r++) {
    const row = rows[r] || [], rec = {};
    const ni = Object.entries(h.cols).find(([, f]) => f === 'nama');
    if (!ni || row[ni[0]] == null || /^(diisi|contoh)\b|^urut$/i.test(String(row[ni[0]]).trim())) continue;
    for (const [i, f] of Object.entries(h.cols)) {
      const v = row[i];
      if (v == null) continue;
      if (f === 'tgl_lahir') {
        const t = tanggal(v);
        if (t === undefined) warnings.push(`Baris ${r + 1}: tanggal lahir "${str(v)}" tidak dikenali, dilewati`); else if (t) rec.tgl_lahir = t;
      } else if (f === 'jk') { const x = jk(v); if (x) rec.jk = x; }
      else if (['nik', 'no_kk', 'nik_ayah', 'nik_ibu', 'nisn', 'nis_lokal', 'kip_kemenag', 'kip_diknas', 'kps', 'pkh', 'sktm', 'kode_pos'].includes(f)) { const x = digits(v); if (x) rec[f] = x; }
      else if (f === 'status_ulang') { const s = norm(v); if (s) rec.mengulang = s.includes('mengulang') && !s.includes('tidak') ? 1 : 0; }
      else if (f === 'desa') { const x = bersih(v, /^desa\/kel\.?\s*/i); if (x) rec.desa = x; }
      else if (f === 'kecamatan') { const x = bersih(v, /^kec\.?\s*/i); if (x) rec.kecamatan = x; }
      else if (f === 'kabupaten') { const x = bersih(v, /^kab\.?\/kota\s*|^kab\.?\s*/i); if (x) rec.kabupaten = x; }
      else if (f === 'telepon' || f === 'hp') { const x = digits(v); if (x && (f === 'hp' || !rec.telepon)) rec.telepon = x; }
      else { const x = str(v); if (x) rec[f] = x; }
    }
    if (!rec.nama || /^(diisi|contoh)\b/i.test(rec.nama) || /^urut$/i.test(rec.nama)) continue;
    if (rec.nama.length > 100) rec.nama = rec.nama.slice(0, 100);
    rec._baris = r + 1;
    records.push(rec);
  }
  const unmapped = h.labels.map((c, i) => [c, i]).filter(([c, i]) => c != null && !(i in h.cols) && !/^(no|urut|umur|ket|no\.?)$/i.test(String(c).trim())).map(([c]) => String(c).trim());
  return { ok: true, records, unmapped, warnings: warnings.slice(0, 30), header: h.header + 1, fields: [...new Set(Object.values(h.cols))] };
}

module.exports = { parseSheet, findHeader };
