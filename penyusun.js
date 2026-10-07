// Penyusun jadwal pelajaran otomatis (awal tahun pelajaran).
// Masukan: hari aktif, sesi harian (jam belajar & kegiatan tetap), beban mengajar per kelas (mapel, jam/minggu, guru, blok),
// batas guru (hari libur, maksimal jam per hari). Hasil: jadwal tanpa bentrok guru/kelas, blok jam berurutan tidak melewati istirahat.
// Metode: penempatan serakah berbobot dengan banyak percobaan acak (benih tetap, hasil dapat diulang); dipilih yang paling sedikit jam tak tertata.
const HARI = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', "Jum'at", 'Sabtu', 'Ahad'];

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const menit = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };

// Slot belajar per hari, dikelompokkan menjadi rangkaian berurutan (dipisah oleh istirahat/kegiatan tetap)
function bangunSlot(hari, sesi) {
  const out = {};
  for (const d of hari) {
    const list = sesi.filter((s) => !s.hari || !s.hari.length || s.hari.includes(d)).sort((a, b) => menit(a.mulai) - menit(b.mulai));
    const slots = [], grup = []; let cur = null;
    for (const s of list) {
      if (s.jenis === 'belajar') {
        const idx = slots.length; slots.push({ idx, mulai: s.mulai, selesai: s.selesai });
        if (!cur) { cur = []; grup.push(cur); }
        cur.push(idx);
      } else cur = null;
    }
    out[d] = { slots, grup, tetap: list.filter((s) => s.jenis !== 'belajar') };
  }
  return out;
}

