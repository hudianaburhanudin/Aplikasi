"""Inti OCR: mengubah PDF hasil scan menjadi PDF berteks (searchable) memakai OCRmyPDF."""
import subprocess
import sys
from pathlib import Path

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


def ocr_pdf(src: Path, dst: Path, lang="ind+eng", mode="skip", deskew=True, rotate=True, optimize=1):
    """Jalankan OCR.

    mode: 'skip'  -> lewati halaman yang sudah berteks
          'force' -> rasterisasi semua halaman lalu OCR ulang
          'redo'  -> buang teks lama, OCR ulang
    """
    cmd = [sys.executable, "-m", "ocrmypdf", "-l", lang, "--optimize", str(optimize), "--output-type", "pdf"]
    cmd.append({"skip": "--skip-text", "force": "--force-ocr", "redo": "--redo-ocr"}[mode])
    if deskew and mode != "redo":
        cmd.append("--deskew")
    if rotate:
        cmd.append("--rotate-pages")
    cmd += [str(src), str(dst)]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(pesan_error(p.returncode, p.stderr))
    return dst


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
    ap.add_argument("input", type=Path)
    ap.add_argument("output", type=Path, nargs="?")
    ap.add_argument("-l", "--lang", default="ind+eng", help="mis. ind, eng, ara, ind+ara")
    ap.add_argument("-m", "--mode", choices=["skip", "force", "redo"], default="skip")
    a = ap.parse_args()
    out = a.output or a.input.with_name(a.input.stem + "_ocr.pdf")
    try:
        ocr_pdf(a.input, out, a.lang, a.mode)
    except RuntimeError as e:
        sys.exit(str(e))
    print("Selesai:", out)
