'use strict';
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const waktu = (s) => { const [d, j] = String(s).split('T'); const t = new Date(d + 'T00:00:00'); return `${t.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })} ${j}`; };
const KODE = ['A', 'B', 'C', 'D', 'E', 'F'];
let me = null, profil = null, ujian = [], materi = [], nilai = [], tab = 'beranda', offset = 0;

async function api(path, opt = {}) {
  let r;
  try { r = await fetch('/api/' + path, { method: opt.method || 'GET', headers: opt.body ? { 'Content-Type': 'application/json' } : {}, body: opt.body ? JSON.stringify(opt.body) : undefined }); }
  catch { throw new Error('Tidak ada koneksi internet'); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'login') { show('login'); throw new Error(d.error || 'Sesi berakhir'); }
  if (!r.ok) throw Object.assign(new Error(d.error || 'Terjadi kesalahan'), { status: r.status });
  return d;
}
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3500);
}
function show(which) { ['boot', 'login', 'app'].forEach((id) => $('#' + id).classList.toggle('hidden', id !== which)); }

function dialog(title, bodyHtml, { submit = 'Simpan', cancel = true } = {}, onSubmit) {
  const dlg = $('#dlg'), f = $('#dlgForm');
  f.innerHTML = `<h3>${esc(title)}</h3>${bodyHtml}<p class="error" id="dErr"></p><div class="actions">${cancel ? '<button type="button" class="btn" id="dNo">Batal</button>' : ''}<button class="btn primary">${esc(submit)}</button></div>`;
  if (cancel) $('#dNo').onclick = () => dlg.close();
  dlg.oncancel = cancel ? null : (e) => e.preventDefault();
  f.onsubmit = async (e) => { e.preventDefault(); try { await onSubmit(Object.fromEntries(new FormData(f)), dlg); } catch (err) { $('#dErr').textContent = err.message; } };
  dlg.showModal();
}
function changePassword(forced) {
  dialog(forced ? 'Buat password baru' : 'Ganti password',
    `${forced ? '<p class="muted small">Demi keamanan, ganti password dari guru dengan password buatanmu sendiri (minimal 8 karakter).</p>' : ''}
     <label>Password lama<input name="lama" type="password" autocomplete="current-password" required></label>
     <label>Password baru<input name="baru" type="password" autocomplete="new-password" minlength="8" required></label>`,
    { cancel: !forced }, async (d, dlg) => { await api('password', { method: 'POST', body: d }); dlg.close(); toast('Password diganti'); if (forced) await muat(); });
}

// ---------- tampilan ----------
const statusChip = (u) => ({ buka: '<span class="chip buka">Dibuka</span>', berjalan: '<span class="chip berjalan">Sedang dikerjakan</span>', belum: '<span class="chip">Belum dibuka</span>', terlewat: '<span class="chip terlewat">Terlewat</span>', selesai: '<span class="chip">Selesai</span>' }[u.status]);
const JENIS = { harian: 'Ulangan Harian', uts: 'UTS', semester: 'Ujian Semester' };
const kartuUjian = (u) => {
  const aksi = u.status === 'buka' ? `<button class="btn primary" data-mulai="${u.id}">Mulai</button>` : u.status === 'berjalan' ? `<button class="btn primary" data-mulai="${u.id}">Lanjutkan</button>`
    : u.status === 'selesai' ? `<button class="btn" data-hasil="${u.id}">Lihat hasil</button>` : '';
  return `<div class="item"><div><b>${esc(u.judul)}</b><div class="s">${esc(u.mapel)} · ${esc(JENIS[u.jenis] || u.jenis)} · ${u.jumlah_soal} soal · ${u.durasi} menit</div>
    <div class="s">${u.status === 'belum' ? 'Dibuka ' + waktu(u.mulai) : 'Sampai ' + waktu(u.selesai)} WIB</div><div style="margin-top:4px">${statusChip(u)}${u.nilai !== null ? ` <span class="chip">Nilai ${u.nilai}</span>` : u.menunggu_nilai ? ' <span class="chip">Menunggu penilaian guru</span>' : ''}</div></div>
    <div class="r">${aksi}</div></div>`;
};
const ikonBerkas = (e) => ({ pdf: '📕', doc: '📘', docx: '📘', ppt: '📙', pptx: '📙', xls: '📗', xlsx: '📗', mp3: '🎧', mp4: '🎬' }[e] || (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(e) ? '🖼' : '📎'));
const ukuran = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const kartuMateri = (m) => `<div class="card"><h3>${esc(m.judul)}</h3><div class="small muted">${esc(m.mapel || 'Umum')} · ${esc(String(m.dibuat).slice(0, 10))}</div>
  ${m.isi ? `<p class="materi-isi">${esc(m.isi)}</p>` : ''}${m.tautan ? `<p><a href="${esc(m.tautan)}" target="_blank" rel="noopener noreferrer">Buka tautan materi ↗</a></p>` : ''}
  ${(m.berkas || []).map((b) => `<div class="item"><div><a href="/api/berkas/${b.id}" target="_blank" rel="noopener">${ikonBerkas(b.ext)} ${esc(b.nama)}</a><div class="s">${ukuran(b.ukuran)}</div></div></div>`).join('')}</div>`;

