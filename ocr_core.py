"""Inti OCR: mengubah PDF hasil scan menjadi PDF berteks (searchable) memakai OCRmyPDF."""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from pypdf import PdfReader

BAHASA = {
    "ind": "Indonesia",
    "eng": "Inggris",
    "ara": "Arab",
}


def bahasa_terpasang():
    """Kembalikan kode bahasa Tesseract yang benar-benar terpasang."""
    try:
        out = subprocess.run(["tesseract", "--list-langs"], capture_output=True, text=True).stdout
    except FileNotFoundError:
        return []
    return [l.strip() for l in out.splitlines()[1:] if l.strip() and l.strip() != "osd"]


def ocr_pdf(src: Path, dst: Path, lang="ind+eng", mode="skip", deskew=False, rotate=True, optimize=1, sidecar=None):
    """Jalankan OCR. sidecar: path berkas teks mentah (untuk keluaran .txt).

    Bawaan menjaga gambar asli tidak disentuh, jadi ukuran file nyaris sama
    (hanya bertambah lapisan teks). deskew & mode 'force' menggambar ulang
    halaman sehingga ukuran file membesar.

    mode: 'skip'  -> lewati halaman yang sudah berteks
          'force' -> rasterisasi semua halaman lalu OCR ulang (file membesar)
          'redo'  -> buang teks lama, OCR ulang
    """
    cmd = [sys.executable, "-m", "ocrmypdf", "-l", lang, "--optimize", str(optimize), "--output-type", "pdf"]
    cmd.append({"skip": "--skip-text", "force": "--force-ocr", "redo": "--redo-ocr"}[mode])
    if deskew and mode != "redo":
        cmd.append("--deskew")
    if rotate:
        cmd.append("--rotate-pages")
    if sidecar:
        cmd += ["--sidecar", str(sidecar)]
    cmd += [str(src), str(dst)]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(pesan_error(p.returncode, p.stderr))
    return dst


def sudah_berteks(path: Path) -> bool:
    """True bila SEMUA halaman sudah punya teks (berhenti di halaman pertama tanpa teks)."""
    try:
        r = PdfReader(str(path))
        if r.is_encrypted:
            return False
        return all((pg.extract_text() or "").strip() for pg in r.pages)
    except Exception:
        return False


def buat_txt(sidecar: Path, pdf: Path) -> str:
    """Susun teks seluruh dokumen. Halaman yang dilewati OCR (sudah berteks) diambil dari PDF-nya."""
    halaman = Path(sidecar).read_text(encoding="utf-8", errors="replace").split("\f")
    reader = None
    hasil = []
    for i, t in enumerate(halaman):
        if t.strip().startswith("[OCR skipped on page(s)"):
            reader = reader or PdfReader(str(pdf))
            t = reader.pages[i].extract_text() or ""
        hasil.append(t.strip())
    while hasil and not hasil[-1]:
        hasil.pop()
    return "\n\n".join(hasil) + "\n"


def _tulis_atomik(path: Path, isi: str):
    fd, tmp = tempfile.mkstemp(suffix=".txt", prefix=".ocr_", dir=path.parent)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(isi)
    os.replace(tmp, path)


FORMAT = ("pdf", "txt", "both")


def ocr_inplace(path: Path, lang="ind+eng", mode="skip", deskew=False, backup=False, fmt="pdf"):
    """OCR satu file di tempat. Mengembalikan 'ok' atau 'lewati'.

    fmt: 'pdf'  -> PDF asli diganti versi berteks
         'txt'  -> tulis nama.txt di sebelah PDF; PDF asli tidak diubah
         'both' -> keduanya
    Hasil ditulis ke file sementara dulu, jumlah halaman dicek, baru menggantikan.
    Bila gagal, file asli tidak disentuh.
    """
    path = Path(path)
    if fmt == "pdf" and mode == "skip" and sudah_berteks(path):
        return "lewati"
    buat_pdf = fmt in ("pdf", "both")
    buat_teks = fmt in ("txt", "both")
    fd, tmp = tempfile.mkstemp(suffix=".pdf", prefix=".ocr_", dir=path.parent)
    os.close(fd)
    tmp = Path(tmp)
    side = tmp.with_suffix(".side.txt") if buat_teks else None
    try:
        ocr_pdf(path, tmp, lang, mode, deskew=deskew, sidecar=side)
        if len(PdfReader(str(tmp)).pages) != len(PdfReader(str(path)).pages):
            raise RuntimeError("Jumlah halaman hasil OCR berbeda; file asli tidak diganti.")
        if buat_teks:
            _tulis_atomik(path.with_suffix(".txt"), buat_txt(side, tmp))
        if buat_pdf:
            if backup:
                shutil.copy2(path, path.with_name(path.stem + ".bak.pdf"))
            shutil.copymode(path, tmp)
            os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
        if side:
            side.unlink(missing_ok=True)
    return "ok"


