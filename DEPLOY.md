# Panduan Deploy ke VPS

Hasil akhir: aplikasi berjalan di `https://DOMAIN-ANDA` dengan sertifikat HTTPS otomatis, database tersimpan
di server, dan backup harian otomatis. Perkiraan waktu: 30-60 menit.

## 0. Yang perlu disiapkan
- **VPS** Linux (Ubuntu 24.04 LTS disarankan). 1 vCPU, 1-2 GB RAM, 20 GB disk sudah cukup untuk beberapa ribu siswa.
  Pilih lokasi dekat (Singapura/Jakarta). Biaya umumnya puluhan ribu rupiah per bulan; bandingkan penyedia saat memesan.
- **Domain** (mis. `sekolah.namadomain.id`) dan akses ke pengaturan DNS-nya.
- Akun GitHub yang dapat mengakses repo ini.

## 1. Arahkan domain ke server
Di pengaturan DNS buat **A record**: `sekolah.namadomain.id` → alamat IP VPS. Tunggu beberapa menit hingga aktif
(`ping sekolah.namadomain.id` menampilkan IP server). Tanpa langkah ini HTTPS tidak bisa terbit.

## 2. Siapkan server
Masuk lewat SSH, lalu:
```bash
# pembaruan dasar + firewall (hanya SSH, HTTP, HTTPS)
sudo apt update && sudo apt -y upgrade
sudo apt -y install ufw git
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable

# Docker (resmi)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # keluar-masuk SSH sekali agar berlaku
```
Keamanan dasar yang sangat dianjurkan: login SSH memakai **kunci** (bukan password), nonaktifkan login root,
dan aktifkan pembaruan keamanan otomatis (`sudo apt -y install unattended-upgrades`).

## 3. Pasang aplikasi
```bash
git clone https://github.com/hudianaburhanudin/Aplikasi.git
cd Aplikasi
git checkout claude/gifted-rubin-tp92nb     # atau branch utama setelah PR digabung
cp .env.example .env
nano .env                                   # isi DOMAIN (dan pengaturan WhatsApp, lihat META-WHATSAPP.md)
docker compose up -d --build
```
Kali pertama berjalan, aplikasi membuat akun **admin** dengan password acak. Ambil dari log:
```bash
docker compose logs app | grep "Akun awal"
```
Buka `https://DOMAIN-ANDA`, masuk, dan **segera ganti password** saat diminta.

## 4. Isi data awal (urutan yang disarankan)
1. Menu **Lembaga** (hanya Admin Yayasan): periksa 7 lembaga, isi **nama kepala**, **NSM**, **NPSN**, jenjang (isi `Madin` untuk
   Madin agar rapor memakai format Madin), dan buka **pendaftaran online** bila perlu.
2. **Tahun Ajaran**: tetapkan yang aktif. **Profil Yayasan**: isi semua kolom bertanda [ISI] untuk Kebijakan Privasi.
3. **Pengguna** (peran berjenjang, hanya Admin Yayasan yang membuat akun ini):
   | Peran | Dibuat untuk | Lembaga |
   |---|---|---|
   | Admin Yayasan | pengurus yayasan (minimal dua orang agar ada cadangan) | semua otomatis |
   | Bendahara Yayasan | bendahara yayasan | semua otomatis |
   | Admin Lembaga | kepala/tata usaha tiap lembaga | pilih lembaganya |
   | Bendahara Lembaga | bendahara tiap lembaga (bila ada) | pilih lembaganya |
   Admin Lembaga kemudian membuat sendiri akun **staf** dan **guru** (isi No. WhatsApp guru) untuk lembaganya.
4. **Siswa**: pakai tombol **Impor Excel** (berkas By Name By Address / Dapodik), lalu **Kelas**, **Guru**. Periksa pratinjau
   sebelum menyimpan; perbaiki NIS ganda di Excel bila dilaporkan.
5. **Mapel Rapor** (KKM per mapel, khusus Madin), **Jadwal** (menu *Impor massal*; contoh CSV ada di `data/jadwal/`).
6. **Akun wali** (menu Siswa → Akun wali) dan **Akun Siswa** (menu Akun Siswa, per kelas; unduh PDF-nya untuk dibagikan).
7. Sesuaikan **Jenis Pelanggaran & poin** per lembaga.

Alamat untuk dibagikan: petugas `https://DOMAIN-ANDA/`, wali murid `https://DOMAIN-ANDA/wali`, siswa `https://DOMAIN-ANDA/siswa`,
pendaftaran `https://DOMAIN-ANDA/daftar`, kebijakan privasi `https://DOMAIN-ANDA/privasi`. Ketiganya dapat dipasang di layar utama
HP ("Tambahkan ke Layar Utama") tanpa toko aplikasi.