const views = {
  beranda() {
    const aktif = ujian.filter((u) => u.status === 'buka' || u.status === 'berjalan'), akan = ujian.filter((u) => u.status === 'belum').slice(0, 3);
    const rata = nilai.filter((n) => n.nilai !== null);
    return `<div class="card hello"><h2>Assalamu'alaikum, ${esc(profil.nama.split(' ')[0])}!</h2><div>Semangat belajar hari ini 📖</div></div>
      <div class="tiles"><div class="tile"><div class="n">${aktif.length}</div><div class="l">Ujian dibuka</div></div><div class="tile"><div class="n">${rata.length ? Math.round(rata.reduce((a, n) => a + n.nilai, 0) / rata.length * 10) / 10 : '-'}</div><div class="l">Rata-rata nilai ujian</div></div></div>
      <div class="card"><h3>Ujian untukmu</h3>${aktif.length ? aktif.map(kartuUjian).join('') : '<div class="empty">Tidak ada ujian yang sedang dibuka.</div>'}</div>
      ${akan.length ? `<div class="card"><h3>Akan datang</h3>${akan.map(kartuUjian).join('')}</div>` : ''}
      ${materi.length ? `<div class="card"><h3>Materi terbaru</h3>${materi.slice(0, 3).map((m) => `<div class="item"><div><b>${esc(m.judul)}</b><div class="s">${esc(m.mapel || 'Umum')}</div></div></div>`).join('')}</div>` : ''}`;
  },
  materi() { return materi.length ? materi.map(kartuMateri).join('') : '<div class="empty">Belum ada materi dari guru.</div>'; },
  ujian() { return ujian.length ? `<div class="card">${ujian.map(kartuUjian).join('')}</div>` : '<div class="empty">Belum ada ujian.</div>'; },
  nilai() {
    return nilai.length ? `<div class="card"><h3>Hasil ujian</h3>${nilai.map((n) => `<div class="item"><div><b>${esc(n.judul)}</b><div class="s">${esc(n.mapel)} · ${esc(JENIS[n.jenis] || n.jenis)}</div></div><div class="r"><b style="font-size:20px">${n.nilai ?? '…'}</b>${n.nilai === null ? '<div class="s">menunggu guru</div>' : ''}</div></div>`).join('')}</div>`
      : '<div class="empty">Belum ada hasil ujian yang ditampilkan.</div>';
  },
};
function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
  $('#view').innerHTML = views[tab]();
}
$('#view').onclick = (e) => {
  const m = e.target.closest('[data-mulai]'), h = e.target.closest('[data-hasil]');
  if (m) mulaiUjian(Number(m.dataset.mulai));
  if (h) lihatHasil(Number(h.dataset.hasil));
};

