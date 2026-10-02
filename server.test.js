process.env.ADMIN_PASSWORD = 'admin123';
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./server');

async function boot(t, opts) {
  const { server } = createApp(':memory:', opts);
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/`;
  const client = () => {
    let cookie = '';
    return async (path, method = 'GET', body, lembaga) => {
      const headers = { 'Content-Type': 'application/json', cookie };
      if (lembaga) headers['x-lembaga'] = String(lembaga);
      const r = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
      const c = r.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
      const type = r.headers.get('content-type') || '';
      return { status: r.status, r, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
    };
  };
  return { client, base };
}
const tgl = new Date().toISOString().slice(0, 10);

test('alur utama dalam satu lembaga', async (t) => {
  const { client } = await boot(t);
  const call = client();
  assert.strictEqual((await call('siswa')).status, 401);
  assert.strictEqual((await call('login', 'POST', { username: 'admin', password: 'salah' })).status, 401);
  const me = (await call('login', 'POST', { username: 'admin', password: 'admin123' })).data;
  assert.strictEqual(me.role, 'yayasan');
  assert.strictEqual(me.lembagas.length, 7);
  const L = me.lembagas.find((l) => l.kode === 'SMP').id;

  assert.strictEqual((await call('guru', 'POST', { nama: 'X' })).status, 400); // semua lembaga: pilih dulu
  const guru = (await call('guru', 'POST', { nama: 'Pak Budi', nip: '1' }, L)).data.id;
  const kelas = (await call('kelas', 'POST', { nama: 'VII-A', wali_guru_id: guru }, L)).data.id;
  const siswa = (await call('siswa', 'POST', { nama: 'Andi', nis: '001', kelas_id: kelas }, L)).data.id;
  assert.strictEqual((await call('siswa', 'POST', { nama: 'Dup', nis: '001' }, L)).status, 409);
  assert.strictEqual((await call('siswa', 'POST', { nama: '' }, L)).status, 400);

  await call('absensi', 'POST', { tanggal: tgl, items: [{ siswa_id: siswa, status: 'H' }] }, L);
  await call('absensi', 'POST', { tanggal: tgl, items: [{ siswa_id: siswa, status: 'S' }] }, L);
  assert.strictEqual((await call(`absensi?kelas_id=${kelas}&tanggal=${tgl}`, 'GET', null, L)).data[0].status, 'S');
  assert.strictEqual((await call('absensi', 'POST', { tanggal: tgl, items: [{ siswa_id: siswa, status: 'X' }] }, L)).status, 400);

  await call('nilai', 'POST', { siswa_id: siswa, mapel: 'Matematika', nilai: 80, semester: 'Ganjil' });
  await call('nilai', 'POST', { siswa_id: siswa, mapel: 'Matematika', nilai: 90, semester: 'Ganjil' });
  const rapor = (await call(`rapor?siswa_id=${siswa}`)).data;
  assert.strictEqual(rapor.nilai[0].rata, 85);
  assert.strictEqual(rapor.siswa.wali_kelas, 'Pak Budi');

  const pid = (await call('pembayaran', 'POST', { siswa_id: siswa, jumlah: 150000, tanggal: tgl })).data.id;
  const dash = (await call('dashboard')).data;
  assert.strictEqual(dash.pembayaran_bulan_ini, 150000);
  assert.strictEqual(dash.siswa, 1);
  assert.strictEqual(dash.per_lembaga.length, 7);

  assert.strictEqual((await call(`siswa/${siswa}`, 'PUT', { nama: 'Andi P' })).status, 200);
  assert.strictEqual((await call('siswa?q=Andi')).data.length, 1);

  // ekspor
  for (const p of ['export/siswa', 'pdf/siswa', 'pdf/pembayaran', 'pdf/guru', `pdf/rapor?siswa_id=${siswa}`, `pdf/kuitansi?id=${pid}`, `pdf/rekap-absensi?kelas_id=${kelas}&bulan=${tgl.slice(0, 7)}`]) {
    const r = await call(p);
    assert.strictEqual(r.status, 200, p);
    assert.strictEqual(r.data.subarray(0, 2).toString(), p.startsWith('export') ? 'PK' : '%P', p);
  }
  assert.strictEqual((await call('export/tidakada')).status, 404);

  assert.strictEqual((await call(`siswa/${siswa}`, 'DELETE')).status, 200);
  assert.strictEqual((await call('nilai')).data.length, 0);
  assert.strictEqual((await call('logout', 'POST')).status, 200);
  assert.strictEqual((await call('siswa')).status, 401);
});

test('isolasi data antar lembaga dan peran', async (t) => {
  const { client } = await boot(t);
  const yys = client();
  const me = (await yys('login', 'POST', { username: 'admin', password: 'admin123' })).data;
  const id = (k) => me.lembagas.find((l) => l.kode === k).id;
  const [SMP, MI] = [id('SMP'), id('MI')];

  const kelasMI = (await yys('kelas', 'POST', { nama: 'I-A' }, MI)).data.id;
  const siswaMI = (await yys('siswa', 'POST', { nama: 'Anak MI', nis: '1', kelas_id: kelasMI }, MI)).data.id;
  const siswaSMP = (await yys('siswa', 'POST', { nama: 'Anak SMP', nis: '1' }, SMP)).data.id; // NIS sama di lembaga lain boleh
  const kelasSMP = (await yys('kelas', 'POST', { nama: 'VII-A' }, SMP)).data.id;
  assert.strictEqual((await yys('siswa', 'POST', { nama: 'Salah', kelas_id: kelasMI }, SMP)).status, 404); // kelas lembaga lain
  assert.strictEqual((await yys('nilai', 'POST', { siswa_id: siswaMI, mapel: 'IPA', nilai: 90 })).status, 200);

  // admin SMP + staf SMP
  assert.strictEqual((await yys('users', 'POST', { username: 'adminsmp', password: 'rahasia1', nama: 'Admin SMP', role: 'admin' })).status, 400); // wajib lembaga
  assert.strictEqual((await yys('users', 'POST', { username: 'adminsmp', password: 'rahasia1', nama: 'Admin SMP', role: 'admin', lembaga_ids: [SMP] })).status, 200);
  const adm = client();
  await adm('login', 'POST', { username: 'adminsmp', password: 'rahasia1' });
  assert.strictEqual((await adm('siswa')).status, 403); // wajib ganti password dulu
  assert.strictEqual((await adm('password', 'POST', { lama: 'rahasia1', baru: 'rahasia1' })).status, 400);
  assert.strictEqual((await adm('password', 'POST', { lama: 'rahasia1', baru: 'pendek' })).status, 400);
  assert.strictEqual((await adm('password', 'POST', { lama: 'rahasia1', baru: 'rahasia2x' })).status, 200);
  const am = (await adm('me')).data;
  assert.deepStrictEqual(am.lembagas.map((l) => l.kode), ['SMP']);

  let list = (await adm('siswa')).data;
  assert.deepStrictEqual(list.map((s) => s.nama), ['Anak SMP']);                   // tidak melihat MI
  assert.strictEqual((await adm(`siswa/${siswaMI}`)).status, 404);                 // akses langsung ditolak
  assert.strictEqual((await adm(`siswa/${siswaMI}`, 'PUT', { nama: 'Hack' })).status, 404);
  assert.strictEqual((await adm(`siswa/${siswaMI}`, 'DELETE')).status, 404);
  assert.strictEqual((await adm('siswa', 'GET', null, MI)).status, 403);          // header lembaga lain
  assert.strictEqual((await adm('nilai')).data.length, 0);
  assert.strictEqual((await adm('nilai', 'POST', { siswa_id: siswaMI, mapel: 'X', nilai: 1 })).status, 404);
  assert.strictEqual((await adm(`rapor?siswa_id=${siswaMI}`)).status, 404);
  assert.strictEqual((await adm(`absensi?kelas_id=${kelasMI}&tanggal=${tgl}`)).status, 404);
  assert.strictEqual((await adm('absensi', 'POST', { tanggal: tgl, items: [{ siswa_id: siswaMI, status: 'H' }] })).status, 404);
  assert.strictEqual((await adm('pdf/siswa')).data.length > 100, true);
  assert.strictEqual((await adm('dashboard')).data.siswa, 1);
  assert.strictEqual((await adm('lembaga')).data.length, 1);
  assert.strictEqual((await adm('lembaga', 'POST', { kode: 'X', nama: 'X' })).status, 403); // hanya yayasan
  assert.strictEqual((await adm('tahun_ajaran', 'POST', { nama: '2030/2031' })).status, 403);
  assert.strictEqual((await adm('siswa', 'POST', { nama: 'Baru SMP' })).status, 200);   // lembaga otomatis
  assert.strictEqual((await yys('siswa', 'GET', null, SMP)).data.length, 2);

  // admin lembaga hanya mengelola staf di lembaganya
  assert.strictEqual((await adm('users', 'POST', { username: 'a2', password: 'rahasia1', nama: 'A2', role: 'admin', lembaga_ids: [SMP] })).status, 400);
  assert.strictEqual((await adm('users', 'POST', { username: 's1', password: 'rahasia1', nama: 'S1', role: 'staf', lembaga_ids: [MI] })).status, 403);
  const sid = (await adm('users', 'POST', { username: 's1', password: 'rahasia1', nama: 'S1', role: 'staf', lembaga_ids: [SMP] })).data.id;
  assert.strictEqual((await adm('users')).data.length, 2);
  const staf = client();
  await staf('login', 'POST', { username: 's1', password: 'rahasia1' });
  await staf('password', 'POST', { lama: 'rahasia1', baru: 'rahasia2x' });
  assert.strictEqual((await staf('users')).status, 403);
  assert.strictEqual((await staf('siswa')).data.length, 2);
  assert.strictEqual((await staf('siswa', 'GET', null, MI)).status, 403);

  // yayasan: reset password, perubahan peran, pelindung akun terakhir
  assert.strictEqual((await yys(`users/${sid}`, 'PUT', { password: 'baru1234' })).status, 200);
  assert.strictEqual((await staf('siswa')).status, 401); // sesi lama dicabut
  assert.strictEqual((await staf('login', 'POST', { username: 's1', password: 'baru1234' })).status, 200);
  assert.strictEqual((await yys(`users/${me.id}`, 'DELETE')).status, 400);
  assert.strictEqual((await yys(`users/${me.id}`, 'PUT', { role: 'staf' })).status, 400);
  assert.strictEqual((await yys(`users/${sid}`, 'DELETE')).status, 200);
  assert.strictEqual((await staf('siswa')).status, 401);

  // tahun ajaran: hanya satu aktif
  const t2 = (await yys('tahun_ajaran', 'POST', { nama: '2027/2028', aktif: 1 })).data.id;
  const ta = (await yys('tahun_ajaran')).data;
  assert.deepStrictEqual(ta.filter((x) => x.aktif).map((x) => x.id), [t2]);
  // lembaga yang masih punya data tidak bisa dihapus
  assert.strictEqual((await yys(`lembaga/${SMP}`, 'DELETE')).status, 400);
});

test('PPDB online sampai kelulusan', async (t) => {
  const { client } = await boot(t);
  const pub = client(), yys = client();
  const me = (await yys('login', 'POST', { username: 'admin', password: 'admin123' })).data;
  const id = (k) => me.lembagas.find((l) => l.kode === k).id;
  const [SMP, MI] = [id('SMP'), id('MI')];
  const form = { lembaga_id: SMP, nama: 'Calon Siswa', jk: 'L', tgl_lahir: '2014-05-10', telepon: '08123', nama_ayah: 'Pak Calon', asal_sekolah: 'SD 1', setuju: 'on' };

  // pendaftaran ditutup secara default
  assert.deepStrictEqual((await pub('public/lembaga')).data.lembaga, []);
  assert.strictEqual((await pub('public/daftar', 'POST', form)).status, 400);
  assert.strictEqual((await yys(`lembaga/${SMP}`, 'PUT', { ppdb_buka: 1 })).status, 200);
  assert.strictEqual((await yys(`lembaga/${MI}`, 'PUT', { ppdb_buka: 1 })).status, 200);
  const pl = (await pub('public/lembaga')).data;
  assert.strictEqual(pl.lembaga.length, 2);
  assert.strictEqual(pl.tahun_ajaran, '2026/2027');

  // validasi & anti-spam
  for (const bad of [{ nama: '' }, { jk: 'X' }, { tgl_lahir: '31-12-2014' }, { telepon: '' }, { nama_ayah: '' }, { setuju: undefined }, { setuju: 'off' }]) {
    assert.strictEqual((await pub('public/daftar', 'POST', { ...form, ...bad })).status, 400, JSON.stringify(bad));
  }
  assert.strictEqual((await pub('public/daftar', 'POST', { ...form, website: 'spam.com' })).data.no_daftar, 'OK'); // honeypot
  assert.strictEqual((await yys('pendaftar', 'GET', null, SMP)).data.length, 0);

  const reg = (await pub('public/daftar', 'POST', form)).data;
  assert.strictEqual(reg.no_daftar, 'SMP-2026-0001');
  assert.strictEqual((await pub('public/daftar', 'POST', form)).status, 409); // ganda
  assert.strictEqual((await pub('public/daftar', 'POST', { ...form, nama: 'Kedua' })).data.no_daftar, 'SMP-2026-0002');
  assert.strictEqual((await pub('public/daftar', 'POST', { ...form, lembaga_id: MI })).data.no_daftar, 'MI-2026-0001');

  // cek status publik harus cocok nomor + tanggal lahir
  assert.strictEqual((await pub('public/status', 'POST', { no_daftar: reg.no_daftar, tgl_lahir: '2014-05-10' })).data.status, 'baru');
  assert.strictEqual((await pub('public/status', 'POST', { no_daftar: reg.no_daftar, tgl_lahir: '2000-01-01' })).status, 404);
  assert.strictEqual((await pub('pendaftar')).status, 401); // data pendaftar tidak publik

  // admin: seleksi
  const list = (await yys('pendaftar', 'GET', null, SMP)).data;
  assert.strictEqual(list.length, 2);
  const pid = list.find((x) => x.no_daftar === 'SMP-2026-0001').id;
  assert.strictEqual((await yys(`pendaftar/${pid}`, 'PUT', { status: 'terdaftar' })).status, 400); // tidak bisa diset manual
  const kelas7 = (await yys('kelas', 'POST', { nama: 'VII-A', tahun_ajaran: '2026/2027' }, SMP)).data.id;
  const kelas8 = (await yys('kelas', 'POST', { nama: 'VIII-A', tahun_ajaran: '2027/2028' }, SMP)).data.id;
  const kelasMI = (await yys('kelas', 'POST', { nama: 'I-A' }, MI)).data.id;
  assert.strictEqual((await yys(`pendaftar/${pid}/terima`, 'POST', { kelas_id: kelas7 })).status, 400); // belum diterima
  await yys(`pendaftar/${pid}`, 'PUT', { status: 'diterima' });
  assert.strictEqual((await yys(`pendaftar/${pid}/terima`, 'POST', { kelas_id: kelasMI })).status, 400); // kelas lembaga lain
  const sid = (await yys(`pendaftar/${pid}/terima`, 'POST', { kelas_id: kelas7, nis: '2026001' })).data.siswa_id;
  assert.strictEqual((await yys(`pendaftar/${pid}/terima`, 'POST', { kelas_id: kelas7 })).status, 400); // sudah jadi siswa
  assert.strictEqual((await yys(`pendaftar/${pid}`, 'PUT', { status: 'baru' })).status, 400);
  const s = (await yys(`siswa/${sid}`)).data;
  assert.deepStrictEqual([s.nama, s.nis, s.kelas_id, s.status, s.tahun_masuk, s.wali], ['Calon Siswa', '2026001', kelas7, 'aktif', '2026/2027', 'Pak Calon']);
  assert.strictEqual((await yys('pendaftar/' + pid)).data.status, 'terdaftar');

  // kenaikan kelas
  assert.strictEqual((await yys('kenaikan', 'POST', { siswa_ids: [sid], aksi: 'naik', ke_kelas_id: kelasMI })).status, 400); // lintas lembaga
  assert.strictEqual((await yys('kenaikan', 'POST', { siswa_ids: [sid], aksi: 'naik', ke_kelas_id: kelas7 })).status, 400); // sama
  assert.strictEqual((await yys('kenaikan', 'POST', { siswa_ids: [sid], aksi: 'hapus' })).status, 400);
  assert.strictEqual((await yys('kenaikan', 'POST', { siswa_ids: [sid], aksi: 'naik', ke_kelas_id: kelas8 })).status, 200);
  assert.strictEqual((await yys(`siswa/${sid}`)).data.kelas_id, kelas8);
  // gagal sebagian = tidak ada perubahan (atomik)
  const s2 = (await yys('siswa', 'POST', { nama: 'Lain', kelas_id: kelas7 }, SMP)).data.id;
  assert.strictEqual((await yys('kenaikan', 'POST', { siswa_ids: [s2, sid], aksi: 'naik', ke_kelas_id: kelas8 })).status, 400); // sid sudah di kelas8
  assert.strictEqual((await yys(`siswa/${s2}`)).data.kelas_id, kelas7);
  // kelulusan
  assert.strictEqual((await yys('kenaikan', 'POST', { siswa_ids: [sid], aksi: 'lulus', tahun_ajaran: '2028/2029' })).status, 200);
  const alum = (await yys(`siswa/${sid}`)).data;
  assert.deepStrictEqual([alum.status, alum.tahun_lulus], ['lulus', '2028/2029']);
  assert.strictEqual((await yys('kenaikan', 'POST', { siswa_ids: [sid], aksi: 'lulus' })).status, 400); // bukan siswa aktif
  assert.deepStrictEqual((await yys(`riwayat?siswa_id=${sid}`)).data.map((m) => m.jenis), ['masuk', 'naik', 'lulus']);

  // isolasi: admin MI tidak melihat pendaftar/riwayat SMP
  await yys('users', 'POST', { username: 'adminmi', password: 'rahasia1', nama: 'A', role: 'admin', lembaga_ids: [MI] });
  const mi = client(); await mi('login', 'POST', { username: 'adminmi', password: 'rahasia1' });
  await mi('password', 'POST', { lama: 'rahasia1', baru: 'rahasia2x' });
  assert.deepStrictEqual((await mi('pendaftar')).data.map((x) => x.no_daftar), ['MI-2026-0001']);
  assert.strictEqual((await mi(`pendaftar/${pid}`)).status, 404);
  assert.strictEqual((await mi(`riwayat?siswa_id=${sid}`)).status, 404);
  assert.strictEqual((await mi('kenaikan', 'POST', { siswa_ids: [s2], aksi: 'lulus' })).status, 404);
  assert.strictEqual((await mi('export/pendaftar')).status, 200);
  assert.strictEqual((await yys('dashboard', 'GET', null, MI)).data.pendaftar_baru, 1);
});

test('portal wali murid, tagihan, dan pengumuman', async (t) => {
  const { client } = await boot(t);
  const yys = client();
  const me = (await yys('login', 'POST', { username: 'admin', password: 'admin123' })).data;
  const id = (k) => me.lembagas.find((l) => l.kode === k).id;
  const [SMP, MI] = [id('SMP'), id('MI')];
  const bulan = tgl.slice(0, 7);

  const kelas = (await yys('kelas', 'POST', { nama: 'VII-A' }, SMP)).data.id;
  const a1 = (await yys('siswa', 'POST', { nama: 'Anak Satu', nis: '1', kelas_id: kelas, telepon: '+62 812-3456-7890' }, SMP)).data.id;
  const a2 = (await yys('siswa', 'POST', { nama: 'Anak Dua', nis: '2', kelas_id: kelas }, SMP)).data.id;
  const kMI = (await yys('kelas', 'POST', { nama: 'I-A' }, MI)).data.id;
  const a3 = (await yys('siswa', 'POST', { nama: 'Adik MI', nis: '3', kelas_id: kMI }, MI)).data.id;
  const lain = (await yys('siswa', 'POST', { nama: 'Anak Orang Lain', nis: '9', kelas_id: kelas }, SMP)).data.id;

  // tagihan massal + status otomatis dari pembayaran
  assert.strictEqual((await yys('tagihan/generate', 'POST', { kelas_id: kelas, periode: bulan, jumlah: 150000, jatuh_tempo: '2020-01-10' }, SMP)).data.dibuat, 3);
  assert.deepStrictEqual((await yys('tagihan/generate', 'POST', { kelas_id: kelas, periode: bulan, jumlah: 150000 }, SMP)).data, { dibuat: 0, dilewati: 3 });
  assert.strictEqual((await yys('tagihan/generate', 'POST', { kelas_id: kelas, periode: 'x', jumlah: 1 }, SMP)).status, 400);
  assert.strictEqual((await yys('tagihan/generate', 'POST', { kelas_id: kMI, periode: bulan, jumlah: 1 }, SMP)).status, 404);
  await yys('pembayaran', 'POST', { siswa_id: a1, jumlah: 100000, tanggal: tgl, jenis: 'SPP', bulan });
  let tg = (await yys('tagihan?siswa_id=' + a1, 'GET', null, SMP)).data[0];
  assert.deepStrictEqual([tg.terbayar, tg.sisa, tg.status], [100000, 50000, 'sebagian']);
  await yys('pembayaran', 'POST', { siswa_id: a1, jumlah: 50000, tanggal: tgl, jenis: 'SPP', bulan });
  assert.strictEqual((await yys('tagihan?siswa_id=' + a1, 'GET', null, SMP)).data[0].status, 'lunas');
  assert.strictEqual((await yys('tagihan?status=belum', 'GET', null, SMP)).data.length, 2);
  assert.strictEqual((await yys('dashboard', 'GET', null, SMP)).data.tunggakan, 300000); // 2 siswa x 150rb lewat jatuh tempo

  // pengumuman per lembaga
  assert.strictEqual((await yys('pengumuman', 'POST', { judul: 'Libur', isi: 'Libur Senin' }, SMP)).status, 200);
  assert.strictEqual((await yys('pengumuman', 'POST', { judul: 'Rapat MI', isi: 'x' }, MI)).status, 200);

  // petugas membuat akun wali (nomor HP dinormalisasi), 1 wali -> 2 anak lintas lembaga
  const w1 = (await yys('wali-akun', 'POST', { siswa_id: a1 })).status; // butuh lembaga? tidak, siswa menentukan
  assert.strictEqual(w1, 200);
  const acc = (await yys('wali-akun?siswa_id=' + a1)).data;
  assert.strictEqual(acc[0].username, '081234567890');
  const link2 = (await yys('wali-akun', 'POST', { siswa_id: a3, username: '081234567890' })).data; // tautkan adik di MI
  assert.deepStrictEqual([link2.baru, link2.password], [false, null]);
  assert.strictEqual((await yys('wali-akun', 'POST', { siswa_id: a2, username: 'ab' })).status, 400);
  const reset = (await yys('wali-akun/reset', 'POST', { user_id: acc[0].user_id })).data.password;
  assert.match(reset, /^[A-Za-z0-9]{10}$/);

  const wali = client();
  assert.strictEqual((await wali('login', 'POST', { username: '081234567890', password: 'salahsekali' })).status, 401);
  const lw = await wali('login', 'POST', { username: '081234567890', password: reset });
  assert.deepStrictEqual([lw.data.role, lw.data.must_change], ['wali', true]);
  assert.strictEqual((await wali('wali/anak')).status, 403);          // wajib ganti password
  assert.strictEqual((await wali('password', 'POST', { lama: reset, baru: 'sandiwali99' })).status, 200);
  const anak = (await wali('wali/anak')).data;
  assert.deepStrictEqual(anak.map((x) => x.nama).sort(), ['Adik MI', 'Anak Satu']);

  const d = (await wali('wali/anak/' + a1)).data;
  assert.strictEqual(d.tagihan[0].status, 'lunas');
  assert.strictEqual(d.pembayaran.length, 2);
  assert.strictEqual((await wali('wali/anak/' + lain)).status, 404);   // bukan anaknya
  assert.strictEqual((await wali('wali/anak/' + a2)).status, 404);
  assert.deepStrictEqual((await wali('wali/pengumuman')).data.map((x) => x.judul).sort(), ['Libur', 'Rapat MI']);

  // wali tidak bisa memakai API petugas sama sekali
  for (const p of ['siswa', 'nilai', 'pembayaran', 'tagihan', 'users', 'dashboard', 'lembaga', 'pdf/siswa', 'export/siswa', `rapor?siswa_id=${a1}`, `riwayat?siswa_id=${a1}`, 'wali-akun?siswa_id=' + a1]) {
    assert.strictEqual((await wali(p)).status, 403, p);
  }
  assert.strictEqual((await wali('siswa', 'POST', { nama: 'x' })).status, 403);
  assert.strictEqual((await wali(`siswa/${a1}`, 'DELETE')).status, 403);
  assert.strictEqual((await wali('wali-akun/reset', 'POST', { user_id: 1 })).status, 403);

  // wali lain tidak melihat anak ini; akun wali tak muncul di daftar pengguna petugas
  const other = (await yys('wali-akun', 'POST', { siswa_id: lain, username: 'ortu.lain', nama: 'Ortu Lain' })).data;
  assert.match(other.password, /^[A-Za-z0-9]{10}$/);
  const w2 = client(); await w2('login', 'POST', { username: 'ortu.lain', password: other.password });
  await w2('password', 'POST', { lama: other.password, baru: 'sandilain88' });
  assert.deepStrictEqual((await w2('wali/anak')).data.map((x) => x.nama), ['Anak Orang Lain']);
  assert.strictEqual((await w2('wali/anak/' + a1)).status, 404);
  assert.strictEqual((await yys('users')).data.some((u) => u.role === 'wali'), false);
  assert.strictEqual((await yys(`users/${other.user_id}`, 'DELETE')).status, 404);

  // admin MI hanya mengurus wali anak MI
  await yys('users', 'POST', { username: 'adminmi', password: 'rahasia1', nama: 'A', role: 'admin', lembaga_ids: [MI] });
  const mi = client(); await mi('login', 'POST', { username: 'adminmi', password: 'rahasia1' });
  await mi('password', 'POST', { lama: 'rahasia1', baru: 'rahasia2x' });
  assert.strictEqual((await mi('wali-akun', 'POST', { siswa_id: a1 })).status, 404);
  assert.strictEqual((await mi('wali-akun/reset', 'POST', { user_id: other.user_id })).status, 404);
  assert.strictEqual((await mi('wali-akun/reset', 'POST', { user_id: acc[0].user_id })).status, 200); // wali ini punya anak di MI
  assert.strictEqual((await wali('wali/anak')).status, 401);                                        // sesi lama dicabut

  // melepas tautan: wali tanpa anak ikut dihapus
  assert.strictEqual((await yys(`wali-akun?siswa_id=${lain}&user_id=${other.user_id}`, 'DELETE')).status, 200);
  assert.strictEqual((await w2('wali/anak')).status, 401);

  // pembatasan login per username
  const bf = client();
  for (let i = 0; i < 10; i++) await bf('login', 'POST', { username: 'target', password: 'x' });
  assert.strictEqual((await bf('login', 'POST', { username: 'target', password: 'x' })).status, 429);
});

test('profil yayasan hanya untuk admin yayasan', async (t) => {
  const { client } = await boot(t);
  const yys = client(); const me = (await yys('login', 'POST', { username: 'admin', password: 'admin123' })).data;
  const p = (await yys('profil')).data;
  assert.strictEqual(p.sk_pengesahan, 'AHU-0004853.AH.01.04.Tahun 2015');
  assert.strictEqual((await yys('profil', 'PUT', { alamat: 'Jl. Kartini No. 1', bukan_kunci: 'x' })).data.alamat, 'Jl. Kartini No. 1');
  assert.strictEqual((await yys('profil')).data.bukan_kunci, undefined);
  const SMP = me.lembagas.find((l) => l.kode === 'SMP').id;
  await yys('users', 'POST', { username: 'adminsmp', password: 'rahasia1', nama: 'A', role: 'admin', lembaga_ids: [SMP] });
  const adm = client(); await adm('login', 'POST', { username: 'adminsmp', password: 'rahasia1' });
  await adm('password', 'POST', { lama: 'rahasia1', baru: 'rahasia2x' });
  assert.strictEqual((await adm('profil')).status, 403);
  assert.strictEqual((await adm('profil', 'PUT', { alamat: 'x' })).status, 403);
  // tidak tercetak di PDF
  const pdf = (await yys('pdf/siswa')).data.toString('latin1');
  assert.strictEqual(pdf.includes('AHU'), false);
});

// ================= WhatsApp =================
const crypto = require('node:crypto');
const { kelasKeys, sameKelas, parseTanggal, matchSiswa, waNorm } = require('./wa');

test('WA: pengenal kelas, tanggal, nomor, dan nama', () => {
  for (const [a, b] of [['7A', 'VII-A'], ['vii a', '7a'], ['X IPA', 'xipa'], ['10 ipa', 'X-IPA'], ['xi tkj', 'XI-TKJ'], ['1a', 'I-A'], ['kelas 7a', 'VIIA']]) assert.ok(sameKelas(a, b), `${a} ~ ${b}`);
  for (const [a, b] of [['7a', '7b'], ['viii-a', 'vii-a'], ['xi ipa', 'x ipa']]) assert.ok(!sameKelas(a, b), `${a} !~ ${b}`);
  assert.strictEqual(waNorm('0812-3456-7890'), '6281234567890');
  assert.strictEqual(waNorm('+62 812 3456 7890'), '6281234567890');
  assert.strictEqual(waNorm('6281234567890@c.us'), '6281234567890');
  assert.strictEqual(waNorm('81234567890'), '6281234567890');
  const T = '2026-10-02';
  assert.deepStrictEqual(parseTanggal(['kemarin'], T), { tanggal: '2026-10-01', pakai: 1 });
  assert.deepStrictEqual(parseTanggal(['30/09'], T), { tanggal: '2026-09-30', pakai: 1 });
  assert.deepStrictEqual(parseTanggal(['1', 'okt'], T), { tanggal: '2026-10-01', pakai: 2 });
  assert.deepStrictEqual(parseTanggal(['2026-09-28'], T), { tanggal: '2026-09-28', pakai: 1 });
  assert.ok(parseTanggal(['31/02'], T).err);
  assert.strictEqual(parseTanggal(['andin'], T), null);
  const murid = [{ id: 1, nama: 'Andin Pratama' }, { id: 2, nama: 'Andini Putri' }, { id: 3, nama: "Ma'ruf Hakim" }, { id: 4, nama: 'Budi Santoso' }, { id: 5, nama: 'Budi Hartono' }];
  assert.strictEqual(matchSiswa('andin', murid).siswa.id, 1);              // kata persis lebih diutamakan daripada awalan
  assert.strictEqual(matchSiswa('ANDINI', murid).siswa.id, 2);
  assert.strictEqual(matchSiswa('maruf', murid).siswa.id, 3);               // tanda baca diabaikan
  assert.strictEqual(matchSiswa('santoso', murid).siswa.id, 4);
  assert.strictEqual(matchSiswa('andn', murid).siswa.id, 1);                // salah ketik 1 huruf, hanya 1 kandidat -> dikenali
  assert.strictEqual(matchSiswa('andi', murid).ambig.length, 2);            // Andin / Andini -> tidak menebak
  assert.strictEqual(matchSiswa('budi', murid).ambig.length, 2);
  assert.strictEqual(matchSiswa('Budi Hart', murid).siswa.id, 5);
  assert.ok(matchSiswa('zzz', murid).none);
});

async function siapWa(t, opts) {
  const { client, base } = await boot(t, opts);
  const yys = client(); const me = (await yys('login', 'POST', { username: 'admin', password: 'admin123' })).data;
  const id = (k) => me.lembagas.find((l) => l.kode === k).id; const [SMP, MI] = [id('SMP'), id('MI')];
  const kA = (await yys('kelas', 'POST', { nama: 'VII-A' }, SMP)).data.id, kB = (await yys('kelas', 'POST', { nama: 'VII-B' }, SMP)).data.id;
  const kMI = (await yys('kelas', 'POST', { nama: 'I-A' }, MI)).data.id;
  const sis = {}; for (const [n, k, l] of [['Andin Pratama', kA, SMP], ['Budi Santoso', kA, SMP], ['Citra Dewi', kA, SMP], ['Andini Putri', kA, SMP], ['Budi Hartono', kB, SMP], ['Dewi Anak MI', kMI, MI]]) sis[n] = (await yys('siswa', 'POST', { nama: n, kelas_id: k }, l)).data.id;
  const guru = async (username, wa, lembaga) => (await yys('users', 'POST', { username, nama: username, role: 'guru', wa, lembaga_ids: lembaga })).data.id;
  return { yys, me, SMP, MI, kA, kB, kMI, sis, guru, client, base };
}

test('WA: absensi "semua hadir kecuali" lewat pesan', async (t) => {
  const { yys, SMP, kA, sis, guru } = await siapWa(t);
  const g = await guru('ali', '0812-3456-7001', [SMP]);
  const wa = (pesan, uid = g) => yys('wa/simulasi', 'POST', { user_id: uid, pesan }).then((r) => r.data.balasan);
  const status = async () => Object.fromEntries((await yys(`absensi?kelas_id=${kA}&tanggal=${new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)}`, 'GET', null, SMP)).data.map((r) => [r.nama, r.status + (r.keterangan ? ':' + r.keterangan : '')]));

  let r = await wa('absen 7A andin sakit demam, budi izin');
  assert.match(r, /Hadir 2 dari 4/); assert.match(r, /Sakit \(1\): Andin Pratama – demam/);
  const rows = (await yys(`absensi?kelas_id=${kA}&tanggal=${new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)}`, 'GET', null, SMP)).data;
  const by = Object.fromEntries(rows.map((x) => [x.nama, x.status]));
  assert.deepStrictEqual(by, { 'Andin Pratama': 'S', 'Andini Putri': 'H', 'Budi Santoso': 'I', 'Citra Dewi': 'H' });

  // koreksi: kirim ulang menimpa seluruhnya
  await wa('absen vii-a semua hadir');
  assert.ok(Object.values(await status()).every((v) => v === 'H'));
  // beragam gaya penulisan
  await wa('Absen 7a:\nAndin sakit\nbudi izin acara keluarga\n'); assert.deepStrictEqual(await status(), { 'Andin Pratama': 'S', 'Andini Putri': 'H', 'Budi Santoso': 'I:acara keluarga', 'Citra Dewi': 'H' });
  await wa('absen 7a sakit: andin, citra'); assert.deepStrictEqual(Object.values(await status()), ['S', 'H', 'H', 'S']);
  await wa('ABSEN 7A semua hadir kecuali andini alpa, citra sakit demam, batuk'); assert.deepStrictEqual(await status(), { 'Andin Pratama': 'H', 'Andini Putri': 'A', 'Budi Santoso': 'H', 'Citra Dewi': 'S:demam, batuk' });
  // tanggal mundur
  r = await wa('absen 7a kemarin andin sakit'); assert.match(r, /Kam, 1 Okt 2026.*tersimpan/s);
  assert.match(await wa('absen 7a 01/01 andin sakit'), /sampai 14 hari/);
  assert.match(await wa('absen 7a 31/02 andin sakit'), /tidak valid/);

  // semua-atau-tidak-sama-sekali
  const sebelum = await status();
  r = await wa('absen 7a andin sakit, zzz izin, budi alpa'); assert.match(r, /tidak ditemukan/); assert.match(r, /Belum ada yang disimpan/);
  r = await wa('absen 7a andi sakit'); assert.match(r, /cocok dengan 2 siswa/);                                    // ambigu: tidak menebak
  r = await wa('absen 7a andin'); assert.match(r, /Status untuk "Andin" tidak jelas/);
  r = await wa('absen 7a andin sakit, andin izin'); assert.match(r, /dua kali dengan status berbeda/);
  assert.deepStrictEqual(await status(), sebelum);                                                                 // tidak ada yang berubah
  assert.match(await wa('absen andin sakit'), /Kelas mana/);                                                       // guru bukan wali kelas
  assert.match(await wa('absen 9z andin sakit'), /Kelas mana|tidak/);

  // batal mengembalikan keadaan sebelumnya
  await wa('absen 7a semua hadir'); assert.ok(Object.values(await status()).every((v) => v === 'H'));
  r = await wa('batal'); assert.match(r, /dikembalikan/); assert.deepStrictEqual(await status(), sebelum);
  // rekap & bantuan
  assert.match(await wa('rekap 7a'), /Hadir \d dari 4/);
  assert.match(await wa('bantuan'), /ABSENSI/);
  assert.match(await wa('hmm apa ini'), /tidak dikenali/);
});

test('WA: wali kelas tidak perlu menulis kelas', async (t) => {
  const { yys, SMP, kA, kB, sis, guru } = await siapWa(t);
  const gid = (await yys('guru', 'POST', { nama: 'Ust. Wali', telepon: '0812-1111-0000' }, SMP)).data.id;
  await yys(`kelas/${kA}`, 'PUT', { wali_guru_id: gid });
  const u = await guru('walikelas', '081211110000', [SMP]); const lain = await guru('lain', '081299990000', [SMP]);
  const wa = (pesan, uid) => yys('wa/simulasi', 'POST', { user_id: uid, pesan }).then((r) => r.data.balasan);
  assert.match(await wa('absen andin sakit', u), /Absensi VII-A/);                    // otomatis kelas yang diwalikan
  assert.match(await wa('rekap', u), /Absensi VII-A/);
  assert.match(await wa('absen andin sakit', lain), /Kelas mana/);                    // guru lain harus menyebut kelas
  void kB; void sis;
});

test('WA: pelanggaran, poin, dan peringatan batas', async (t) => {
  const { yys, SMP, sis, kA, guru } = await siapWa(t);
  const g = await guru('ali', '0812-3456-7001', [SMP]);
  const wa = (pesan) => yys('wa/simulasi', 'POST', { user_id: g, pesan }).then((r) => r.data.balasan);
  const poin = async (n) => (await yys(`pelanggaran?siswa_id=${sis[n]}`, 'GET', null, SMP)).data.reduce((a, x) => a + x.poin, 0);

  let r = await wa('langgar andin terlambat'); assert.match(r, /Andin Pratama.*Terlambat \(\+5\).*total 5 poin/);
  assert.strictEqual(await poin('Andin Pratama'), 5);
  r = await wa('langgar 7a budi berkelahi dengan citra\ncitra hp');                                    // beberapa baris = beberapa entri
  assert.match(r, /Budi Santoso.*Berkelahi \(\+50\).*dengan citra.*50 poin/s); assert.match(r, /Mencapai 50 poin/); assert.match(r, /Citra Dewi.*Membawa\/menggunakan HP/);
  r = await wa('pelanggaran: 7a andin telat, budi bolos'); assert.match(r, /Andin Pratama.*Terlambat.*total 10/s); assert.match(r, /Budi Santoso.*Bolos\/keluar.*\(\+20\).*total 70/s);
  r = await wa('langgar 7a budi merokok'); assert.match(r, /total 120 poin/); assert.match(r, /Mencapai 100 poin/);
  r = await wa('langgar kemarin andin tugas'); assert.match(r, /Tidak mengerjakan tugas/);
  r = await wa('langgar terlambat: andin, citra'); assert.match(r, /Andin.*total/s); assert.match(r, /Citra.*total/s);

  // semua-atau-tidak-sama-sekali dan ambigu
  const before = await poin('Andin Pratama');
  r = await wa('langgar andin terlambat, zzz bolos'); assert.match(r, /tidak ditemukan/); assert.strictEqual(await poin('Andin Pratama'), before);
  r = await wa('langgar andi terlambat'); assert.match(r, /cocok dengan 2 siswa/); assert.match(r, /VII-A/);
  r = await wa('langgar budi terlambat'); assert.match(r, /cocok dengan 2 siswa/);                                  // Budi Santoso (VII-A) dan Budi Hartono (VII-B)
  r = await wa('langgar andin melompat pagar'); assert.match(r, /tidak dikenali/);
  r = await wa('langgar 7a andin berkelahi'); assert.match(r, /Berkelahi/);

  // batal & poin
  const p0 = await poin('Citra Dewi');
  await wa('langgar citra hp'); assert.strictEqual(await poin('Citra Dewi'), p0 + 15);
  r = await wa('batal'); assert.match(r, /dibatalkan/); assert.strictEqual(await poin('Citra Dewi'), p0);
  assert.match(await wa('poin budi santoso'), /Total 120 poin/);
  assert.match(await wa('poin andi'), /cocok dengan/);
  assert.match(await wa('jenis'), /terlambat – Terlambat \(5\)/);
  void kA;
});

test('WA: keamanan - nomor tak terdaftar, lembaga lain, dan peran guru', async (t) => {
  const { yys, SMP, MI, kMI, sis, guru, client } = await siapWa(t);
  const g = await guru('ali', '0812-3456-7001', [SMP]);
  const wa = (pesan) => yys('wa/simulasi', 'POST', { user_id: g, pesan }).then((r) => r.data.balasan);
  // guru SMP tidak bisa menyentuh siswa/kelas MI lewat WhatsApp
  assert.match(await wa('absen i-a dewi sakit'), /Kelas mana|tidak/);
  assert.match(await wa('langgar anak mi terlambat'), /tidak ditemukan/);
  assert.match(await wa('poin dewi anak mi'), /tidak ditemukan/);
  const mi = (await yys('absensi?kelas_id=' + kMI + '&tanggal=2026-10-02', 'GET', null, MI)).data; assert.ok(mi.every((x) => x.status === null));
  assert.strictEqual((await yys('pelanggaran', 'GET', null, MI)).data.length, 0);
  // nomor WA unik
  assert.strictEqual((await yys('users', 'POST', { username: 'dobel', nama: 'D', role: 'guru', wa: '+62 812-3456-7001', lembaga_ids: [SMP] })).status, 409);
  assert.strictEqual((await yys('users', 'POST', { username: 'salah', nama: 'D', role: 'guru', wa: '123', lembaga_ids: [SMP] })).status, 400);

  // login web guru: tanpa password (acak), dengan password: akses terbatas
  assert.strictEqual((await yys('users', 'POST', { username: 'ali2', nama: 'Ali', role: 'staf', lembaga_ids: [SMP] })).status, 400);   // staf tetap wajib password
  const guruWeb = (await yys('users', 'POST', { username: 'guruweb', password: 'rahasia1', nama: 'Guru Web', role: 'guru', lembaga_ids: [SMP] })).data.id; void guruWeb;
  const gw = client(); await gw('login', 'POST', { username: 'guruweb', password: 'rahasia1' }); await gw('password', 'POST', { lama: 'rahasia1', baru: 'rahasia2x' });
  assert.strictEqual((await gw('siswa')).status, 200);
  const sw = (await gw('siswa')).data; assert.ok(sw.length > 0 && sw.every((x) => !('nik' in x) && !('alamat' in x)));       // data pribadi disembunyikan
  assert.strictEqual((await gw('siswa', 'POST', { nama: 'x' })).status, 403);
  for (const p of ['pembayaran', 'tagihan', 'nilai', 'users', 'dashboard', 'lembaga', 'pendaftar', 'wa/status', 'wa/log', 'pdf/siswa', 'export/siswa', 'wali-akun?siswa_id=1', 'profil']) assert.strictEqual((await gw(p)).status, 403, p);
  assert.strictEqual((await gw('absensi', 'POST', { tanggal: '2026-10-02', items: [{ siswa_id: sis['Andin Pratama'], status: 'S' }] })).status, 200);
  const jn = (await gw('jenis_pelanggaran')).data[0];
  assert.strictEqual((await gw('pelanggaran', 'POST', { siswa_id: sis['Andin Pratama'], jenis_id: jn.id, tanggal: '2026-10-02' })).status, 200);
  assert.strictEqual((await gw('jenis_pelanggaran', 'POST', { kode: 'baru', nama: 'Baru' })).status, 403);

  // admin lembaga lain tidak melihat log WA / penerima SMP
  await yys('users', 'POST', { username: 'adminmi', password: 'rahasia1', nama: 'A', role: 'admin', lembaga_ids: [MI] });
  const am = client(); await am('login', 'POST', { username: 'adminmi', password: 'rahasia1' }); await am('password', 'POST', { lama: 'rahasia1', baru: 'rahasia2x' });
  await wa('langgar andin terlambat');
  assert.strictEqual((await am('wa/status')).data.penerima.length, 0);
  assert.strictEqual((await am('wa/log')).data.length, 0);
  assert.strictEqual((await am('wa/simulasi', 'POST', { user_id: g, pesan: 'bantuan' })).status, 404);
  assert.ok((await yys('wa/log')).data.length > 0);
  assert.strictEqual((await am('pelanggaran')).data.length, 0);
});

test('WA: webhook Meta - tanda tangan, nomor, duplikat, kedaluwarsa, dan balasan', async (t) => {
  const kirim = [];
  const fakeFetch = async (url, init) => {
    let body; try { body = JSON.parse(init.body); } catch { body = Object.fromEntries(new URLSearchParams(init.body)); }
    kirim.push({ url, body, auth: init.headers.Authorization }); return { ok: true, status: 200 };
  };
  const KEYS = ['WA_PROVIDER', 'WA_APP_SECRET', 'WA_VERIFY_TOKEN', 'WA_ACCESS_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_WEBHOOK_TOKEN', 'FONNTE_TOKEN', 'WAHA_URL'];
  Object.assign(process.env, { WA_PROVIDER: 'meta', WA_APP_SECRET: 'rahasia-app', WA_VERIFY_TOKEN: 'verif', WA_ACCESS_TOKEN: 'tok', WA_PHONE_NUMBER_ID: '123' });
  t.after(() => { for (const k of KEYS) delete process.env[k]; });
  const { yys, SMP, kA, guru, base } = await siapWa(t, { fetch: fakeFetch });
  await guru('ali', '0812-3456-7001', [SMP]);
  const url = base + 'wa/webhook';
  const payload = (msgs) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: msgs } }] }] });
  const msg = (id, from, body, extra = {}) => ({ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body }, ...extra });
  const sig = (raw, secret = 'rahasia-app') => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const post = (raw, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: raw });
  const tgl = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const absen = async () => (await yys(`absensi?kelas_id=${kA}&tanggal=${tgl}`, 'GET', null, SMP)).data.map((x) => x.status).join('');

  // verifikasi pendaftaran webhook oleh Meta
  assert.strictEqual(await (await fetch(`${url}?hub.mode=subscribe&hub.verify_token=verif&hub.challenge=abc123`)).text(), 'abc123');
  assert.strictEqual((await fetch(`${url}?hub.mode=subscribe&hub.verify_token=salah&hub.challenge=x`)).status, 403);

  // tanda tangan wajib dan harus benar
  const raw1 = payload([msg('wamid.1', '6281234567001', 'absen 7a andin sakit')]);
  assert.strictEqual((await post(raw1)).status, 401);
  assert.strictEqual((await post(raw1, { 'x-hub-signature-256': sig(raw1, 'secret-salah') })).status, 401);
  assert.strictEqual((await post(raw1, { 'x-hub-signature-256': sig(raw1 + ' ') })).status, 401);                  // isi diubah
  assert.strictEqual(kirim.length, 0); assert.strictEqual(await absen(), '');                                       // tidak ada yang diproses

  // pesan sah dari guru terdaftar: tersimpan + balasan dikirim lewat Graph API
  let r = await post(raw1, { 'x-hub-signature-256': sig(raw1) }); assert.strictEqual(r.status, 200);
  const rows = (await yys(`absensi?kelas_id=${kA}&tanggal=${tgl}`, 'GET', null, SMP)).data; assert.deepStrictEqual(Object.fromEntries(rows.map((x) => [x.nama, x.status])), { 'Andin Pratama': 'S', 'Andini Putri': 'H', 'Budi Santoso': 'H', 'Citra Dewi': 'H' });
  assert.strictEqual(kirim.length, 1);
  assert.strictEqual(kirim[0].url, 'https://graph.facebook.com/v23.0/123/messages'); assert.strictEqual(kirim[0].auth, 'Bearer tok');
  assert.strictEqual(kirim[0].body.to, '6281234567001'); assert.match(kirim[0].body.text.body, /Absensi VII-A/);

  // Meta mengirim ulang pesan yang sama: tidak diproses dua kali
  r = await post(raw1, { 'x-hub-signature-256': sig(raw1) }); assert.deepStrictEqual((await r.json()).hasil, [{ id: 'wamid.1', status: 'duplikat' }]); assert.strictEqual(kirim.length, 1);

  // antrean lama (>1 jam) diabaikan
  const lama = payload([msg('wamid.2', '6281234567001', 'absen 7a semua hadir', { timestamp: String(Math.floor(Date.now() / 1000) - 7200) })]);
  r = await post(lama, { 'x-hub-signature-256': sig(lama) }); assert.strictEqual((await r.json()).hasil[0].status, 'kedaluwarsa'); assert.strictEqual(kirim.length, 1);
  assert.strictEqual((await yys(`absensi?kelas_id=${kA}&tanggal=${tgl}`, 'GET', null, SMP)).data.find((x) => x.nama === 'Andin Pratama').status, 'S');

  // nomor tak terdaftar: dibalas penolakan, tidak menyimpan apa pun, dan berhenti dibalas setelah 3 kali
  for (let i = 0; i < 5; i++) { const raw = payload([msg('wamid.u' + i, '6285550001111', 'absen 7a andin sakit')]); await post(raw, { 'x-hub-signature-256': sig(raw) }); }
  const penolakan = kirim.filter((k) => k.body.to === '6285550001111'); assert.strictEqual(penolakan.length, 3); assert.match(penolakan[0].body.text.body, /belum terdaftar/);

  // pesan bukan teks (gambar/suara)
  const img = payload([{ from: '6281234567001', id: 'wamid.img', timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: 'x' } }]);
  await post(img, { 'x-hub-signature-256': sig(img) }); assert.match(kirim[kirim.length - 1].body.text.body, /hanya mengerti pesan teks/);

  // tanpa WA_APP_SECRET webhook menolak (fail-closed); WA_PROVIDER=none -> mati
  delete process.env.WA_APP_SECRET; assert.strictEqual((await post(raw1, { 'x-hub-signature-256': sig(raw1) })).status, 503);
  process.env.WA_PROVIDER = 'none'; assert.strictEqual((await post(raw1)).status, 404);

  // ---- Fonnte: token di URL, form-encoded ----
  Object.assign(process.env, { WA_PROVIDER: 'fonnte', WA_WEBHOOK_TOKEN: 'tokenku', FONNTE_TOKEN: 'ft' });
  const form = (m) => new URLSearchParams({ sender: '6281234567001', message: m, device: 'x' }).toString();
  const f = (q, m) => fetch(`${url}${q}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(m) });
  assert.strictEqual((await f('', 'absen 7a budi izin')).status, 401); assert.strictEqual((await f('?token=salah', 'absen 7a budi izin')).status, 401);
  const n0 = kirim.length; assert.strictEqual((await f('?token=tokenku', 'absen 7a budi izin')).status, 200);
  assert.strictEqual(kirim.length, n0 + 1); assert.strictEqual(kirim[n0].url, 'https://api.fonnte.com/send'); assert.strictEqual(kirim[n0].auth, 'ft'); assert.strictEqual(kirim[n0].body.target, '6281234567001');
  assert.strictEqual((await yys(`absensi?kelas_id=${kA}&tanggal=${tgl}`, 'GET', null, SMP)).data.find((x) => x.nama === 'Budi Santoso').status, 'I');
  void kirim;
});

