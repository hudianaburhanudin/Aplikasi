'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const today = () => new Date().toISOString().slice(0, 10);
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
let me = null;

async function api(path, opt = {}) {
  const r = await fetch('/api/' + path, {
    method: opt.method || 'GET', headers: opt.body ? { 'Content-Type': 'application/json' } : {},
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'login') { showLogin(); throw new Error(data.error); }
  if (!r.ok) throw new Error(data.error || 'Terjadi kesalahan');
  return data;
}
const qs = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v))).toString();

async function download(path) {
  try {
    const r = await fetch('/api/' + path);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Gagal mengekspor');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = /filename="(.+?)"/.exec(r.headers.get('content-disposition') || '')?.[1] || 'unduhan';
    a.click(); URL.revokeObjectURL(a.href);
  } catch (e) { toast(e.message, true); }
}

function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3000);
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

// ---- dialog form ----
function openForm(title, fields, values, onSave) {
  const f = $('#dlgForm');
  f.innerHTML = `<h3>${esc(title)}</h3><div class="fields">${fields.map((x) => {
    const v = values[x.name] ?? x.default ?? '';
    let input;
    if (x.options) input = `<select name="${x.name}">${x.blank === false ? '' : '<option value=""></option>'}${x.options.map((o) =>
      `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    else if (x.type === 'textarea') input = `<textarea name="${x.name}" rows="2">${esc(v)}</textarea>`;
    else input = `<input name="${x.name}" type="${x.type || 'text'}" value="${esc(v)}" ${x.step ? `step="${x.step}"` : ''}>`;
    return `<label class="${x.full ? 'full' : ''}">${esc(x.label)}${x.required ? ' *' : ''}${input}</label>`;
  }).join('')}</div><p class="error" id="formErr"></p>
  <div class="actions"><button type="button" class="btn" id="cancelBtn">Batal</button><button class="btn primary" value="ok">Simpan</button></div>`;
  const dlg = $('#dlg');
  $('#cancelBtn').onclick = () => dlg.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    try { await onSave(data); dlg.close(); } catch (err) { $('#formErr').textContent = err.message; }
  };
  dlg.showModal();
}

// ---- opsi dropdown ----
const optKelas = async () => (await api('kelas')).map((k) => ({ value: k.id, label: k.nama }));
const optGuru = async () => (await api('guru')).map((g) => ({ value: g.id, label: g.nama }));
const optSiswa = async () => (await api('siswa?status=aktif')).map((s) => ({ value: s.id, label: `${s.nis || '-'} · ${s.nama}` }));
const JK = [{ value: 'L', label: 'Laki-laki' }, { value: 'P', label: 'Perempuan' }];

// ---- halaman CRUD generik ----
function crudPage(cfg) {
  return guard(async () => {
    const main = $('#main');
    const filters = cfg.filters ? await Promise.all(cfg.filters.map(async (f) => ({ ...f, options: await f.load() }))) : [];
    main.innerHTML = `<h2>${cfg.title}</h2><div class="bar">
      <input id="q" placeholder="Cari…" type="search">
      ${filters.map((f) => `<select data-f="${f.key}"><option value="">${f.label}</option>${f.options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`).join('')}
      <span class="grow"></span><button class="btn" id="xls">⬇ Excel</button><button class="btn" id="pdf">⬇ PDF</button><button class="btn primary" id="add">+ Tambah</button></div>
      <div class="tablewrap" id="tbl"></div><p id="foot" class="empty" style="text-align:left"></p>`;
    const load = guard(async () => {
      const params = { q: $('#q').value };
      main.querySelectorAll('[data-f]').forEach((s) => { params[s.dataset.f] = s.value; });
      const rows = await api(cfg.key + '?' + qs(params));
      $('#tbl').innerHTML = rows.length ? `<table><thead><tr>${cfg.columns.map((c) => `<th>${c.label}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map((r) =>
        `<tr>${cfg.columns.map((c) => `<td>${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}
        <td class="act">${(cfg.rowActions || []).map((a) => `<button class="btn small" data-a="${a.name}" data-id="${r.id}">${a.label}</button>`).join(' ')}
        <button class="btn small" data-a="edit" data-id="${r.id}">Ubah</button>
        <button class="btn small danger" data-a="del" data-id="${r.id}">Hapus</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada data.</div>';
      $('#foot').textContent = cfg.footer ? cfg.footer(rows) : `${rows.length} data`;
      $('#tbl').onclick = guard(async (e) => {
        const b = e.target.closest('button[data-a]'); if (!b) return;
        const row = rows.find((r) => r.id === Number(b.dataset.id));
        if (b.dataset.a === 'edit') return form(row);
        if (b.dataset.a === 'del') {
          if (!confirm('Hapus data ini?')) return;
          await api(`${cfg.key}/${row.id}`, { method: 'DELETE' }); toast('Data dihapus'); return load();
        }
        cfg.rowActions.find((a) => a.name === b.dataset.a).run(row);
      });
    });
    const form = guard(async (row) => {
      const fields = await Promise.all(cfg.fields.map(async (f) => ({ ...f, options: f.load ? await f.load() : f.options })));
      openForm((row ? 'Ubah ' : 'Tambah ') + cfg.single, fields, row || {}, async (d) => {
        await api(row ? `${cfg.key}/${row.id}` : cfg.key, { method: row ? 'PUT' : 'POST', body: d });
        toast('Tersimpan'); load();
      });
    });
    $('#add').onclick = () => form();
    $('#xls').onclick = () => {
      const params = { q: $('#q').value };
      main.querySelectorAll('[data-f]').forEach((s) => { params[s.dataset.f] = s.value; });
      download('export/' + cfg.key + '?' + qs(params));
    };
    $('#pdf').onclick = () => {
      const params = { q: $('#q').value };
      main.querySelectorAll('[data-f]').forEach((s) => { params[s.dataset.f] = s.value; });
      download('pdf/' + cfg.key + '?' + qs(params));
    };
    $('#q').oninput = (() => { let t; return () => { clearTimeout(t); t = setTimeout(load, 250); }; })();
    main.querySelectorAll('[data-f]').forEach((s) => { s.onchange = load; });
    load();
  });
}

const pages = {};
pages.siswa = crudPage({
  key: 'siswa', title: 'Data Siswa', single: 'Siswa',
  filters: [{ key: 'kelas_id', label: 'Semua kelas', load: optKelas },
    { key: 'status', label: 'Semua status', load: async () => ['aktif', 'lulus', 'pindah'].map((v) => ({ value: v, label: v })) }],
  columns: [{ key: 'nis', label: 'NIS' }, { key: 'nama', label: 'Nama' }, { key: 'jk', label: 'L/P' },
    { key: 'kelas_nama', label: 'Kelas' }, { key: 'wali', label: 'Wali' }, { key: 'telepon', label: 'Telepon' },
    { label: 'Status', render: (r) => `<span class="badge">${esc(r.status)}</span>` }],
  fields: [{ name: 'nis', label: 'NIS' }, { name: 'nama', label: 'Nama', required: true },
    { name: 'jk', label: 'Jenis kelamin', options: JK }, { name: 'tgl_lahir', label: 'Tanggal lahir', type: 'date' },
    { name: 'kelas_id', label: 'Kelas', load: optKelas }, { name: 'status', label: 'Status', blank: false, default: 'aktif',
      options: ['aktif', 'lulus', 'pindah'].map((v) => ({ value: v, label: v })) },
    { name: 'wali', label: 'Nama orang tua/wali' }, { name: 'telepon', label: 'Telepon' },
    { name: 'alamat', label: 'Alamat', type: 'textarea', full: true }],
});
pages.guru = crudPage({
  key: 'guru', title: 'Data Guru', single: 'Guru',
  columns: [{ key: 'nip', label: 'NIP' }, { key: 'nama', label: 'Nama' }, { key: 'jk', label: 'L/P' },
    { key: 'mapel', label: 'Mata pelajaran' }, { key: 'telepon', label: 'Telepon' }],
  fields: [{ name: 'nip', label: 'NIP' }, { name: 'nama', label: 'Nama', required: true },
    { name: 'jk', label: 'Jenis kelamin', options: JK }, { name: 'mapel', label: 'Mata pelajaran' },
    { name: 'telepon', label: 'Telepon' }, { name: 'alamat', label: 'Alamat', type: 'textarea', full: true }],
});
pages.kelas = crudPage({
  key: 'kelas', title: 'Data Kelas', single: 'Kelas',
  columns: [{ key: 'nama', label: 'Kelas' }, { key: 'tahun_ajaran', label: 'Tahun ajaran' },
    { key: 'wali_nama', label: 'Wali kelas' }, { key: 'jumlah', label: 'Jml siswa' }],
  fields: [{ name: 'nama', label: 'Nama kelas', required: true }, { name: 'tahun_ajaran', label: 'Tahun ajaran', default: '2026/2027' },
    { name: 'wali_guru_id', label: 'Wali kelas', load: optGuru, full: true }],
});
pages.nilai = crudPage({
  key: 'nilai', title: 'Nilai Siswa', single: 'Nilai',
  filters: [{ key: 'kelas_id', label: 'Semua kelas', load: optKelas },
    { key: 'semester', label: 'Semua semester', load: async () => ['Ganjil', 'Genap'].map((v) => ({ value: v, label: v })) }],
  columns: [{ key: 'tanggal', label: 'Tanggal' }, { key: 'siswa_nama', label: 'Siswa' }, { key: 'kelas_nama', label: 'Kelas' },
    { key: 'mapel', label: 'Mapel' }, { key: 'jenis', label: 'Jenis' }, { key: 'nilai', label: 'Nilai' }, { key: 'semester', label: 'Semester' }],
  fields: [{ name: 'siswa_id', label: 'Siswa', load: optSiswa, required: true, full: true },
    { name: 'mapel', label: 'Mata pelajaran', required: true },
    { name: 'jenis', label: 'Jenis', options: ['Tugas', 'Ulangan Harian', 'UTS', 'UAS'].map((v) => ({ value: v, label: v })) },
    { name: 'nilai', label: 'Nilai (0-100)', type: 'number', step: '0.01', required: true },
    { name: 'semester', label: 'Semester', options: ['Ganjil', 'Genap'].map((v) => ({ value: v, label: v })) },
    { name: 'tanggal', label: 'Tanggal', type: 'date', default: today() }],
});
pages.pembayaran = crudPage({
  key: 'pembayaran', title: 'Pembayaran (SPP & lainnya)', single: 'Pembayaran',
  filters: [{ key: 'kelas_id', label: 'Semua kelas', load: optKelas }],
  columns: [{ key: 'tanggal', label: 'Tanggal' }, { key: 'siswa_nama', label: 'Siswa' }, { key: 'kelas_nama', label: 'Kelas' },
    { key: 'jenis', label: 'Jenis' }, { key: 'bulan', label: 'Periode' }, { label: 'Jumlah', render: (r) => rp(r.jumlah) }],
  rowActions: [{ name: 'kuitansi', label: 'Kuitansi', run: (r) => download('pdf/kuitansi?id=' + r.id) }],
  footer: (rows) => `${rows.length} transaksi · total ${rp(rows.reduce((a, r) => a + r.jumlah, 0))}`,
  fields: [{ name: 'siswa_id', label: 'Siswa', load: optSiswa, required: true, full: true },
    { name: 'jenis', label: 'Jenis', blank: false, default: 'SPP', options: ['SPP', 'Uang Gedung', 'Seragam', 'Kegiatan', 'Lainnya'].map((v) => ({ value: v, label: v })) },
    { name: 'bulan', label: 'Periode (bulan)', type: 'month', default: today().slice(0, 7) },
    { name: 'jumlah', label: 'Jumlah (Rp)', type: 'number', required: true }, { name: 'tanggal', label: 'Tanggal bayar', type: 'date', default: today(), required: true },
    { name: 'keterangan', label: 'Keterangan', full: true }],
});

// ---- dashboard ----
pages.dashboard = guard(async () => {
  const d = await api('dashboard');
  const a = d.absensi_hari_ini, max = Math.max(1, ...d.per_kelas.map((k) => k.jumlah));
  $('#main').innerHTML = `<h2>Dashboard</h2><div class="stats">
    ${[['Siswa aktif', d.siswa], ['Guru', d.guru], ['Kelas', d.kelas], ['Pembayaran bulan ini', rp(d.pembayaran_bulan_ini)]]
      .map(([l, n]) => `<div class="card stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('')}</div>
    <div class="grid2"><div class="card"><b>Absensi hari ini</b><p>Hadir ${a.H || 0} · Sakit ${a.S || 0} · Izin ${a.I || 0} · Alpa ${a.A || 0}</p></div>
    <div class="card"><b>Siswa per kelas</b><div class="bars">${d.per_kelas.map((k) =>
      `<div><span>${esc(k.nama)}</span><i style="width:${k.jumlah / max * 100}%"></i><span>${k.jumlah}</span></div>`).join('') || '<p class="empty">Belum ada kelas.</p>'}</div></div></div>`;
});

// ---- absensi ----
pages.absensi = guard(async () => {
  const kelas = await optKelas();
  $('#main').innerHTML = `<h2>Absensi Siswa</h2><div class="bar">
    <select id="k">${kelas.map((k) => `<option value="${k.value}">${esc(k.label)}</option>`).join('')}</select>
    <input type="date" id="t" value="${today()}"><button class="btn" id="allH">Semua hadir</button>
    <span class="grow"></span><button class="btn primary" id="save">Simpan absensi</button></div>
    <div class="tablewrap" id="tbl"></div>
    <h2 style="margin-top:24px">Rekap bulanan</h2><div class="bar"><input type="month" id="bln" value="${today().slice(0, 7)}"><button class="btn" id="xlsRekap">⬇ Excel</button><button class="btn" id="pdfRekap">⬇ PDF</button></div>
    <div class="tablewrap" id="rekap"></div>`;
  const load = guard(async () => {
    if (!$('#k').value) { $('#tbl').innerHTML = '<div class="empty">Buat kelas terlebih dahulu.</div>'; return; }
    const rows = await api('absensi?' + qs({ kelas_id: $('#k').value, tanggal: $('#t').value }));
    $('#tbl').innerHTML = rows.length ? `<table><thead><tr><th>NIS</th><th>Nama</th><th>Kehadiran</th></tr></thead><tbody>${rows.map((r) =>
      `<tr><td>${esc(r.nis)}</td><td>${esc(r.nama)}</td><td><div class="radios">${[['H', 'Hadir'], ['S', 'Sakit'], ['I', 'Izin'], ['A', 'Alpa']].map(([v, l]) =>
        `<label><input type="radio" name="s${r.siswa_id}" value="${v}" ${(r.status || '') === v ? 'checked' : ''}>${l}</label>`).join('')}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Kelas ini belum memiliki siswa aktif.</div>';
    rekap();
  });
  const rekap = guard(async () => {
    if (!$('#k').value) return;
    const rows = await api('rekap-absensi?' + qs({ kelas_id: $('#k').value, bulan: $('#bln').value }));
    $('#rekap').innerHTML = rows.length ? `<table><thead><tr><th>Nama</th><th>Hadir</th><th>Sakit</th><th>Izin</th><th>Alpa</th></tr></thead><tbody>${rows.map((r) =>
      `<tr><td>${esc(r.nama)}</td><td>${r.h || 0}</td><td>${r.s || 0}</td><td>${r.i || 0}</td><td>${r.a || 0}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Tidak ada data.</div>';
  });
  $('#k').onchange = $('#t').onchange = load; $('#bln').onchange = rekap;
  const rekapQ = () => '?' + qs({ kelas_id: $('#k').value, bulan: $('#bln').value });
  $('#xlsRekap').onclick = () => download('export/rekap-absensi' + rekapQ());
  $('#pdfRekap').onclick = () => download('pdf/rekap-absensi' + rekapQ());
  $('#allH').onclick = () => document.querySelectorAll('input[value="H"]').forEach((i) => { i.checked = true; });
  $('#save').onclick = guard(async () => {
    const items = [...document.querySelectorAll('#tbl input:checked')].map((i) => ({ siswa_id: Number(i.name.slice(1)), status: i.value }));
    if (!items.length) return toast('Pilih status kehadiran terlebih dahulu', true);
    await api('absensi', { method: 'POST', body: { tanggal: $('#t').value, items } }); toast('Absensi tersimpan'); rekap();
  });
  load();
});

// ---- rapor ----
pages.rapor = guard(async () => {
  const siswa = await optSiswa();
  $('#main').innerHTML = `<h2>Rapor Siswa</h2><div class="bar">
    <select id="s">${siswa.map((s) => `<option value="${s.value}">${esc(s.label)}</option>`).join('')}</select>
    <select id="sem"><option value="">Semua semester</option><option>Ganjil</option><option>Genap</option></select>
    <button class="btn" id="raporPdf">⬇ PDF</button><button class="btn" onclick="window.print()">🖨 Cetak</button></div><div id="out"></div>`;
  const load = guard(async () => {
    if (!$('#s').value) { $('#out').innerHTML = '<div class="empty">Belum ada siswa.</div>'; return; }
    const d = await api('rapor?' + qs({ siswa_id: $('#s').value, semester: $('#sem').value }));
    const s = d.siswa, a = d.absensi, avg = d.nilai.length ? (d.nilai.reduce((x, n) => x + n.rata, 0) / d.nilai.length).toFixed(1) : '-';
    $('#out').innerHTML = `<div class="rapor"><h3>LAPORAN HASIL BELAJAR</h3><div style="text-align:center;color:var(--mut)">${d.semester ? 'Semester ' + esc(d.semester) : 'Semua semester'}</div>
      <dl><dt>Nama</dt><dd>${esc(s.nama)}</dd><dt>NIS</dt><dd>${esc(s.nis)}</dd><dt>Kelas</dt><dd>${esc(s.kelas_nama)}</dd><dt>Wali kelas</dt><dd>${esc(s.wali_kelas)}</dd></dl>
      <table><thead><tr><th>Mata pelajaran</th><th>Jml nilai</th><th>Rata-rata</th></tr></thead><tbody>${d.nilai.map((n) =>
        `<tr><td>${esc(n.mapel)}</td><td>${n.jumlah}</td><td>${n.rata}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Belum ada nilai.</td></tr>'}
      <tr><th colspan="2">Rata-rata keseluruhan</th><th>${avg}</th></tr></tbody></table>
      <p>Kehadiran: Hadir ${a.h || 0} · Sakit ${a.s || 0} · Izin ${a.i || 0} · Alpa ${a.a || 0}</p></div>`;
  });
  $('#raporPdf').onclick = () => $('#s').value && download('pdf/rapor?' + qs({ siswa_id: $('#s').value, semester: $('#sem').value }));
  $('#s').onchange = $('#sem').onchange = load; load();
});

// ---- pengguna ----
pages.pengguna = guard(async () => {
  const load = guard(async () => {
    const rows = await api('users');
    $('#main').innerHTML = `<h2>Pengguna</h2><div class="bar"><span class="grow"></span><button class="btn primary" id="add">+ Tambah</button></div>
      <div class="tablewrap"><table><thead><tr><th>Username</th><th>Nama</th><th>Role</th><th></th></tr></thead><tbody>${rows.map((u) =>
        `<tr><td>${esc(u.username)}</td><td>${esc(u.nama)}</td><td><span class="badge">${esc(u.role)}</span></td>
        <td class="act">${u.id === me.id ? '' : `<button class="btn small danger" data-id="${u.id}">Hapus</button>`}</td></tr>`).join('')}</tbody></table></div>`;
    $('#add').onclick = () => openForm('Tambah Pengguna', [{ name: 'username', label: 'Username', required: true }, { name: 'nama', label: 'Nama', required: true },
      { name: 'password', label: 'Password (min. 6)', type: 'password', required: true },
      { name: 'role', label: 'Role', blank: false, options: [{ value: 'staf', label: 'Staf' }, { value: 'admin', label: 'Admin' }] }], {},
    async (d) => { await api('users', { method: 'POST', body: d }); toast('Pengguna ditambahkan'); load(); });
    $('#main').onclick = guard(async (e) => {
      const b = e.target.closest('button[data-id]'); if (!b || !confirm('Hapus pengguna ini?')) return;
      await api('users/' + b.dataset.id, { method: 'DELETE' }); load();
    });
  });
  load();
});

// ---- shell ----
const MENU = [['dashboard', 'Dashboard'], ['siswa', 'Siswa'], ['guru', 'Guru'], ['kelas', 'Kelas'], ['absensi', 'Absensi'],
  ['nilai', 'Nilai'], ['rapor', 'Rapor'], ['pembayaran', 'Pembayaran'], ['pengguna', 'Pengguna', true]];

function route() {
  const name = location.hash.slice(2) || 'dashboard';
  const page = pages[name] || pages.dashboard;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.p === name));
  $('#main').onclick = null; page();
}
function showLogin() { me = null; $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
function showApp() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#nav').innerHTML = MENU.filter((m) => !m[2] || me.role === 'admin').map(([k, l]) => `<a href="#/${k}" data-p="${k}">${l}</a>`).join('');
  $('#who').textContent = `${me.nama} (${me.role})`; route();
}
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault(); $('#loginError').textContent = '';
  try { me = await api('login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); showApp(); }
  catch (err) { $('#loginError').textContent = err.message; }
};
$('#logoutBtn').onclick = async () => { await api('logout', { method: 'POST' }).catch(() => {}); showLogin(); };
$('#pwBtn').onclick = () => openForm('Ganti Password', [{ name: 'lama', label: 'Password lama', type: 'password', required: true, full: true },
  { name: 'baru', label: 'Password baru (min. 6)', type: 'password', required: true, full: true }], {},
async (d) => { await api('password', { method: 'POST', body: d }); toast('Password diganti'); });
window.addEventListener('hashchange', () => me && route());
api('me').then((u) => { me = u; showApp(); }).catch(showLogin);