def cari_pdf(folder: Path, rekursif=True):
    pola = "**/*.pdf" if rekursif else "*.pdf"
    return sorted(
        p for p in Path(folder).glob(pola)
        if p.is_file() and not p.name.startswith(".") and not p.stem.endswith(".bak")
    )


def ocr_folder(folder, lang="ind+eng", mode="skip", deskew=False, backup=False, rekursif=True, on_progress=None, fmt="pdf"):
    """OCR semua PDF di folder, hasil menggantikan file lama. Satu file gagal tidak menghentikan yang lain."""
    files = cari_pdf(Path(folder).expanduser(), rekursif)
    hasil = {"ok": 0, "lewati": 0, "gagal": []}
    for i, f in enumerate(files, 1):
        if on_progress:
            on_progress(i, len(files), f)
        try:
            hasil[ocr_inplace(f, lang, mode, deskew, backup, fmt)] += 1
        except Exception as e:
            hasil["gagal"].append((str(f), str(e)))
    return hasil


def pesan_error(code, stderr):
    peta = {
        2: "File bukan PDF yang valid.",
        6: "PDF ini sudah berteks. Pilih mode 'Paksa OCR ulang' atau 'Ganti teks lama'.",
        8: "PDF terenkripsi/diproteksi password.",
    }
    return peta.get(code, "OCR gagal: " + (stderr.strip().splitlines() or ["tidak diketahui"])[-1])


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="PDF scan -> PDF berteks (OCR)")
    ap.add_argument("input", type=Path, help="file PDF atau folder")
    ap.add_argument("output", type=Path, nargs="?", help="(opsional, hanya untuk satu file)")
    ap.add_argument("--inplace", action="store_true", help="timpa file asli (otomatis untuk folder)")
    ap.add_argument("--backup", action="store_true", help="simpan cadangan nama.bak.pdf saat menimpa")
    ap.add_argument("--no-recursive", action="store_true", help="folder: jangan masuk subfolder")
    ap.add_argument("-l", "--lang", default="ind+eng", help="mis. ind, eng, ara, ind+ara")
    ap.add_argument("--deskew", action="store_true", help="luruskan halaman miring (ukuran file bisa membesar)")
    ap.add_argument("-f", "--format", choices=FORMAT, default="pdf", help="pdf (bawaan), txt, atau both")
    ap.add_argument("-m", "--mode", choices=["skip", "force", "redo"], default="skip")
    a = ap.parse_args()
    if a.input.is_dir() or a.inplace:
        if a.input.is_dir():
            def tampil(i, n, f):
                print(f"[{i}/{n}] {f}", flush=True)
            h = ocr_folder(a.input, a.lang, a.mode, a.deskew, a.backup, not a.no_recursive, tampil, a.format)
            print(f"Selesai: {h['ok']} di-OCR, {h['lewati']} dilewati (sudah berteks), {len(h['gagal'])} gagal")
            for f, e in h["gagal"]:
                print("GAGAL:", f, "-", e)
            sys.exit(1 if h["gagal"] else 0)
        try:
            print("Selesai:", ocr_inplace(a.input, a.lang, a.mode, a.deskew, a.backup, a.format), a.input)
        except RuntimeError as e:
            sys.exit(str(e))
        sys.exit(0)
    pdf_out = a.output if (a.output and a.format != "txt") else a.input.with_name(a.input.stem + "_ocr.pdf")
    txt_out = a.output if (a.output and a.format == "txt") else a.input.with_suffix(".txt")
    side = None
    tmp_pdf = None
    try:
        if a.format == "pdf":
            ocr_pdf(a.input, pdf_out, a.lang, a.mode, deskew=a.deskew)
            print("Selesai:", pdf_out)
        else:
            fd, t = tempfile.mkstemp(suffix=".pdf"); os.close(fd)
            tmp_pdf = Path(t); side = tmp_pdf.with_suffix(".side.txt")
            ocr_pdf(a.input, tmp_pdf, a.lang, a.mode, deskew=a.deskew, sidecar=side)
            txt_out.write_text(buat_txt(side, tmp_pdf), encoding="utf-8")
            print("Selesai:", txt_out)
            if a.format == "both":
                shutil.copyfile(tmp_pdf, pdf_out)
                print("Selesai:", pdf_out)
    except RuntimeError as e:
        sys.exit(str(e))
    finally:
        for f in (tmp_pdf, side):
            if f:
                Path(f).unlink(missing_ok=True)
