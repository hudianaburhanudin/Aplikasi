# Menyambungkan WhatsApp (Meta Cloud API)

Hasil akhir: guru mengirim `absen 7A andin sakit` ke **satu nomor WhatsApp sekolah**, aplikasi menyimpan datanya dan
membalas konfirmasi. Alurnya: pesan guru → Meta → aplikasi Anda (`/api/wa/webhook`) → aplikasi membalas lewat Meta.

> Tampilan dashboard Meta sering berubah. Nama menu di bawah adalah panduan; bila berbeda, cari menu yang sepadan atau
> ikuti dokumentasi resmi di `developers.facebook.com/docs/whatsapp/cloud-api`. Aplikasi sudah harus online
> dengan HTTPS (lihat `DEPLOY.md`) sebelum langkah 6.

## Gambaran dan batasan
- Guru **mengirim pesan pribadi** ke nomor bot. Cloud API resmi **tidak** mendukung bot di dalam grup.
- Aplikasi hanya **membalas** pesan guru (dalam jendela 24 jam sejak pesan terakhir mereka). Karena tidak memulai percakapan sendiri,
  tidak perlu membuat *message template*.
- Menurut kebijakan Meta saat ini, membalas dalam jendela layanan tidak dikenai biaya percakapan. Aturan tarif bisa berubah;
  periksa halaman tarif WhatsApp Business Platform sebelum produksi.
- Nomor bot harus nomor yang **tidak sedang dipakai di aplikasi WhatsApp/WhatsApp Business biasa** (atau akunnya dihapus lebih
  dulu) dan bisa menerima SMS/telepon untuk verifikasi. Sebaiknya SIM khusus.

## 1. Akun Meta Business
1. Buka `business.facebook.com`, buat **Business Portfolio** atas nama yayasan (login dengan akun Facebook pengurus).
2. Mulai **Verifikasi Bisnis** (Business Verification / Security Center): biasanya meminta dokumen legal yayasan dan data
   alamat/telepon. Untuk uji coba tahap awal verifikasi belum wajib, tetapi diperlukan untuk produksi.

## 2. Buat aplikasi
1. Buka `developers.facebook.com` → **My Apps** → **Create App** → jenis **Business** → hubungkan ke Business Portfolio tadi.
2. Di dashboard aplikasi, **Add product** → **WhatsApp** → **Set up**.

## 3. Uji dengan nomor tes (gratis, tanpa menunggu verifikasi)
Di **WhatsApp → API Setup** Meta menyediakan nomor tes dan **sementara** token (berlaku ± 24 jam).
- Tambahkan nomor HP guru yang ikut uji sebagai **recipient** (maksimal beberapa nomor, masing-masing diverifikasi kode).
- Catat **Phone number ID** (bukan nomor teleponnya) → untuk `WA_PHONE_NUMBER_ID`.
Anda bisa menyelesaikan langkah 4-8 dengan nomor tes dulu, lalu mengganti ke nomor sekolah (langkah 9).

## 4. Rahasia aplikasi
**App settings → Basic → App secret** (klik *Show*) → untuk `WA_APP_SECRET`. Jaga kerahasiaannya; aplikasi memakainya untuk
memastikan setiap pesan benar-benar berasal dari Meta.

## 5. Token akses permanen
Token di halaman API Setup kedaluwarsa. Untuk produksi:
1. **Business Settings → Users → System users** → **Add** (peran Admin).
2. **Add assets** → pilih aplikasi Anda dengan akses penuh.
3. **Generate token**: pilih aplikasi, masa berlaku **Never**, izin `whatsapp_business_messaging` dan
   `whatsapp_business_management`. Salin → `WA_ACCESS_TOKEN`. (Token hanya ditampilkan sekali.)
4. Pastikan **WhatsApp Business Account** juga terhubung ke System User tersebut.

## 6. Isi `.env` di server dan jalankan ulang
```bash
cd Aplikasi && nano .env
```
```
WA_PROVIDER=meta
WA_VERIFY_TOKEN=<kata acak buatan Anda sendiri, mis. 24 huruf/angka>
WA_APP_SECRET=<dari langkah 4>
WA_ACCESS_TOKEN=<dari langkah 5>
WA_PHONE_NUMBER_ID=<dari langkah 3>
WA_GRAPH_VERSION=<versi API yang tertera di dashboard Meta, mis. v23.0>
```
```bash
docker compose up -d        # menerapkan .env baru
```

## 7. Daftarkan webhook
**WhatsApp → Configuration → Webhook → Edit**:
- **Callback URL**: `https://DOMAIN-ANDA/api/wa/webhook`
- **Verify token**: sama persis dengan `WA_VERIFY_TOKEN`
- Klik **Verify and save**. Gagal? Pastikan aplikasi sudah berjalan, HTTPS aktif, dan token sama.
- Pada **Webhook fields**, klik **Subscribe** untuk **messages**.

## 8. Daftarkan nomor guru di aplikasi dan uji
1. Di aplikasi: menu **Pengguna → Tambah**, peran **Guru**, isi **No. WhatsApp** guru (format bebas: `0812...` atau `+62...`).
   Guru yang hanya memakai WhatsApp tidak perlu password.
2. Guru mengirim `bantuan` ke nomor bot. Balasan berisi daftar perintah = tersambung.
3. Coba `absen 7A semua hadir`, lalu cek di menu **Absensi**. Riwayat semua pesan ada di menu **WhatsApp**.

## 9. Pindah ke nomor sekolah (produksi)
1. **WhatsApp → API Setup → Add phone number**; isi nama tampilan (harus sesuai nama lembaga, bisa ditinjau Meta) dan
   verifikasi lewat SMS/telepon.
2. Ganti `WA_PHONE_NUMBER_ID` di `.env` dengan ID nomor baru, lalu `docker compose up -d`.
3. Pastikan metode pembayaran Meta terpasang bila diminta, dan Business Verification selesai.
4. Informasikan ke guru: nomor bot, cara pakai, dan bahwa pesan hanya diproses dari nomor yang didaftarkan.

## Bila bermasalah
| Gejala | Penyebab umum |
|---|---|
| Verify and save gagal | Aplikasi belum online/HTTPS belum aktif; `WA_VERIFY_TOKEN` berbeda; `WA_PROVIDER` bukan `meta` (webhook mati) |
| Pesan guru tidak dibalas | Webhook belum Subscribe ke **messages**; cek menu **WhatsApp → Riwayat pesan** di aplikasi. Kosong = pesan tidak sampai |
| Riwayat menunjukkan *tidak_terdaftar* | Nomor guru belum diisi di Pengguna, atau salah digit |
| Log server: `Tanda tangan tidak valid` / respons 401 | `WA_APP_SECRET` salah |
| Log server: `WA kirim gagal ... 401/403` | `WA_ACCESS_TOKEN` salah/kedaluwarsa, atau System User belum diberi akses ke akun WhatsApp Business |
| Log server: `WA kirim gagal ... 400/404` | `WA_PHONE_NUMBER_ID` salah, atau `WA_GRAPH_VERSION` sudah tidak didukung Meta |
| Balasan terlambat/tidak datang setelah lama tidak chat | Jendela 24 jam habis; guru cukup mengirim pesan baru |

Lihat log: `docker compose logs -f app`.

## Privasi
Pesan berisi nama siswa dan diproses melalui Meta/WhatsApp. Minta guru **tidak mengirim NIK, alamat, atau data sensitif lain**
lewat WhatsApp; perintah yang tersedia memang hanya memerlukan nama, kelas, status, dan alasan singkat.
Cantumkan penggunaan WhatsApp dalam kebijakan privasi sekolah.
