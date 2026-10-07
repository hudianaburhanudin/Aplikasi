'use strict';
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const tgl = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const bln = (p) => p ? new Date(p + '-01T00:00:00').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : '';
const ABSEN = { H: 'Hadir', S: 'Sakit', I: 'Izin', A: 'Alpa' };

const logoUrl = (k) => '/logo/' + String(k || 'yayasan').toLowerCase() + '.png';
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

// ---- data & privasi: hak pemilik data ----
const JENIS = { salinan: 'Minta salinan data anak', koreksi: 'Minta koreksi data anak', hapus_data: 'Minta penghapusan data anak', hapus_akun: 'Minta hapus akun saya' };
const STATUS_MINTA = { baru: 'Menunggu', diproses: 'Sedang diproses', selesai: 'Selesai', ditolak: 'Ditolak' };
async function dataPrivasi() {
  let riwayat = [];
  try { riwayat = await api('wali/permintaan'); } catch (e) { toast(e.message, true); return; }
  const f = $('#dlgForm'), dlg = $('#dlg');
  f.innerHTML = `<h3>Data &amp; privasi</h3><p class="muted small" style="margin:0">Anda berhak meminta salinan, koreksi, atau penghapusan data. Petugas sekolah akan memverifikasi dan menjawab. <a href="/privasi">Kebijakan Privasi</a></p>
    <label>Jenis permintaan<select name="jenis">${Object.entries(JENIS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <label id="lAnak">Anak<select name="siswa_id">${anak.map((a) => `<option value="${a.id}">${esc(a.nama)} · ${esc(a.lembaga_nama)}</option>`).join('')}</select></label>
    <label>Catatan (wajib untuk koreksi: data apa yang salah)<textarea name="catatan" rows="3" maxlength="500"></textarea></label>
    <p class="error" id="dpErr"></p>
    ${riwayat.length ? `<div><b class="small">Permintaan Anda</b>${riwayat.map((r) => `<div class="item"><div>${esc(JENIS[r.jenis] || r.jenis)}${r.anak ? ' · ' + esc(r.anak) : ''}<div class="s">${esc(tgl(String(r.dibuat).slice(0, 10)))}${r.hasil ? ' · ' + esc(r.hasil) : ''}</div></div><div class="r">${chip(r.status === 'selesai' ? 'lunas' : r.status === 'ditolak' ? 'belum' : 'sebagian', STATUS_MINTA[r.status] || r.status)}</div></div>`).join('')}</div>` : ''}
    <div class="actions"><button type="button" class="btn" id="dpTutup">Tutup</button><button class="btn primary">Kirim permintaan</button></div>`;
  const sinkron = () => { $('#lAnak').classList.toggle('hidden', f.jenis.value === 'hapus_akun'); };
  f.jenis.onchange = sinkron; sinkron();
  $('#dpTutup').onclick = () => dlg.close(); dlg.oncancel = null;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    if (d.jenis === 'hapus_akun' && !confirm('Akun Anda akan dihapus oleh sekolah dan Anda tidak dapat masuk lagi. Lanjutkan?')) return;
    try { await api('wali/permintaan', { method: 'POST', body: d }); dlg.close(); toast('Permintaan terkirim. Petugas akan menjawabnya.'); } catch (err) { $('#dpErr').textContent = err.message; }
  };
  dlg.showModal();
}

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
    return `${install}<div class="card hero"><img class="hero-logo" src="${logoUrl(s.lembaga_kode)}" alt=""><div class="t"><b>${esc(s.nama)}</b><div>${esc(s.lembaga_nama)}</div><div>Kelas ${esc(s.kelas_nama || '-')} · NIS ${esc(s.nis || '-')}</div>
      <div>Wali kelas: ${esc(s.wali_kelas || '-')}</div>${s.status !== 'aktif' ? '<div>' + chip('belum', 'Status: ' + s.status) + '</div>' : ''}</div></div>
      <div class="tiles"><div class="tile"><div class="n">${ab.h}<span class="small muted"> / ${absTotal(ab)}</span></div><div class="l">Hadir bulan ini</div></div>
      <div class="tile"><div class="n">${rata}</div><div class="l">Rata-rata nilai</div></div>
      <div class="tile" style="grid-column:1/-1"><div class="n" style="color:${sisa ? 'var(--bad)' : 'var(--ok)'}">${sisa ? rp(sisa) : 'Lunas ✓'}</div><div class="l">${sisa ? `Tagihan belum dibayar (${due.length})` : 'Tidak ada tagihan tertunggak'}</div></div></div>
      ${data.pelanggaran && data.pelanggaran.total_poin > 0 ? `<div class="tile" style="margin-bottom:12px"><div class="n" style="color:${data.pelanggaran.total_poin >= 50 ? 'var(--bad)' : 'var(--warn)'}">${data.pelanggaran.total_poin} poin</div><div class="l">Catatan kedisiplinan (lihat di tab Absensi)</div></div>` : ''}
      ${news.length ? `<div class="card news"><h3>Info terbaru</h3><h4>${esc(news[0].judul)}</h4><div class="small muted">${tgl(news[0].tanggal)} · ${esc(news[0].lembaga)}</div><p>${esc(news[0].isi)}</p></div>` : ''}`;
  },
  nilai() {
    const n = data.nilai;
    const kartuRapor = `<div class="card"><h3>Rapor</h3><div class="actions" style="display:flex;gap:8px"><select id="rSem" style="flex:1"><option value="">Semua semester</option><option>Ganjil</option><option>Genap</option></select>
      <button class="btn" id="rLihat">Lihat</button><button class="btn" id="rPdf">PDF</button></div><div id="rOut"></div></div>`;
    if (!n.rata.length) return kartuRapor + '<div class="empty">Belum ada nilai.</div>';
    return kartuRapor + `<div class="card"><h3>Rata-rata per mata pelajaran</h3>${n.rata.map((r) => `<div style="margin:10px 0"><div class="item" style="border:0;padding:0"><span>${esc(r.mapel)}</span><b>${r.rata}</b></div><div class="bar"><i style="width:${Math.min(100, r.rata)}%"></i></div></div>`).join('')}</div>
      <div class="card"><h3>Nilai terbaru</h3>${n.daftar.slice(0, 40).map((x) => `<div class="item"><div>${esc(x.mapel)}<div class="s">${esc(x.jenis || '')} · ${tgl(x.tanggal)} ${x.semester ? '· ' + esc(x.semester) : ''}</div></div><div class="r"><b>${x.nilai}</b></div></div>`).join('')}</div>`;
  },
  absensi() {
    const a = data.absensi, b = a.bulan_ini, all = a.semua;
    return `<div class="tiles">${[['H', b.h], ['S', b.s], ['I', b.i], ['A', b.a]].map(([k, v]) => `<div class="tile"><div class="n">${v}</div><div class="l">${ABSEN[k]} · ${esc(bln(a.bulan))}</div></div>`).join('')}</div>
      <div class="card"><h3>Keseluruhan</h3><div class="small">Hadir ${all.h} · Sakit ${all.s} · Izin ${all.i} · Alpa ${all.a}</div></div>
      ${data.pelanggaran && data.pelanggaran.daftar.length ? `<div class="card"><h3>Catatan kedisiplinan · ${data.pelanggaran.total_poin} poin</h3>${data.pelanggaran.daftar.map((x) => `<div class="item"><div>${esc(x.jenis_nama)}<div class="s">${tgl(x.tanggal)}${x.keterangan ? ' · ' + esc(x.keterangan) : ''}</div></div><div class="r"><b>+${x.poin}</b></div></div>`).join('')}</div>` : ''}
      <div class="card"><h3>14 hari terakhir tercatat</h3>${a.terbaru.length ? `<div class="days">${a.terbaru.map((x) => chip(x.status, tgl(x.tanggal).replace(/ \d{4}$/, '') + ' ' + ABSEN[x.status])).join('')}</div>` : '<div class="empty">Belum ada data.</div>'}</div>`;
  },
  tagihan() {
    const t = data.tagihan, p = data.pembayaran;
    return `<div class="card"><h3>Tagihan</h3>${t.length ? t.map((x) => `<div class="item"><div>${esc(x.jenis)} ${esc(bln(x.periode))}<div class="s">${x.jatuh_tempo ? 'Jatuh tempo ' + tgl(x.jatuh_tempo) : ''}${x.keterangan ? ' · ' + esc(x.keterangan) : ''}</div><div style="margin-top:4px">${tagihanChip(x)}</div></div>
      <div class="r"><b>${rp(x.jumlah)}</b>${x.status === 'sebagian' ? `<div class="s">sisa ${rp(x.sisa)}</div>` : ''}</div></div>`).join('') : '<div class="empty">Belum ada tagihan.</div>'}</div>
      <div class="card"><h3>Riwayat pembayaran</h3>${p.length ? p.map((x) => `<div class="item"><div>${esc(x.jenis)} ${esc(bln(x.bulan))}<div class="s">${tgl(x.tanggal)}${x.keterangan ? ' · ' + esc(x.keterangan) : ''}</div></div><div class="r"><b>${rp(x.jumlah)}</b></div></div>`).join('') : '<div class="empty">Belum ada pembayaran.</div>'}</div>
      <p class="muted small">Pembayaran dilakukan di tata usaha lembaga. Status tagihan diperbarui setelah petugas mencatat pembayaran.</p>`;
  },
  jadwal() {
    const j = data.jadwal || [];
    if (!j.length) return '<div class="empty">Jadwal pelajaran belum tersedia.</div>';
    const hariIni = ((new Date().getDay() + 6) % 7) + 1;
    const NAMA = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', "Jum'at", 'Sabtu', 'Ahad'];
    return [...new Set(j.map((x) => x.hari))].sort((a, b) => a - b).map((h) => `<div class="card"><h3>${NAMA[h]}${h === hariIni ? ' ' + chip('lunas', 'Hari ini') : ''}</h3>${j.filter((x) => x.hari === h).map((x) =>
      `<div class="item"><div>${esc(x.judul)}${x.guru ? `<div class="s">${esc(x.guru)}</div>` : ''}</div><div class="r"><span class="small">${esc(x.mulai.replace(':', '.'))} - ${esc(x.selesai.replace(':', '.'))}</span></div></div>`).join('')}</div>`).join('');
  },
  berita() {
    return news.length ? news.map((x) => `<div class="card news"><h4>${esc(x.judul)}</h4><div class="small muted">${tgl(x.tanggal)} · ${esc(x.lembaga)}</div><p>${esc(x.isi)}</p></div>`).join('') : '<div class="empty">Belum ada pengumuman.</div>';
  },
};

