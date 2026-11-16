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
- [ ] Riwayat versi git per proyek.
- [ ] Pohon file dengan folder + cari isi semua file.

Rencana awal:

- Antarmuka penyimpanan (repository) dengan backend filesystem: `WORKSPACE_DIR/<workspace>/<proyek>/` berisi file tsci (`index.circuit.tsx`, `package.json`, `manual-edits.json`, `.cds/chat.json`).
- Login satu pengguna (hash password di `.env`, cookie sesi httpOnly, proteksi CSRF), API key disimpan terenkripsi di server.
- Migrasi sekali jalan IndexedDB → server.
- Workspace → Proyek → file; pohon file dengan folder, buat/ganti nama/pindah/hapus file, cari isi semua file.
- Daftar proyek: cari, urutkan, tag, favorit; template (kosong, Pico, ESP32, modul catu daya).
- Riwayat versi: setiap proyek repo git, commit otomatis tiap perubahan AI; lihat diff dan kembalikan versi.
- Tempat sampah 30 hari; impor ZIP / folder tsci / URL GitHub; ekspor semua.

## Fase 2 — Pengaturan

Global dan per proyek (per proyek menimpa global).

- AI per koneksi: temperature, max token, budget thinking, timeout first-chunk dan idle; model per tugas (chat vs auto-fix); aturan/system prompt tambahan per proyek; tombol "Tes koneksi".
- Editor: tema, font, tab size, word wrap, minimap, mode Vim.
- Preview: jeda auto-run, tab default, auto-run on/off.
- Default board: jumlah layer, ukuran, clearance DRC.
- Aplikasi: tema terang/gelap, shortcut; backup/restore pengaturan (tanpa API key).

## Fase 3 — Terminal

- xterm.js (browser) + node-pty + WebSocket (server); panel bawah (Ctrl+`), banyak tab, cwd = folder proyek aktif.
- Pemantau folder: perubahan dari terminal (`tsci add`, `git checkout`) langsung muncul di editor/preview, dan sebaliknya.
- Tombol cepat: `tsci build`, export Gerber, `git log`.
- Keamanan: wajib login, cek Origin WebSocket, mati default di produksi (`ENABLE_TERMINAL=true`), bind 127.0.0.1 / Tailscale.

## Fase 4 — AI agen (opsional)

- AI memakai tools: baca file, jalankan build, baca error, cari part JLCPCB.
- AI mengusulkan perintah terminal, dijalankan setelah disetujui.
- Panel DRC/ERC yang bisa diklik ke komponen.
