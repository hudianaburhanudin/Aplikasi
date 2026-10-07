process.env.ADMIN_PASSWORD = 'admin123';
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./server');

async function boot(t, opts) {
  const { server, db } = createApp(':memory:', opts);
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
  return { client, base, db };
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
  r = await wa('absen 7a kemarin andin sakit'); assert.match(r, new RegExp(`, ${new Date(Date.now() + 7 * 3600e3 - 86400e3).getUTCDate()} \\w+ \\d{4}.*tersimpan`, 's'));
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

test('hak pemilik data: permintaan dari wali, pemrosesan admin, salinan PDF, dan jejak audit', async (t) => {
  const { yys, SMP, MI, kA, kMI, sis, client } = await siapWa(t);
  const a1 = sis['Andin Pratama'], adikMI = sis['Dewi Anak MI'], lain = sis['Budi Santoso'];
  await yys('nilai', 'POST', { siswa_id: a1, mapel: 'Matematika', nilai: 88, semester: 'Ganjil' });
  await yys('pelanggaran', 'POST', { siswa_id: a1, jenis_id: (await yys('jenis_pelanggaran', 'GET', null, SMP)).data[0].id, tanggal: '2026-10-01' });
  const akun = async (sid, username) => (await yys('wali-akun', 'POST', { siswa_id: sid, username })).data;
  const w1 = await akun(a1, 'ortu.satu'); await akun(adikMI, 'ortu.satu');               // satu wali, dua anak lintas lembaga
  const w2 = await akun(lain, 'ortu.dua');
  const login = async (u, pw) => { const c = client(); await c('login', 'POST', { username: u, password: pw }); await c('password', 'POST', { lama: pw, baru: 'sandiwali123' }); return c; };
  const wali1 = await login('ortu.satu', w1.password), wali2 = await login('ortu.dua', w2.password);

  // ---- wali mengajukan permintaan ----
  assert.strictEqual((await wali1('wali/permintaan', 'POST', { jenis: 'aneh' })).status, 400);
  assert.strictEqual((await wali1('wali/permintaan', 'POST', { jenis: 'salinan', siswa_id: lain })).status, 404);      // bukan anaknya
  assert.strictEqual((await wali1('wali/permintaan', 'POST', { jenis: 'koreksi', siswa_id: a1 })).status, 400);        // koreksi wajib menyebut data apa
  const pSalinan = (await wali1('wali/permintaan', 'POST', { jenis: 'salinan', siswa_id: a1 })).data.id;
  assert.strictEqual((await wali1('wali/permintaan', 'POST', { jenis: 'salinan', siswa_id: a1 })).status, 409);        // sudah ada yang serupa
  const pKoreksi = (await wali1('wali/permintaan', 'POST', { jenis: 'koreksi', siswa_id: a1, catatan: 'Tanggal lahir salah' })).data.id; void pKoreksi;
  const pAkun = (await wali1('wali/permintaan', 'POST', { jenis: 'hapus_akun' })).data.id;
  const pAkun2 = (await wali2('wali/permintaan', 'POST', { jenis: 'hapus_akun' })).data.id;
  assert.strictEqual((await wali1('wali/permintaan')).data.length, 3);
  assert.strictEqual((await wali2('wali/permintaan')).data.length, 1);                                                // wali lain tidak melihat milik orang

  // ---- admin: hanya yang berada dalam lingkupnya ----
  await yys('users', 'POST', { username: 'adminmi', password: 'rahasia1', nama: 'Admin MI', role: 'admin', lembaga_ids: [MI] });
  await yys('users', 'POST', { username: 'adminsmp', password: 'rahasia1', nama: 'Admin SMP', role: 'admin', lembaga_ids: [SMP] });
  await yys('users', 'POST', { username: 'stafsmp', password: 'rahasia1', nama: 'Staf SMP', role: 'staf', lembaga_ids: [SMP] });
  const masuk = async (u) => { const c = client(); await c('login', 'POST', { username: u, password: 'rahasia1' }); await c('password', 'POST', { lama: 'rahasia1', baru: 'rahasia2x' }); return c; };
  const aSmp = await masuk('adminsmp'), aMi = await masuk('adminmi'), staf = await masuk('stafsmp');
  assert.strictEqual((await staf('permintaan')).status, 403); assert.strictEqual((await staf('audit')).status, 403);
  assert.deepStrictEqual((await aSmp('permintaan')).data.map((p) => p.id).sort(), [pSalinan, pKoreksi, pAkun, pAkun2].sort());
  const idsMi = (await aMi('permintaan')).data.map((p) => p.id); assert.deepStrictEqual(idsMi, [pAkun]);                // akun lintas lembaga terlihat oleh MI juga
  assert.strictEqual((await yys('dashboard', 'GET', null, SMP)).data.permintaan_baru, 4);

  // ---- salinan data (PDF) ----
  assert.strictEqual((await aMi(`pdf/salinan?id=${pSalinan}`)).status, 404);                                          // admin MI tak bisa mengambil data siswa SMP
  assert.strictEqual((await staf(`pdf/salinan?id=${pSalinan}`)).status, 403);
  const pdf = await aSmp(`pdf/salinan?id=${pSalinan}`); assert.strictEqual(pdf.status, 200); assert.strictEqual(pdf.data.subarray(0, 5).toString(), '%PDF-');
  assert.strictEqual((await aSmp(`pdf/salinan?id=${pKoreksi}`)).status, 404);                                         // hanya untuk jenis salinan

  // ---- pemrosesan ----
  const proses = (c, id, body) => c(`permintaan/${id}/proses`, 'POST', body);
  assert.strictEqual((await proses(aSmp, pKoreksi, { aksi: 'tolak' })).status, 400);                                  // tolak wajib beralasan
  assert.strictEqual((await proses(aSmp, pKoreksi, { aksi: 'ngawur' })).status, 400);
  assert.strictEqual((await proses(aMi, pKoreksi, { aksi: 'selesai' })).status, 404);                                 // di luar lingkup
  assert.strictEqual((await proses(aSmp, pKoreksi, { aksi: 'selesai', catatan: 'Sudah dikoreksi' })).status, 200);
  assert.strictEqual((await proses(aSmp, pKoreksi, { aksi: 'selesai' })).status, 400);                                // tidak bisa diproses dua kali
  assert.strictEqual((await proses(aSmp, pSalinan, { aksi: 'tolak', catatan: 'Mohon datang membawa KTP' })).status, 200);
  const lihat = (await wali1('wali/permintaan')).data;
  assert.deepStrictEqual(lihat.map((x) => [x.jenis, x.status, x.hasil]).sort(), [['hapus_akun', 'baru', null], ['koreksi', 'selesai', 'Sudah dikoreksi'], ['salinan', 'ditolak', 'Mohon datang membawa KTP']]);

  // ---- hapus akun: akun lintas lembaga hanya bisa oleh admin yayasan; akun satu lembaga oleh adminnya ----
  assert.strictEqual((await proses(aSmp, pAkun, { aksi: 'hapus_akun' })).status, 403);
  assert.strictEqual((await proses(aMi, pAkun, { aksi: 'hapus_akun' })).status, 403);
  assert.strictEqual((await proses(aSmp, pKoreksi, { aksi: 'hapus_akun' })).status, 400);
  assert.strictEqual((await proses(aSmp, pAkun2, { aksi: 'hapus_akun' })).status, 200);
  assert.strictEqual((await wali2('wali/anak')).status, 401);                                                         // sesi wali itu langsung mati
  assert.strictEqual((await client()('login', 'POST', { username: 'ortu.dua', password: 'sandiwali123' })).status, 401);
  const sisa = (await yys('permintaan')).data.find((p) => p.id === pAkun2); assert.strictEqual(sisa.status, 'selesai'); assert.strictEqual(sisa.wali_username, 'ortu.dua');   // catatan permintaan tetap ada
  assert.strictEqual((await proses(yys, pAkun, { aksi: 'hapus_akun' })).status, 200);
  assert.strictEqual((await wali1('wali/anak')).status, 401);
  assert.strictEqual((await yys('users')).data.some((u) => u.username.startsWith('ortu')), false);

  // ---- jejak audit ----
  const aud = (await yys('audit')).data.map((x) => x.aksi);
  for (const a of ['permintaan_data', 'salinan_data', 'tolak_permintaan', 'selesai_permintaan', 'hapus_akun_wali', 'buat_akun_wali', 'tambah_pengguna']) assert.ok(aud.includes(a), a);
  await yys(`siswa/${a1}`, 'DELETE'); assert.match((await yys('audit')).data[0].detail, /Andin Pratama/);                // penghapusan siswa tercatat siapa/apa
  assert.ok((await yys('audit')).data.every((x) => x.aktor));
  void kA; void kMI;
});

test('hapus pendaftar otomatis: mati secara bawaan, hanya yang tidak menjadi siswa, tercatat', async (t) => {
  const { yys, SMP, kA } = await siapWa(t);
  const { db, purgePendaftar } = createApp(':memory:'); void kA;
  const lembaga = db.prepare("SELECT id FROM lembaga WHERE kode = 'SMP'").get().id;
  const baris = db.prepare("INSERT INTO pendaftar (lembaga_id, tahun_ajaran, urut, no_daftar, nama, status, dibuat) VALUES (?, '2026/2027', ?, ?, ?, ?, datetime('now', ?))");
  [['ditolak', '-13 months'], ['cadangan', '-13 months'], ['baru', '-13 months'], ['terverifikasi', '-13 months'], ['diterima', '-13 months'], ['terdaftar', '-13 months'], ['ditolak', '-2 months']]
    .forEach(([st, umur], i) => baris.run(lembaga, i + 1, 'SMP-2026-000' + (i + 1), 'P' + i, st, umur));
  assert.strictEqual(purgePendaftar(), 0);                                                                           // bawaan: tidak menghapus apa pun
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM pendaftar').get().n, 7);
  db.prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('hapus_pendaftar_bulan', '12')").run();
  assert.strictEqual(purgePendaftar(), 4);                                                                           // ditolak, cadangan, baru, terverifikasi yang > 12 bulan
  assert.deepStrictEqual(db.prepare('SELECT status FROM pendaftar ORDER BY id').all().map((r) => r.status), ['diterima', 'terdaftar', 'ditolak']);
  const a = db.prepare("SELECT aktor, aksi, detail FROM audit WHERE aksi = 'hapus_pendaftar_otomatis'").get(); assert.strictEqual(a.aktor, 'sistem'); assert.match(a.detail, /4 pendaftar/);
  assert.strictEqual(purgePendaftar(), 0);                                                                           // tidak berulang

  // pengaturan lewat Profil Yayasan: validasi, pratinjau, dan hanya admin yayasan
  assert.strictEqual((await yys('profil', 'PUT', { hapus_pendaftar_bulan: '-1' })).status, 400);
  assert.strictEqual((await yys('profil', 'PUT', { hapus_pendaftar_bulan: 'abc' })).status, 400);
  assert.strictEqual((await yys('profil', 'PUT', { hapus_pendaftar_bulan: '999' })).status, 400);
  const pr = await yys('profil', 'PUT', { hapus_pendaftar_bulan: '6' }); assert.strictEqual(pr.status, 200); assert.strictEqual(pr.data._kedaluwarsa, 0);
  assert.ok((await yys('audit')).data.some((x) => x.aksi === 'atur_hapus_pendaftar' && /6 bulan/.test(x.detail)));
  void SMP;
});

test('jadwal pelajaran: CRUD, impor massal (CSV bawaan), PDF, isolasi, wali, guru hanya baca', async (t) => {
  const fs = require('node:fs');
  const { client } = await boot(t);
  const yys = client();
  const me = (await yys('login', 'POST', { username: 'admin', password: 'admin123' })).data;
  const id = (k) => me.lembagas.find((l) => l.kode === k).id;
  const [SMP, MI, SMK] = [id('SMP'), id('MI'), id('SMK')];
  const csv = (f) => fs.readFileSync(`${__dirname}/data/jadwal/${f}`, 'utf8');

  // CRUD dasar + validasi
  const kelas = (await yys('kelas', 'POST', { nama: 'VII' }, SMP)).data.id;
  const j1 = (await yys('jadwal', 'POST', { kelas_id: kelas, hari: 1, mulai: '7.40', selesai: '08.20', judul: 'Matematika', guru: 'Bu Sari' }, SMP)).data.id;
  assert.strictEqual((await yys(`jadwal/${j1}`, 'GET', null, SMP)).data.mulai, '07:40');
  assert.strictEqual((await yys('jadwal', 'POST', { kelas_id: kelas, hari: 9, mulai: '07.00', selesai: '08.00', judul: 'X' }, SMP)).status, 400);
  assert.strictEqual((await yys('jadwal', 'POST', { kelas_id: kelas, hari: 1, mulai: '08.00', selesai: '07.00', judul: 'X' }, SMP)).status, 400);
  assert.strictEqual((await yys('jadwal', 'POST', { kelas_id: kelas, hari: 1, mulai: 'abc', selesai: '07.00', judul: 'X' }, SMP)).status, 400);
  assert.strictEqual((await yys('jadwal', 'POST', { hari: 1, mulai: '07.00', selesai: '08.00', judul: 'X' })).status, 400);   // pilih lembaga
  const kMI = (await yys('kelas', 'POST', { nama: '1' }, MI)).data.id;
  assert.strictEqual((await yys('jadwal', 'POST', { kelas_id: kMI, hari: 1, mulai: '07.00', selesai: '08.00', judul: 'X' }, SMP)).status, 404);   // kelas lembaga lain
  assert.strictEqual((await yys(`jadwal/${j1}`, 'PUT', { selesai: '07.00' }, SMP)).status, 400);
  assert.strictEqual((await yys(`jadwal/${j1}`, 'PUT', { judul: 'MTK' }, SMP)).status, 200);

  // impor: kelas belum ada ditolak, atomik, lalu diterima
  const bad = await yys('jadwal-impor', 'POST', { text: 'VIII;Senin;07.00;08.00;IPA;Pak A\nVIII;Selasa;xx;08.00;IPA' }, SMP);
  assert.strictEqual(bad.status, 400);
  assert.match(bad.data.error, /Baris 2/);
  assert.strictEqual((await yys('jadwal-impor', 'POST', { text: 'VIII;Senin;07.00;08.00;IPA;Pak A' }, SMP)).status, 400);       // kelas VIII belum ada
  assert.strictEqual((await yys('jadwal?kelas_id=' + kelas, 'GET', null, SMP)).data.length, 1);
  const smp = (await yys('jadwal-impor', 'POST', { text: csv('SMP.csv'), buat_kelas: true, ganti: true }, SMP)).data;
  assert.deepStrictEqual(smp.kelas_baru.sort(), ['IX', 'VIII']);
  const vii = (await yys('jadwal-kelas?kelas_id=' + kelas, 'GET', null, SMP)).data;
  assert.ok(vii.rows.some((r) => r.kelas_id === null && /QIRO/.test(r.judul)), 'baris umum ikut tampil');
  assert.ok(vii.rows.some((r) => r.judul === 'PEGO' && r.hari === 1 && r.mulai === '07:40'));
  assert.ok(!vii.rows.some((r) => r.judul === 'MTK' && r.guru === 'Bu Sari'), 'jadwal lama kelas VII diganti');
  const mi = (await yys('jadwal-impor', 'POST', { text: csv('MI.csv'), buat_kelas: true }, MI)).data;
  assert.deepStrictEqual(mi.kelas_baru.sort(), ['2', '3A', '3B', '4', '5', '6']);
  const smk = (await yys('jadwal-impor', 'POST', { text: csv('SMK.csv'), buat_kelas: true }, SMK)).data;
  assert.strictEqual(smk.baris, 65);
  // lembaga lain tidak terlihat dari SMP
  assert.strictEqual((await yys('jadwal', 'GET', null, SMP)).data.every((r) => r.lembaga_kode === 'SMP'), true);
  const k6 = (await yys('kelas', 'GET', null, MI)).data.find((k) => k.nama === '6').id;
  assert.strictEqual((await yys('jadwal-kelas?kelas_id=' + k6, 'GET', null, SMP)).status, 404);

  // PDF jadwal valid
  const pdf = await yys('pdf/jadwal?kelas_id=' + k6, 'GET', null, MI);
  assert.strictEqual(pdf.status, 200);
  assert.strictEqual(pdf.data.subarray(0, 5).toString(), '%PDF-');
  assert.strictEqual((await yys('pdf/jadwal?kelas_id=' + kelas, 'GET', null, SMP)).data.subarray(0, 5).toString(), '%PDF-');

  // guru: hanya baca
  await yys('users', 'POST', { username: 'gurusmp', password: 'rahasia123', nama: 'Guru SMP', role: 'guru', lembaga_ids: [SMP] });
  const guru = client();
  await guru('login', 'POST', { username: 'gurusmp', password: 'rahasia123' });
  await guru('password', 'POST', { lama: 'rahasia123', baru: 'rahasia456' });
  assert.strictEqual((await guru('jadwal-kelas?kelas_id=' + kelas)).status, 200);
  assert.strictEqual((await guru('jadwal', 'POST', { hari: 1, mulai: '07.00', selesai: '08.00', judul: 'X' })).status, 403);
  assert.strictEqual((await guru('jadwal-impor', 'POST', { text: 'VII;Senin;07.00;08.00;X' })).status, 403);

  // wali melihat jadwal kelas anaknya (termasuk baris umum), bukan kelas lain
  const s = (await yys('siswa', 'POST', { nama: 'Anak Wali', nis: '7', kelas_id: kelas, telepon: '081300000001' }, SMP)).data.id;
  await yys('wali-akun', 'POST', { siswa_id: s });
  const acc = (await yys('wali-akun?siswa_id=' + s)).data;
  const pw = (await yys('wali-akun/reset', 'POST', { user_id: acc[0].user_id })).data.password;
  const wali = client();
  await wali('login', 'POST', { username: '081300000001', password: pw });
  await wali('password', 'POST', { lama: pw, baru: 'sandiwali99' });
  const d = (await wali('wali/anak/' + s)).data;
  assert.ok(d.jadwal.length > 30);
  assert.ok(d.jadwal.some((r) => r.judul === 'PEGO'));
  assert.ok(!d.jadwal.some((r) => r.judul === 'IPA' && r.hari === 2 && r.mulai === '08:20' && r.judul === 'PAI'));
  assert.ok(d.jadwal.every((r) => !('id' in r) && !('kelas_id' in r)));
});

test('rapor format Madin: mapel & KKM, huruf, rata-rata kelas, sikap, ketidakhadiran, PDF', async (t) => {
  const { client } = await boot(t);
  const yys = client();
  const me = (await yys('login', 'POST', { username: 'admin', password: 'admin123' })).data;
  const id = (k) => me.lembagas.find((l) => l.kode === k).id;
  const [MADIN, SMP] = [id('MADIN-ULA'), id('SMP')];
  assert.strictEqual((await yys('lembaga/' + MADIN, 'PUT', { kepala: 'Azkiyatul Ula' })).status, 200);

  const kelas = (await yys('kelas', 'POST', { nama: '3' }, MADIN)).data.id;
  const a = (await yys('siswa', 'POST', { nama: 'Andin', nis: '1', kelas_id: kelas }, MADIN)).data.id;
  const b = (await yys('siswa', 'POST', { nama: 'Budi', nis: '2', kelas_id: kelas }, MADIN)).data.id;
  await yys('mapel_rapor', 'POST', { nama: 'Fiqih', kategori: 'pokok', kkm: 70, urut: 1 }, MADIN);
  await yys('mapel_rapor', 'POST', { nama: 'Imla', kategori: 'kecakapan', kkm: 65, urut: 2 }, MADIN);
  assert.strictEqual((await yys('mapel_rapor', 'POST', { nama: 'Fiqih' }, MADIN)).status, 409);        // nama ganda
  assert.strictEqual((await yys('mapel_rapor', 'POST', { nama: 'X', kategori: 'lain' }, MADIN)).status, 400);
  for (const [sid, mp, n] of [[a, 'Fiqih', 85], [a, 'Imla', 70], [a, 'Akhlak', 90], [b, 'Fiqih', 65], [b, 'Imla', 80]]) {
    await yys('nilai', 'POST', { siswa_id: sid, mapel: mp, nilai: n, semester: 'Ganjil' });
  }
  const r = (await yys(`rapor?siswa_id=${a}&semester=Ganjil`)).data;
  assert.strictEqual(r.format, 'madin');
  assert.deepStrictEqual(r.madin.pokok.map((m) => [m.mapel, m.kkm, m.rata, m.huruf, m.kelas_rata]),
    [['Fiqih', 70, 85, 'Delapan Puluh Lima', 75], ['Akhlak', null, 90, 'Sembilan Puluh', 90]]);   // mapel belum terdaftar ikut tampil
  assert.deepStrictEqual(r.madin.kecakapan.map((m) => [m.mapel, m.rata, m.huruf, m.kelas_rata]), [['Imla', 70, 'Tujuh Puluh', 75]]);
  assert.deepStrictEqual([r.madin.jumlah, r.madin.rata], [245, 81.7]);
  assert.strictEqual(r.madin.sikap.length, 5);
  assert.deepStrictEqual(r.madin.ketidakhadiran, { sakit: '0', izin: '0', alpa: '0' });

  // sikap, catatan, dan ketidakhadiran manual
  const put = (data, sem = 'Ganjil', sid = a) => yys('rapor-catatan', 'PUT', { siswa_id: sid, semester: sem, data });
  assert.strictEqual((await put({ sikap1: 'A', sikap2: 'B', sakit: '2', 'cat:Fiqih': 'Bagus, tingkatkan' })).status, 200);
  assert.strictEqual((await put({ bogus: 'x' })).status, 400);
  assert.strictEqual((await put({ sikap1: 'A' }, 'Ganjil', 999999)).status, 404);
  const r2 = (await yys(`rapor?siswa_id=${a}&semester=Ganjil`)).data.madin;
  assert.deepStrictEqual([r2.sikap[0].nilai, r2.sikap[1].nilai, r2.sikap[2].nilai, r2.ketidakhadiran.sakit, r2.pokok[0].catatan], ['A', 'B', '', '2', 'Bagus, tingkatkan']);
  assert.strictEqual((await yys(`rapor?siswa_id=${a}&semester=Genap`)).data.madin.sikap[0].nilai, '');   // per semester
  await put({ sikap1: '' });
  assert.strictEqual((await yys(`rapor-catatan?siswa_id=${a}&semester=Ganjil`)).data.sikap1, undefined); // kosong = dihapus

  const pdf = await yys(`pdf/rapor?siswa_id=${a}&semester=Ganjil`);
  assert.strictEqual(pdf.status, 200);
  assert.strictEqual(pdf.data.subarray(0, 5).toString(), '%PDF-');

  // lembaga lain tetap memakai format umum dan tidak bisa membaca/menulis siswa Madin
  const s2 = (await yys('siswa', 'POST', { nama: 'Anak SMP', nis: '1' }, SMP)).data.id;
  await yys('nilai', 'POST', { siswa_id: s2, mapel: 'IPA', nilai: 80 });
  assert.strictEqual((await yys(`rapor?siswa_id=${s2}`)).data.format, 'umum');
  assert.strictEqual((await yys(`pdf/rapor?siswa_id=${s2}`)).data.subarray(0, 5).toString(), '%PDF-');
  await yys('users', 'POST', { username: 'adminsmp', password: 'rahasia123', nama: 'A', role: 'admin', lembaga_ids: [SMP] });
  const asmp = client();
  await asmp('login', 'POST', { username: 'adminsmp', password: 'rahasia123' });
  await asmp('password', 'POST', { lama: 'rahasia123', baru: 'rahasia456' });
  assert.strictEqual((await asmp('rapor-catatan', 'PUT', { siswa_id: a, semester: 'Ganjil', data: { sikap1: 'D' } })).status, 404);
  assert.strictEqual((await asmp(`rapor-catatan?siswa_id=${a}&semester=Ganjil`)).status, 404);
});

test('impor siswa dari Excel: By Name EMIS & Dapodik, pembaruan tanpa duplikat, ekspor By Name/SPPG', async (t) => {
  const { buildXlsx } = require('./xlsx');
  const { readXlsx } = require('./xlsx-read');
  const { client } = await boot(t);
  const yys = client();
  const me = (await yys('login', 'POST', { username: 'admin', password: 'admin123' })).data;
  const id = (k) => me.lembagas.find((l) => l.kode === k).id;
  const [MI, SMP] = [id('MI'), id('SMP')];
  const b64 = (buf) => buf.toString('base64');

  // --- By Name By Address (judul pada baris 5 setelah judul-judul laporan, baris petunjuk "diisi ...") ---
  const H = ['No', 'NIS Lokal (EMIS)', 'NISN', 'No Induk', 'Nama Siswa', 'Tempat Lahir', 'Tanggal Lahir', 'NIK Siswa', 'Nomor KK', 'Jenis Kelamin', 'Kelas', 'KIP KEMENAG', 'Nama Ayah', 'NIK Ayah', 'Nama Ibu', 'NIK Ibu', 'Alamat Siswa', 'Desa', 'Kecamatan', 'Kabupaten', 'NSM', 'Nama Madrasah', 'KKM / KECAMATAN', 'STATUS'];
  const rows = [
    ['urut', 'diisi nislokal', 'diisi nisn', 'diisi induk', 'diisi nama lengkap', 'diisi sesuai', 'diisi sesuai', 'diisi NIK', 'diisi KK', 'L/P', '1 / 2 / 3', '', 'diisi', '', '', '', 'diisi', 'desa', 'kec', 'kab', '', '', '', ''],
    [1, '111235220242240001', '185976735', '0333', 'Abryzam Gaffar Alkalif', 'Bojonegoro', '14/1/2018', '3522021101210012', '3522021101210013', 'L', 1, '', 'Sugianto', '3522011503880003', 'Apriliani', '3522024104930002', 'Jawik RT/RW 02/01', 'Jawik', 'Tambakrejo', 'BOJONEGORO', '111235220242', 'MI MIFTAHUL ULUM', 'TAMBAKREJO', 'TIDAK MENGULANG'],
    [2, '111235220242240002', '3174237254', '0334', 'Adiba Shakila Khoironi', 'Bojonegoro', '2017-10-30', '3522027010170001', '', 'P', 1, '', 'Imam', '', 'Yuliana Wati', '', 'Tambakrejo', 'Tambakrejo', 'Tambakrejo', 'BOJONEGORO', '', '', '', 'MENGULANG'],
    [3, '', '', '0335', 'Ahmad Maulana', 'Bojonegoro', 'rusak', '', '', 'Laki-laki', 2, '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  const lapor = (n) => [['BY NAME BY ADDRESS SISWA'], ['MADRASAH IBTIDAIYAH'], ['SEMESTER GANJIL'], [], ...n];
  // buildXlsx menulis baris judul = headers; susun judul laporan di atasnya lewat baris data
  const berkas = buildXlsx('MI', ['BY NAME BY ADDRESS SISWA'], [['MADRASAH IBTIDAIYAH'], ['SEMESTER GANJIL'], [], H, ...rows]);
  assert.strictEqual(readXlsx(berkas)[0].rows[4][4], 'Nama Siswa');

  assert.strictEqual((await yys('siswa-impor', 'POST', { file: b64(berkas) })).status, 400);                 // pilih lembaga dulu
  const pr = (await yys('siswa-impor', 'POST', { file: b64(berkas) }, MI)).data;
  assert.deepStrictEqual([pr.disimpan, pr.total, pr.baru, pr.diperbarui], [false, 3, 3, 0]);
  assert.deepStrictEqual(pr.kelas_baru.sort(), ['1', '2']);
  assert.ok(pr.kolom_terbaca.includes('nik_ayah') && pr.kolom_terbaca.includes('nis_lokal'));
  assert.ok(pr.peringatan.some((w) => /rusak/.test(w)));                                                       // tanggal tak dikenali
  assert.strictEqual((await yys('siswa?q=Abryzam', 'GET', null, MI)).data.length, 0);                          // pratinjau tidak menyimpan
  assert.strictEqual((await yys('siswa-impor', 'POST', { file: b64(berkas), simpan: true }, MI)).status, 400); // kelas belum ada, tidak dibuat otomatis
  const sv = (await yys('siswa-impor', 'POST', { file: b64(berkas), simpan: true, buat_kelas: true, tahun_masuk: '2026/2027' }, MI)).data;
  assert.deepStrictEqual([sv.disimpan, sv.baru], [true, 3]);
  const a = (await yys('siswa?q=Abryzam', 'GET', null, MI)).data[0];
  assert.deepStrictEqual([a.nisn, a.nis_lokal, a.nis, a.tgl_lahir, a.nik_ayah, a.kelas_nama, a.jk, a.mengulang, a.tahun_masuk, a.desa],
    ['185976735', '111235220242240001', '0333', '2018-01-14', '3522011503880003', '1', 'L', 0, '2026/2027', 'Jawik']);
  const b = (await yys('siswa?q=Adiba', 'GET', null, MI)).data[0];
  assert.deepStrictEqual([b.tgl_lahir, b.mengulang, b.jk], ['2017-10-30', 1, 'P']);
  assert.strictEqual((await yys('siswa?q=Maulana', 'GET', null, MI)).data[0].tgl_lahir, null);
  // lembaga lain tidak melihatnya
  assert.strictEqual((await yys('siswa?q=Abryzam', 'GET', null, SMP)).data.length, 0);

  // impor ulang = perbarui, tidak menggandakan, dan tidak menghapus data yang tidak ada pada berkas
  await yys(`siswa/${a.id}`, 'PUT', { telepon: '081200000000' });
  const ulang = (await yys('siswa-impor', 'POST', { file: b64(berkas), simpan: true, buat_kelas: true }, MI)).data;
  assert.deepStrictEqual([ulang.baru, ulang.diperbarui], [0, 3]);
  assert.strictEqual((await yys('siswa', 'GET', null, MI)).data.length, 3);
  assert.strictEqual((await yys(`siswa/${a.id}`)).data.telepon, '081200000000');

  // --- Dapodik: judul dua baris (Data Ayah / Nama, Tahun Lahir, ...) ---
  const g1 = ['No', 'Nama', 'NIPD', 'JK', 'NISN', 'Tempat Lahir', 'Tanggal Lahir', 'NIK', 'Agama', 'Alamat', 'RT', 'RW', 'Dusun', 'Kelurahan', 'Kecamatan', 'Kode Pos', 'Jenis Tinggal', 'HP', 'Data Ayah', '', '', '', 'Data Ibu', ''];
  const g2 = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Nama', 'Tahun Lahir', 'Pekerjaan', 'NIK', 'Nama', 'Pekerjaan'];
  const dapo = buildXlsx('Daftar Peserta Didik', g1, [g2, [1, 'ABDUL AZIZ', '0018', 'L', '0104326026', 'BOJONEGORO', '2010-04-27', '3522022704100001', 'Islam', '-', '4', '2', 'NGLAMBANGAN', 'Desa/Kel. Jatimulyo', 'Kec. Tambakrejo', '62166', 'Pesantren', '085733115271', 'AHMAT', '1968', 'Petani', '3522022106800002', 'MUSTIYAH', 'Petani']]);
  const d = (await yys('siswa-impor', 'POST', { file: b64(dapo), simpan: true }, SMP)).data;
  assert.strictEqual(d.baru, 1);
  const z = (await yys('siswa?q=AZIZ', 'GET', null, SMP)).data[0];
  assert.deepStrictEqual([z.desa, z.kecamatan, z.rt, z.dusun, z.nama_ayah, z.lahir_ayah, z.pekerjaan_ayah, z.nik_ayah, z.nama_ibu, z.telepon, z.jenis_tinggal, z.alamat],
    ['Jatimulyo', 'Tambakrejo', '4', 'NGLAMBANGAN', 'AHMAT', '1968', 'Petani', '3522022106800002', 'MUSTIYAH', '085733115271', 'Pesantren', null]);

  // baris ganda: nama sama digabung, NIS sama dengan nama berbeda ditolak, tanpa pengenal dicocokkan lewat nama
  const HH = ['Nama Siswa', 'No Induk', 'Kelas'];
  const ganda = buildXlsx('X', HH, [['Budi Satu', '900', '3'], ['BUDI SATU', '900', '4'], ['Tanpa Id', '', '3']]);
  const g = (await yys('siswa-impor', 'POST', { file: b64(ganda), simpan: true, buat_kelas: true }, MI)).data;
  assert.deepStrictEqual([g.total, g.baru], [2, 2]);
  assert.ok(g.peringatan.some((w) => /digabung/.test(w)));
  assert.strictEqual((await yys('siswa?q=Budi Satu', 'GET', null, MI)).data[0].kelas_nama, '4');                 // baris belakangan menang
  assert.strictEqual((await yys('siswa-impor', 'POST', { file: b64(ganda), simpan: true }, MI)).data.baru, 0);   // impor ulang: Tanpa Id tidak digandakan
  const bentrok = buildXlsx('X', HH, [['Cici', '901', '3'], ['Dedi', '901', '3']]);
  const bt = await yys('siswa-impor', 'POST', { file: b64(bentrok), simpan: true }, MI);
  assert.strictEqual(bt.status, 400); assert.match(bt.data.error, /Baris \d+ dan \d+/);

  // berkas rusak / bukan Excel / tanpa judul
  assert.strictEqual((await yys('siswa-impor', 'POST', { file: b64(Buffer.from('bukan excel'.repeat(20))) }, MI)).status, 400);
  assert.strictEqual((await yys('siswa-impor', 'POST', { file: b64(buildXlsx('X', ['a', 'b'], [[1, 2]])) }, MI)).status, 400);

  // ekspor By Name (EMIS) & SPPG
  await yys('lembaga/' + MI, 'PUT', { nsm: '111235220242' });
  const ex = await yys('export/by-name', 'GET', null, MI);
  assert.strictEqual(ex.status, 200);
  const sh = readXlsx(ex.data)[0].rows;
  assert.deepStrictEqual(sh[0].slice(0, 6), ['No', 'NIS Lokal (EMIS)', 'NISN', 'No Induk', 'Nama Siswa', 'Tempat Lahir']);
  const baris = sh.find((r) => r[4] === 'Abryzam Gaffar Alkalif');
  assert.deepStrictEqual([baris[2], baris[3], baris[9], baris[10], baris.at(-1)], ['185976735', '0333', 'L', '1', 'TIDAK MENGULANG']);
  assert.ok(sh.some((r) => r.includes('111235220242') && r.includes('MI Miftahul Ulum')));
  const sp = readXlsx((await yys('export/sppg', 'GET', null, MI)).data)[0].rows;
  assert.deepStrictEqual(sp[0], ['NO', 'NISN', 'NAMA SISWA', 'UMUR', 'JENIS KELAMIN', 'KELAS', 'NAMA ORANG TUA / WALI']);
  assert.match(sp[1][3], /^\d+ Thn \d+ Bln$/);
  assert.strictEqual((await yys('export/siswa-lengkap', 'GET', null, MI)).status, 200);

  // guru tidak boleh impor dan tidak melihat data pribadi
  await yys('users', 'POST', { username: 'gurumi', password: 'rahasia123', nama: 'Guru MI', role: 'guru', lembaga_ids: [MI] });
  const guru = client();
  await guru('login', 'POST', { username: 'gurumi', password: 'rahasia123' });
  await guru('password', 'POST', { lama: 'rahasia123', baru: 'rahasia456' });
  assert.strictEqual((await guru('siswa-impor', 'POST', { file: b64(berkas) })).status, 403);
  const gs = (await guru('siswa?q=Abryzam')).data[0];
  assert.strictEqual(gs.nama, 'Abryzam Gaffar Alkalif');
  for (const k of ['nik', 'no_kk', 'nik_ayah', 'nik_ibu', 'alamat', 'desa', 'kip_kemenag']) assert.ok(!(k in gs), k + ' tidak boleh terlihat guru');
});

test('cetak massal rapor & kartu pelajar, rapor untuk wali, kehadiran per semester, dashboard', async (t) => {
  const { client } = await boot(t);
  const yys = client();
  const me = (await yys('login', 'POST', { username: 'admin', password: 'admin123' })).data;
  const id = (k) => me.lembagas.find((l) => l.kode === k).id;
  const [MADIN, SMP] = [id('MADIN-ULA'), id('SMP')];
  const halaman = (buf) => (buf.toString('latin1').match(/\/Type \/Page /g) || []).length;

  const kelas = (await yys('kelas', 'POST', { nama: '3' }, MADIN)).data.id;
  const sis = [];
  for (const [n, nis] of [['Andin', '101'], ['Budi', '102'], ['Citra', '103']]) sis.push((await yys('siswa', 'POST', { nama: n, nis, nisn: '99' + nis, kelas_id: kelas, telepon: '0813000000' + nis.slice(1) }, MADIN)).data.id);
  await yys('mapel_rapor', 'POST', { nama: 'Fiqih', kkm: 70 }, MADIN);
  for (const sid of sis) await yys('nilai', 'POST', { siswa_id: sid, mapel: 'Fiqih', nilai: 80, semester: 'Ganjil' });

  // kehadiran per semester mengikuti tahun ajaran aktif (2026/2027: Ganjil = Jul-Des 2026, Genap = Jan-Jun 2027)
  const a = sis[0];
  const ab = (tanggal, status) => yys('absensi', 'POST', { tanggal, items: [{ siswa_id: a, status }] }, MADIN);
  await ab('2026-09-10', 'S'); await ab('2026-10-01', 'A'); await ab('2027-02-03', 'I');
  const gj = (await yys(`rapor?siswa_id=${a}&semester=Ganjil`)).data, gn = (await yys(`rapor?siswa_id=${a}&semester=Genap`)).data, semua = (await yys(`rapor?siswa_id=${a}`)).data;
  assert.deepStrictEqual([gj.absensi.s, gj.absensi.a, gj.absensi.i], [1, 1, 0]);
  assert.deepStrictEqual([gn.absensi.s, gn.absensi.a, gn.absensi.i], [0, 0, 1]);
  assert.deepStrictEqual([semua.absensi.s, semua.absensi.a, semua.absensi.i], [1, 1, 1]);
  assert.deepStrictEqual(gj.madin.ketidakhadiran, { sakit: '1', izin: '0', alpa: '1' });

  // cetak massal: satu halaman per siswa; kartu 10 per halaman
  const rk = await yys(`pdf/rapor-kelas?kelas_id=${kelas}&semester=Ganjil`);
  assert.strictEqual(rk.status, 200); assert.strictEqual(rk.data.subarray(0, 5).toString(), '%PDF-'); assert.strictEqual(halaman(rk.data), 3);
  const kp = await yys(`pdf/kartu?kelas_id=${kelas}`);
  assert.strictEqual(kp.status, 200); assert.strictEqual(halaman(kp.data), 1);
  assert.strictEqual((await yys(`pdf/kartu?siswa_id=${a}`)).status, 200);
  assert.strictEqual((await yys('pdf/kartu')).status, 400);
  const kosong = (await yys('kelas', 'POST', { nama: 'kosong' }, MADIN)).data.id;
  assert.strictEqual((await yys(`pdf/rapor-kelas?kelas_id=${kosong}`)).status, 404);
  const kSMP = (await yys('kelas', 'POST', { nama: 'VII' }, SMP)).data.id;
  await yys('users', 'POST', { username: 'adminsmp', password: 'rahasia123', nama: 'A', role: 'admin', lembaga_ids: [SMP] });
  const asmp = client();
  await asmp('login', 'POST', { username: 'adminsmp', password: 'rahasia123' });
  await asmp('password', 'POST', { lama: 'rahasia123', baru: 'rahasia456' });
  assert.strictEqual((await asmp(`pdf/kartu?kelas_id=${kelas}`)).status, 404);          // kelas lembaga lain
  assert.strictEqual((await asmp(`pdf/rapor-kelas?kelas_id=${kelas}`)).status, 404);
  assert.strictEqual((await asmp(`pdf/kartu?siswa_id=${a}`)).status, 404);
  assert.ok(kSMP);

  // rapor di aplikasi wali: hanya anak sendiri, tanpa data pribadi
  await yys('wali-akun', 'POST', { siswa_id: a });
  const acc = (await yys('wali-akun?siswa_id=' + a)).data;
  const pw = (await yys('wali-akun/reset', 'POST', { user_id: acc[0].user_id })).data.password;
  const wali = client();
  await wali('login', 'POST', { username: acc[0].username, password: pw });
  await wali('password', 'POST', { lama: pw, baru: 'sandiwali99' });
  const wr = (await wali(`wali/anak/${a}/rapor?semester=Ganjil`)).data;
  assert.strictEqual(wr.format, 'madin'); assert.strictEqual(wr.madin.pokok[0].mapel, 'Fiqih');
  assert.deepStrictEqual(Object.keys(wr.siswa).sort(), ['kelas_nama', 'kepala_lembaga', 'lembaga_kode', 'lembaga_nama', 'nama', 'nis', 'wali_kelas']);
  const wp = await wali(`wali/anak/${a}/rapor-pdf?semester=Ganjil`);
  assert.strictEqual(wp.status, 200); assert.strictEqual(wp.data.subarray(0, 5).toString(), '%PDF-');
  assert.strictEqual((await wali(`wali/anak/${sis[1]}/rapor`)).status, 404);              // bukan anaknya
  assert.strictEqual((await wali(`wali/anak/${sis[1]}/rapor-pdf`)).status, 404);

  // dashboard: tren kehadiran, tunggakan per lembaga, siswa perlu perhatian
  const J = (await yys('jenis_pelanggaran', 'GET', null, MADIN)).data.sort((x, y) => y.poin - x.poin)[0];
  for (let i = 0; i < Math.ceil(50 / J.poin); i++) await yys('pelanggaran', 'POST', { siswa_id: sis[1], jenis_id: J.id, tanggal: '2026-10-01' }, MADIN);
  await yys('tagihan', 'POST', { siswa_id: a, jenis: 'SPP', periode: '2026-09', jumlah: 100000, jatuh_tempo: '2026-09-10' });
  const d = (await yys('dashboard')).data;
  assert.ok(Array.isArray(d.tren_hadir));
  assert.deepStrictEqual(d.tunggakan_per_lembaga, [{ kode: 'MADIN-ULA', jumlah: 100000 }]);
  assert.ok(d.berisiko.some((r) => r.nama === 'Budi' && r.poin >= 50));
});

test('pengingat tagihan lewat WhatsApp: pratinjau, pengiriman, tanpa duplikat 7 hari, keamanan', async (t) => {
  const kirim = [];
  const fetchStub = async (url, init) => { kirim.push({ url, body: String(init.body) }); return { ok: true, status: 200 }; };
  const KEYS = ['WA_PROVIDER', 'FONNTE_TOKEN'], lama = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  t.after(() => KEYS.forEach((k) => (lama[k] === undefined ? delete process.env[k] : (process.env[k] = lama[k]))));
  delete process.env.WA_PROVIDER;
  const { client } = await boot(t, { fetch: fetchStub, jedaKirim: 0 });
  const yys = client();
  const me = (await yys('login', 'POST', { username: 'admin', password: 'admin123' })).data;
  const SMP = me.lembagas.find((l) => l.kode === 'SMP').id, MI = me.lembagas.find((l) => l.kode === 'MI').id;
  const kelas = (await yys('kelas', 'POST', { nama: 'VII' }, SMP)).data.id;
  const s1 = (await yys('siswa', 'POST', { nama: 'Andin', nis: '1', kelas_id: kelas, telepon: '0812-3456-7890' }, SMP)).data.id;
  const s2 = (await yys('siswa', 'POST', { nama: 'Budi', nis: '2', kelas_id: kelas }, SMP)).data.id;   // tanpa nomor
  const s3 = (await yys('siswa', 'POST', { nama: 'Citra', nis: '3', kelas_id: kelas, telepon: '081300000003' }, SMP)).data.id;
  for (const sid of [s1, s2, s3]) await yys('tagihan', 'POST', { siswa_id: sid, jenis: 'SPP', periode: '2026-09', jumlah: 150000, jatuh_tempo: '2026-09-10' });
  await yys('tagihan', 'POST', { siswa_id: s1, jenis: 'Seragam', periode: '2026-12', jumlah: 99000, jatuh_tempo: '2999-01-01' });   // belum jatuh tempo
  await yys('pembayaran', 'POST', { siswa_id: s3, jumlah: 150000, tanggal: '2026-09-12', jenis: 'SPP', bulan: '2026-09' });         // sudah lunas

  assert.strictEqual((await yys('pengingat-tagihan', 'POST', {})).status, 400);                                  // pilih lembaga
  const pr = (await yys('pengingat-tagihan', 'POST', {}, SMP)).data;
  assert.deepStrictEqual([pr.siswa, pr.tagihan, pr.total, pr.tanpa_nomor, pr.dikirim], [1, 1, 150000, ['Budi'], false]);
  assert.match(pr.contoh, /Andin/); assert.doesNotMatch(pr.contoh, /Seragam/);
  assert.strictEqual((await yys('pengingat-tagihan', 'POST', { kirim: true }, SMP)).status, 400);               // WA belum tersambung
  assert.strictEqual(kirim.length, 0);

  Object.assign(process.env, { WA_PROVIDER: 'fonnte', FONNTE_TOKEN: 'tok' });
  const k1 = (await yys('pengingat-tagihan', 'POST', { kirim: true }, SMP)).data;
  assert.deepStrictEqual([k1.terkirim, k1.gagal], [1, 0]);
  assert.strictEqual(kirim.length, 1);
  assert.match(kirim[0].body, /target=6281234567890/); assert.match(decodeURIComponent(kirim[0].body.replace(/\+/g, ' ')), /Andin.*SPP 2026-09: Rp 150\.000/s);
  const k2 = (await yys('pengingat-tagihan', 'POST', { kirim: true }, SMP)).data;                                  // 7 hari: tidak diulang
  assert.deepStrictEqual([k2.siswa, k2.terkirim, k2.sudah_diingatkan], [0, 0, 1]);
  assert.strictEqual(kirim.length, 1);
  assert.ok((await yys('audit')).data.some((r) => r.aksi === 'pengingat_tagihan'));

  // lembaga lain tidak terlihat; guru ditolak
  assert.strictEqual((await yys('pengingat-tagihan', 'POST', {}, MI)).data.siswa, 0);
  assert.strictEqual((await yys('pengingat-tagihan', 'POST', { kelas_id: kelas }, MI)).status, 404);
  await yys('users', 'POST', { username: 'gurusmp', password: 'rahasia123', nama: 'G', role: 'guru', lembaga_ids: [SMP] });
  const guru = client();
  await guru('login', 'POST', { username: 'gurusmp', password: 'rahasia123' });
  await guru('password', 'POST', { lama: 'rahasia123', baru: 'rahasia456' });
  assert.strictEqual((await guru('pengingat-tagihan', 'POST', {})).status, 403);
});

test('backup: salinan ke luar server lewat rclone hanya bila diatur', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { salinKeLuar } = require('./backup-lib');
  assert.strictEqual(salinKeLuar('/tmp/x.db', ''), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-')), tanda = path.join(dir, 'dipanggil');
  const bin = path.join(dir, 'rclone'); fs.writeFileSync(bin, `#!/bin/sh\necho "$@" > ${tanda}\n`, { mode: 0o755 });
  process.env.RCLONE_BIN = bin;
  assert.strictEqual(salinKeLuar('/tmp/sekolah-1.db', 'gdrive:backup'), true);
  for (let i = 0; i < 50 && !fs.existsSync(tanda); i++) await new Promise((r) => setTimeout(r, 40));
  delete process.env.RCLONE_BIN;
  assert.strictEqual(fs.readFileSync(tanda, 'utf8').trim(), 'copy /tmp/sekolah-1.db gdrive:backup --immutable');
});

test('aplikasi belajar siswa: akun siswa, materi, ujian online sampai masuk ke nilai/rapor', async (t) => {
  const { client, db } = await boot(t);
  const yys = client();
  const me = (await yys('login', 'POST', { username: 'admin', password: 'admin123' })).data;
  const id = (k) => me.lembagas.find((l) => l.kode === k).id;
  const [MI, SMP] = [id('MI'), id('SMP')];
  const wib = (menit) => new Date(Date.now() + 7 * 3600e3 + menit * 60e3).toISOString().slice(0, 16);   // 'YYYY-MM-DDTHH:MM' WIB

  const kelas = (await yys('kelas', 'POST', { nama: '5' }, MI)).data.id;
  const kelas6 = (await yys('kelas', 'POST', { nama: '6' }, MI)).data.id;
  const a = (await yys('siswa', 'POST', { nama: 'Andin', nis: '1', nisn: '1234567890', kelas_id: kelas }, MI)).data.id;
  const b = (await yys('siswa', 'POST', { nama: 'Budi', nis: '2', kelas_id: kelas }, MI)).data.id;
  const c6 = (await yys('siswa', 'POST', { nama: 'Citra Kelas Enam', nis: '3', kelas_id: kelas6 }, MI)).data.id;

  // --- akun siswa ---
  const massal = (await yys('siswa-akun', 'POST', { kelas_id: kelas })).data;                                   // satu kelas sekaligus
  assert.deepStrictEqual([massal.akun.length, massal.dilewati], [2, 0]);
  const ak = (await yys('siswa-akun?kelas_id=' + kelas)).data;
  assert.deepStrictEqual(ak.map((x) => x.username !== null), [true, true]);
  // reset menghasilkan password baru yang dapat dipakai login
  const rs = (await yys('siswa-akun', 'POST', { siswa_id: a, reset: true })).data.akun[0];
  assert.strictEqual(rs.username, '1234567890'); assert.match(rs.password, /^[A-Za-z0-9]{8}$/);
  const rb = (await yys('siswa-akun', 'POST', { siswa_id: b, reset: true })).data.akun[0];
  assert.strictEqual(rb.username, 'mi.2');
  assert.strictEqual((await yys('siswa-akun', 'POST', { siswa_id: a })).data.akun.length, 0);                  // sudah punya akun: dilewati
  const pdfAkun = await yys('akun-pdf', 'POST', { rows: [[rs.username, '5', rs.username, rs.password]] });
  assert.strictEqual(pdfAkun.data.subarray(0, 5).toString(), '%PDF-');

  const siswaA = client(), siswaB = client();
  assert.strictEqual((await siswaA('login', 'POST', { username: rs.username, password: rs.password })).data.role, 'siswa');
  assert.strictEqual((await siswaA('belajar/profil')).status, 403);                                           // wajib ganti password
  assert.strictEqual((await siswaA('password', 'POST', { lama: rs.password, baru: 'belajarku1' })).status, 200);
  await siswaB('login', 'POST', { username: rb.username, password: rb.password });
  await siswaB('password', 'POST', { lama: rb.password, baru: 'belajarku2' });
  // akun siswa tidak bisa memakai API petugas/wali dan sebaliknya
  for (const p of ['siswa', 'nilai', 'ujian', 'dashboard', 'wali/anak', 'ujian-hasil?ujian_id=1']) assert.strictEqual((await siswaA(p)).status, 403, p);
  assert.strictEqual((await yys('belajar/profil')).status, 403);
  assert.strictEqual((await yys('users')).data.some((u) => u.role === 'siswa'), false);                       // tidak tercampur daftar pengguna

  // --- materi ---
  assert.strictEqual((await yys('materi', 'POST', { judul: 'Pecahan', isi: 'Pecahan adalah...', tautan: 'javascript:alert(1)' }, MI)).status, 400);
  await yys('materi', 'POST', { kelas_id: kelas, mapel: 'Matematika', judul: 'Pecahan', isi: 'Pecahan adalah...', tautan: 'https://contoh.id/pecahan' }, MI);
  await yys('materi', 'POST', { kelas_id: kelas6, judul: 'Materi kelas 6' }, MI);
  await yys('materi', 'POST', { judul: 'Untuk semua kelas' }, MI);
  assert.deepStrictEqual((await siswaA('belajar/materi')).data.map((m) => m.judul).sort(), ['Pecahan', 'Untuk semua kelas']);

  // --- ujian: validasi, soal, terbit ---
  const U = { kelas_id: kelas, mapel: 'Matematika', judul: 'Ulangan Harian 1', jenis: 'harian', mulai: wib(-10), selesai: wib(120), durasi: 30, acak: 1, tampil_nilai: 1 };
  assert.strictEqual((await yys('ujian', 'POST', { ...U, selesai: wib(-20) }, MI)).status, 400);
  assert.strictEqual((await yys('ujian', 'POST', { ...U, mulai: 'kapan-kapan' }, MI)).status, 400);
  assert.strictEqual((await yys('ujian', 'POST', { ...U, durasi: 0 }, MI)).status, 400);
  assert.strictEqual((await yys('ujian', 'POST', { ...U, status: 'terbit' }, MI)).status, 400);               // belum ada soal
  const uid = (await yys('ujian', 'POST', U, MI)).data.id;
  assert.strictEqual((await yys('ujian', 'POST', { ...U, kelas_id: (await yys('kelas', 'POST', { nama: 'X' }, SMP)).data.id }, MI)).status, 404);   // kelas lembaga lain
  assert.strictEqual((await yys(`ujian/${uid}`, 'PUT', { status: 'terbit' })).status, 400);
  const soal = [
    { tipe: 'pg', teks: '2 + 3 = ?', opsi: ['4', '5', '6'], kunci: 1, bobot: 1 },
    { tipe: 'pg', teks: '10 - 4 = ?', opsi: ['6', '7'], kunci: 0, bobot: 1 },
    { tipe: 'uraian', teks: 'Jelaskan pecahan', bobot: 2 }];
  assert.strictEqual((await yys('ujian-soal', 'PUT', { ujian_id: uid, soal: [{ tipe: 'pg', teks: 'x', opsi: ['a'], kunci: 0 }] })).status, 400);
  assert.strictEqual((await yys('ujian-soal', 'PUT', { ujian_id: uid, soal: [{ tipe: 'pg', teks: 'x', opsi: ['a', 'b'], kunci: 5 }] })).status, 400);
  assert.strictEqual((await yys('ujian-soal', 'PUT', { ujian_id: uid, soal })).data.jumlah, 3);
  assert.strictEqual((await yys(`ujian/${uid}`, 'PUT', { status: 'terbit' })).status, 200);
  // draf tidak terlihat siswa; kelas lain tidak melihat
  const uDraf = (await yys('ujian', 'POST', { ...U, judul: 'Draf' }, MI)).data.id;
  assert.deepStrictEqual((await siswaA('belajar/ujian')).data.ujian.map((x) => x.judul), ['Ulangan Harian 1']);
  assert.strictEqual((await siswaA(`belajar/ujian/${uDraf}/mulai`, 'POST')).status, 404);

  // --- siswa mengerjakan ---
  const ls = (await siswaA('belajar/ujian')).data.ujian[0];
  assert.deepStrictEqual([ls.status, ls.jumlah_soal, ls.nilai], ['buka', 3, null]);
  const sesi = (await siswaA(`belajar/ujian/${uid}/mulai`, 'POST')).data;
  assert.strictEqual(sesi.soal.length, 3);
  assert.ok(JSON.stringify(sesi).indexOf('kunci') < 0, 'kunci tidak boleh dikirim ke siswa');
  assert.ok(sesi.batas - sesi.sekarang <= 30 * 60e3 && sesi.batas > sesi.sekarang);
  const idSoal = (teks) => sesi.soal.find((s) => s.teks.startsWith(teks));
  const optIdx = (s, teks) => s.opsi.find((o) => o.t === teks).i;                                           // indeks asli, walau opsi diacak
  const jawab = (s, j, x = {}) => siswaA(`belajar/ujian/${uid}/jawab`, 'POST', { soal_id: s.id, jawaban: j, ...x });
  assert.strictEqual((await jawab(idSoal('2 + 3'), optIdx(idSoal('2 + 3'), '5'))).status, 200);
  assert.strictEqual((await jawab(idSoal('10 - 4'), optIdx(idSoal('10 - 4'), '7'))).status, 200);           // salah
  assert.strictEqual((await jawab(idSoal('2 + 3'), 9)).status, 400);                                          // di luar pilihan
  assert.strictEqual((await jawab({ id: 999999 }, 0)).status, 400);
  assert.strictEqual((await jawab(idSoal('Jelaskan'), 'Pecahan adalah bagian dari keseluruhan', { pindah: 2 })).status, 200);
  const lanjut = (await siswaA(`belajar/ujian/${uid}/mulai`, 'POST')).data;                                   // lanjut: jawaban tersimpan
  assert.strictEqual(Object.keys(lanjut.jawaban).length, 3);
  assert.strictEqual(lanjut.batas, sesi.batas);
  // siswa kelas lain tidak bisa; siswa lain di kelas sama punya sesi sendiri
  const asing = (await yys('siswa-akun', 'POST', { siswa_id: c6, reset: true })).data.akun[0];
  const cc = client(); await cc('login', 'POST', { username: asing.username, password: asing.password }); await cc('password', 'POST', { lama: asing.password, baru: 'belajarku3' });
  assert.strictEqual((await cc(`belajar/ujian/${uid}/mulai`, 'POST')).status, 404);
  assert.strictEqual((await cc('belajar/ujian')).data.ujian.length, 0);

  const k = (await siswaA(`belajar/ujian/${uid}/kumpul`, 'POST')).data;
  assert.deepStrictEqual([k.menunggu_nilai, k.nilai, k.benar, k.total_pg], [true, null, 1, 2]);                // uraian belum dinilai
  assert.strictEqual((await siswaA(`belajar/ujian/${uid}/mulai`, 'POST')).status, 409);                       // sekali mengerjakan
  assert.strictEqual((await jawab(idSoal('2 + 3'), 0)).status, 409);                                          // tidak bisa ubah setelah kumpul
  assert.strictEqual((await yys(`ujian-soal`, 'PUT', { ujian_id: uid, soal: [] })).status, 409);              // soal terkunci

  // --- guru menilai uraian -> nilai masuk ke tabel nilai dan rapor ---
  const hl = (await yys('ujian-hasil?ujian_id=' + uid)).data;
  assert.deepStrictEqual([hl.ringkas.siswa, hl.ringkas.mengerjakan, hl.ringkas.menunggu_nilai], [2, 1, 1]);
  const pa = hl.peserta.find((x) => x.siswa_id === a);
  assert.strictEqual(pa.pindah_tab, 2);
  const det = (await yys('ujian-hasil/' + pa.peserta_id)).data;
  assert.strictEqual(det.soal.find((s) => s.tipe === 'uraian').jawaban, 'Pecahan adalah bagian dari keseluruhan');
  assert.strictEqual((await yys('ujian-hasil/' + pa.peserta_id, 'PUT', { skor: { [det.soal[0].id]: 1 } })).status, 400);   // pg tidak bisa diberi skor manual
  assert.strictEqual((await yys('ujian-hasil/' + pa.peserta_id, 'PUT', { skor: { [det.soal[2].id]: 5 } })).status, 400);   // melebihi bobot
  const gr = (await yys('ujian-hasil/' + pa.peserta_id, 'PUT', { skor: { [det.soal[2].id]: 1.5 } })).data;
  assert.strictEqual(gr.nilai, 62.5);                                                                          // (1 benar + 1,5 uraian) / 4 bobot
  const nilai = (await yys('nilai?siswa_id=' + a)).data;
  assert.deepStrictEqual([nilai.length, nilai[0].mapel, nilai[0].jenis, nilai[0].nilai], [1, 'Matematika', 'Ulangan Harian', 62.5]);
  await yys('ujian-hasil/' + pa.peserta_id, 'PUT', { skor: { [det.soal[2].id]: 2 } });                         // koreksi: memperbarui, bukan menggandakan
  const nilai2 = (await yys('nilai?siswa_id=' + a)).data;
  assert.deepStrictEqual([nilai2.length, nilai2[0].nilai], [1, 75]);
  assert.strictEqual((await yys(`rapor?siswa_id=${a}`)).data.nilai[0].rata, 75);
  const hsl = (await siswaA(`belajar/ujian/${uid}/hasil`)).data;
  assert.deepStrictEqual([hsl.nilai, hsl.menunggu_nilai], [75, false]);
  assert.strictEqual((await siswaA('belajar/nilai')).data[0].nilai, 75);
  assert.strictEqual((await yys(`export/ujian-hasil?ujian_id=${uid}`)).status, 200);

  // --- waktu: belum dibuka, terlewat, dan kadaluwarsa saat sedang mengerjakan ---
  const idBelum = (await yys('ujian', 'POST', { ...U, judul: 'Besok', mulai: wib(60), selesai: wib(180) }, MI)).data.id;
  const idLewat = (await yys('ujian', 'POST', { ...U, judul: 'Kemarin', mulai: wib(-300), selesai: wib(-200) }, MI)).data.id;
  const idCepat = (await yys('ujian', 'POST', { ...U, judul: 'Cepat', mulai: wib(-5), selesai: wib(60), durasi: 1, tampil_nilai: 0 }, MI)).data.id;
  for (const x of [idBelum, idLewat, idCepat]) {
    await yys('ujian-soal', 'PUT', { ujian_id: x, soal: [{ tipe: 'pg', teks: 'Satu?', opsi: ['ya', 'tidak'], kunci: 0 }] });
    await yys(`ujian/${x}`, 'PUT', { status: 'terbit' });
  }
  assert.strictEqual((await siswaB(`belajar/ujian/${idBelum}/mulai`, 'POST')).status, 403);
  assert.strictEqual((await siswaB(`belajar/ujian/${idLewat}/mulai`, 'POST')).status, 403);
  const stat = Object.fromEntries((await siswaB('belajar/ujian')).data.ujian.map((x) => [x.judul, x.status]));
  assert.deepStrictEqual([stat.Besok, stat.Kemarin, stat.Cepat], ['belum', 'terlewat', 'buka']);
  const s2 = (await siswaB(`belajar/ujian/${idCepat}/mulai`, 'POST')).data;
  assert.ok(s2.batas - s2.sekarang <= 60e3);
  await siswaB(`belajar/ujian/${idCepat}/jawab`, 'POST', { soal_id: s2.soal[0].id, jawaban: s2.soal[0].opsi.find((o) => o.t === 'ya').i });
  // paksa kedaluwarsa: waktu habis -> jawaban baru ditolak, dikumpulkan & dinilai otomatis
  db.prepare('UPDATE ujian_peserta SET batas = ? WHERE ujian_id = ?').run(Date.now() - 20000, idCepat);
  assert.strictEqual((await siswaB(`belajar/ujian/${idCepat}/jawab`, 'POST', { soal_id: s2.soal[0].id, jawaban: 1 })).status, 409);
  const hb = (await yys(`ujian-hasil?ujian_id=${idCepat}`)).data;
  assert.deepStrictEqual([hb.ringkas.selesai, hb.ringkas.rata], [1, 100]);                                    // jawaban sebelum habis tetap dihitung
  assert.strictEqual((await yys('nilai?siswa_id=' + b)).data.length, 1);
  const hs = (await siswaB(`belajar/ujian/${idCepat}/hasil`)).data;
  assert.deepStrictEqual([hs.nilai, hs.tampil_nilai], [null, false]);                                          // guru menyembunyikan nilai dari siswa
  assert.strictEqual((await siswaB('belajar/nilai')).data.length, 0);
});

test('peran berjenjang: admin yayasan, bendahara yayasan/lembaga, admin lembaga, staf', async (t) => {
  const { client } = await boot(t);
  const yys = client();
  const me = (await yys('login', 'POST', { username: 'admin', password: 'admin123' })).data;
  const id = (k) => me.lembagas.find((l) => l.kode === k).id;
  const [MI, SMP] = [id('MI'), id('SMP')];
  const mk = async (username, role, lembaga_ids) => {
    assert.strictEqual((await yys('users', 'POST', { username, password: 'rahasia123', nama: username, role, lembaga_ids })).status, 200, username);
    const c = client(); await c('login', 'POST', { username, password: 'rahasia123' });
    await c('password', 'POST', { lama: 'rahasia123', baru: 'rahasia456' }); return c;
  };
  const bY = await mk('bendahara.yys', 'bendahara_yayasan', []);
  const bMI = await mk('bendahara.mi', 'bendahara', [MI]);
  const aMI = await mk('admin.mi', 'admin', [MI]);
  const sMI = await mk('staf.mi', 'staf', [MI]);
  assert.deepStrictEqual((await bY('me')).data.lembagas.length, 7);                     // bendahara yayasan = semua lembaga
  assert.deepStrictEqual((await bMI('me')).data.lembagas.map((l) => l.kode), ['MI']);

  // data
  const kMI = (await yys('kelas', 'POST', { nama: '1' }, MI)).data.id, kSMP = (await yys('kelas', 'POST', { nama: 'VII' }, SMP)).data.id;
  const sm = (await yys('siswa', 'POST', { nama: 'Anak MI', nis: '1', nik: '3522000000000001', kelas_id: kMI }, MI)).data.id;
  const ss = (await yys('siswa', 'POST', { nama: 'Anak SMP', nis: '1', kelas_id: kSMP }, SMP)).data.id;
  const bln = tgl.slice(0, 7);
  await yys('tagihan', 'POST', { siswa_id: sm, jumlah: 100000, periode: bln, jatuh_tempo: '2020-01-01' });
  await yys('tagihan', 'POST', { siswa_id: ss, jumlah: 200000, periode: bln, jatuh_tempo: '2020-01-01' });

  // bendahara yayasan: keuangan semua lembaga, tanpa akademik
  assert.strictEqual((await bY('tagihan')).data.length, 2);
  const pb = await bY('pembayaran', 'POST', { siswa_id: ss, jumlah: 50000, tanggal: tgl, jenis: 'SPP', bulan: bln }, SMP);
  assert.strictEqual(pb.status, 200);
  assert.strictEqual((await bY('pdf/kuitansi?id=' + pb.data.id)).status, 200);
  assert.strictEqual((await bY('export/pembayaran')).status, 200);
  assert.strictEqual((await bY('tagihan/generate', 'POST', { kelas_id: kMI, periode: '2099-01', jumlah: 1 }, MI)).status, 200);
  const dBY = (await bY('dashboard')).data;
  assert.strictEqual(dBY.pembayaran_bulan_ini, 50000); assert.strictEqual(dBY.tunggakan, 250000);
  assert.strictEqual(dBY.siswa, undefined); assert.strictEqual(dBY.berisiko, undefined);          // tidak ada data akademik di dashboard
  assert.deepStrictEqual(dBY.tunggakan_per_lembaga.map((r) => r.kode).sort(), ['MI', 'SMP']);
  const lihat = (await bY('siswa', 'GET', null, MI)).data[0];
  assert.strictEqual(lihat.nama, 'Anak MI'); assert.ok(!('nik' in lihat));                         // data pribadi disembunyikan
  for (const [p, m, b] of [['siswa', 'POST', { nama: 'X' }], [`siswa/${sm}`, 'PUT', { nama: 'Y' }], ['nilai'], ['jadwal'], ['ujian'], ['absensi?kelas_id=1&tanggal=' + tgl], ['users'], ['audit'], ['wa/status'],
    ['export/siswa'], ['pdf/rapor?siswa_id=' + sm], ['lembaga/' + MI, 'PUT', { nama: 'Z' }], ['pengumuman'], ['kenaikan', 'POST', {}], ['profil']]) {
    assert.strictEqual((await bY(p, m || 'GET', b)).status, 403, p);
  }

  // bendahara lembaga: hanya keuangan lembaganya
  assert.deepStrictEqual([...new Set((await bMI('tagihan')).data.map((r) => r.lembaga_kode))], ['MI']);
  assert.strictEqual((await bMI('tagihan', 'GET', null, SMP)).status, 403);
  assert.strictEqual((await bMI('pembayaran', 'POST', { siswa_id: ss, jumlah: 1, tanggal: tgl }, MI)).status, 404);   // siswa lembaga lain
  assert.strictEqual((await bMI('pembayaran', 'POST', { siswa_id: sm, jumlah: 25000, tanggal: tgl, jenis: 'SPP', bulan: bln }, MI)).status, 200);
  const dMI = (await bMI('dashboard')).data;
  assert.deepStrictEqual([dMI.pembayaran_bulan_ini, dMI.tunggakan, dMI.multi], [25000, 75000, false]);
  assert.strictEqual((await bMI('users')).status, 403);

  // admin lembaga: dashboard & operasional lembaganya, tanpa keuangan
  const dA = (await aMI('dashboard')).data;
  assert.deepStrictEqual([dA.siswa, dA.multi, dA.pembayaran_bulan_ini, dA.tunggakan], [1, false, undefined, undefined]);
  assert.strictEqual((await aMI('dashboard', 'GET', null, SMP)).status, 403);
  for (const p of ['pembayaran', 'tagihan', 'export/pembayaran', 'export/tagihan', 'pdf/kuitansi?id=1']) assert.strictEqual((await aMI(p)).status, 403, p);
  for (const [p, b] of [['pembayaran', { siswa_id: sm, jumlah: 1, tanggal: tgl }], ['tagihan/generate', { kelas_id: kMI, periode: '2099-02', jumlah: 1 }], ['pengingat-tagihan', {}]]) assert.strictEqual((await aMI(p, 'POST', b, MI)).status, 403, p);
  assert.strictEqual((await aMI('siswa')).data.length, 1);                                       // akademik lembaganya tetap bisa
  assert.strictEqual((await aMI('lembaga/' + MI, 'PUT', { nama: 'Z' })).status, 403);            // pengaturan yayasan tidak
  assert.strictEqual((await aMI('profil')).status, 403);
  // akun hanya dipegang admin yayasan: admin lembaga cuma boleh membuat staf/guru di lembaganya
  assert.strictEqual((await aMI('users', 'POST', { username: 'bend2', password: 'rahasia123', nama: 'B', role: 'bendahara', lembaga_ids: [MI] })).status, 400);
  assert.strictEqual((await aMI('users', 'POST', { username: 'adm2', password: 'rahasia123', nama: 'A', role: 'admin', lembaga_ids: [MI] })).status, 400);
  assert.strictEqual((await aMI('users', 'POST', { username: 'staf2', password: 'rahasia123', nama: 'S', role: 'staf', lembaga_ids: [MI] })).status, 200);
  assert.deepStrictEqual((await aMI('users')).data.map((u) => u.role).sort(), ['admin', 'staf', 'staf']);   // bendahara & yayasan tidak terlihat
  const bendId = (await yys('users')).data.find((u) => u.username === 'bendahara.mi').id;
  assert.strictEqual((await aMI(`users/${bendId}`, 'DELETE')).status, 404);
  assert.strictEqual((await aMI(`users/${bendId}`, 'PUT', { role: 'admin' })).status, 404);

  // staf: tidak ada keuangan
  for (const p of ['pembayaran', 'tagihan']) assert.strictEqual((await sMI(p)).status, 403, p);
  assert.strictEqual((await sMI('siswa')).status, 200);

  // wali tetap melihat tagihan anaknya
  await yys('wali-akun', 'POST', { siswa_id: sm, username: '081200001111' });
  assert.strictEqual((await yys('users')).data.some((u) => u.role === 'wali'), false);
});