## 5. Memperbarui aplikasi
```bash
cd Aplikasi
git pull
docker compose up -d --build
```
Database tidak tersentuh; skema menyesuaikan otomatis. Backup otomatis sudah berjalan, tetapi bila ada perubahan besar
buat backup manual dulu: `docker compose exec app node backup.js`.

## 6. Backup dan pemulihan
- **Otomatis**: tiap 24 jam (dan saat aplikasi dinyalakan bila backup terakhir lebih tua), disimpan 14 salinan terakhir di
  volume `data` (`/data/backup`). Atur dengan `BACKUP_EVERY_HOURS` dan `BACKUP_KEEP` di `.env`.
- **Penting: salin keluar server.** Backup yang berada di server yang sama ikut hilang bila server rusak. Contoh menarik
  salinan ke komputer/penyimpanan lain tiap hari (jalankan dari komputer Anda atau dari server lain):
  ```bash
  # lokasi volume di server:  docker volume inspect aplikasi_data   (cari "Mountpoint")
  rsync -av USER@IP-SERVER:/var/lib/docker/volumes/aplikasi_data/_data/backup/ ./backup-sekolah/
  ```
  **Otomatis ke cloud (disarankan)**: image Docker sudah memuat `rclone`. Di server jalankan sekali `docker compose run --rm app rclone config`
  (konfigurasi tersimpan di volume `data`; untuk Google Drive pilih "headless" dan jalankan `rclone authorize "drive"` di komputer Anda, lalu tempel tokennya), buat remote bernama mis. `gdrive`, lalu isi `BACKUP_RCLONE_REMOTE=gdrive:backup-sekolah`
  di `.env` dan `docker compose up -d`. Tiap backup baru otomatis disalin ke sana; cek `docker compose logs app` untuk
  "Backup disalin ke". Berkas materi pelajaran yang diunggah (folder `/data/berkas`) ikut disalin ke `REMOTE/berkas`; tanpa rclone, salin sendiri folder itu bersama backup database. Data berisi informasi anak: pakai akun penyimpanan khusus yayasan dengan akses terbatas.
- **Memulihkan**:
  ```bash
  docker compose stop app
  docker compose run --rm --no-deps -v $(pwd)/backup-sekolah:/pulih app sh -c "cp /pulih/sekolah-XXXXXXXX-XXXXXX.db /data/sekolah.db"
  docker compose start app
  ```
  Latih langkah ini sekali sebelum benar-benar dipakai.

## 7. Pemantauan
- `docker compose ps` menunjukkan status; `docker compose logs -f app` untuk log.
- Alamat `https://DOMAIN-ANDA/healthz` mengembalikan `{"ok":true}`. Daftarkan di layanan pemantau uptime gratis
  (mis. UptimeRobot) agar Anda diberi tahu bila aplikasi mati.

## 8. Daftar periksa sebelum dibuka ke wali dan guru
- [ ] HTTPS aktif (gembok di browser) dan `http://` otomatis dialihkan.
- [ ] Password admin awal sudah diganti; akun lain memakai password kuat.
- [ ] Backup pertama ada di `/data/backup` **dan** sudah disalin keluar server; pemulihan sudah dilatih.
- [ ] Firewall hanya membuka 22, 80, 443.
- [ ] Kebijakan privasi disiapkan (wajib untuk toko aplikasi dan Meta). Data siswa tidak boleh dibagikan di luar keperluan sekolah.
- [ ] WhatsApp sudah diuji dengan satu pesan nyata (lihat `META-WHATSAPP.md`).
- [ ] Tiap peran sudah dicoba: Admin Lembaga tidak melihat menu keuangan; Bendahara hanya melihat Pembayaran/Tagihan; wali hanya melihat anaknya; siswa hanya melihat materi dan ujian.
- [ ] Satu ujian percobaan dikerjakan dari HP siswa sungguhan (Wi-Fi sekolah) sebelum dipakai untuk UTS/UAS.

## 9. Rencana uji coba (disarankan)
1. **Minggu 1-2**: satu lembaga saja (mis. MI): siswa, absensi harian, tagihan, aplikasi wali. Kumpulkan keluhan petugas.
2. **Minggu 3-4**: tambahkan ujian harian dengan satu kelas; periksa nilai masuk ke rapor.
3. Baru kemudian lembaga lain, WhatsApp (Meta), dan terakhir pembungkus Play Store/App Store.
Siapkan satu orang di yayasan yang memegang akun Admin Yayasan cadangan dan tahu cara memulihkan backup.
