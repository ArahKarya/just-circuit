# Circuit Design Studio (CDS)

Desain PCB dengan kode [tscircuit](https://github.com/tscircuit/tscircuit) langsung di browser, dibantu asisten AI. Semua yang biasanya dilakukan lewat `tsci` CLI (preview skematik/PCB/3D, impor part JLCPCB, ekspor file produksi) ada di satu halaman web.

## Fitur

- **Editor + preview live**: editor Monaco, preview PCB / Schematic / 3D / BOM dari `@tscircuit/runframe`. Kode dijalankan di browser (web worker), bukan di server.
- **Chat AI**: minta rangkaian dengan bahasa biasa. AI menulis file baru secara lengkap dan mengubah file yang ada lewat edit sebagian (blok SEARCH/REPLACE), jadi desain besar tidak terpotong batas token. Kodenya langsung diterapkan dan dipreview; edit yang tidak cocok dikembalikan ke AI. Kalau build gagal, error dikirim balik ke AI untuk diperbaiki otomatis (default 2x, bisa diatur). Setiap perubahan dari AI bisa dibatalkan.
- **Pengaturan lengkap** (ikon gerigi): beberapa koneksi AI, "Ambil model", "Tes koneksi", level thinking dan batas waktu per koneksi, model terpisah untuk auto-fix; per proyek: koneksi sendiri dan aturan tambahan untuk AI; tema gelap/terang/sistem, editor, preview; cadangan pengaturan (tanpa API key).
  - OpenAI-compatible: OpenRouter, Groq, Ollama lokal, 9router, OpenAI, atau endpoint `/v1/chat/completions` lainnya
  - Anthropic (Claude) native
  - Google Gemini native
- **Atur posisi (drag & drop di PCB)**: tombol "Atur posisi" membuka PCB yang bisa diseret. Komponen yang posisinya sudah ditulis di kode (`pcbX`/`pcbY`) diperbarui langsung di kode; komponen lain disimpan ke `manual-edits.json` (format resmi tscircuit, otomatis di-import ke `<board manualEdits={...}>`). Hapus tab `manual-edits.json` untuk mereset posisi manual.
- **Proyek disimpan di server**: setiap proyek adalah folder biasa di `~/cds-data/workspaces/default/<id-proyek>/` yang bisa langsung dibuka dengan `tsci dev`. Riwayat chat ada di `.cds/chat.json` di folder yang sama. Buat, ganti nama, duplikat, hapus (dipindah ke `~/cds-data/trash/`), unduh ZIP.
- **Penjelajah file**: folder, file baru (`lib/power.tsx`), ganti nama/pindah file dan folder, hapus, jadikan file utama (ikon bintang), dan cari teks di semua file (klik hasil untuk loncat ke barisnya).
- **Workspace & tempat sampah**: kelompokkan proyek per workspace, pindahkan antar workspace, proyek yang dihapus bisa dipulihkan selama 30 hari. Proyek baru bisa dari template (LED, kosong, Raspberry Pi Pico, catu daya 3.3V) atau impor ZIP.
- **Board besar: tombol "Skematik" dan "Routing" di header** (disimpan per proyek). Di board ratusan komponen, bagian build paling lama adalah solver kabel skematik (PLC 300 part: ±190 detik), lalu routing PCB (±30 detik); cek penempatan dan netlist saja hanya beberapa detik. Matikan skematik selama mengerjakan PCB, dan matikan routing untuk cek cepat. Pengaturan yang sama dipakai preview browser dan build agen di server. Kalau build sudah 45 detik lebih, header menawarkan "Lama? Matikan skematik". AI selalu menerima daftar masalah build terakhir (maks. 40 baris) dan tahu bagian mana yang sengaja dimatikan.
- **Cari part** (tombol di header): satu pencarian ke katalog datasheet tscircuit, JLCPCB/LCSC, Texas Instruments, DigiKey, Mouser, footprint resmi KiCad dan registry tscircuit, tidak terikat satu pabrik PCB. Part yang ada di katalog datasheet langsung jadi komponen `lib/parts/<Nama>.tsx` (peta pin, footprint, atribut pin; dibangun CDS dari datanya, bukan dari kode pihak luar) dan bisa disimpan ke Library. Part tanpa file CAD: "Buat dari datasheet" membuat server mengunduh PDF datasheet resmi (hanya alamat publik, port 80/443) ke lampiran chat beserta permintaan untuk AI; AI menyusun peta pin dan memilih footprint KiCad. Impor lengkap JLCPCB (simbol, footprint, 3D) tetap ada di dialog ini. Agen punya tool `search_parts` dan `search_footprints`.
- **Lampiran di chat**: lampirkan referensi dari luar (gambar skematik, foto board, datasheet PDF, netlist, BOM, file KiCad/Eagle) lewat tombol klip, seret ke panel chat, atau tempel screenshot (Cmd/Ctrl+V), lalu minta "buatkan PCB dari ini". Gambar besar diperkecil di browser (sisi terpanjang 2048 px). PDF sampai 20 halaman dikirim utuh ke Claude/Gemini (gambar dan tabel ikut terbaca); PDF yang lebih panjang dan provider lain menerima teks hasil ekstraksi per halaman. Lampiran disimpan di `.cds/attachments/` proyek (di luar riwayat versi), ikut terkirim di pertanyaan berikutnya selama masih dalam batas riwayat chat, dan terhapus saat riwayat chat dihapus. Batas: 6 file per pesan, gambar 8 MB, PDF 32 MB, teks 2 MB. Memori AI tidak disimpan otomatis dari jawaban yang membaca lampiran.
- **Mode agen** (tombol "Mode agen" di chat): AI bekerja dengan tools: membaca file yang dibutuhkan saja, mengubah lewat edit kecil, mencari part JLCPCB (nomor LCSC, stok, harga), lalu hasilnya dibangun preview dan error dikirim balik otomatis. Setiap jawaban agen jadi satu versi di Riwayat; langkah-langkahnya bisa dilihat di chat. AI bisa mengusulkan perintah terminal: tombol "Tempel ke terminal" hanya mengetikkannya, kamu yang menekan Enter. Opsional: "Izinkan agen menjalankan build di server" (Pengaturan → AI) menjalankan build (bun + `@tscircuit/core`, mengikuti tombol Skematik/Routing) di sandbox (macOS `sandbox-exec`, Linux `bwrap`) tanpa jaringan dan tanpa akses folder home; runtime `tscircuit`+`react` disiapkan sekali di `CDS_DATA_DIR/build-runtime` (butuh `bun`).
- **Panel Masalah (DRC/ERC)**: tab "Masalah" (atau klik status build di header) menampilkan error dan peringatan PCB, skematik, dan rangkaian. Klik nama komponen (R1, U1…) untuk loncat ke deklarasinya di kode; tombol "Minta AI perbaiki" mengirim semua error ke AI.
- **Memori AI**: AI mencatat keputusan penting (pilihan part, pinout, tegangan) ke memori proyek, dan preferensimu ke memori global; keduanya selalu dikirim ke AI dan bisa diedit di Pengaturan → Memori.
- **Library komponen**: simpan file atau folder (mis. modul catu daya, kanal I/O PLC) ke library lewat ikon buku di penjelajah file, lalu sisipkan ke proyek lain lewat tombol **Library** (disalin ke `lib/<nama>/` dan di-import otomatis). AI mengetahui isi library-mu. Paket registry tscircuit (`@tsci/<author>.<nama>`) dan npm juga bisa di-import langsung di kode.
- **Terminal** (tombol Terminal atau Ctrl+\`): shell sungguhan di server, mulai di folder proyek aktif, bisa beberapa tab. Jalankan `tsci build`, `tsci add`, `git`, dst. File yang diubah dari terminal otomatis muncul di editor dan preview, dan dicatat sebagai versi "Perubahan di luar editor". Tombol cepat: `tsci build`, `git log`.
- **Riwayat versi**: setiap proyek adalah repo git. Perubahan dari AI, batal (undo), dan impor part otomatis tercatat sebagai versi; tombol **Riwayat** menampilkan diff tiap versi, menyimpan versi manual, dan mengembalikan versi lama (isi sekarang disimpan dulu, jadi tidak ada yang hilang). Butuh `git` di server.
- **Login**: satu pengguna, password di-hash scrypt (`pnpm set-password`). Tanpa password, server hanya mau berjalan di 127.0.0.1.
- **Pindah dari versi lama**: proyek, chat, dan pengaturan AI yang dulu tersimpan di browser (IndexedDB) otomatis dipindahkan ke server saat aplikasi pertama kali dibuka. Salinan di browser tidak dihapus.
- **Impor part JLCPCB**: cari part (mis. `C46749`), lalu komponen TSX-nya ditambahkan ke `imports/` dan otomatis di-import ke file utama.
- **Ekspor** (menu File → Export di preview): Fabrication files (Gerber), KiCad project/library, STEP, GLB, Pinout SVG, Circuit JSON, dan lainnya.

## Arsitektur

```
browser (Vite + React 19)                       server (Express 5, kecil)
├─ runframe: eval TSX + viewer (web worker)     ├─ /api/auth             → login, sesi (cookie httpOnly)
├─ Monaco editor                                ├─ /api/projects         → proyek + chat (folder di CDS_DATA_DIR)
└─ klien API (src/lib/repo.ts)                  ├─ /api/settings         → pengaturan AI, API key terenkripsi AES-256-GCM
                                                ├─ POST /api/llm/chat    → stream NDJSON dari provider (Vercel AI SDK)
                                                ├─ POST /api/llm/models  → daftar model provider
                                                └─ ALL  /api/jlc/proxy   → proxy CORS ke EasyEDA/JLCPCB (allowlist host)

CDS_DATA_DIR (default ~/cds-data)
├─ workspaces/default/<id-proyek>/   file sirkuit + package.json (tsci) + .cds/{project,chat}.json + .cds/attachments/
├─ trash/                            proyek yang dihapus
├─ settings.json                     pengaturan AI (key terenkripsi)
├─ sessions.json                     sesi login (hash token)
└─ secret.key                        kunci enkripsi (kalau CDS_SECRET tidak diisi)
```

API key tidak pernah dikirim balik ke browser. Browser hanya mengirim id koneksi, lalu server membaca key-nya sendiri.

## Menjalankan

Butuh Node 22+ dan pnpm.

```bash
pnpm install
cp .env.example .env    # opsional
pnpm dev                # web http://localhost:5180, API :8787
```

Lalu buka **Pengaturan AI** (ikon gerigi), tambahkan koneksi dari preset, isi API key, lalu Simpan.

Untuk membuka server ke jaringan (mis. Tailscale), pasang password dulu:

```bash
pnpm set-password                      # salin baris CDS_PASSWORD_HASH=... ke .env
HOST=0.0.0.0 pnpm start
```

Produksi:

```bash
NODE_OPTIONS=--max-old-space-size=8192 pnpm build
pnpm start              # satu proses: API + file statis di API_PORT
```

### Variabel lingkungan

| Nama | Default | Keterangan |
|---|---|---|
| `API_PORT` | `8787` | Port server API (dev server Vite mem-proxy `/api` ke sini) |
| `HOST` | `127.0.0.1` (dev) / `0.0.0.0` (prod) | Interface yang didengarkan server |
| `ALLOW_PRIVATE_LLM_HOSTS` | `true` (dev) / `false` (prod) | Izinkan base URL ke localhost/LAN (perlu untuk Ollama). Biarkan `false` kalau server bisa diakses orang lain, supaya tidak bisa dipakai menembus jaringan internal. |
| `CDS_DATA_DIR` | `~/cds-data` | Lokasi proyek, chat, pengaturan, sesi |
| `CDS_PASSWORD_HASH` | kosong | Hash password login dari `pnpm set-password`. Wajib kalau `HOST` bukan 127.0.0.1 |
| `CDS_SECRET` | kosong | Kunci 32 byte (64 hex) untuk mengenkripsi API key; kalau kosong dibuat otomatis di `CDS_DATA_DIR/secret.key` |
| `COOKIE_SECURE` | `false` (dev) / `true` (prod) | Cookie sesi hanya lewat HTTPS. Set `false` kalau produksi diakses lewat HTTP (mis. Tailscale tanpa TLS) |
| `SESSION_TTL_DAYS` | `30` | Lama sesi login |
| `ENABLE_TERMINAL` | `true` (dev) / `false` (prod) | Terminal di browser. Tanpa password, program lain di mesin yang sama juga bisa membukanya |
| `TERMINAL_SHELL` | `$SHELL` | Shell yang dijalankan |
| `MAX_TERMINALS` | `8` | Jumlah terminal terbuka sekaligus |
| `CDS_ALLOWED_HOSTS` | kosong | Nama host tambahan yang boleh dipakai membuka CDS (mis. nama Tailscale), dipisah koma |
| `RATE_LIMIT_PER_MINUTE` | `60` | Batas request chat/model AI (`/api/llm`) per IP per menit |
| `JLC_RATE_LIMIT_PER_MINUTE` | `1200` | Batas request proxy part JLCPCB per IP per menit (satu render preview bisa memicu puluhan) |

## Tes

```bash
pnpm test          # unit test (vitest)
pnpm test:e2e      # E2E Playwright; server sendiri di port 5181/8788 dengan data di .e2e-data, mock LLM lokal (e2e/mock-llm.mjs)
```

Tes impor JLCPCB (`e2e/import.spec.ts`) memanggil API jlcsearch/EasyEDA yang asli, jadi butuh internet.

## Keamanan

- Proxy LLM menolak host privat (kecuali diizinkan), tidak mengikuti redirect, dan membatasi ukuran respons.
- Proxy JLCPCB hanya ke `easyeda.com`, `lcsc.com`, `jlcpcb.com`, `szlcsc.com` lewat HTTPS.
- API key disimpan terenkripsi di server dan tidak pernah dikirim ke browser. Kode sirkuit tetap dijalankan di browser; kode jahat bisa memanggil API CDS atas nama sesi yang sedang login, jadi periksa kode dari sumber yang tidak dipercaya sebelum dijalankan.
- Login satu pengguna dengan cookie httpOnly + SameSite=Strict; setiap request yang mengubah data wajib membawa header `X-CDS-Request` (proteksi CSRF). Tetap disarankan di belakang Tailscale / reverse proxy HTTPS.
- Jalur file proyek divalidasi: tanpa `..`, file tersembunyi, `node_modules/`, `dist/`, `package.json`, atau file konfigurasi tool (supaya kode tulisan AI tidak ikut dijalankan `tsci`), dan tidak menulis lewat symlink yang keluar dari folder proyek.
- Header `Host` dicek (hanya localhost dan nama di `CDS_ALLOWED_HOSTS`) untuk mencegah DNS rebinding. Tanpa password, request yang lewat proxy/tunnel (`X-Forwarded-For`, `CF-Connecting-IP`) ditolak, dan mode produksi wajib password.
- Terminal: WebSocket `/api/terminal` hanya diterima dari halaman CDS sendiri (Origin = Host), setelah login dan cek Host; environment shell hanya berisi variabel dasar (PATH, HOME, LANG, …), bukan isi `.env` atau API key. Terminal tetap berarti akses penuh ke mesin untuk pengguna yang login: shell bisa membaca `CDS_DATA_DIR` (termasuk `secret.key`). Di produksi terminal mati kecuali `ENABLE_TERMINAL=true`.
- Mode agen: kode tulisan AI dianggap tidak tepercaya (bisa dipengaruhi teks dari katalog part atau file impor). Build di server mati secara default; kalau dinyalakan, build jalan di salinan sementara di dalam sandbox OS dan ditolak kalau sandbox tidak tersedia. Memori tidak ditulis otomatis dari jawaban yang membaca data part dari luar.
- API key tersimpan hanya dikirim ke Base URL tempat key itu disimpan; mengganti Base URL atau jenis API mewajibkan key diisi ulang.

## Catatan

- Roadmap pengembangan: [docs/ROADMAP.md](docs/ROADMAP.md).

- `tsc` butuh heap besar karena tipe tscircuit sangat besar; `src/types/runframe.d.ts` berisi tipe ringkas untuk bagian runframe yang dipakai.
- Ekspor Altium tidak didukung (paketnya hanya tersedia dari git dan butuh build Bun). Pakai ekspor KiCad lalu impor ke Altium.
- Mesin eval tscircuit (`@tscircuit/eval`, ±21 MB) dilayani dari aplikasi sendiri di `/vendor/tscircuit-eval-<versi>.js` (lihat `vite-plugins/eval-worker.ts`), jadi preview tidak bergantung pada CDN. Versi `@tscircuit/eval`, `runframe`, dan `core` dikunci persis di `package.json`; naikkan ketiganya bersamaan.
- Beberapa hasil pengecekan tscircuit ditampilkan sebagai **peringatan**, bukan error, misalnya polaritas LED/dioda yang berbeda dengan part JLCPCB pilihan otomatis. Peringatan tidak memicu auto-fix AI.
- Preview PCB memakai WebGPU; pakai Chrome/Edge/Safari versi baru. Tes E2E menyalakan WebGPU software (SwiftShader) lewat argumen Chromium di `e2e/layout.spec.ts`.
- Geser komponen hanya di PCB. Schematic viewer di runframe versi ini belum mengirim event edit.
