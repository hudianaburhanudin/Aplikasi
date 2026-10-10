"""Aplikasi web OCR PDF. Jalankan: python app.py  lalu buka http://localhost:5000"""
import os
import tempfile
import uuid
from pathlib import Path

from flask import Flask, render_template, request, send_file, jsonify

from ocr_core import BAHASA, bahasa_terpasang, ocr_pdf

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
    job = uuid.uuid4().hex
    src, dst = WORK / f"{job}_in.pdf", WORK / f"{job}_out.pdf"
    f.save(src)
    try:
        ocr_pdf(src, dst, "+".join(langs), mode, deskew=request.form.get("deskew") == "1")
    except RuntimeError as e:
        return jsonify(error=str(e)), 422
    finally:
        src.unlink(missing_ok=True)
    nama = Path(f.filename).stem + "_ocr.pdf"
    resp = send_file(dst, as_attachment=True, download_name=nama, mimetype="application/pdf")
    resp.call_on_close(lambda: dst.unlink(missing_ok=True))
    return resp


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
