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
