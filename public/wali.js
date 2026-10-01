'use strict';
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const tgl = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const bln = (p) => p ? new Date(p + '-01T00:00:00').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : '';
const ABSEN = { H: 'Hadir', S: 'Sakit', I: 'Izin', A: 'Alpa' };

let me = null, anak = [], cur = null, data = null, news = [], tab = 'beranda', installEvt = null;

async function api(path, opt = {}) {
  let r;
  try {
    r = await fetch('/api/' + path, { method: opt.method || 'GET', headers: opt.body ? { 'Content-Type': 'application/json' } : {}, body: opt.body ? JSON.stringify(opt.body) : undefined });
  } catch { throw new Error('Tidak ada koneksi internet'); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'login') { show('login'); throw new Error(d.error || 'Sesi berakhir'); }
  if (!r.ok) throw new Error(d.error || 'Terjadi kesalahan');
  return d;
}
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3200);
}
function show(which) { ['boot', 'login', 'app'].forEach((id) => $('#' + id).classList.toggle('hidden', id !== which)); }

// ---- dialog ----
function dialog(title, fields, { cancel = true, submit = 'Simpan' } = {}, onSave) {
  const f = $('#dlgForm');
  f.innerHTML = `<h3>${esc(title)}</h3>${fields.map((x) => `<label>${esc(x.label)}<input name="${x.name}" type="${x.type || 'text'}" autocomplete="${x.ac || 'off'}" required></label>`).join('')}
    <p class="error" id="dlgErr"></p><div class="actions">${cancel ? '<button type="button" class="btn" id="dlgCancel">Batal</button>' : ''}<button class="btn primary">${esc(submit)}</button></div>`;
  const dlg = $('#dlg');
  dlg.oncancel = cancel ? null : (e) => e.preventDefault();
  if (cancel) $('#dlgCancel').onclick = () => dlg.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { await onSave(Object.fromEntries(new FormData(f))); dlg.oncancel = null; dlg.close(); } catch (err) { $('#dlgErr').textContent = err.message; }
  };
  dlg.showModal();
}
const changePassword = (force) => dialog(force ? 'Buat password baru' : 'Ganti password', [
  { name: 'lama', label: 'Password saat ini', type: 'password', ac: 'current-password' },
  { name: 'baru', label: 'Password baru (min. 8 karakter)', type: 'password', ac: 'new-password' }], { cancel: !force },
async (d) => { await api('password', { method: 'POST', body: d }); me.must_change = false; toast('Password diganti'); if (force) await start(); });

// ---- render ----
const chip = (cls, text) => `<span class="chip ${cls}">${esc(text)}</span>`;
function tagihanChip(t) {
  if (t.status === 'lunas') return chip('lunas', 'Lunas');
  const late = t.jatuh_tempo && t.jatuh_tempo < todayStr();
  return t.status === 'sebagian' ? chip('sebagian', late ? 'Sebagian · terlambat' : 'Sebagian') : chip(late ? 'telat' : 'belum', late ? 'Terlambat' : 'Belum bayar');
}
function absTotal(a) { return a.h + a.s + a.i + a.a; }

