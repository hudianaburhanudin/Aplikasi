# Aplikasi HP (Play Store & App Store)

Portal wali (`/wali`) adalah **PWA**: wali bisa langsung memakainya lewat browser dan memasangnya ke layar utama
(Android: tombol "Pasang aplikasi"; iPhone: Bagikan → Tambah ke Layar Utama), tanpa toko aplikasi.

Folder ini berisi konfigurasi untuk membungkusnya menjadi aplikasi toko dengan [Capacitor](https://capacitorjs.com).
Aplikasi dibungkus **menunjuk ke server produksi** (`server.url`), jadi pembaruan fitur cukup deploy server,
tanpa mengirim ulang ke toko. **Catatan:** konfigurasi ini belum dibuild/diuji di lingkungan pengembangan
(butuh Android Studio / Xcode), jadi uji di perangkat sebelum dikirim.

## Prasyarat
- Server produksi sudah online dengan **HTTPS** dan domain (lihat tahap deploy).
- Akun developer: **Google Play Console** (± US$25, sekali bayar) dan **Apple Developer Program** (US$99 per tahun).
  Daftarkan atas nama yayasan (Apple meminta nomor D-U-N-S untuk akun organisasi).
- Kebijakan privasi (URL publik) — wajib di kedua toko karena aplikasi memuat data anak.
- Android Studio (Android) dan Mac dengan Xcode (iOS).

## Langkah
```bash
cd mobile
# 1. ganti GANTI-DENGAN-DOMAIN-ANDA di capacitor.config.json dengan domain produksi
npm init -y
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap add android && npx cap add ios
# 2. ikon & splash: gunakan ../public/icons/maskable-512.png
npx cap sync
npx cap open android   # build AAB di Android Studio -> unggah ke Play Console
npx cap open ios       # archive di Xcode -> App Store Connect
```

## Peringatan penting untuk App Store (iOS)
Apple (Guideline 4.2 "Minimum Functionality") sering menolak aplikasi yang hanya "membungkus situs web".
Agar lolos tambahkan fungsi native, misalnya **notifikasi push** (`@capacitor/push-notifications`, butuh
Firebase untuk Android dan APNs untuk iOS) dan/atau kunci biometrik. Itu tahap berikutnya dan membutuhkan
server mengirim notifikasi saat ada pengumuman, nilai, atau tagihan baru. Jalur Android lebih mudah:
selain Capacitor, PWA ini dapat dipublikasikan ke Play Store sebagai **Trusted Web Activity**
(Bubblewrap) tanpa kode native.

## Alternatif tanpa toko
Bagikan tautan `https://DOMAIN/wali` lewat grup WhatsApp wali murid; instal PWA gratis dan langsung berfungsi.
