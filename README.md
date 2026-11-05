# Buku Bersuara

Aplikasi web untuk mengubah buku menjadi suara dan mendengarkannya kalimat demi kalimat.

## Memakai aplikasi
**Cara tercepat (di komputer):** unduh folder ini, lalu buka `index.html` di Chrome/Edge/Safari.

**Agar bisa diinstal di HP/komputer (PWA) dan dibuka dari mana saja:** publikasikan lewat GitHub Pages.
1. Gabungkan (merge) branch ini ke `main`.
2. Di GitHub: *Settings → Pages → Build and deployment → Source: GitHub Actions*.
3. Workflow `.github/workflows/pages.yml` akan menerbitkan aplikasi di `https://<pengguna>.github.io/<repo>/`.
4. Buka alamat itu di Chrome/Edge lalu pilih **Instal aplikasi** / **Tambahkan ke layar utama**. Setelah terpasang, aplikasi juga bisa dibuka tanpa internet (suara bawaan perangkat; suara natural dan terjemahan online tetap butuh internet).

Alternatif lokal: `python3 -m http.server` lalu buka `http://localhost:8000`.

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
- Terjemahan Arab disimpan per buku (tidak diterjemahkan ulang saat dibuka lagi); tombol **Ekspor** menyimpan teks Arab + terjemahan ke file .txt.
- Pustaka tersimpan di peramban (IndexedDB) dan **melanjutkan dari posisi terakhir**.
- Pintasan: `Spasi` putar/jeda, `←`/`→` kalimat, `R` ulangi.

## Suara natural
Di **Pengaturan suara → Mesin suara** pilih:
- **OpenAI** (model `gpt-4o-mini-tts`, suara alloy/nova/coral/dll.) atau layanan lain yang kompatibel lewat kolom *Alamat API*.
- **ElevenLabs** (`eleven_multilingual_v2`, isi Voice ID).

Isi kunci API sendiri; kunci hanya disimpan di peramban dan dikirim langsung ke penyedia (biaya ditagih penyedia). Tiga kalimat berikutnya diunduh lebih dulu agar pembacaan mulus. Mesin “Bawaan perangkat” tetap gratis dan offline.

## Mode Arab → Indonesia
Untuk buku berbahasa Arab (terdeteksi otomatis, atau tombol **Mode Arab**): teks dipotong di setiap titik, koma, titik dua, dan titik koma. Tiap potongan dibacakan dalam bahasa Arab asli, lalu diterjemahkan dan dibacakan dalam bahasa Indonesia. Teks Arab dan terjemahannya tampil berdampingan, dan terjemahan berikutnya disiapkan lebih dulu.

Penerjemah (Pengaturan suara): **MyMemory** (gratis, kuota harian terbatas), **Claude** (kunci Anthropic), atau **OpenAI**. Untuk kitab/teks keagamaan, pakai Claude atau OpenAI agar mutunya baik. Pilihan “Yang dibacakan”: Arab+terjemahan, Arab saja, atau terjemahan saja. Suara Arab bawaan perangkat harus terpasang (ar-SA); mesin suara natural otomatis mengenali Arab.

## Catatan
- Suara memakai Web Speech API bawaan perangkat. Kualitas dan ketersediaan suara bahasa Indonesia tergantung sistem (pasang suara id-ID di pengaturan sistem jika tidak muncul).
- PDF hasil scan (gambar) tidak bisa dibacakan tanpa OCR.
- PDF/EPUB memuat pustaka pdf.js/JSZip dari CDN, jadi butuh internet saat pertama kali membuka file jenis itu.