// ---------- pengerjaan ujian ----------
let S = null;   // sesi ujian aktif
const sisa = () => S.batas - (Date.now() + offset);
const fmt = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)), j = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), d = t % 60; return (j ? j + ':' : '') + String(m).padStart(2, '0') + ':' + String(d).padStart(2, '0'); };
async function mulaiUjian(id) {
  const u = ujian.find((x) => x.id === id);
  if (u && u.status === 'buka' && !confirm(`Mulai "${u.judul}"?\n\nWaktu ${u.durasi} menit langsung berjalan dan tidak bisa diulang. Jangan menutup atau berpindah aplikasi selama ujian.`)) return;
  try {
    const r = await api(`belajar/ujian/${id}/mulai`, { method: 'POST' });
    offset = r.sekarang - Date.now();
    S = { ...r, id, i: 0, jawab: r.jawaban, pindah: 0, tulis: null, selesai: false };
    $('#exam').classList.remove('hidden'); document.body.style.overflow = 'hidden';
    S.timer = setInterval(tick, 500);
    soalKe(0);
  } catch (e) { toast(e.message, true); await muat(); }
}
function tick() {
  if (!S) return;
  const t = $('#timer'); if (!t) return;
  t.textContent = fmt(sisa()); t.classList.toggle('low', sisa() < 60000);
  if (sisa() <= 0 && !S.selesai) kumpul(true);
}
function soalKe(i) {
  S.i = i;
  const s = S.soal[i], j = S.jawab[s.id];
  const nav = S.soal.map((x, k) => `<button data-k="${k}" class="${S.jawab[x.id] !== undefined ? 'done' : ''} ${k === i ? 'now' : ''}">${k + 1}</button>`).join('');
  $('#exam').innerHTML = `<div class="ex-top"><b>${esc(S.ujian.judul)}<br><span class="small" style="font-weight:400">${esc(S.ujian.mapel)}</span></b><span class="timer" id="timer">${fmt(sisa())}</span></div>
    <div class="ex-body">${i === 0 && S.ujian.petunjuk ? `<div class="card small" style="white-space:pre-wrap">${esc(S.ujian.petunjuk)}</div>` : ''}
      <div class="small muted">Soal ${i + 1} dari ${S.soal.length} · bobot ${s.bobot}</div><div class="q">${esc(s.teks)}</div>${s.gambar ? `<img src="${esc(s.gambar)}" alt="Gambar soal" class="soal-img">` : ''}
      ${s.tipe === 'pg' ? s.opsi.map((o, k) => `<button class="opt ${j === o.i ? 'on' : ''}" data-o="${o.i}"><b>${KODE[k]}</b><span>${esc(o.t)}</span></button>`).join('')
        : `<textarea id="uraian" placeholder="Tulis jawabanmu di sini…" maxlength="5000">${esc(j ?? '')}</textarea>`}
      <div class="saved" id="saved"></div><div class="grid">${nav}</div></div>
    <div class="ex-nav"><button class="btn" id="prev" ${i === 0 ? 'disabled' : ''}>← Sebelumnya</button>${i < S.soal.length - 1 ? '<button class="btn primary" id="next">Berikutnya →</button>' : '<button class="btn primary" id="kumpul">Kumpulkan</button>'}</div>`;
  $('#exam').onclick = (e) => {
    const o = e.target.closest('[data-o]'), k = e.target.closest('[data-k]');
    if (o) { const v = Number(o.dataset.o); simpan(s, S.jawab[s.id] === v ? null : v); }
    if (k) { flushUraian(); soalKe(Number(k.dataset.k)); }
  };
  if ($('#prev')) $('#prev').onclick = () => { flushUraian(); soalKe(i - 1); };
  if ($('#next')) $('#next').onclick = () => { flushUraian(); soalKe(i + 1); };
  if ($('#kumpul')) $('#kumpul').onclick = () => { flushUraian(); kumpul(false); };
  const ta = $('#uraian');
  if (ta) { ta.oninput = () => { clearTimeout(S.tulis); S.tulis = setTimeout(() => simpan(s, ta.value, true), 900); }; ta.onblur = () => flushUraian(); }
}
function flushUraian() {
  const ta = $('#uraian'); if (!ta || !S) return;
  clearTimeout(S.tulis);
  const s = S.soal[S.i];
  if ((S.jawab[s.id] ?? '') !== ta.value) simpan(s, ta.value, true);
}
async function simpan(s, v, diam) {
  if (!S || S.selesai) return;
  const kosong = v === null || (typeof v === 'string' && !v.trim());
  if (kosong) delete S.jawab[s.id]; else S.jawab[s.id] = v;
  if (!diam) soalKe(S.i);
  const pindah = S.pindah; S.pindah = 0;
  const lbl = $('#saved'); if (lbl) lbl.textContent = 'Menyimpan…';
  try {
    await api(`belajar/ujian/${S.id}/jawab`, { method: 'POST', body: { soal_id: s.id, jawaban: kosong ? null : v, pindah } });
    const l2 = $('#saved'); if (l2) l2.textContent = 'Tersimpan ✓';
  } catch (e) {
    S.pindah += pindah;
    if (e.status === 409) { await selesaiOtomatis(); return; }
    const l2 = $('#saved'); if (l2) l2.textContent = 'Gagal menyimpan, coba lagi: ' + e.message;
  }
}
async function kumpul(otomatis) {
  if (!S || S.selesai) return;
  if (!otomatis) {
    const kosong = S.soal.filter((s) => S.jawab[s.id] === undefined).length;
    if (!confirm(kosong ? `Masih ada ${kosong} soal yang belum dijawab. Kumpulkan sekarang?` : 'Kumpulkan jawaban sekarang?')) return;
  }
  S.selesai = true; clearInterval(S.timer);
  try { tampilHasil(await api(`belajar/ujian/${S.id}/kumpul`, { method: 'POST' }), otomatis); }
  catch (e) { S.selesai = false; S.timer = setInterval(tick, 500); toast(e.message, true); }
}
async function selesaiOtomatis() {
  S.selesai = true; clearInterval(S.timer);
  try { tampilHasil(await api(`belajar/ujian/${S.id}/kumpul`, { method: 'POST' }), true); } catch { tutupUjian(); }
}
function tampilHasil(h, otomatis) {
  S = null;
  $('#exam').classList.remove('hidden'); document.body.style.overflow = 'hidden';
  $('#exam').innerHTML = `<div class="ex-top"><b>${esc(h.judul)}</b></div><div class="ex-body" style="text-align:center">
    ${otomatis ? '<p class="muted">Waktu habis, jawabanmu dikumpulkan otomatis.</p>' : ''}<h2>Ujian selesai 🎉</h2>
    ${h.menunggu_nilai ? '<p>Jawabanmu sudah diterima. Nilai akan muncul setelah guru memeriksa soal uraian.</p>' : h.tampil_nilai ? `<div class="score">${h.nilai}</div><p>Benar ${h.benar} dari ${h.total_pg} soal pilihan ganda</p>` : '<p>Jawabanmu sudah diterima. Guru akan membagikan nilai.</p>'}
    <p class="muted small">Dijawab ${h.dijawab} dari ${h.total_soal} soal.</p><button class="btn primary block" id="tutup">Kembali</button></div>`;
  $('#tutup').onclick = tutupUjian;
}
async function tutupUjian() { $('#exam').classList.add('hidden'); $('#exam').innerHTML = ''; document.body.style.overflow = ''; S = null; await muat(); }
async function lihatHasil(id) { try { tampilHasil(await api(`belajar/ujian/${id}/hasil`), false); } catch (e) { toast(e.message, true); } }

