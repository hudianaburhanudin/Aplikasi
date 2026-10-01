const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./server');

test('alur utama aplikasi sekolah', async (t) => {
  const { server } = createApp(':memory:');
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/`;
  let cookie = '';
  const call = async (path, method = 'GET', body) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body && JSON.stringify(body) });
    const c = r.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
    return { status: r.status, data: await r.json() };
  };

  assert.strictEqual((await call('siswa')).status, 401);
  assert.strictEqual((await call('login', 'POST', { username: 'admin', password: 'salah' })).status, 401);
  assert.strictEqual((await call('login', 'POST', { username: 'admin', password: 'admin123' })).status, 200);

  const guru = (await call('guru', 'POST', { nama: 'Pak Budi', nip: '1' })).data.id;
  const kelas = (await call('kelas', 'POST', { nama: 'VII-A', wali_guru_id: guru })).data.id;
  const siswa = (await call('siswa', 'POST', { nama: 'Andi', nis: '001', kelas_id: kelas })).data.id;
  assert.strictEqual((await call('siswa', 'POST', { nama: 'Dup', nis: '001' })).status, 409);
  assert.strictEqual((await call('siswa', 'POST', { nama: '' })).status, 400);

  const tgl = new Date().toISOString().slice(0, 10);
  await call('absensi', 'POST', { tanggal: tgl, items: [{ siswa_id: siswa, status: 'H' }] });
  await call('absensi', 'POST', { tanggal: tgl, items: [{ siswa_id: siswa, status: 'S' }] }); // upsert
  assert.strictEqual((await call(`absensi?kelas_id=${kelas}&tanggal=${tgl}`)).data[0].status, 'S');
  assert.strictEqual((await call('absensi', 'POST', { tanggal: tgl, items: [{ siswa_id: siswa, status: 'X' }] })).status, 400);

  await call('nilai', 'POST', { siswa_id: siswa, mapel: 'Matematika', nilai: 80, semester: 'Ganjil' });
  await call('nilai', 'POST', { siswa_id: siswa, mapel: 'Matematika', nilai: 90, semester: 'Ganjil' });
  const rapor = (await call(`rapor?siswa_id=${siswa}`)).data;
  assert.strictEqual(rapor.nilai[0].rata, 85);
  assert.strictEqual(rapor.siswa.wali_kelas, 'Pak Budi');

  await call('pembayaran', 'POST', { siswa_id: siswa, jumlah: 150000, tanggal: tgl });
  const dash = (await call('dashboard')).data;
  assert.strictEqual(dash.pembayaran_bulan_ini, 150000);
  assert.strictEqual(dash.siswa, 1);

  assert.strictEqual((await call(`siswa/${siswa}`, 'PUT', { nama: 'Andi P' })).status, 200);
  assert.strictEqual((await call('siswa?q=Andi')).data.length, 1);
  assert.strictEqual((await call(`siswa/${siswa}`, 'DELETE')).status, 200);
  assert.strictEqual((await call('nilai')).data.length, 0); // cascade
  assert.strictEqual((await call('logout', 'POST')).status, 200);
  assert.strictEqual((await call('siswa')).status, 401);
});