const views = {
  beranda() {
    const s = data.siswa, ab = data.absensi.bulan_ini, due = data.tagihan.filter((t) => t.status !== 'lunas');
    const sisa = due.reduce((x, t) => x + t.sisa, 0), rata = data.nilai.rata.length ? (data.nilai.rata.reduce((x, n) => x + n.rata, 0) / data.nilai.rata.length).toFixed(1) : '-';
    const install = installEvt ? '<div class="install">📲 Pasang aplikasi ini di layar utama HP Anda. <button class="btn primary" id="install" style="margin-top:8px;width:100%">Pasang aplikasi</button></div>'
      : (/iphone|ipad/i.test(navigator.userAgent) && !navigator.standalone ? '<div class="install">📲 Untuk memasang di iPhone: ketuk tombol <b>Bagikan</b> lalu <b>Tambah ke Layar Utama</b>.</div>' : '');
    return `${install}<div class="card hero"><b>${esc(s.nama)}</b><div>${esc(s.lembaga_nama)}</div><div>Kelas ${esc(s.kelas_nama || '-')} · NIS ${esc(s.nis || '-')}</div>
      <div>Wali kelas: ${esc(s.wali_kelas || '-')}</div>${s.status !== 'aktif' ? '<div>' + chip('belum', 'Status: ' + s.status) + '</div>' : ''}</div>
      <div class="tiles"><div class="tile"><div class="n">${ab.h}<span class="small muted"> / ${absTotal(ab)}</span></div><div class="l">Hadir bulan ini</div></div>
      <div class="tile"><div class="n">${rata}</div><div class="l">Rata-rata nilai</div></div>
      <div class="tile" style="grid-column:1/-1"><div class="n" style="color:${sisa ? 'var(--bad)' : 'var(--ok)'}">${sisa ? rp(sisa) : 'Lunas ✓'}</div><div class="l">${sisa ? `Tagihan belum dibayar (${due.length})` : 'Tidak ada tagihan tertunggak'}</div></div></div>
      ${news.length ? `<div class="card news"><h3>Info terbaru</h3><h4>${esc(news[0].judul)}</h4><div class="small muted">${tgl(news[0].tanggal)} · ${esc(news[0].lembaga)}</div><p>${esc(news[0].isi)}</p></div>` : ''}`;
  },
  nilai() {
    const n = data.nilai;
    if (!n.rata.length) return '<div class="empty">Belum ada nilai.</div>';
    return `<div class="card"><h3>Rata-rata per mata pelajaran</h3>${n.rata.map((r) => `<div style="margin:10px 0"><div class="item" style="border:0;padding:0"><span>${esc(r.mapel)}</span><b>${r.rata}</b></div><div class="bar"><i style="width:${Math.min(100, r.rata)}%"></i></div></div>`).join('')}</div>
      <div class="card"><h3>Nilai terbaru</h3>${n.daftar.slice(0, 40).map((x) => `<div class="item"><div>${esc(x.mapel)}<div class="s">${esc(x.jenis || '')} · ${tgl(x.tanggal)} ${x.semester ? '· ' + esc(x.semester) : ''}</div></div><div class="r"><b>${x.nilai}</b></div></div>`).join('')}</div>`;
  },
  absensi() {
    const a = data.absensi, b = a.bulan_ini, all = a.semua;
    return `<div class="tiles">${[['H', b.h], ['S', b.s], ['I', b.i], ['A', b.a]].map(([k, v]) => `<div class="tile"><div class="n">${v}</div><div class="l">${ABSEN[k]} · ${esc(bln(a.bulan))}</div></div>`).join('')}</div>
      <div class="card"><h3>Keseluruhan</h3><div class="small">Hadir ${all.h} · Sakit ${all.s} · Izin ${all.i} · Alpa ${all.a}</div></div>
      <div class="card"><h3>14 hari terakhir tercatat</h3>${a.terbaru.length ? `<div class="days">${a.terbaru.map((x) => chip(x.status, tgl(x.tanggal).replace(/ \d{4}$/, '') + ' ' + ABSEN[x.status])).join('')}</div>` : '<div class="empty">Belum ada data.</div>'}</div>`;
  },
  tagihan() {
    const t = data.tagihan, p = data.pembayaran;
    return `<div class="card"><h3>Tagihan</h3>${t.length ? t.map((x) => `<div class="item"><div>${esc(x.jenis)} ${esc(bln(x.periode))}<div class="s">${x.jatuh_tempo ? 'Jatuh tempo ' + tgl(x.jatuh_tempo) : ''}${x.keterangan ? ' · ' + esc(x.keterangan) : ''}</div><div style="margin-top:4px">${tagihanChip(x)}</div></div>
      <div class="r"><b>${rp(x.jumlah)}</b>${x.status === 'sebagian' ? `<div class="s">sisa ${rp(x.sisa)}</div>` : ''}</div></div>`).join('') : '<div class="empty">Belum ada tagihan.</div>'}</div>
      <div class="card"><h3>Riwayat pembayaran</h3>${p.length ? p.map((x) => `<div class="item"><div>${esc(x.jenis)} ${esc(bln(x.bulan))}<div class="s">${tgl(x.tanggal)}${x.keterangan ? ' · ' + esc(x.keterangan) : ''}</div></div><div class="r"><b>${rp(x.jumlah)}</b></div></div>`).join('') : '<div class="empty">Belum ada pembayaran.</div>'}</div>
      <p class="muted small">Pembayaran dilakukan di tata usaha lembaga. Status tagihan diperbarui setelah petugas mencatat pembayaran.</p>`;
  },
  berita() {
    return news.length ? news.map((x) => `<div class="card news"><h4>${esc(x.judul)}</h4><div class="small muted">${tgl(x.tanggal)} · ${esc(x.lembaga)}</div><p>${esc(x.isi)}</p></div>`).join('') : '<div class="empty">Belum ada pengumuman.</div>';
  },
};

