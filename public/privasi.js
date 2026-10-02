'use strict';
// Kebijakan Privasi: teks tetap, bagian [ISI] diambil dari Profil Yayasan (admin). Yang belum diisi ditandai kuning.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tgl = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return d; } };

fetch('/api/public/privasi').then((r) => r.json()).catch(() => ({})).then((d) => {
  const v = (k, fmt) => (d[k] ? esc(fmt ? fmt(d[k]) : d[k]) : '<mark>[belum diisi]</mark>');
  document.getElementById('isi').innerHTML = `
  <header><img src="/logo/yayasan.png" alt="Logo Yayasan Miftahul Ulumillah"><div><h1>Kebijakan Privasi</h1><p class="meta" style="margin:4px 0 0">Yayasan Miftahul Ulumillah</p></div></header>
  <p class="meta">Berlaku mulai ${v('tanggal_berlaku', tgl)} · Versi 1.0</p>

  <h2>1. Pengantar</h2>
  <p>Kebijakan ini menjelaskan cara Yayasan Miftahul Ulumillah dan lembaga di bawahnya menggunakan data pribadi dalam aplikasi administrasi sekolah: aplikasi petugas, aplikasi wali murid, formulir pendaftaran online, dan layanan pesan WhatsApp. Sebagian besar datanya adalah data anak, jadi kami hanya mengumpulkan yang diperlukan untuk pendidikan dan hanya memperlihatkannya kepada orang yang berkepentingan. Kami tidak menjual data, tidak memasang iklan, dan tidak memakai pelacak pihak ketiga.</p>

  <h2>2. Siapa kami</h2>
  <p>Pengendali data adalah <b>Yayasan Miftahul Ulumillah</b>, ${v('alamat_kantor')}, yang menaungi:</p>
  <ul><li>Pondok Pesantren Miftahul Ulum</li><li>SMK Miftahul Ulum</li><li>SMP Plus Miftahul Ulum Tambakrejo</li><li>MI Miftahul Ulum</li><li>RA Muslimat</li><li>Madin Ula Miftahul Ulum</li><li>Madin Wustho Miftahul Ulum</li></ul>
  <p>Cara menghubungi kami ada di bagian 12.</p>

  <h2>3. Data siapa yang kami proses</h2>
  <p>Data calon siswa dan siswa, data orang tua atau wali murid, serta data guru dan petugas yang memakai aplikasi.</p>

  <h2>4. Data yang kami kumpulkan</h2>
  <table><thead><tr><th>Kelompok</th><th>Data</th><th>Sumber</th></tr></thead><tbody>
  <tr><td>Calon siswa (pendaftaran)</td><td>Nama, jenis kelamin, tempat dan tanggal lahir, NIK (bila diisi), alamat, nama ayah dan ibu, telepon/WhatsApp orang tua, asal sekolah, status seleksi, waktu persetujuan</td><td>Orang tua lewat formulir online, atau petugas</td></tr>
  <tr><td>Siswa</td><td>Data identitas di atas, NIS, kelas, status (aktif, lulus, pindah, keluar), tahun masuk dan lulus, riwayat kelas</td><td>Petugas, dari data pendaftaran</td></tr>
  <tr><td>Kegiatan belajar</td><td>Kehadiran (hadir, sakit, izin, alpa) beserta alasan singkat, nilai</td><td>Guru dan petugas</td></tr>
  <tr><td>Keuangan</td><td>Tagihan dan pembayaran: jenis, periode, jumlah, tanggal</td><td>Petugas</td></tr>
  <tr><td>Kedisiplinan</td><td>Jenis pelanggaran, poin, tanggal, keterangan, nama pencatat</td><td>Guru dan petugas</td></tr>
  <tr><td>Wali murid</td><td>Nama, nomor HP (dipakai sebagai nama pengguna), kata sandi, anak yang terhubung</td><td>Petugas membuatkan akun</td></tr>
  <tr><td>Guru dan petugas</td><td>Nama, nama pengguna, peran, lembaga, nomor WhatsApp, kata sandi</td><td>Admin</td></tr>
  <tr><td>Pesan WhatsApp</td><td>Nomor pengirim, isi pesan, balasan sistem, waktu</td><td>Guru atau petugas yang mengirim</td></tr></tbody></table>
  <p>Kata sandi disimpan hanya dalam bentuk terenkripsi satu arah, sehingga tidak bisa dibaca siapa pun, termasuk admin.</p>
  <p>Data teknis yang sangat terbatas: alamat IP dipakai sementara di memori server untuk membatasi percobaan masuk dan pendaftaran yang berulang, dan tidak disimpan permanen. Aplikasi memakai satu cookie sesi (berlaku 12 jam) dan menyimpan pilihan lembaga atau anak terakhir di peramban Anda. Alasan kehadiran bisa memuat keterangan kesehatan singkat, misalnya "demam", bila guru menuliskannya.</p>
  <p>Kami <b>tidak</b> mengumpulkan lokasi, daftar kontak, foto, atau rekaman suara.</p>

  <h2>5. Untuk apa data digunakan, dan dasarnya</h2>
  <table><thead><tr><th>Tujuan</th><th>Dasar pemrosesan</th></tr></thead><tbody>
  <tr><td>Menerima dan menyeleksi siswa baru</td><td>Persetujuan orang tua atau wali, diberikan lewat kotak persetujuan pada formulir</td></tr>
  <tr><td>Administrasi pendidikan: kelas, absensi, nilai, rapor, kenaikan kelas, kelulusan</td><td>Pelaksanaan layanan pendidikan yang diminta orang tua</td></tr>
  <tr><td>Penagihan SPP dan pembuatan kuitansi</td><td>Pelaksanaan perjanjian layanan dan kewajiban administrasi keuangan</td></tr>
  <tr><td>Pembinaan kedisiplinan dan pemberitahuan kepada wali</td><td>Kepentingan sah sekolah untuk membina siswa; wali dapat melihat catatan anaknya</td></tr>
  <tr><td>Komunikasi dengan wali: pengumuman dan informasi anak di aplikasi wali</td><td>Pelaksanaan layanan dan persetujuan wali</td></tr>
  <tr><td>Memudahkan guru mencatat absensi dan pelanggaran lewat WhatsApp</td><td>Persetujuan guru atau petugas yang mendaftarkan nomornya</td></tr>
  <tr><td>Menjaga keamanan sistem dan mencegah penyalahgunaan</td><td>Kepentingan sah yayasan</td></tr></tbody></table>
  <p>Data tidak dipakai untuk iklan, pembuatan profil pemasaran, atau dijual kepada siapa pun.</p>

  <h2>6. Dengan siapa data dibagikan</h2>
  <p><b>Di dalam yayasan.</b> Petugas dan guru hanya melihat data lembaga tempat mereka bertugas. Guru hanya memakai absensi dan pelanggaran, tanpa melihat pembayaran, NIK, atau alamat siswa. Admin yayasan dapat melihat seluruh lembaga. Setiap orang tua atau wali hanya melihat data anaknya sendiri.</p>
  <p><b>Penyedia layanan yang membantu menjalankan aplikasi,</b> dan hanya bertindak atas perintah kami:</p>
  <ul><li>Penyedia server (VPS): ${v('penyedia_server')}, tempat database dan cadangan tersimpan.</li>
  <li>Meta Platforms (WhatsApp Business Platform), untuk menerima dan membalas pesan guru dan petugas. Server Meta dapat berada di luar Indonesia.</li>
  <li>Google Play atau Apple App Store, bila aplikasi wali dipasang lewat toko. Mereka memproses data pemasangan sesuai kebijakan mereka; kami tidak mengirim data siswa ke toko aplikasi.</li></ul>
  <p><b>Pihak berwenang,</b> bila diwajibkan oleh hukum. Pelaporan resmi kepada kementerian atau dinas pendidikan dilakukan sekolah sesuai ketentuan, di luar aplikasi ini.</p>
  <p>Untuk penyedia di luar Indonesia, kami memilih penyedia yang menerapkan pelindungan data yang sepadan.</p>

  <h2>7. Pesan WhatsApp</h2>
  <p>Guru dan petugas yang nomornya didaftarkan admin dapat mengirim perintah singkat, misalnya mencatat absensi atau pelanggaran, ke satu nomor WhatsApp resmi sekolah. Pesan diproses oleh Meta sebagai penyedia WhatsApp Business Platform, lalu diteruskan ke aplikasi kami. Pesan dari nomor yang tidak terdaftar ditolak dan tidak diproses.</p>
  <p>Kami menyimpan isi pesan dan balasan sistem sebagai riwayat penelusuran selama <b>90 hari</b>, lalu menghapusnya otomatis. Hasil pesan (absensi atau pelanggaran) tersimpan sesuai bagian 9. Sistem hanya membalas pesan yang masuk dan tidak mengirim pesan promosi. Guru dan petugas diminta tidak mengirim NIK, alamat, atau data sensitif lain lewat WhatsApp; perintah yang tersedia hanya memerlukan nama, kelas, status, dan alasan singkat. Wali murid tidak berhubungan dengan sistem lewat WhatsApp.</p>

  <h2>8. Keamanan</h2>
  <ul><li>Semua koneksi memakai HTTPS.</li>
  <li>Kata sandi disimpan terenkripsi satu arah, minimal 8 karakter. Akun baru dan hasil reset password wajib mengganti kata sandi saat masuk pertama.</li>
  <li>Akses dibatasi menurut peran dan lembaga. Percobaan masuk yang berulang dibatasi sementara.</li>
  <li>Pesan WhatsApp diperiksa tanda tangan digitalnya, sehingga hanya pesan asli dari Meta yang diproses.</li>
  <li>Database dicadangkan otomatis setiap hari (14 salinan terakhir).</li></ul>
  <p>Tidak ada sistem yang sepenuhnya aman. Bila terjadi kebocoran data yang berisiko bagi pemilik data, kami akan memberi tahu pemilik data dan pihak berwenang sesuai ketentuan perundang-undangan.</p>

  <h2>9. Berapa lama data disimpan</h2>
  <table><thead><tr><th>Data</th><th>Lama penyimpanan</th></tr></thead><tbody>
  <tr><td>Data siswa aktif: identitas, absensi, nilai, pembayaran, pelanggaran</td><td>Selama siswa terdaftar</td></tr>
  <tr><td>Data alumni: identitas, nilai akhir, tahun lulus</td><td>${v('retensi_alumni')}</td></tr>
  <tr><td>Pendaftar yang tidak diterima</td><td>${v('retensi_pendaftar')}</td></tr>
  <tr><td>Akun wali</td><td>Selama ada anak yang terhubung; dihapus bila tautan ke anak dilepas dan tidak ada anak lain</td></tr>
  <tr><td>Riwayat pesan WhatsApp</td><td>90 hari, dihapus otomatis</td></tr>
  <tr><td>Cadangan database</td><td>14 salinan harian terakhir; data yang dihapus hilang dari cadangan setelah sekitar 14 hari</td></tr>
  <tr><td>Sesi masuk</td><td>12 jam</td></tr></tbody></table>

  <h2>10. Hak Anda</h2>
  <p>Sebagai pemilik data, atau orang tua dan wali yang mewakili anak, Anda berhak:</p>
  <ul><li>mengetahui dan meminta salinan data yang kami simpan;</li><li>meminta data yang salah diperbaiki;</li><li>meminta data dihapus atau pemrosesannya dibatasi, sepanjang tidak bertentangan dengan kewajiban administrasi pendidikan;</li><li>menarik persetujuan yang pernah diberikan;</li><li>mengajukan keberatan dan pengaduan.</li></ul>
  <p>Cara mengajukan: hubungi kontak di bagian 12 atau tata usaha lembaga, sebutkan nama anak dan lembaganya. Kami memverifikasi dulu bahwa pemohon adalah orang tua atau wali yang tercatat, lalu menjawab permintaan secepatnya. Data yang wajib dipertahankan, misalnya nilai dan riwayat kelulusan, akan kami jelaskan alasannya.</p>
  <p id="hapus-data"><b>Permintaan penghapusan data atau akun.</b> Kirim email ke alamat di bagian 12 dengan subjek "Penghapusan data", sebutkan nama anak, lembaga, dan nomor HP akun wali. Kami menghapus akun wali dan data yang tidak lagi wajib disimpan.</p>

  <h2>11. Data anak dan persetujuan orang tua</h2>
  <p>Sebagian besar siswa belum dewasa. Karena itu kami meminta persetujuan orang tua atau wali pada formulir pendaftaran online; persetujuan itu dicatat bersama waktunya. Halaman masuk aplikasi wali juga menampilkan tautan ke kebijakan ini. Orang tua dapat menarik persetujuan kapan saja; akibatnya sebagian layanan, misalnya akses aplikasi wali, dapat berhenti, sedangkan data yang wajib untuk administrasi pendidikan tetap diproses sesuai dasarnya. Kami tidak memakai data anak untuk iklan atau pemasaran.</p>

  <h2>12. Perubahan kebijakan dan kontak</h2>
  <p>Bila kebijakan berubah, kami mengumumkannya di aplikasi dan memperbarui tanggal berlaku. Perubahan yang mengurangi hak Anda tidak berlaku surut.</p>
  <table><tbody>
  <tr><th>Pejabat pelindungan data</th><td>${v('pejabat_pdp')}</td></tr>
  <tr><th>Email</th><td>${v('kontak_email')}</td></tr>
  <tr><th>Telepon / WhatsApp</th><td>${v('kontak_telepon')}</td></tr>
  <tr><th>Alamat</th><td>${v('alamat_kantor')}</td></tr></tbody></table>`;
  document.title = 'Kebijakan Privasi - Yayasan Miftahul Ulumillah';
  if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); }
});
