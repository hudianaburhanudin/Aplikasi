# OCR PDF

Mengubah PDF hasil scan (gambar) menjadi PDF berteks yang bisa dicari, disalin, dan diseleksi.
Memakai [OCRmyPDF](https://ocrmypdf.readthedocs.io) + Tesseract.

## Instalasi (Ubuntu/Debian)

```bash
sudo apt install tesseract-ocr tesseract-ocr-ind tesseract-ocr-ara ghostscript
pip install -r requirements.txt
```

macOS: `brew install tesseract tesseract-lang ghostscript`.

## Pakai versi web

```bash
python app.py        # buka http://localhost:5000
```

Unggah PDF, pilih bahasa (Indonesia/Inggris/Arab) dan mode, lalu unduh hasilnya.

## Pakai versi baris perintah

```bash
python ocr_core.py buku.pdf buku_ocr.pdf -l ind+ara
```

Mode: `skip` (lewati halaman yang sudah berteks), `force` (OCR ulang semua), `redo` (ganti teks lama).
Batas unggah web default 200 MB (`MAX_MB=500 python app.py` untuk mengubah).

## Ukuran file

Bawaan aplikasi tidak mengubah gambar asli, jadi ukuran hasil nyaris sama dengan file asli
(hanya bertambah lapisan teks, sekitar beberapa persen). Dua opsi ini menggambar ulang halaman dan
membuat file membesar: "luruskan halaman miring" (`--deskew`) dan mode "paksa OCR ulang" (`force`).

## OCR satu folder (menggantikan file lama)

Di halaman web, klik **Pilih folder…**, pilih folder, lalu **Proses folder**. Semua PDF di dalamnya
(termasuk subfolder) diproses dan hasilnya menggantikan file lama. PDF yang sudah berteks dilewati,
dan file asli baru diganti setelah OCR berhasil serta jumlah halamannya cocok. Centang "Simpan cadangan"
bila ingin menyimpan `nama.bak.pdf`.

Lewat baris perintah:

```bash
python ocr_core.py ~/Documents/buku -l ind+ara            # satu folder
python ocr_core.py ~/Documents/buku --backup              # dengan cadangan
python ocr_core.py buku.pdf --inplace                      # satu file, ditimpa
```

Server web hanya menerima koneksi dari komputer sendiri (127.0.0.1), karena mode folder bisa menimpa file.
