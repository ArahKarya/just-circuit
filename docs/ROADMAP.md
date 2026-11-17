# Roadmap CDS

Status per 16 Nov 2026. Aplikasi hanya versi web. Keputusan: proyek pindah ke penyimpanan server (folder di disk, kompatibel tsci) dengan login satu pengguna.

## Fase 0 — Stabilisasi

- [x] Eval worker tscircuit dilayani dari aplikasi sendiri dengan versi terkunci (sebelumnya diambil dari CDN `latest`; preview mati kalau CDN gagal).
- [x] Temperature tidak dikirim ke model yang menolaknya (Claude 5.x, GPT-5, seri o); bisa diatur per koneksi.
- [x] AI boleh mengirim edit sebagian (blok SEARCH/REPLACE) alih-alih menulis ulang seluruh file; edit yang gagal diterapkan dilaporkan balik ke AI.
- [x] Riwayat chat lebih ringan: blok kode di pesan lama diganti penanda (isi file terbaru sudah ada di system prompt).
- [x] Batas ukuran system prompt dinaikkan (proyek besar seperti PLC melebihi 60 ribu karakter).
- [x] Preview yang crash menampilkan pesan dan tombol muat ulang.
- [x] System prompt: IC/modul wajib `manufacturerPartNumber`, pasif wajib nilai, supaya label terlihat di skematik.
- [x] Rate limit dipisah: chat AI 60/menit, proxy part JLCPCB 1200/menit (sebelumnya satu render preview bisa menghabiskan kuota chat → "Terlalu banyak permintaan").
- [x] Paket tscircuit dinaikkan dan dikunci (eval 0.0.1781, runframe 0.0.3251, core 0.0.2385).
- [x] Peringatan desain (mis. polaritas LED beda dengan part JLCPCB) tampil sebagai "N peringatan", tidak dihitung build error.
- [ ] Bug temuan pengguna (tambahkan di sini, masing-masing dengan tes E2E).

## Fase 1 — Workspace di server

### 1A (selesai 16 Nov 2026)

- [x] Penyimpanan filesystem `CDS_DATA_DIR/workspaces/<workspace>/<proyek>/` (file tsci + `.cds/project.json` + `.cds/chat.json`), hapus = pindah ke `trash/`.
- [x] Login satu pengguna (scrypt, `pnpm set-password`), sesi persisten, cookie httpOnly SameSite=Strict, header CSRF.
- [x] API key terenkripsi AES-256-GCM di server, tidak pernah dikirim ke browser.
- [x] Migrasi otomatis IndexedDB → server (sekali per browser, salinan lama tidak dihapus).
- [x] E2E memakai server dan folder data sendiri.

### 1B

- [x] Workspace: buat, ganti nama, hapus (kalau kosong), pindahkan proyek antar workspace (folder ikut pindah di disk).
- [x] Tempat sampah: daftar, pulihkan ke workspace asal, hapus permanen, kosongkan; otomatis dibersihkan setelah 30 hari.
- [x] Template proyek: LED, kosong, Raspberry Pi Pico, catu daya 3.3V AMS1117 (file di `templates/`, dicek dengan `tsci build`).
- [x] Impor ZIP (folder tsci atau unduhan CDS); `node_modules`, `dist`, file biner dilewati.
- [x] Cari dan urutkan proyek.
- [x] Riwayat versi git per proyek: versi otomatis tiap perubahan AI / undo / impor part, "Simpan versi" manual, lihat diff, kembalikan versi (edit tangan disimpan dulu sebagai "Perubahan manual").
- [x] Penjelajah file: folder, file baru, ganti nama/pindah (file & folder), hapus, jadikan file utama, cari teks di semua file lalu loncat ke barisnya.
- [x] Edit dari terminal/tsci yang belum tercatat disimpan sebagai versi "Perubahan di luar editor" sebelum disimpan ulang dari browser.

Rencana awal:

- Antarmuka penyimpanan (repository) dengan backend filesystem: `WORKSPACE_DIR/<workspace>/<proyek>/` berisi file tsci (`index.circuit.tsx`, `package.json`, `manual-edits.json`, `.cds/chat.json`).
- Login satu pengguna (hash password di `.env`, cookie sesi httpOnly, proteksi CSRF), API key disimpan terenkripsi di server.
- Migrasi sekali jalan IndexedDB → server.
- Workspace → Proyek → file; pohon file dengan folder, buat/ganti nama/pindah/hapus file, cari isi semua file.
- Daftar proyek: cari, urutkan, tag, favorit; template (kosong, Pico, ESP32, modul catu daya).
- Riwayat versi: setiap proyek repo git, commit otomatis tiap perubahan AI; lihat diff dan kembalikan versi.
- Tempat sampah 30 hari; impor ZIP / folder tsci / URL GitHub; ekspor semua.