function raporHtml(d) {
  const row = (m, i) => `<div class="item"><div>${i}. ${esc(m.mapel)}<div class="s">KKM ${m.kkm ?? '-'} · rata kelas ${m.kelas_rata ?? '-'}${m.catatan ? ' · ' + esc(m.catatan) : ''}</div></div><div class="r"><b>${m.rata ?? '-'}</b><div class="s">${esc(m.huruf || '')}</div></div></div>`;
  if (d.format === 'madin') {
    const m = d.madin; let n = 0;
    return `<div class="small muted" style="margin:8px 0">${esc(d.siswa.lembaga_nama)} · ${d.semester ? 'Semester ' + esc(d.semester) : 'Semua semester'} · ${esc(m.tahun_ajaran)}</div>
      ${m.pokok.map((x) => row(x, ++n)).join('')}${m.kecakapan.length ? '<b class="small">Kecakapan</b>' + m.kecakapan.map((x) => row(x, ++n)).join('') : ''}
      <div class="item"><div><b>Rata-rata</b></div><div class="r"><b>${m.rata ?? '-'}</b></div></div>
      <b class="small">Kepribadian</b>${m.sikap.map((x, i) => `<div class="item"><div class="s" style="color:inherit">${i + 1}. ${esc(x.teks)}</div><div class="r"><b>${esc(x.nilai || '-')}</b></div></div>`).join('')}
      <div class="small" style="margin-top:8px">Tidak hadir: sakit ${esc(m.ketidakhadiran.sakit)}, izin ${esc(m.ketidakhadiran.izin)}, tanpa keterangan ${esc(m.ketidakhadiran.alpa)} hari</div>`;
  }
  return `<div class="small muted" style="margin:8px 0">${d.semester ? 'Semester ' + esc(d.semester) : 'Semua semester'}</div>${d.nilai.map((x, i) => `<div class="item"><div>${i + 1}. ${esc(x.mapel)}</div><div class="r"><b>${x.rata}</b></div></div>`).join('') || '<div class="empty">Belum ada nilai.</div>'}
    <div class="small" style="margin-top:8px">Kehadiran: hadir ${d.absensi.h || 0}, sakit ${d.absensi.s || 0}, izin ${d.absensi.i || 0}, alpa ${d.absensi.a || 0}</div>`;
}

