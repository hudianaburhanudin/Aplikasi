'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
let me = null;
let scope = 'all'; // lembaga aktif: id atau 'all'
const multi = () => me.lembagas.length > 1 && scope === 'all';

async function api(path, opt = {}) {
  const r = await fetch('/api/' + path, {
    method: opt.method || 'GET', headers: { ...(opt.body ? { 'Content-Type': 'application/json' } : {}), 'X-Lembaga': String(scope) },
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
    const r = await fetch('/api/' + path, { headers: { 'X-Lembaga': String(scope) } });
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
    const v = values[x.name] ?? x.default ?? x.options?.find((o) => o.active)?.value ?? '';
    let input;
    if (x.type === 'checks') return `<fieldset class="full checks"><legend>${esc(x.label)}</legend>${x.options.map((o) =>
      `<label><input type="checkbox" name="${x.name}" value="${esc(o.value)}" ${(values[x.name] || []).includes(o.value) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}</fieldset>`;
    if (x.options) input = `<select name="${x.name}">${x.blank === false ? '' : '<option value=""></option>'}${x.options.map((o) =>
      `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    else if (x.type === 'textarea') input = `<textarea name="${x.name}" rows="2">${esc(v)}</textarea>`;
    else input = `<input name="${x.name}" type="${x.type || 'text'}" value="${esc(v)}" ${x.step ? `step="${x.step}"` : ''} ${x.disabled ? 'disabled' : ''}>`;
    return `<label class="${x.full ? 'full' : ''}">${esc(x.label)}${x.required ? ' *' : ''}${input}</label>`;
  }).join('')}</div><p class="error" id="formErr"></p>
  <div class="actions"><button type="button" class="btn" id="cancelBtn">Batal</button><button class="btn primary" value="ok">Simpan</button></div>`;
  const dlg = $('#dlg');
  $('#cancelBtn').onclick = () => dlg.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    fields.filter((x) => x.type === 'checks').forEach((x) => { data[x.name] = [...f.querySelectorAll(`input[name=${x.name}]:checked`)].map((i) => Number(i.value)); });
    try { await onSave(data); dlg.close(); } catch (err) { $('#formErr').textContent = err.message; }
  };
  dlg.showModal();
}

function showInfo(title, html) {
  $('#dlgForm').innerHTML = `<h3>${esc(title)}</h3>${html}<div class="actions"><button type="button" class="btn" id="cancelBtn">Tutup</button></div>`;
  $('#dlgForm').onsubmit = null; $('#cancelBtn').onclick = () => $('#dlg').close(); $('#dlg').showModal();
}

// ---- akun wali murid ----
const waPhone = (v) => { const d = String(v || '').replace(/\D/g, ''); return /^\d{9,15}$/.test(d) ? (d.startsWith('0') ? '62' + d.slice(1) : d) : ''; };
const waliDialog = guard(async (r) => {
  const f = $('#dlgForm');
  const render = async (cred) => {
    const acc = await api('wali-akun?siswa_id=' + r.id);
    const text = cred ? `Aplikasi Wali Murid Miftahul Ulum\nBuka: ${location.origin}/wali\nUsername: ${cred.username}\nPassword sementara: ${cred.password}\n(Wajib diganti saat pertama masuk)` : '';
    f.innerHTML = `<h3>Akun wali: ${esc(r.nama)}</h3>
      ${cred ? `<div class="card" style="background:#fff8e6"><b>Berikan ke wali (hanya tampil sekali)</b><pre style="white-space:pre-wrap;margin:6px 0">${esc(text)}</pre>
        <button type="button" class="btn small" data-act="copy">Salin</button> <a class="btn small" target="_blank" rel="noopener" href="https://wa.me/${waPhone(cred.username)}?text=${encodeURIComponent(text)}" style="text-decoration:none">Kirim lewat WhatsApp</a></div>` : ''}
      <div class="tablewrap"><table><thead><tr><th>Username</th><th>Nama</th><th>Status</th><th></th></tr></thead><tbody>${acc.map((a) =>
        `<tr><td>${esc(a.username)}</td><td>${esc(a.nama)}</td><td>${a.must_change ? 'belum ganti password' : 'aktif'}</td><td class="act">
        <button type="button" class="btn small" data-act="reset" data-uid="${a.user_id}">Reset password</button>
        <button type="button" class="btn small danger" data-act="unlink" data-uid="${a.user_id}">Lepas</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Belum ada akun wali.</td></tr>'}</tbody></table></div>
      <div class="fields"><label>No. HP wali / username<input id="wu" value="${esc(r.telepon || '')}"></label><label>Nama wali<input id="wn" value="${esc(r.wali || '')}"></label></div>
      <p class="muted small" style="margin:0;color:var(--mut)">Isi username/No. HP yang sudah ada untuk menautkan anak lain ke akun wali yang sama (kakak-adik).</p>
      <p class="error" id="formErr"></p>
      <div class="actions"><button type="button" class="btn" id="cancelBtn">Tutup</button><button type="button" class="btn primary" data-act="add">Buat / tautkan akun</button></div>`;
    $('#cancelBtn').onclick = () => $('#dlg').close();
    f.onclick = async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      try {
        if (b.dataset.act === 'copy') { await navigator.clipboard.writeText(text); return toast('Disalin'); }
        if (b.dataset.act === 'add') {
          const x = await api('wali-akun', { method: 'POST', body: { siswa_id: r.id, username: $('#wu').value, nama: $('#wn').value } });
          return render(x.password ? { username: x.username, password: x.password } : null);
        }
        if (b.dataset.act === 'reset') {
          if (!confirm('Buat password sementara baru untuk akun ini?')) return;
          const u = acc.find((a) => a.user_id === Number(b.dataset.uid));
          return render({ username: u.username, password: (await api('wali-akun/reset', { method: 'POST', body: { user_id: u.user_id } })).password });
        }
        if (b.dataset.act === 'unlink') {
          if (!confirm('Lepas akun ini dari siswa? Akun dihapus jika tidak punya anak lain.')) return;
          await api(`wali-akun?siswa_id=${r.id}&user_id=${b.dataset.uid}`, { method: 'DELETE' }); return render();
        }
      } catch (err) { $('#formErr').textContent = err.message; }
    };
  };
  f.onsubmit = (e) => e.preventDefault();
  await render(); $('#dlg').showModal();
});

// ---- opsi dropdown ----
const optKelas = async () => (await api('kelas')).map((k) => ({ value: k.id, label: (multi() ? k.lembaga_kode + ' · ' : '') + k.nama }));
const optGuru = async () => (await api('guru')).map((g) => ({ value: g.id, label: g.nama }));
const optSiswa = async () => (await api('siswa?status=aktif')).map((s) => ({ value: s.id, label: `${s.nis || '-'} · ${s.nama}` }));
const optTahun = async () => (await api('tahun_ajaran')).map((t) => ({ value: t.nama, label: t.nama + (t.aktif ? ' (aktif)' : ''), active: !!t.aktif }));
const STATUS_SISWA = ['aktif', 'lulus', 'pindah', 'keluar'];
const JK = [{ value: 'L', label: 'Laki-laki' }, { value: 'P', label: 'Perempuan' }];

// ---- halaman CRUD generik ----
function crudPage(cfg) {
  return guard(async () => {
    const main = $('#main');
    const filters = cfg.filters ? await Promise.all(cfg.filters.map(async (f) => ({ ...f, options: await f.load() }))) : [];
    main.innerHTML = `<h2>${cfg.title}</h2><div class="bar">
      <input id="q" placeholder="Cari…" type="search">
      ${filters.map((f) => `<select data-f="${f.key}"><option value="">${f.label}</option>${f.options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`).join('')}
      <span class="grow"></span>${(cfg.extra || []).map((b, i) => `<button class="btn" data-x="${i}">${b.label}</button>`).join('')}${cfg.noExport ? '' : '<button class="btn" id="xls">⬇ Excel</button><button class="btn" id="pdf">⬇ PDF</button>'}<button class="btn primary" id="add">+ Tambah</button></div>
      <div class="tablewrap" id="tbl"></div><p id="foot" class="empty" style="text-align:left"></p>${cfg.note || ''}`;
    filters.forEach((f) => { if (f.def) main.querySelector(`[data-f="${f.key}"]`).value = f.def; });
    const load = guard(async () => {
      const params = { q: $('#q').value };
      main.querySelectorAll('[data-f]').forEach((s) => { params[s.dataset.f] = s.value; });
      const rows = await api(cfg.key + '?' + qs(params));
      const columns = multi() && cfg.scoped !== false ? [{ key: 'lembaga_kode', label: 'Lembaga' }, ...cfg.columns] : cfg.columns;
      $('#tbl').innerHTML = rows.length ? `<table><thead><tr>${columns.map((c) => `<th>${c.label}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map((r) =>
        `<tr>${columns.map((c) => `<td class="${c.render || String(r[c.key] ?? '').length <= 18 ? 'nw' : ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}
        <td class="act">${(cfg.rowActions || []).filter((a) => !a.show || a.show(r)).map((a) => `<button class="btn small" data-a="${a.name}" data-id="${r.id}">${a.label}</button>`).join(' ')}
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
        cfg.rowActions.find((a) => a.name === b.dataset.a).run(row, load);
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
    main.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => cfg.extra[b.dataset.x].run(load); });
    if (!cfg.noExport) $('#xls').onclick = () => {
      const params = { q: $('#q').value };
      main.querySelectorAll('[data-f]').forEach((s) => { params[s.dataset.f] = s.value; });
      download('export/' + cfg.key + '?' + qs(params));
    };
    if (!cfg.noExport) $('#pdf').onclick = () => {
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
    { key: 'status', label: 'Semua status', def: 'aktif', load: async () => STATUS_SISWA.map((v) => ({ value: v, label: v })) }],
  columns: [{ key: 'nis', label: 'NIS' }, { key: 'nama', label: 'Nama' }, { key: 'jk', label: 'L/P' },
    { key: 'kelas_nama', label: 'Kelas' }, { key: 'wali', label: 'Wali' }, { key: 'telepon', label: 'Telepon' },
    { label: 'Status', render: (r) => `<span class="badge">${esc(r.status)}</span>` }],
  rowActions: [{ name: 'wali', label: 'Akun wali', run: waliDialog }, { name: 'riwayat', label: 'Riwayat', run: guard(async (r) => {
    const h = await api('riwayat?siswa_id=' + r.id);
    showInfo('Riwayat ' + r.nama, h.length ? `<div class="tablewrap"><table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Dari</th><th>Ke</th><th>Tahun</th></tr></thead><tbody>${h.map((m) =>
      `<tr><td>${esc(m.tanggal)}</td><td>${esc(m.jenis)}</td><td>${esc(m.dari_kelas)}</td><td>${esc(m.ke_kelas)}</td><td>${esc(m.tahun_ajaran)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Belum ada riwayat.</p>');
  }) }],
  fields: [{ name: 'nis', label: 'NIS' }, { name: 'nama', label: 'Nama', required: true },
    { name: 'jk', label: 'Jenis kelamin', options: JK }, { name: 'tempat_lahir', label: 'Tempat lahir' }, { name: 'tgl_lahir', label: 'Tanggal lahir', type: 'date' }, { name: 'nik', label: 'NIK' },
    { name: 'kelas_id', label: 'Kelas', load: optKelas }, { name: 'status', label: 'Status', blank: false, default: 'aktif',
      options: STATUS_SISWA.map((v) => ({ value: v, label: v })) },
    { name: 'wali', label: 'Nama orang tua/wali' }, { name: 'telepon', label: 'Telepon' },
    { name: 'tahun_masuk', label: 'Tahun masuk (mis. 2026/2027)' }, { name: 'tahun_lulus', label: 'Tahun lulus' },
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
  fields: [{ name: 'nama', label: 'Nama kelas', required: true }, { name: 'tahun_ajaran', label: 'Tahun ajaran', load: optTahun, blank: false },
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

pages.lembaga = crudPage({
  key: 'lembaga', title: 'Lembaga', single: 'Lembaga', scoped: false,
  noExport: true,
  columns: [{ key: 'kode', label: 'Kode' }, { key: 'nama', label: 'Nama' }, { key: 'jenjang', label: 'Jenjang' }, { key: 'telepon', label: 'Telepon' },
    { label: 'Pendaftaran online', render: (r) => r.ppdb_buka ? '<span class="badge">dibuka</span>' : 'ditutup' }],
  fields: [{ name: 'kode', label: 'Kode singkat', required: true }, { name: 'nama', label: 'Nama lembaga', required: true },
    { name: 'jenjang', label: 'Jenjang' }, { name: 'telepon', label: 'Telepon' },
    { name: 'ppdb_buka', label: 'Pendaftaran online (PPDB)', blank: false, default: 0, full: true, options: [{ value: 0, label: 'Ditutup' }, { value: 1, label: 'Dibuka' }] }, { name: 'alamat', label: 'Alamat', type: 'textarea', full: true }],
});
pages.tahun = crudPage({
  key: 'tahun_ajaran', title: 'Tahun Ajaran', single: 'Tahun Ajaran', scoped: false, noExport: true,
  columns: [{ key: 'nama', label: 'Tahun ajaran' }, { key: 'mulai', label: 'Mulai' }, { key: 'selesai', label: 'Selesai' },
    { label: 'Status', render: (r) => r.aktif ? '<span class="badge">aktif</span>' : '' }],
  fields: [{ name: 'nama', label: 'Nama (mis. 2026/2027)', required: true, full: true }, { name: 'mulai', label: 'Mulai', type: 'date' }, { name: 'selesai', label: 'Selesai', type: 'date' },
    { name: 'aktif', label: 'Tahun ajaran aktif', blank: false, default: 0, options: [{ value: 0, label: 'Tidak' }, { value: 1, label: 'Ya (menonaktifkan yang lain)' }] }],
});

pages.tagihan = crudPage({
  key: 'tagihan', title: 'Tagihan', single: 'Tagihan',
  note: '<p class="empty" style="text-align:left">Status tagihan dihitung otomatis dari menu Pembayaran: pembayaran dengan siswa, jenis, dan periode yang sama. Wali melihatnya di aplikasi.</p>',
  filters: [{ key: 'kelas_id', label: 'Semua kelas', load: optKelas }, { key: 'status', label: 'Semua status', load: async () => ['belum', 'sebagian', 'lunas'].map((v) => ({ value: v, label: v })) }],
  columns: [{ key: 'siswa_nama', label: 'Siswa' }, { key: 'kelas_nama', label: 'Kelas' }, { key: 'jenis', label: 'Jenis' }, { key: 'periode', label: 'Periode' }, { key: 'jatuh_tempo', label: 'Jatuh tempo' },
    { label: 'Jumlah', render: (r) => rp(r.jumlah) }, { label: 'Terbayar', render: (r) => rp(r.terbayar) }, { label: 'Sisa', render: (r) => rp(r.sisa) },
    { label: 'Status', render: (r) => `<span class="badge">${esc(r.status)}</span>` }],
  footer: (rows) => `${rows.length} tagihan · sisa ${rp(rows.reduce((a, r) => a + r.sisa, 0))}`,
  extra: [{ label: '⚡ Buat tagihan massal', run: guard(async (reload) => {
    const kelas = await optKelas();
    openForm('Buat tagihan untuk satu kelas', [{ name: 'kelas_id', label: 'Kelas', options: kelas, required: true, full: true },
      { name: 'jenis', label: 'Jenis', blank: false, default: 'SPP', options: ['SPP', 'Uang Gedung', 'Seragam', 'Kegiatan', 'Lainnya'].map((v) => ({ value: v, label: v })) },
      { name: 'periode', label: 'Periode', type: 'month', default: today().slice(0, 7) }, { name: 'jumlah', label: 'Jumlah per siswa (Rp)', type: 'number', required: true },
      { name: 'jatuh_tempo', label: 'Jatuh tempo', type: 'date' }], {},
    async (d) => { const r = await api('tagihan/generate', { method: 'POST', body: d }); toast(`${r.dibuat} tagihan dibuat, ${r.dilewati} dilewati (sudah ada)`); reload(); });
  }) }],
  fields: [{ name: 'siswa_id', label: 'Siswa', load: optSiswa, required: true, full: true },
    { name: 'jenis', label: 'Jenis', blank: false, default: 'SPP', options: ['SPP', 'Uang Gedung', 'Seragam', 'Kegiatan', 'Lainnya'].map((v) => ({ value: v, label: v })) },
    { name: 'periode', label: 'Periode', type: 'month', default: today().slice(0, 7) }, { name: 'jumlah', label: 'Jumlah (Rp)', type: 'number', required: true },
    { name: 'jatuh_tempo', label: 'Jatuh tempo', type: 'date' }, { name: 'keterangan', label: 'Keterangan' }],
});
pages.pengumuman = crudPage({
  key: 'pengumuman', title: 'Pengumuman untuk Wali', single: 'Pengumuman', noExport: true,
  note: '<p class="empty" style="text-align:left">Pengumuman tampil di aplikasi wali murid dari lembaga yang dipilih. Pilih satu lembaga saat membuat pengumuman.</p>',
  columns: [{ key: 'tanggal', label: 'Tanggal' }, { key: 'judul', label: 'Judul' }, { label: 'Isi', render: (r) => esc(String(r.isi).slice(0, 80)) + (r.isi.length > 80 ? '…' : '') }, { key: 'dibuat_oleh', label: 'Oleh' }],
  fields: [{ name: 'judul', label: 'Judul', required: true, full: true }, { name: 'isi', label: 'Isi pengumuman', type: 'textarea', required: true, full: true }],
});
const STATUS_PPDB = ['baru', 'terverifikasi', 'diterima', 'cadangan', 'ditolak'];
const setStatus = (status) => guard(async (r, reload) => { await api('pendaftar/' + r.id, { method: 'PUT', body: { status } }); toast('Status diubah'); reload(); });
pages.pendaftar = crudPage({
  key: 'pendaftar', title: 'Pendaftar Baru (PPDB)', single: 'Pendaftar',
  note: `<p class="empty" style="text-align:left">Tautan pendaftaran online untuk orang tua: <b>${esc(location.origin)}/daftar</b> — buka/tutup per lembaga di menu Lembaga.</p>`,
  filters: [{ key: 'status', label: 'Semua status', load: async () => [...STATUS_PPDB, 'terdaftar'].map((v) => ({ value: v, label: v })) }],
  columns: [{ key: 'no_daftar', label: 'No. Daftar' }, { key: 'nama', label: 'Nama' }, { key: 'jk', label: 'L/P' }, { key: 'tgl_lahir', label: 'Tgl lahir' },
    { key: 'asal_sekolah', label: 'Asal sekolah' }, { key: 'telepon', label: 'Telepon' }, { label: 'Status', render: (r) => `<span class="badge">${esc(r.status)}</span>` }],
  rowActions: [
    { name: 'terima', label: 'Terima', show: (r) => ['baru', 'terverifikasi', 'cadangan'].includes(r.status), run: setStatus('diterima') },
    { name: 'tolak', label: 'Tolak', show: (r) => ['baru', 'terverifikasi', 'cadangan'].includes(r.status), run: setStatus('ditolak') },
    { name: 'siswa', label: 'Jadikan siswa', show: (r) => r.status === 'diterima' && !r.siswa_id, run: guard(async (r, reload) => {
      const kelas = (await api('kelas')).filter((k) => k.lembaga_id === r.lembaga_id).map((k) => ({ value: k.id, label: `${k.nama} (${k.tahun_ajaran || '-'})` }));
      openForm('Jadikan siswa: ' + r.nama, [{ name: 'kelas_id', label: 'Kelas', options: kelas, full: true }, { name: 'nis', label: 'NIS (opsional, bisa diisi nanti)', full: true }], {},
        async (d) => { await api(`pendaftar/${r.id}/terima`, { method: 'POST', body: d }); toast('Ditambahkan sebagai siswa aktif'); reload(); });
    }) }],
  fields: [{ name: 'nama', label: 'Nama', required: true, full: true }, { name: 'jk', label: 'Jenis kelamin', options: JK }, { name: 'tgl_lahir', label: 'Tanggal lahir', type: 'date' },
    { name: 'tempat_lahir', label: 'Tempat lahir' }, { name: 'nik', label: 'NIK' }, { name: 'nama_ayah', label: 'Nama ayah' }, { name: 'nama_ibu', label: 'Nama ibu' },
    { name: 'telepon', label: 'Telepon/WA' }, { name: 'asal_sekolah', label: 'Asal sekolah' }, { name: 'alamat', label: 'Alamat', type: 'textarea', full: true },
    { name: 'status', label: 'Status seleksi', blank: false, default: 'baru', options: STATUS_PPDB.map((v) => ({ value: v, label: v })) },
    { name: 'catatan', label: 'Catatan internal' }],
});

pages.kenaikan = guard(async () => {
  const kelas = await api('kelas');
  const label = (k) => `${multi() ? k.lembaga_kode + ' · ' : ''}${k.nama}${k.tahun_ajaran ? ' (' + k.tahun_ajaran + ')' : ''}`;
  $('#main').innerHTML = `<h2>Kenaikan Kelas & Kelulusan</h2>
    <div class="card" style="display:grid;gap:12px;max-width:760px">
      <div class="fields"><label>Kelas asal<select id="asal"><option value=""></option>${kelas.map((k) => `<option value="${k.id}">${esc(label(k))}</option>`).join('')}</select></label>
        <label>Tindakan<select id="aksi"><option value="naik">Naik ke kelas…</option><option value="lulus">Lulus (menjadi alumni)</option><option value="pindah">Pindah sekolah</option><option value="keluar">Keluar</option></select></label>
        <label id="tujuanWrap" class="full">Kelas tujuan<select id="tujuan"></select></label>
        <label class="full">Keterangan (opsional)<input id="ket" maxlength="200"></label></div>
      <div id="siswa" class="tablewrap"><div class="empty">Pilih kelas asal.</div></div>
      <div class="bar" style="margin:0"><span id="cnt" class="grow"></span><button class="btn primary" id="proses" disabled>Proses</button></div></div>`;
  let siswa = [];
  const checked = () => [...document.querySelectorAll('#siswa input[data-id]:checked')].map((i) => Number(i.dataset.id));
  const refresh = () => {
    const aksi = $('#aksi').value, asal = kelas.find((k) => String(k.id) === $('#asal').value);
    $('#tujuanWrap').classList.toggle('hidden', aksi !== 'naik');
    $('#tujuan').innerHTML = kelas.filter((k) => asal && k.lembaga_id === asal.lembaga_id && k.id !== asal.id).map((k) => `<option value="${k.id}">${esc(label(k))}</option>`).join('');
    $('#cnt').textContent = `${checked().length} dari ${siswa.length} siswa dipilih`;
    $('#proses').disabled = !checked().length || (aksi === 'naik' && !$('#tujuan').value);
  };
  const load = guard(async () => {
    siswa = $('#asal').value ? await api('siswa?' + qs({ kelas_id: $('#asal').value, status: 'aktif' })) : [];
    $('#siswa').innerHTML = siswa.length ? `<table><thead><tr><th><input type="checkbox" id="all" checked></th><th>NIS</th><th>Nama</th></tr></thead><tbody>${siswa.map((x) =>
      `<tr><td><input type="checkbox" data-id="${x.id}" checked></td><td>${esc(x.nis)}</td><td>${esc(x.nama)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Tidak ada siswa aktif.</div>';
    const all = $('#all'); if (all) all.onchange = () => { document.querySelectorAll('#siswa input[data-id]').forEach((i) => { i.checked = all.checked; }); refresh(); };
    refresh();
  });
  $('#asal').onchange = load; $('#aksi').onchange = refresh; $('#tujuan').onchange = refresh;
  $('#siswa').onchange = refresh;
  $('#proses').onclick = guard(async () => {
    const ids = checked(), aksi = $('#aksi').value;
    const msg = { naik: 'dinaikkan kelas', lulus: 'diluluskan', pindah: 'ditandai pindah', keluar: 'ditandai keluar' }[aksi];
    if (!confirm(`${ids.length} siswa akan ${msg}. Lanjutkan?`)) return;
    await api('kenaikan', { method: 'POST', body: { siswa_ids: ids, aksi, ke_kelas_id: $('#tujuan').value, keterangan: $('#ket').value } });
    toast(`${ids.length} siswa ${msg}`); load();
  });
  refresh();
});

// ---- dashboard ----
pages.dashboard = guard(async () => {
  const d = await api('dashboard');
  const a = d.absensi_hari_ini;
  const bars = (rows, label) => { const max = Math.max(1, ...rows.map((r) => r.jumlah)); return rows.map((r) =>
    `<div><span>${esc(label(r))}</span><i style="width:${r.jumlah / max * 100}%"></i><span>${r.jumlah}</span></div>`).join('') || '<p class="empty">Belum ada data.</p>'; };
  $('#main').innerHTML = `<h2>Dashboard</h2><div class="stats">
    ${[['Siswa aktif', d.siswa], ['Guru', d.guru], ['Kelas', d.kelas], ['Pendaftar baru', d.pendaftar_baru], ['Pembayaran bulan ini', rp(d.pembayaran_bulan_ini)], ['Tunggakan (lewat jatuh tempo)', rp(d.tunggakan)]]
      .map(([l, n]) => `<div class="card stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('')}</div>
    <div class="grid2"><div class="card"><b>Absensi hari ini</b><p>Hadir ${a.H || 0} · Sakit ${a.S || 0} · Izin ${a.I || 0} · Alpa ${a.A || 0}</p></div>
    ${d.multi ? `<div class="card"><b>Siswa per lembaga</b><div class="bars">${bars(d.per_lembaga, (r) => r.kode)}</div></div>` : ''}
    <div class="card"><b>Siswa per kelas</b><div class="bars">${bars(d.per_kelas, (k) => (d.multi ? k.lembaga_kode + ' ' : '') + k.nama)}</div></div></div>`;
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
    <button class="btn" id="raporPdf">⬇ PDF</button><button class="btn" id="printBtn">🖨 Cetak</button></div><div id="out"></div>`;
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
  $('#printBtn').onclick = () => window.print();
  $('#raporPdf').onclick = () => $('#s').value && download('pdf/rapor?' + qs({ siswa_id: $('#s').value, semester: $('#sem').value }));
  $('#s').onchange = $('#sem').onchange = load; load();
});

// ---- pengguna ----
pages.pengguna = guard(async () => {
  const lembagaOpts = me.lembagas.map((l) => ({ value: l.id, label: l.nama }));
  const kode = (ids) => ids.map((i) => (me.lembagas.find((l) => l.id === i) || {}).kode).filter(Boolean).join(', ');
  const roles = me.role === 'yayasan' ? [['yayasan', 'Admin Yayasan (semua lembaga)'], ['admin', 'Admin Lembaga'], ['staf', 'Staf']] : [['staf', 'Staf']];
  const load = guard(async () => {
    const rows = await api('users');
    $('#main').innerHTML = `<h2>Pengguna</h2><div class="bar"><span class="grow"></span><button class="btn primary" id="add">+ Tambah</button></div>
      <div class="tablewrap"><table><thead><tr><th>Username</th><th>Nama</th><th>Peran</th><th>Lembaga</th><th></th></tr></thead><tbody>${rows.map((u) =>
        `<tr><td>${esc(u.username)}</td><td>${esc(u.nama)}</td><td><span class="badge">${esc(u.role)}</span></td><td>${u.role === 'yayasan' ? 'Semua' : esc(kode(u.lembaga_ids))}</td>
        <td class="act">${me.role !== 'yayasan' && u.role !== 'staf' ? '' : `<button class="btn small" data-a="edit" data-id="${u.id}">Ubah</button>
        ${u.id === me.id ? '' : `<button class="btn small danger" data-a="del" data-id="${u.id}">Hapus</button>`}`}</td></tr>`).join('')}</tbody></table></div>
      <p class="empty" style="text-align:left">Kosongkan password saat mengubah jika tidak ingin menggantinya.</p>`;
    const fields = (edit) => [{ name: 'username', label: 'Username', required: true, ...(edit ? { disabled: true } : {}) }, { name: 'nama', label: 'Nama', required: true },
      { name: 'password', label: edit ? 'Password baru (opsional)' : 'Password (min. 8)', type: 'password', required: !edit },
      { name: 'role', label: 'Peran', blank: false, options: roles.map(([value, label]) => ({ value, label })) },
      { name: 'lembaga_ids', label: 'Lembaga yang boleh diakses (tidak berlaku untuk Admin Yayasan)', type: 'checks', options: lembagaOpts }];
    const save = (row) => async (d) => {
      if (row && !d.password) delete d.password;
      if (row) delete d.username;
      await api(row ? 'users/' + row.id : 'users', { method: row ? 'PUT' : 'POST', body: d }); toast('Tersimpan'); load();
    };
    $('#add').onclick = () => openForm('Tambah Pengguna', fields(false), { role: roles[roles.length - 1][0] }, save());
    $('#main').onclick = guard(async (e) => {
      const b = e.target.closest('button[data-id]'); if (!b) return;
      const row = rows.find((u) => u.id === Number(b.dataset.id));
      if (b.dataset.a === 'edit') return openForm('Ubah Pengguna', fields(true), row, save(row));
      if (!confirm('Hapus pengguna ini?')) return;
      await api('users/' + row.id, { method: 'DELETE' }); load();
    });
  });
  load();
});

// ---- shell ----
const ALL = ['yayasan', 'admin', 'staf'], ADM = ['yayasan', 'admin'];
const MENU = [['dashboard', 'Dashboard', ALL], ['siswa', 'Siswa', ALL], ['guru', 'Guru', ALL], ['kelas', 'Kelas', ALL], ['absensi', 'Absensi', ALL],
  ['pendaftar', 'Pendaftar (PPDB)', ALL], ['kenaikan', 'Kenaikan Kelas', ADM], ['nilai', 'Nilai', ALL], ['rapor', 'Rapor', ALL], ['pembayaran', 'Pembayaran', ALL], ['tagihan', 'Tagihan', ALL], ['pengumuman', 'Pengumuman', ALL], ['pengguna', 'Pengguna', ADM],
  ['lembaga', 'Lembaga', ['yayasan']], ['tahun', 'Tahun Ajaran', ['yayasan']]];

function route() {
  const name = location.hash.slice(2) || 'dashboard';
  const page = pages[name] || pages.dashboard;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.p === name));
  $('#main').onclick = null; page();
}
function showLogin() { me = null; $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
function forcePassword() {
  openForm('Buat password baru (wajib)', [{ name: 'lama', label: 'Password saat ini', type: 'password', required: true, full: true },
    { name: 'baru', label: 'Password baru (min. 8 karakter)', type: 'password', required: true, full: true }], {},
  async (d) => { await api('password', { method: 'POST', body: d }); me.must_change = false; $('#dlg').oncancel = null; toast('Password diganti'); route(); });
  $('#cancelBtn').classList.add('hidden'); $('#dlg').oncancel = (e) => e.preventDefault();
}
function showApp() {
  if (me.role === 'wali') { location.href = '/wali'; return; }
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#nav').innerHTML = MENU.filter((m) => m[2].includes(me.role)).map(([k, l]) => `<a href="#/${k}" data-p="${k}">${l}</a>`).join('');
  $('#who').textContent = `${me.nama} (${me.role})`;
  let saved = null; try { saved = localStorage.getItem('lembaga'); } catch {}
  scope = me.lembagas.some((l) => String(l.id) === saved) ? Number(saved) : (me.lembagas.length === 1 ? me.lembagas[0].id : 'all');
  const sw = $('#lembaga');
  if (me.lembagas.length > 1) {
    sw.classList.remove('hidden');
    sw.innerHTML = '<option value="all">Semua lembaga</option>' + me.lembagas.map((l) => `<option value="${l.id}">${esc(l.nama)}</option>`).join('');
    sw.value = String(scope);
  } else sw.classList.add('hidden');
  $('#lembagaName').textContent = me.lembagas.length === 1 ? me.lembagas[0].nama : '';
  if (me.must_change) { forcePassword(); return; }
  route();
}
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault(); $('#loginError').textContent = '';
  try { me = await api('login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); showApp(); }
  catch (err) { $('#loginError').textContent = err.message; }
};
$('#lembaga').onchange = (e) => {
  scope = e.target.value === 'all' ? 'all' : Number(e.target.value);
  try { localStorage.setItem('lembaga', String(scope)); } catch {}
  route();
};
$('#logoutBtn').onclick = async () => { await api('logout', { method: 'POST' }).catch(() => {}); showLogin(); };
$('#pwBtn').onclick = () => openForm('Ganti Password', [{ name: 'lama', label: 'Password lama', type: 'password', required: true, full: true },
  { name: 'baru', label: 'Password baru (min. 8)', type: 'password', required: true, full: true }], {},
async (d) => { await api('password', { method: 'POST', body: d }); toast('Password diganti'); });
window.addEventListener('hashchange', () => me && route());
api('me').then((u) => { me = u; showApp(); }).catch(showLogin);