test('backup otomatis: salinan konsisten dan rotasi', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { backupNow, backupTerakhir, daftar } = require('./backup-lib');
  const { server, db } = createApp(':memory:'); void server;
  db.prepare("INSERT INTO guru (lembaga_id, nama) VALUES (1, 'Contoh Guru')").run();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  assert.strictEqual(backupTerakhir(dir), 0);
  for (let i = 0; i < 5; i++) backupNow(db, dir, 3, new Date(Date.UTC(2026, 9, 1 + i, 2, 0, 0)));
  assert.deepStrictEqual(daftar(dir), ['sekolah-20261005-020000.db', 'sekolah-20261004-020000.db', 'sekolah-20261003-020000.db']);   // hanya 3 terbaru
  assert.ok(backupTerakhir(dir) > 0);
  const { DatabaseSync } = require('node:sqlite');
  const salinan = new DatabaseSync(path.join(dir, daftar(dir)[0]));
  assert.strictEqual(salinan.prepare('SELECT nama FROM guru').get().nama, 'Contoh Guru');            // isi database ikut tersalin
  assert.strictEqual(salinan.prepare('SELECT COUNT(*) n FROM lembaga').get().n, 7);
  fs.rmSync(dir, { recursive: true });
});

test('privasi: persetujuan orang tua tercatat, halaman publik tanpa data SK, riwayat WA dibersihkan', async (t) => {
  const { client, base } = await boot(t);
  const yys = client(), pub = client();
  const me = (await yys('login', 'POST', { username: 'admin', password: 'admin123' })).data;
  const SMP = me.lembagas.find((l) => l.kode === 'SMP').id;
  await yys(`lembaga/${SMP}`, 'PUT', { ppdb_buka: 1 });
  const form = { lembaga_id: SMP, nama: 'Calon', jk: 'L', tgl_lahir: '2014-05-10', telepon: '08123', nama_ayah: 'Pak Calon' };
  assert.strictEqual((await pub('public/daftar', 'POST', form)).status, 400);                         // tanpa persetujuan ditolak
  assert.match((await pub('public/daftar', 'POST', form)).data.error, /Persetujuan/);
  const ok = await pub('public/daftar', 'POST', { ...form, setuju: 'on' }); assert.strictEqual(ok.status, 200);
  const row = (await yys('pendaftar', 'GET', null, SMP)).data[0];
  assert.match(row.persetujuan, /^\d{4}-\d{2}-\d{2}T/);                                              // waktu persetujuan tersimpan
  const manual = (await yys('pendaftar', 'POST', { nama: 'Datang Langsung' }, SMP)).data.id;          // input petugas: tanpa persetujuan online
  assert.strictEqual((await yys('pendaftar/' + manual, 'GET')).data.persetujuan, null);

  // halaman privasi: hanya data kontak; data SK tidak pernah ikut
  assert.deepStrictEqual((await pub('public/privasi')).data, { nama_yayasan: 'Yayasan Miftahul Ulumillah' });   // belum diisi -> kosong
  await yys('profil', 'PUT', { kontak_email: 'privasi@contoh.id', pejabat_pdp: 'Siti', alamat: 'Jl. Rahasia SK', sk_pengesahan: 'AHU-RAHASIA' });
  const pv = (await pub('public/privasi')).data;
  assert.strictEqual(pv.kontak_email, 'privasi@contoh.id'); assert.strictEqual(pv.pejabat_pdp, 'Siti');
  assert.ok(!JSON.stringify(pv).includes('AHU') && !JSON.stringify(pv).includes('Rahasia'));
  const page = await fetch(base.replace('/api/', '/privasi')); assert.strictEqual(page.status, 200); assert.match(await page.text(), /Kebijakan Privasi/);
  assert.strictEqual((await fetch(base.replace('/api/', '/privasi.js'))).status, 200);
  assert.strictEqual((await fetch(base.replace('/api/', '/daftar'))).status, 200);

  // riwayat WhatsApp: lebih dari 90 hari dihapus otomatis, yang baru tetap
  const { db, purgeWaLog } = createApp(':memory:');
  db.prepare("INSERT INTO wa_log (pesan, status, dibuat) VALUES ('lama', 'ok', datetime('now', '-91 days')), ('batas', 'ok', datetime('now', '-89 days')), ('baru', 'ok', datetime('now'))").run();
  assert.strictEqual(purgeWaLog(90), 1);
  assert.deepStrictEqual(db.prepare('SELECT pesan FROM wa_log ORDER BY id').all().map((r) => r.pesan), ['batas', 'baru']);
});