function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
  if (!anak.length) { $('#view').innerHTML = tab === 'berita' ? views.berita() : '<div class="empty">Belum ada data anak yang tertaut ke akun ini. Hubungi tata usaha.</div>'; return; }
  $('#view').innerHTML = data ? views[tab]() : '<div class="empty">Memuat…</div>';
  if ($('#rLihat')) {
    $('#rLihat').onclick = async () => {
      try { $('#rOut').innerHTML = raporHtml(await api(`wali/anak/${cur}/rapor?semester=${encodeURIComponent($('#rSem').value)}`)); } catch (e) { toast(e.message, true); }
    };
    $('#rPdf').onclick = async () => {
      try {
        const r = await fetch(`/api/wali/anak/${cur}/rapor-pdf?semester=${encodeURIComponent($('#rSem').value)}`);
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Gagal mengunduh');
        const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `rapor-${cur}.pdf`; a.click(); URL.revokeObjectURL(a.href);
      } catch (e) { toast(e.message, true); }
    };
  }
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
    show('login'); $('#loginErr').textContent = (me.role === 'siswa' ? 'Ini akun siswa. Gunakan aplikasi Belajar di alamat /siswa.' : 'Akun ini adalah akun petugas. Gunakan halaman petugas.'); return;
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
  $('#dlgForm').innerHTML = `<h3>${esc(me.nama)}</h3><button type="button" class="btn" id="mData">Data &amp; privasi</button><button type="button" class="btn" id="mPw">Ganti password</button><button type="button" class="btn" id="mOut">Keluar</button><button type="button" class="btn" id="mClose">Tutup</button>`;
  $('#dlgForm').onsubmit = null; $('#dlg').oncancel = null;
  $('#mClose').onclick = () => $('#dlg').close();
  $('#mPw').onclick = () => { $('#dlg').close(); changePassword(false); };
  $('#mData').onclick = () => { $('#dlg').close(); dataPrivasi(); };
  $('#mOut').onclick = async () => { await api('logout', { method: 'POST' }).catch(() => {}); $('#dlg').close(); try { localStorage.removeItem('anak'); } catch {} show('login'); };
  $('#dlg').showModal();
};
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (data && tab === 'beranda') render(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
start();