// berpindah aplikasi/tab saat ujian dicatat dan ditegur
document.addEventListener('visibilitychange', () => { if (S && !S.selesai && document.hidden) S.pindah++; else if (S && !S.selesai && S.pindah) toast('Jangan berpindah aplikasi saat ujian. Guru dapat melihat catatan ini.', true); });
window.addEventListener('beforeunload', (e) => { if (S && !S.selesai) { e.preventDefault(); e.returnValue = ''; } });

// ---------- mulai ----------
async function muat() {
  const [p, u, m, n] = await Promise.all([api('belajar/profil'), api('belajar/ujian'), api('belajar/materi'), api('belajar/nilai')]);
  profil = p.siswa; offset = p.sekarang - Date.now(); ujian = u.ujian; materi = m; nilai = n;
  $('#who').textContent = profil.nama; $('#kelasInfo').textContent = `${profil.lembaga_nama}${profil.kelas_nama ? ' · Kelas ' + profil.kelas_nama : ''}`;
  render();
}
async function start() {
  try { me = await api('me'); } catch { show('login'); return; }
  if (me.role !== 'siswa') {
    await api('logout', { method: 'POST' }).catch(() => {});
    show('login'); $('#loginErr').textContent = me.role === 'wali' ? 'Ini akun wali murid. Gunakan aplikasi Wali Murid.' : 'Akun ini bukan akun siswa.'; return;
  }
  show('app');
  if (me.must_change) { changePassword(true); return; }
  try { await muat(); } catch (e) { toast(e.message, true); }
}
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault(); $('#loginErr').textContent = '';
  try { await api('login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); await start(); }
  catch (err) { $('#loginErr').textContent = err.message; }
};
document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => { tab = b.dataset.t; render(); window.scrollTo(0, 0); }; });
$('#menuBtn').onclick = () => {
  dialog('Menu', `<button type="button" class="btn block" id="mPw">Ganti password</button><button type="button" class="btn block" id="mRef">Muat ulang data</button><button type="button" class="btn block" id="mOut">Keluar</button>
    <p class="muted small">Data belajar hanya bisa dilihat olehmu dan gurumu. <a href="/privasi">Kebijakan Privasi</a></p>`, { submit: 'Tutup' }, async (d, dlg) => dlg.close());
  $('#mPw').onclick = () => { $('#dlg').close(); changePassword(false); };
  $('#mRef').onclick = () => { $('#dlg').close(); muat().then(() => toast('Data diperbarui')).catch((e) => toast(e.message, true)); };
  $('#mOut').onclick = async () => { $('#dlg').close(); await api('logout', { method: 'POST' }).catch(() => {}); show('login'); };
};
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw-siswa.js', { scope: '/siswa' }).catch(() => {});
start();
