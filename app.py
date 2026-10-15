"""Aplikasi web OCR PDF. Jalankan: python app.py  lalu buka http://localhost:5000"""
import io
import os
import subprocess
import zipfile
import sys
import tempfile
import threading
import uuid
from pathlib import Path

from flask import Flask, render_template, request, send_file, jsonify

from ocr_core import BAHASA, FORMAT, bahasa_terpasang, buat_txt, ocr_folder, ocr_pdf

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = int(os.environ.get("MAX_MB", 200)) * 1024 * 1024
WORK = Path(tempfile.gettempdir()) / "ocr_pdf_app"
WORK.mkdir(exist_ok=True)


@app.get("/")
def index():
    terpasang = bahasa_terpasang()
    pilihan = [(k, v) for k, v in BAHASA.items() if k in terpasang]
    return render_template("index.html", bahasa=pilihan)


@app.post("/ocr")
def ocr():
    f = request.files.get("pdf")
    if not f or not f.filename.lower().endswith(".pdf"):
        return jsonify(error="Unggah file berformat PDF."), 400
    langs = [l for l in request.form.getlist("lang") if l in bahasa_terpasang()] or ["eng"]
    mode = request.form.get("mode", "skip")
    if mode not in ("skip", "force", "redo"):
        mode = "skip"
    fmt = request.form.get("format", "pdf")
    if fmt not in FORMAT:
        fmt = "pdf"
    job = uuid.uuid4().hex
    src, dst = WORK / f"{job}_in.pdf", WORK / f"{job}_out.pdf"
    side = WORK / f"{job}_side.txt"
    keluar = WORK / f"{job}_final"
    f.save(src)
    try:
        ocr_pdf(src, dst, "+".join(langs), mode, deskew=request.form.get("deskew") == "1",
                sidecar=side if fmt != "pdf" else None)
        stem = Path(f.filename).stem
        if fmt == "pdf":
            nama, mime, keluar = stem + "_ocr.pdf", "application/pdf", dst
        else:
            teks = buat_txt(side, dst)
            if fmt == "txt":
                keluar.write_text(teks, encoding="utf-8")
                nama, mime = stem + ".txt", "text/plain; charset=utf-8"
            else:
                with zipfile.ZipFile(keluar, "w", zipfile.ZIP_DEFLATED) as z:
                    z.write(dst, stem + "_ocr.pdf")
                    z.writestr(stem + ".txt", teks)
                nama, mime = stem + "_ocr.zip", "application/zip"
        data = keluar.read_bytes()
    except RuntimeError as e:
        return jsonify(error=str(e)), 422
    finally:
        # Semua file sementara dihapus segera; hasil dikirim dari memori.
        for x in (src, side, dst, keluar):
            x.unlink(missing_ok=True)
    return send_file(io.BytesIO(data), as_attachment=True, download_name=nama, mimetype=mime)


JOBS = {}


@app.post("/pilih-folder")
def pilih_folder():
    """Buka dialog pilih folder bawaan sistem (aplikasi ini berjalan di komputer pengguna)."""
    if sys.platform == "darwin":
        cmd = ["osascript", "-e", 'POSIX path of (choose folder with prompt "Pilih folder berisi PDF")']
    else:
        cmd = [sys.executable, "-c",
               "import tkinter as t, tkinter.filedialog as f; r=t.Tk(); r.withdraw(); "
               "r.attributes('-topmost', True); print(f.askdirectory(title='Pilih folder berisi PDF'))"]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except Exception as e:
        return jsonify(error=f"Tidak bisa membuka dialog folder: {e}"), 500
    path = p.stdout.strip()
    if p.returncode != 0 or not path:
        return jsonify(batal=True)
    return jsonify(path=path.rstrip("/") or "/")


@app.post("/folder")
def folder():
    d = request.get_json(force=True)
    path = Path(str(d.get("path", "")).strip().strip("\"'")).expanduser()
    if not path.is_dir():
        return jsonify(error=f"Folder tidak ditemukan: {path}"), 400
    langs = [l for l in d.get("lang", []) if l in bahasa_terpasang()] or ["eng"]
    mode = d.get("mode", "skip") if d.get("mode") in ("skip", "force", "redo") else "skip"
    job = uuid.uuid4().hex
    st = JOBS[job] = {"selesai": False, "i": 0, "n": 0, "file": "", "hasil": None}

    def kerja():
        def prog(i, n, f):
            st.update(i=i, n=n, file=str(f))
        try:
            st["hasil"] = ocr_folder(path, "+".join(langs), mode, bool(d.get("deskew")),
                                     bool(d.get("backup")), bool(d.get("rekursif", True)), prog,
                                     d.get("format") if d.get("format") in FORMAT else "pdf")
        except Exception as e:
            st["hasil"] = {"ok": 0, "lewati": 0, "gagal": [(str(path), str(e))]}
        st["selesai"] = True

    threading.Thread(target=kerja, daemon=True).start()
    return jsonify(job=job)


@app.get("/status/<job>")
def status(job):
    return jsonify(JOBS.get(job) or {"selesai": True, "hasil": {"ok": 0, "lewati": 0, "gagal": [["", "Job tidak ditemukan"]]}})


if __name__ == "__main__":
    # Hanya 127.0.0.1: mode folder bisa menimpa file, jangan dibuka ke jaringan.
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", 5000)))
