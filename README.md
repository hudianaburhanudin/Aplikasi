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
