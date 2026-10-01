# Aplikasi Administrasi Sekolah

Aplikasi web untuk mengelola administrasi sekolah. Tanpa dependensi eksternal:
Node.js (>= 22.13) + SQLite bawaan Node + frontend HTML/JS biasa.

## Fitur
- **Dashboard**: ringkasan siswa, guru, kelas, absensi hari ini, pembayaran bulan ini
- **Siswa, Guru, Kelas**: tambah/ubah/hapus, pencarian, filter
- **Absensi**: input harian per kelas (Hadir/Sakit/Izin/Alpa) + rekap bulanan
- **Nilai** dan **Rapor** per siswa (rata-rata per mapel, bisa dicetak)
- **Pembayaran**: SPP dan pembayaran lain, total otomatis
- **Pengguna & login**: peran admin/staf, ganti password

## Menjalankan
```bash
npm start            # http://localhost:3000
npm run seed         # (opsional) isi data contoh
npm test             # tes API
```
Login awal: `admin` / `admin123` — **segera ganti** lewat tombol "Ganti password"
(atau set `ADMIN_PASSWORD` sebelum run pertama).

Variabel lingkungan: `PORT` (default 3000), `DB_FILE` (default `data/sekolah.db`).

> Jalankan di belakang HTTPS (reverse proxy) bila diakses lewat internet.
