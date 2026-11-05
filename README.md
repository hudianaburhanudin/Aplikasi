# Buku Bersuara

Aplikasi web untuk mengubah buku menjadi suara dan mendengarkannya kalimat demi kalimat.

## Cara pakai
Buka `index.html` di Chrome, Edge, atau Safari (tanpa instalasi, tanpa server). Atau jalankan `python3 -m http.server` lalu buka `http://localhost:8000`.

1. Klik **Buka buku**: pilih file **TXT, PDF, EPUB**, atau tempel teks.
2. Tekan **Putar**. Kalimat yang dibaca disorot; klik kalimat mana pun untuk loncat ke sana.
3. Atur suara di **Pengaturan suara**.

## Fitur
- Format: TXT/MD, PDF (berteks), EPUB, teks tempelan; seret-lepas file.
- Pembagian bab otomatis (Bab/Chapter/Bagian/Pasal/Kitab…), atau per ±6000 karakter.
- Pembacaan per kalimat dengan sorotan, bilah posisi, perkiraan sisa waktu.
- Kontrol: putar/jeda, kalimat sebelumnya/berikutnya, ulangi kalimat, bab sebelumnya/berikutnya.
- Pengaturan: pilihan suara & bahasa (Indonesia, Inggris, Arab), kecepatan, nada, volume, jeda antar kalimat, ukuran huruf, timer tidur, lanjut bab otomatis, tema gelap/terang.
- Pustaka tersimpan di peramban (IndexedDB) dan **melanjutkan dari posisi terakhir**.
- Pintasan: `Spasi` putar/jeda, `←`/`→` kalimat, `R` ulangi.

## Catatan
- Suara memakai Web Speech API bawaan perangkat. Kualitas dan ketersediaan suara bahasa Indonesia tergantung sistem (pasang suara id-ID di pengaturan sistem jika tidak muncul).
- PDF hasil scan (gambar) tidak bisa dibacakan tanpa OCR.
- PDF/EPUB memuat pustaka pdf.js/JSZip dari CDN, jadi butuh internet saat pertama kali membuka file jenis itu.
