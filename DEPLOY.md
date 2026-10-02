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
1. Menu **Lembaga**: periksa 7 lembaga, buka **pendaftaran online** untuk yang membutuhkan.
2. **Tahun Ajaran**: tetapkan yang aktif.
3. **Pengguna**: buat Admin Lembaga (satu per lembaga) dan guru (isi **No. WhatsApp**).
4. **Guru**, **Kelas**, **Siswa** (atau lewat PPDB), lalu **Akun wali**.
5. Sesuaikan **Jenis Pelanggaran & poin** per lembaga.

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
  Alternatif: `rclone` ke Google Drive/penyimpanan cloud lain lewat cron. Data berisi informasi anak: simpan salinan
  di tempat yang aman dan terbatas aksesnya.
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
