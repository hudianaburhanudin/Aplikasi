# Administrasi Yayasan Miftahul Ulumillah

Aplikasi web untuk administrasi seluruh lembaga di bawah Yayasan Miftahul Ulumillah:
Pondok Pesantren, SMK, SMP Plus (Tambakrejo), MI, RA Muslimat, Madin Ula, dan Madin Wustho.
Tanpa dependensi eksternal: Node.js (>= 22.13) + SQLite bawaan Node + frontend HTML/JS.

## Fitur
- **Multi-lembaga**: data tiap lembaga terpisah; pilih lembaga aktif lewat menu di samping
- **Peran**: *Admin Yayasan* (semua lembaga), *Admin Lembaga* (lembaganya + kelola staf), *Staf*
- **Tahun ajaran** dan pengelolaan lembaga (admin yayasan)
- **Pendaftaran online (PPDB)**: orang tua mendaftar lewat `/daftar` dari HP (tanpa login), mendapat nomor
  pendaftaran, dan bisa cek status (nomor + tanggal lahir). Dibuka/ditutup per lembaga; ada penangkal spam
  (batas per IP, kolom jebakan, deteksi ganda). Admin menyeleksi (baru → terverifikasi → diterima/cadangan/ditolak)
  lalu **Jadikan siswa** dengan satu klik.
- **Kenaikan kelas & kelulusan** massal (atomik), pindah/keluar, **alumni**, dan **riwayat** tiap siswa
- **Siswa, Guru, Kelas**: tambah/ubah/hapus, pencarian, filter (NIS boleh sama antar lembaga)
- **Absensi** harian per kelas + rekap bulanan
- **Nilai** dan **Rapor** per siswa
- **Pembayaran** (SPP dll.) dan kuitansi
- **Ekspor Excel (.xlsx) dan PDF** (daftar, rapor, kuitansi) sesuai filter aktif
- Login, ganti password, reset password oleh admin

## Menjalankan
```bash
npm start            # http://localhost:3000
npm run seed         # (opsional) data contoh di SMP
npm run backup       # backup database ke data/backup/
npm test
```
Saat pertama dijalankan dibuat akun `admin` (Admin Yayasan) dengan **password acak yang dicetak di
konsol** (atau set `ADMIN_PASSWORD` sebelum run pertama). Catat lalu ganti.

Variabel lingkungan: `PORT` (default 3000), `DB_FILE` (default `data/sekolah.db`), `ADMIN_PASSWORD`,
`TRUST_PROXY=1` (wajib bila di belakang reverse proxy agar batas per-IP memakai IP asli pengunjung).

Skema database bermigrasi otomatis (versi tersimpan di `PRAGMA user_version`).

> Data berisi informasi anak: jalankan di belakang HTTPS, batasi akses server, dan jadwalkan
> `npm run backup` (mis. cron harian) dengan salinan di luar server.
> Database versi sebelum multi-lembaga tidak kompatibel; hapus `data/sekolah.db` lama.

## Rencana
1. ✅ Fondasi multi-lembaga, peran, tahun ajaran
2. ✅ Pendaftaran online (PPDB) → seleksi → siswa, kenaikan kelas, kelulusan/alumni
3. Portal wali murid (PWA) + notifikasi, lalu dibungkus untuk Play Store/App Store
4. Deploy VPS (Docker, HTTPS, backup otomatis)