## Fase 2 — Pengaturan (selesai 16 Nov 2026)

- [x] Dialog Pengaturan bertab: AI, Tampilan & editor, Proyek ini, Cadangan.
- [x] Per koneksi: level thinking (opsi `reasoning` AI SDK), batas waktu jawaban pertama & diam, temperature, tombol "Tes koneksi".
- [x] Model terpisah untuk auto-fix; jumlah riwayat chat yang dikirim.
- [x] Per proyek: koneksi AI sendiri dan aturan tambahan untuk AI (masuk system prompt).
- [x] Tema gelap/terang/ikuti sistem; editor (font, tab, bungkus baris, nomor baris, minimap); preview (jeda build, tab awal).
- [x] Cadangan & pulihkan pengaturan (tanpa API key).
- [ ] Mode Vim di editor (butuh paket monaco-vim, belum).
- [ ] Default board (layer, clearance) sebagai field terstruktur — sementara lewat "aturan tambahan".

## Fase 3 — Terminal (selesai 16 Nov 2026)

- [x] xterm.js + node-pty + WebSocket `/api/terminal`; panel bawah (Ctrl+\`), banyak tab, ubah tinggi, besarkan; cwd = folder proyek.
- [x] Perubahan file dari terminal muat ulang otomatis ke editor/preview (setelah output berhenti 0,7 dtk) dan dicatat sebagai versi.
- [x] Tombol cepat `tsci build`, `git log`.
- [x] Keamanan: login + Host + Origin, env shell allowlist, batas sesi, heartbeat, backpressure, frame besar tidak menjatuhkan server; mati default di produksi.

## Fase 4 — AI lebih pintar

- [x] Memori AI: memori proyek (`.cds/memory.md`) dan global (`CDS_DATA_DIR/memory.md`), selalu dikirim ke AI; AI mencatat sendiri lewat blok `memory`; bisa diedit di Pengaturan → Memori.
- [x] Library komponen (`CDS_DATA_DIR/library/`): simpan file/folder ke library (ikon buku di penjelajah file), sisipkan ke proyek lain ke `lib/<nama>/` + import otomatis, AI tahu katalog library; prompt menjelaskan paket `@tsci/...` dan npm.
- [x] Mode agen: AI memakai tools (daftar/baca/cari/tulis/ubah/hapus file, build, cari part JLCPCB); satu versi git per jawaban; langkah tampil di chat.
- [x] Hasil agen dicek preview browser dan error dikirim balik otomatis; build di server opsional dan di dalam sandbox (sandbox-exec / bwrap, tanpa jaringan, home tidak terbaca, salinan sementara).
- [x] AI mengusulkan perintah terminal; hanya ditempel ke terminal setelah diklik, Enter ditekan pengguna sendiri.
- [x] Panel DRC/ERC (tab "Masalah"): error/peringatan PCB, skematik dan rangkaian dari circuit JSON, saring, klik nama komponen untuk loncat ke deklarasinya di kode, "Minta AI perbaiki". Status build di header membuka panel ini.
- [x] Lampiran di chat: gambar (diperkecil di browser), PDF (utuh ke Claude/Gemini sampai 20 halaman, selain itu teks per halaman lewat `unpdf`), file teks/netlist/KiCad; klip, seret, tempel screenshot; disimpan di `.cds/attachments/`, dihapus bersama chat.
- [x] Board besar: tombol Skematik/Routing per proyek (platformConfig `schematicDisabled`/`routingDisabled` untuk preview, runner bun + core untuk build agen), daftar masalah build terakhir dikirim ke AI.
- [x] Cari part multi-sumber (katalog datasheet, JLCPCB/LCSC, TI, DigiKey, Mouser, KiCad, registry): tambah dari katalog, simpan ke Library, "Buat dari datasheet" (server unduh PDF ke chat), tool agen search_parts/search_footprints.
- [x] Footprint `kicad:` di build agen: diunduh di luar sandbox ke cache disk, runner memakainya lewat footprintLibraryMap.
- [x] Unggah `.kicad_mod` (pabrikan/SnapEDA/Ultra Librarian) → komponen + footprint JSON, chat disiapkan untuk nama pin.