function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
  if (!anak.length) { $('#view').innerHTML = tab === 'berita' ? views.berita() : '<div class="empty">Belum ada data anak yang tertaut ke akun ini. Hubungi tata usaha.</div>'; return; }
  $('#view').innerHTML = data ? views[tab]() : '<div class="empty">Memuat…</div>';
  const ib = $('#install'); if (ib) ib.onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); };
}

async function loadAnak() {
  data = null; render();
  try { data = await api('wali/anak/' + cur); } catch (e) { toast(e.message, true); }
  render();
}
async function loadAll() {
  [anak, news] = await Promise.all([api('wali/anak'), api('wali/pengumuman')]);
  let saved = null; try { saved = localStorage.getItem('anak'); } catch {}
  cur = anak.some((a) => String(a.id) === saved) ? Number(saved) : (anak[0] || {}).id;
  const sel = $('#anak');
  sel.innerHTML = anak.map((a) => `<option value="${a.id}">${esc(a.nama)} · ${esc(a.kelas_nama || a.lembaga_nama)}</option>`).join('');
  sel.classList.toggle('hidden', anak.length < 2); if (cur) sel.value = String(cur);
  if (cur) await loadAnak(); else render();
}

async function start() {
  try { me = await api('me'); } catch { show('login'); return; }
  if (me.role !== 'wali') {
    await api('logout', { method: 'POST' }).catch(() => {});
    show('login'); $('#loginErr').textContent = 'Akun ini adalah akun petugas. Gunakan halaman petugas.'; return;
  }
  $('#who').textContent = me.nama;
  show('app');
  if (me.must_change) { changePassword(true); return; }
  try { await loadAll(); } catch (e) { toast(e.message, true); }
}

$('#loginForm').onsubmit = async (e) => {
  e.preventDefault(); $('#loginErr').textContent = '';
  try { await api('login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); await start(); }
  catch (err) { $('#loginErr').textContent = err.message; }
};
document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => { tab = b.dataset.t; render(); window.scrollTo(0, 0); }; });
$('#anak').onchange = (e) => { cur = Number(e.target.value); try { localStorage.setItem('anak', String(cur)); } catch {} loadAnak(); };
$('#reload').onclick = () => loadAll().then(() => toast('Data diperbarui')).catch((e) => toast(e.message, true));
$('#menuBtn').onclick = () => {
  $('#dlgForm').innerHTML = `<h3>${esc(me.nama)}</h3><button type="button" class="btn" id="mPw">Ganti password</button><button type="button" class="btn" id="mOut">Keluar</button><button type="button" class="btn" id="mClose">Tutup</button>`;
  $('#dlgForm').onsubmit = null; $('#dlg').oncancel = null;
  $('#mClose').onclick = () => $('#dlg').close();
  $('#mPw').onclick = () => { $('#dlg').close(); changePassword(false); };
  $('#mOut').onclick = async () => { await api('logout', { method: 'POST' }).catch(() => {}); $('#dlg').close(); try { localStorage.removeItem('anak'); } catch {} show('login'); };
  $('#dlg').showModal();
};
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (data && tab === 'beranda') render(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
start();
