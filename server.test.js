process.env.ADMIN_PASSWORD = 'admin123';
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./server');

async function boot(t) {
  const { server } = createApp(':memory:');
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
  return { client };
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
  const form = { lembaga_id: SMP, nama: 'Calon Siswa', jk: 'L', tgl_lahir: '2014-05-10', telepon: '08123', nama_ayah: 'Pak Calon', asal_sekolah: 'SD 1' };

  // pendaftaran ditutup secara default
  assert.deepStrictEqual((await pub('public/lembaga')).data.lembaga, []);
  assert.strictEqual((await pub('public/daftar', 'POST', form)).status, 400);
  assert.strictEqual((await yys(`lembaga/${SMP}`, 'PUT', { ppdb_buka: 1 })).status, 200);
  assert.strictEqual((await yys(`lembaga/${MI}`, 'PUT', { ppdb_buka: 1 })).status, 200);
  const pl = (await pub('public/lembaga')).data;
  assert.strictEqual(pl.lembaga.length, 2);
  assert.strictEqual(pl.tahun_ajaran, '2026/2027');

  // validasi & anti-spam
  for (const bad of [{ nama: '' }, { jk: 'X' }, { tgl_lahir: '31-12-2014' }, { telepon: '' }, { nama_ayah: '' }]) {
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
