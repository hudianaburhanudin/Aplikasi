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
- **Portal wali murid (PWA)** di `/wali`: dipasang di layar utama HP; wali melihat nilai, absensi, tagihan,
  riwayat pembayaran, dan pengumuman anaknya (satu akun bisa untuk beberapa anak lintas lembaga). Petugas membuat
  akun dari daftar siswa (**Akun wali**): password sementara acak tampil sekali + tombol kirim WhatsApp;
  wali wajib mengganti password saat pertama masuk. Wali hanya bisa membaca data anaknya sendiri.
- **Tagihan** (buat massal per kelas; status lunas/sebagian/belum otomatis dari pembayaran) dan **Pengumuman**
- **Absensi & pelanggaran lewat WhatsApp**: petugas/guru cukup mengirim pesan ke satu nomor sekolah.
  `absen 7A andin sakit, budi izin demam` (semua siswa otomatis hadir kecuali yang disebut),
  `langgar andin terlambat`, `rekap 7A`, `poin andin`, `batal`, `bantuan`. Hanya nomor yang terdaftar
  (kolom No. WhatsApp di Pengguna) yang diproses, dibatasi pada lembaga pengirim; semua-atau-tidak-sama-sekali
  bila ada nama yang tidak dikenali; bisa dibatalkan. Menu **WhatsApp** menyediakan simulator chat dan riwayat pesan.
- **Pelanggaran siswa**: jenis & poin per lembaga (bisa diubah admin), peringatan pada 50 dan 100 poin,
  tampil di aplikasi wali. Peran **Guru** hanya mengakses absensi dan pelanggaran.
- **Siswa, Guru, Kelas**: tambah/ubah/hapus, pencarian, filter (NIS boleh sama antar lembaga)
- **Absensi** harian per kelas + rekap bulanan
- **Nilai** dan **Rapor** per siswa
- **Pembayaran** (SPP dll.) dan kuitansi
- **Ekspor Excel (.xlsx) dan PDF** (daftar, rapor, kuitansi) sesuai filter aktif
- Login, ganti password, reset password oleh admin

## WhatsApp
Aplikasi menerima pesan lewat webhook `https://DOMAIN/api/wa/webhook` dan membalas lewat penyedia yang dipilih
(`WA_PROVIDER`, lihat `.env.example`). Penyedia resmi **Meta WhatsApp Cloud API** disarankan (stabil, nomor tidak
berisiko diblokir; butuh akun Meta Business dan nomor khusus yang tidak dipakai di aplikasi WhatsApp biasa).
Gateway tidak resmi (Fonnte, WAHA) lebih mudah disiapkan dan dapat berada di grup, tetapi nomor berisiko diblokir.
Webhook diamankan tanda tangan (Meta) atau token (lainnya), menolak pesan ganda dan antrean lama, dan membatasi laju.
Format webhook tiap penyedia perlu diuji dengan akun Anda sendiri saat penyambungan pertama.

## Menjalankan
```bash
npm start            # http://localhost:3000
npm run seed         # (opsional) data contoh di SMP
npm run backup       # backup database ke data/backup/
npm test
```
Saat pertama dijalankan dibuat akun `admin` (Admin Yayasan) dengan **password acak yang dicetak di
konsol** (atau set `ADMIN_PASSWORD` sebelum run pertama). Catat lalu ganti.

Variabel lingkungan (lengkap di `.env.example`): `PORT` (default 3000), `DB_FILE` (default `data/sekolah.db`), `ADMIN_PASSWORD`,
`TRUST_PROXY=1` (wajib bila di belakang reverse proxy agar batas per-IP memakai IP asli pengunjung).

Skema database bermigrasi otomatis (versi tersimpan di `PRAGMA user_version`).

> Data berisi informasi anak: jalankan di belakang HTTPS, batasi akses server, dan jadwalkan
> `npm run backup` (mis. cron harian) dengan salinan di luar server.
> Database versi sebelum multi-lembaga tidak kompatibel; hapus `data/sekolah.db` lama.

## Rencana
1. ✅ Fondasi multi-lembaga, peran, tahun ajaran
2. ✅ Pendaftaran online (PPDB) → seleksi → siswa, kenaikan kelas, kelulusan/alumni
3. ✅ Portal wali murid (PWA). Berikutnya: notifikasi push dan pembungkus toko (lihat `mobile/README.md`)
4. Deploy VPS (Docker, HTTPS, backup otomatis) — wajib sebelum dipakai wali
