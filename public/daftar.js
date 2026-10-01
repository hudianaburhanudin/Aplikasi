'use strict';
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LABEL = { baru: 'Pendaftaran diterima, menunggu verifikasi', terverifikasi: 'Berkas terverifikasi, dalam proses seleksi', diterima: 'DITERIMA 🎉 Silakan menunggu informasi daftar ulang dari sekolah',
  cadangan: 'Masuk daftar cadangan', ditolak: 'Mohon maaf, belum dapat diterima', terdaftar: 'Sudah terdaftar sebagai siswa' };

async function post(path, body) {
  const r = await fetch('/api/public/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Terjadi kesalahan, coba lagi');
  return d;
}

fetch('/api/public/lembaga').then((r) => r.json()).then((d) => {
  $('#tahun').textContent = d.tahun_ajaran ? '· Tahun Ajaran ' + d.tahun_ajaran : '';
  const sel = $('[name=lembaga_id]');
  sel.innerHTML = '<option value=""></option>' + d.lembaga.map((l) => `<option value="${l.id}">${esc(l.nama)}</option>`).join('');
  if (!d.lembaga.length) { $('#tutup').classList.remove('hidden'); $('#fields').classList.add('hidden'); $('#kirim').classList.add('hidden'); }
});

$('#form').onsubmit = async (e) => {
  e.preventDefault(); $('#err').textContent = '';
  const btn = $('#kirim'); btn.disabled = true;
  try {
    const d = await post('daftar', Object.fromEntries(new FormData(e.target)));
    const h = $('#hasil');
    h.innerHTML = `<h2>Pendaftaran berhasil ✅</h2><div>Nomor pendaftaran:</div><div class="nomor">${esc(d.no_daftar)}</div>
      <div>${esc(d.nama)} · ${esc(d.lembaga)}</div><p>Simpan nomor ini. Gunakan bersama tanggal lahir untuk mengecek status pendaftaran.</p>`;
    h.classList.remove('hidden'); e.target.reset(); window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) { $('#err').textContent = err.message; }
  btn.disabled = false;
};

$('#cek').onsubmit = async (e) => {
  e.preventDefault(); $('#cekErr').textContent = ''; $('#cekHasil').innerHTML = '';
  try {
    const d = await post('status', Object.fromEntries(new FormData(e.target)));
    $('#cekHasil').innerHTML = `<p><b>${esc(d.nama)}</b> · ${esc(d.lembaga)}<br>No. ${esc(d.no_daftar)}<br><span class="badge">${esc(LABEL[d.status] || d.status)}</span></p>`;
  } catch (err) { $('#cekErr').textContent = err.message; }
};