function susun({ hari, sesi, kelas, guru = {}, maksGuruHari = 6, benih = 1, percobaan = 60, batasMs = 2500, maksMapelHari = 2 }) {
  const SL = bangunSlot(hari, sesi);
  const jamTersedia = hari.reduce((a, d) => a + SL[d].slots.length, 0);
  // tugas: pecah jam per minggu menjadi blok
  const dasar = [];
  for (const k of kelas) {
    for (const b of k.beban) {
      const blok = Math.max(1, Math.min(b.blok || 1, b.jam)), n = Math.floor(b.jam / blok), sisa = b.jam % blok;
      for (let i = 0; i < n; i++) dasar.push({ kelas: k.id, mapel: b.mapel, guru: b.guru_id || null, ukuran: blok });
      if (sisa) dasar.push({ kelas: k.id, mapel: b.mapel, guru: b.guru_id || null, ukuran: sisa });
    }
  }
  const jamGuru = {}; for (const t of dasar) if (t.guru) jamGuru[t.guru] = (jamGuru[t.guru] || 0) + t.ukuran;
  const hariGuru = (g) => (g && guru[g] ? hari.filter((d) => !guru[g].libur.has(d)).length : hari.length);
  const mulaiMs = Date.now();
  let terbaik = null;

  for (let p = 0; p < percobaan; p++) {
    if (p > 0 && Date.now() - mulaiMs > batasMs) break;
    const R = rng(benih * 7919 + p * 104729);
    const kelasBusy = new Map(), guruBusy = new Map(), guruHari = new Map(), mapelHari = new Map(), kelasHari = new Map();
    const kb = (k, d) => { const key = k + '|' + d; if (!kelasBusy.has(key)) kelasBusy.set(key, new Array(SL[d].slots.length).fill(null)); return kelasBusy.get(key); };
    const gb = (g, d) => { const key = g + '|' + d; if (!guruBusy.has(key)) guruBusy.set(key, new Array(SL[d].slots.length).fill(false)); return guruBusy.get(key); };
    const tugas = dasar.map((t) => ({ ...t, acak: R() })).sort((a, b) => (b.ukuran - a.ukuran)
      || ((a.guru ? hariGuru(a.guru) : 99) - (b.guru ? hariGuru(b.guru) : 99)) || ((jamGuru[b.guru] || 0) - (jamGuru[a.guru] || 0)) || a.acak - b.acak);
    const rows = [], gagal = []; let penalti = 0;
    for (const t of tugas) {
      let terpilih = null;
      for (const longgar of [false, true]) {
        const cand = [];
        for (const d of hari) {
          if (t.guru && guru[t.guru] && guru[t.guru].libur.has(d)) continue;
          const mh = mapelHari.get(`${t.kelas}|${t.mapel}|${d}`) || 0;
          if (!longgar && mh + t.ukuran > Math.max(maksMapelHari, t.ukuran)) continue;
          const gm = guruHari.get(`${t.guru}|${d}`) || 0, maks = (t.guru && guru[t.guru] && guru[t.guru].maks) || maksGuruHari;
          if (t.guru && gm + t.ukuran > maks) continue;
          for (const grup of SL[d].grup) {
            for (let s = 0; s + t.ukuran <= grup.length; s++) {
              const idx = grup.slice(s, s + t.ukuran);
              const kbd = kb(t.kelas, d);
              if (idx.some((i) => kbd[i] !== null)) continue;
              if (t.guru && idx.some((i) => gb(t.guru, d)[i])) continue;
              const beban = kelasHari.get(`${t.kelas}|${d}`) || 0;
              const skor = (mh > 0 ? 30 : 0) + beban * 3 + idx[0] * 0.6 + Math.max(0, idx[0] - beban) * 4 + R() * 2;     // sebar mapel antarhari, seimbangkan hari, rapatkan ke pagi tanpa jam kosong di tengah
              cand.push({ d, idx, skor });
            }
          }
        }
        if (cand.length) { cand.sort((a, b) => a.skor - b.skor); terpilih = cand[0]; if (longgar) penalti += 25; break; }
      }
      if (!terpilih) { gagal.push(t); continue; }
      const { d, idx, skor } = terpilih;
      penalti += skor;
      for (const i of idx) { kb(t.kelas, d)[i] = t; if (t.guru) gb(t.guru, d)[i] = true; }
      mapelHari.set(`${t.kelas}|${t.mapel}|${d}`, (mapelHari.get(`${t.kelas}|${t.mapel}|${d}`) || 0) + t.ukuran);
      kelasHari.set(`${t.kelas}|${d}`, (kelasHari.get(`${t.kelas}|${d}`) || 0) + t.ukuran);
      if (t.guru) guruHari.set(`${t.guru}|${d}`, (guruHari.get(`${t.guru}|${d}`) || 0) + t.ukuran);
      for (const i of idx) rows.push({ kelas_id: t.kelas, hari: d, mulai: SL[d].slots[i].mulai, selesai: SL[d].slots[i].selesai, judul: t.mapel, guru_id: t.guru });
    }
    const jamGagal = gagal.reduce((a, t) => a + t.ukuran, 0);
    if (!terbaik || jamGagal < terbaik.jamGagal || (jamGagal === terbaik.jamGagal && penalti < terbaik.penalti)) terbaik = { rows, gagal, jamGagal, penalti, percobaan: p + 1 };
    if (jamGagal === 0 && p >= 8) break;     // sudah sempurna dan cukup dibandingkan
  }

  // alasan untuk jam yang tak tertata
  const sisa = new Map();
  for (const t of terbaik.gagal) { const k = `${t.kelas}|${t.mapel}`; sisa.set(k, { kelas_id: t.kelas, mapel: t.mapel, guru_id: t.guru, jam: (sisa.get(k)?.jam || 0) + t.ukuran, blok: t.ukuran }); }
  const belum = [...sisa.values()].map((x) => {
    const k = kelas.find((c) => c.id === x.kelas_id), totalKelas = k.beban.reduce((a, b) => a + b.jam, 0), g = x.guru_id && guru[x.guru_id];
    let alasan = 'tidak ada slot kosong yang cocok';
    if (totalKelas > jamTersedia) alasan = `beban kelas ${totalKelas} jam melebihi jam belajar tersedia ${jamTersedia} jam/minggu`;
    else if (g && (jamGuru[x.guru_id] || 0) > hariGuru(x.guru_id) * Math.min(g.maks || maksGuruHari, Math.max(...hari.map((d) => SL[d].slots.length)))) alasan = `guru ${g.nama} terlalu padat (${jamGuru[x.guru_id]} jam/minggu) dibanding hari dan batas jam hariannya`;
    else if (g && (jamGuru[x.guru_id] || 0) > jamTersedia) alasan = `guru ${g.nama} mengajar ${jamGuru[x.guru_id]} jam, lebih banyak dari jam tersedia`;
    else if (x.blok > 1) alasan = `blok ${x.blok} jam berurutan tidak muat (kurangi blok atau ubah sesi)`;
    return { ...x, kelas: k.nama, guru: g ? g.nama : null, alasan };
  });
  // kegiatan tetap (upacara, qiro'ah, istirahat) berlaku untuk semua kelas
  const tetap = [];
  for (const d of hari) for (const s of SL[d].tetap) tetap.push({ kelas_id: null, hari: d, mulai: s.mulai, selesai: s.selesai, judul: s.judul || 'Istirahat', guru_id: null });
  const beban = {};
  for (const r of terbaik.rows) if (r.guru_id) beban[r.guru_id] = (beban[r.guru_id] || 0) + 1;
  return { rows: terbaik.rows.sort((a, b) => a.kelas_id - b.kelas_id || a.hari - b.hari || a.mulai.localeCompare(b.mulai)), tetap, belum, jamGagal: terbaik.jamGagal, jamTotal: dasar.reduce((a, t) => a + t.ukuran, 0),
    jamTersedia, bebanGuru: beban, percobaan: terbaik.percobaan };
}

// Deteksi bentrok pada jadwal yang sudah ada: guru yang sama mengajar dua kelas pada waktu yang beririsan
function cariBentrok(rows) {
  const out = [];
  const per = new Map();
  for (const r of rows) {
    const g = (r.guru || '').trim().toLowerCase(); if (!g || r.kelas_id === null) continue;
    const key = g + '|' + r.hari; per.set(key, [...(per.get(key) || []), r]);
  }
  for (const list of per.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.kelas_id === b.kelas_id) continue;
      if (a.mulai < b.selesai && b.mulai < a.selesai) out.push({ guru: a.guru, hari: a.hari, a: { kelas: a.kelas_nama, mapel: a.judul, waktu: `${a.mulai}-${a.selesai}` }, b: { kelas: b.kelas_nama, mapel: b.judul, waktu: `${b.mulai}-${b.selesai}` } });
    }
  }
  return out;
}

module.exports = { susun, bangunSlot, cariBentrok, HARI };
