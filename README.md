<div align="center">

# Just Circuit — IDE PCB di Browser dengan Agen AI

**Desain rangkaian dengan kode tscircuit, dibantu AI, dicek simulator, lalu diekspor ke produksi. Satu halaman web.**

[![Status](https://img.shields.io/badge/Status-Dalam%20Pengembangan-16C79A?style=flat-square)](docs/ROADMAP.md)
[![Stack](https://img.shields.io/badge/Stack-React%2019%20%2B%20Express%205-0F3460?style=flat-square)](#-stack)
[![Language](https://img.shields.io/badge/TypeScript-Node%2022%2B-3178C6?style=flat-square&logo=typescript&logoColor=white)](package.json)
[![Engine](https://img.shields.io/badge/Engine-tscircuit%20runframe-7B2FBF?style=flat-square)](https://github.com/tscircuit/tscircuit)
[![AI](https://img.shields.io/badge/AI-Claude%20%7C%20Gemini%20%7C%20OpenAI--compatible-FF6F61?style=flat-square)](#pengaturan-ai)

</div>

> Produk **PT Arah Karya Sinergi**.

Just Circuit memindahkan alur kerja `tsci` CLI ke browser: tulis rangkaian sebagai kode [tscircuit](https://github.com/tscircuit/tscircuit), lihat **skematik, PCB, 3D, dan BOM** secara live, impor part dari katalog, lalu ekspor **Gerber, KiCad, dan STEP**. Asisten AI menulis dan mengubah kodenya, membaca datasheet yang Anda lampirkan, dan memperbaiki error build sendiri. Kode dijalankan di **web worker browser**, bukan di server. Server hanya menyimpan proyek, menjaga API key, dan meneruskan permintaan ke penyedia AI.

## ✨ Kenapa Just Circuit

| Masalah | Solusi |
|---|---|
| Desain PCB butuh pasang toolchain (`tsci`, KiCad, bun) di tiap mesin | Semua ada di satu halaman web; proyek tersimpan di server sebagai folder biasa yang tetap bisa dibuka dengan `tsci dev` |
| AI menulis ulang seluruh file sehingga desain besar terpotong batas token | Mode edit sebagian (blok SEARCH/REPLACE); edit yang tidak cocok dikembalikan ke AI, bukan diam-diam hilang |
| Kode AI sering gagal build | Error build dikirim balik ke AI dan diperbaiki otomatis (default 2x, bisa diatur); setiap perubahan AI bisa dibatalkan |
| Part sulit dicari dan pin-nya salah dipetakan | Satu pencarian ke datasheet tscircuit, JLCPCB/LCSC, Texas Instruments, DigiKey, Mouser, footprint KiCad, dan registry tscircuit; "Buat dari datasheet" membuat AI menyusun peta pin dari PDF resmi |
| Korsleting atau LED tanpa resistor baru ketahuan setelah board dicetak | Simulator DC di browser memeriksa korsleting, arus LED, daya resistor, pin mengambang, dan IC tanpa catu |
| Board ratusan komponen membuat preview berat | Tombol **Skematik** dan **Routing** bisa dimatikan per proyek; PLC 300 part: skematik ±190 detik, routing ±30 detik, cek penempatan dan netlist beberapa detik |

## 🧩 Fitur

### Editor dan preview

- **Editor + preview live**: Monaco, dengan tab PCB / Schematic / 3D / BOM dari `@tscircuit/runframe`.
- **Editor skematik interaktif** dan **PCB CAD** dengan routing jalur tembaga manual (ala KiCad). Perubahan ditulis balik ke kode TSX lewat patcher AST yang menjaga format asli, lengkap dengan undo/redo per file.
- **Mode hibrid**: komponen bisa dikunci supaya AI tidak menyentuhnya saat Anda mengedit manual.
- **Atur posisi** (drag & drop di PCB): posisi yang sudah ada di kode (`pcbX`/`pcbY`) diperbarui di kode; sisanya disimpan ke `manual-edits.json` (format resmi tscircuit). Hapus tab itu untuk mereset.
- **Impor KiCad** (`.kicad_pcb` / `.kicad_sch`) menjadi TSX yang bisa diedit; yang dilewati importer dilaporkan.
- **Simulator listrik DC** (titik operasi MNA dari netlist `circuitJson`): korsleting, LED overcurrent/terbalik/kurang tegangan, daya resistor, arus tinggi, tanpa ground/supply, pin mengambang. Board di atas 300 node dilewati dengan peringatan.
- **Panel Masalah (DRC/ERC)**: error dan peringatan PCB, skematik, rangkaian. Klik nama komponen (R1, U1, …) untuk loncat ke deklarasinya; "Minta AI perbaiki" mengirim semua error ke AI.

### Asisten AI

- **Chat AI**: file baru ditulis utuh, file yang ada diubah lewat edit sebagian. Kode langsung diterapkan dan dipreview.
- **Mode agen**: AI memakai tools untuk membaca file yang dibutuhkan saja, mengubah lewat edit kecil, `search_parts`, dan `search_footprints`. Hasilnya dibangun, dicek preview, error dikirim balik otomatis. Tiap jawaban agen jadi satu versi di Riwayat. Perintah terminal yang diusulkan hanya diketikkan; **Anda yang menekan Enter**.
- **Lampiran chat**: gambar skematik, foto board, PDF datasheet, netlist, BOM, file KiCad/Eagle (klip, seret, atau tempel screenshot). PDF sampai 20 halaman dikirim utuh ke Claude/Gemini; selebihnya sebagai teks per halaman. Batas: 6 file per pesan, gambar 8 MB, PDF 32 MB, teks 2 MB.
- **Memori AI**: keputusan proyek (pilihan part, pinout, tegangan) dan preferensi global dicatat otomatis, selalu dikirim ke AI, dan bisa diedit di Pengaturan → Memori.
- **Library komponen**: simpan file atau folder (modul catu daya, kanal I/O PLC) lalu sisipkan ke proyek lain lewat tombol **Library**. AI mengetahui isinya. Paket `@tsci/<author>.<nama>` dan npm juga bisa di-import langsung.

### Proyek dan part

- **Cari part**: hasil dari katalog datasheet langsung jadi `lib/parts/<Nama>.tsx` (peta pin, footprint, atribut pin). Part tanpa file CAD: "Buat dari datasheet" (server mengunduh PDF dari alamat publik port 80/443). File `.kicad_mod` dari pabrikan, SnapEDA, atau Ultra Librarian bisa diunggah. Impor penuh JLCPCB (simbol, footprint, 3D) tetap tersedia.
- **Proyek di server**: tiap proyek adalah folder `~/just-circuit-data/workspaces/default/<id-proyek>/`. Buat, ganti nama, duplikat, hapus (ke `trash/`, bisa dipulihkan 30 hari), unduh ZIP, impor ZIP. Template: LED, kosong, Raspberry Pi Pico, catu daya 3.3V.
- **Penjelajah file**: folder, file baru, ganti nama/pindah, hapus, file utama (ikon bintang), cari teks di semua file.
- **Riwayat versi**: tiap proyek adalah repo git. Perubahan AI, undo, dan impor part tercatat otomatis; ada diff, simpan versi manual, dan kembalikan versi lama (isi sekarang disimpan dulu).
- **Terminal** (Ctrl+\`): shell sungguhan di server, mulai di folder proyek, banyak tab. File yang berubah dari terminal otomatis muncul di editor dan dicatat sebagai versi.
- **Ekspor**: Fabrication files (Gerber), KiCad project/library, STEP, GLB, Pinout SVG, Circuit JSON.

## 🏛️ Arsitektur

```
browser (Vite + React 19)                       server (Express 5, kecil)
├─ runframe: eval TSX + viewer (web worker)     ├─ /api/auth             login, sesi (cookie httpOnly)
├─ Monaco editor                                ├─ /api/projects         proyek + chat (folder di JUST_CIRCUIT_DATA_DIR)
├─ Editor CAD skematik/PCB (patcher AST TSX)    ├─ /api/settings         pengaturan AI, API key terenkripsi AES-256-GCM
├─ Simulator DC (MNA)                           ├─ POST /api/llm/chat    stream NDJSON dari provider (Vercel AI SDK)
└─ klien API (src/lib/repo.ts)                  ├─ POST /api/llm/models  daftar model provider
                                                ├─ /api/parts            pencarian part multi-sumber
                                                └─ ALL  /api/jlc/proxy   proxy CORS ke EasyEDA/JLCPCB (allowlist host)

JUST_CIRCUIT_DATA_DIR (default ~/just-circuit-data)
├─ workspaces/default/<id-proyek>/   file sirkuit + package.json (tsci) + .just-circuit/{project,chat}.json + attachments/
├─ library/                          komponen bersama antarproyek
├─ trash/                            proyek yang dihapus (dibersihkan setelah 30 hari)
├─ settings.json                     pengaturan AI (key terenkripsi)
├─ sessions.json                     sesi login (hash token)
└─ secret.key                        kunci enkripsi (bila JUST_CIRCUIT_SECRET kosong)
```

API key **tidak pernah dikirim balik ke browser**. Browser hanya mengirim id koneksi, lalu server membaca key-nya sendiri.

## 🔁 Pipeline Satu Permintaan AI

```
pesan + lampiran ─► system prompt (file proyek, memori, library, masalah build terakhir)
      │
      ▼
  LLM (stream) ─► blok kode / SEARCH-REPLACE / tool call (mode agen)
      │
      ▼
  terapkan edit ─► build di web worker ─► error? ──ya──► kirim balik ke AI (auto-fix, default 2x)
      │                                      │
      │                                     tidak
      ▼                                      ▼
  satu versi git (bisa di-undo)        preview PCB / skematik / 3D / BOM
```

## 📁 Struktur Repo

```
src/                 aplikasi browser
  components/        chat, editor kode, preview, cad/ (skematik, PCB, inspector), parts, library, history, terminal, settings
  lib/               logika murni + tes: apply-edits, tsx-ast, kicad-import, circuit-sim, drc, manual-edits, llm-client
server/              API Express
  agent/             tools agen, build runner, pencarian JLCPCB, footprint KiCad
  llm/               provider AI, lampiran, timer idle
  parts/             katalog datasheet, sumber part, unduh PDF, parser .kicad_mod
  routes/            proyek, workspace, library, memori, pengaturan, migrasi
  auth/ security/    login scrypt, sesi, hash password
  middleware/ net/   host guard, rate limit, penjaga URL keluar
  terminal/          WebSocket + node-pty
shared/              kode dipakai bersama browser dan server
templates/           template proyek (LED, kosong, Pico, catu daya 3.3V)
e2e/                 tes Playwright + mock LLM lokal
docs/ROADMAP.md      rencana dan status per fase
```

## 🚀 Quickstart

Butuh **Node 22+** dan **pnpm**.

```bash
pnpm install
cp .env.example .env    # opsional
pnpm dev                # web http://localhost:5180, API :8787
```

Buka **Pengaturan AI** (ikon gerigi), tambahkan koneksi dari preset, isi API key, lalu Simpan.

### Membuka server ke jaringan (mis. Tailscale)

```bash
pnpm set-password                      # salin baris JUST_CIRCUIT_PASSWORD_HASH=... ke .env
HOST=0.0.0.0 pnpm start
```

### Produksi

```bash
NODE_OPTIONS=--max-old-space-size=8192 pnpm build
pnpm start              # satu proses: API + file statis di API_PORT
```

> `tsc` butuh heap besar karena tipe tscircuit sangat besar. Di mesin RAM 8 GB, jalankan build tanpa proses berat lain.

### Pengaturan AI

| Penyedia | Keterangan |
|---|---|
| OpenAI-compatible | OpenRouter, Groq, Ollama lokal, 9router, OpenAI, atau endpoint `/v1/chat/completions` lain |
| Anthropic | Claude native |
| Google | Gemini native |

Per koneksi: "Ambil model", "Tes koneksi", level thinking, batas waktu, temperature. Model terpisah untuk auto-fix. Per proyek: koneksi sendiri dan aturan tambahan untuk AI.

### Variabel lingkungan

| Nama | Default | Keterangan |
|---|---|---|
| `API_PORT` | `8787` | Port server API (dev server Vite mem-proxy `/api` ke sini) |
| `HOST` | `127.0.0.1` (dev) / `0.0.0.0` (prod) | Interface yang didengarkan server |
| `ALLOW_PRIVATE_LLM_HOSTS` | `true` (dev) / `false` (prod) | Izinkan base URL ke localhost/LAN (perlu untuk Ollama). Biarkan `false` bila server bisa diakses orang lain |
| `JUST_CIRCUIT_DATA_DIR` | `~/just-circuit-data` | Lokasi proyek, chat, pengaturan, sesi |
| `JUST_CIRCUIT_PASSWORD_HASH` | kosong | Hash dari `pnpm set-password`. Wajib bila `HOST` bukan 127.0.0.1 |
| `JUST_CIRCUIT_SECRET` | kosong | Kunci 32 byte (64 hex) untuk enkripsi API key; kosong = dibuat di `secret.key` |
| `COOKIE_SECURE` | `false` (dev) / `true` (prod) | Cookie sesi hanya lewat HTTPS. Set `false` bila produksi lewat HTTP (mis. Tailscale tanpa TLS) |
| `SESSION_TTL_DAYS` | `30` | Lama sesi login |
| `ENABLE_TERMINAL` | `true` (dev) / `false` (prod) | Terminal di browser |
| `TERMINAL_SHELL` | `$SHELL` | Shell yang dijalankan |
| `MAX_TERMINALS` | `8` | Jumlah terminal terbuka sekaligus |
| `JUST_CIRCUIT_ALLOWED_HOSTS` | kosong | Nama host tambahan yang boleh membuka Just Circuit (mis. nama Tailscale), dipisah koma |
| `RATE_LIMIT_PER_MINUTE` | `60` | Batas request chat/model AI per IP per menit |
| `JLC_RATE_LIMIT_PER_MINUTE` | `1200` | Batas request proxy JLCPCB per IP per menit (satu render preview memicu puluhan) |

### Tes

```bash
pnpm test          # unit test (vitest)
pnpm test:e2e      # Playwright; server sendiri di port 5181/8788, data di .e2e-data, mock LLM lokal
```

Tes impor JLCPCB (`e2e/import.spec.ts`) memanggil API jlcsearch/EasyEDA yang asli, jadi butuh internet.

## 🔒 Keamanan

- **Login** satu pengguna (scrypt), cookie httpOnly + SameSite=Strict, header `X-Just-Circuit-Request` wajib pada setiap request yang mengubah data (proteksi CSRF). Tanpa password, server hanya mau berjalan di 127.0.0.1 dan menolak request lewat proxy/tunnel. Tetap disarankan di belakang Tailscale atau reverse proxy HTTPS.
- **Header `Host`** dicek (hanya localhost dan nama di `JUST_CIRCUIT_ALLOWED_HOSTS`) untuk mencegah DNS rebinding.
- **Proxy LLM** menolak host privat (kecuali diizinkan), tidak mengikuti redirect, dan membatasi ukuran respons. **Proxy JLCPCB** hanya ke `easyeda.com`, `lcsc.com`, `jlcpcb.com`, `szlcsc.com` lewat HTTPS.
- **API key** terenkripsi di server, hanya dikirim ke Base URL tempat key itu disimpan; mengganti Base URL atau jenis API mewajibkan key diisi ulang.
- **Jalur file proyek** divalidasi: tanpa `..`, file tersembunyi, `node_modules/`, `dist/`, `package.json`, atau file konfigurasi tool (supaya kode tulisan AI tidak ikut dijalankan `tsci`), dan tidak menulis lewat symlink keluar folder proyek.
- **Terminal**: WebSocket hanya dari halaman sendiri (Origin = Host), setelah login; env shell hanya variabel dasar. Terminal tetap berarti **akses penuh ke mesin** bagi pengguna yang login (termasuk `secret.key`). Mati default di produksi.
- **Mode agen**: kode tulisan AI dianggap tidak tepercaya. Build di server mati default; bila dinyalakan, jalan di salinan sementara dalam sandbox OS (macOS `sandbox-exec`, Linux `bwrap`) tanpa jaringan dan tanpa akses home, dan ditolak bila sandbox tidak tersedia. Memori tidak ditulis otomatis dari jawaban yang membaca data part dari luar.
- Kode sirkuit dijalankan di browser; kode jahat bisa memanggil API Just Circuit atas nama sesi yang login, jadi periksa kode dari sumber tak dipercaya sebelum dijalankan.

## ✅ Status

Rincian per fase ada di [`docs/ROADMAP.md`](docs/ROADMAP.md).

- [x] Fase 0 — Stabilisasi (eval worker lokal, edit sebagian, rate limit terpisah)
- [x] Fase 1 — Proyek di server, workspace, tempat sampah, riwayat git
- [x] Fase 2 — Pengaturan bertab, koneksi AI ganda
- [x] Fase 3 — Terminal di browser
- [x] Fase 4 — Memori, library, mode agen, DRC/ERC, lampiran, cari part
- [x] Fase 5 — Editor skematik dan PCB CAD, mode hibrid, impor KiCad
- [x] Simulator listrik DC
- [ ] Mode Vim di editor
- [ ] Default board (layer, clearance) sebagai field terstruktur

## ⚠️ Batasan

- Preview PCB memakai WebGPU; pakai Chrome/Edge/Safari versi baru.
- Geser komponen hanya di PCB; viewer skematik runframe versi ini belum mengirim event edit.
- Ekspor Altium tidak didukung (paketnya butuh build Bun dari git). Pakai ekspor KiCad lalu impor ke Altium.
- Peringatan desain (mis. polaritas LED beda dengan part JLCPCB) tampil sebagai peringatan, tidak memicu auto-fix AI.
- Versi `@tscircuit/eval`, `runframe`, dan `core` dikunci persis; naikkan ketiganya bersamaan. Mesin eval (±21 MB) dilayani dari aplikasi sendiri di `/vendor/`, tanpa CDN.

## 🧱 Stack

| Lapisan | Teknologi |
|---|---|
| Browser | Vite, React 19, Monaco, xterm.js, `@tscircuit/runframe` (eval, PCB/skematik/3D viewer) |
| Server | Node 22, Express 5, tsx, node-pty, WebSocket |
| AI | Vercel AI SDK (`@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`) |
| Penyimpanan | Folder biasa + git per proyek; sesi dan pengaturan sebagai JSON |
| Tes | Vitest (unit), Playwright (E2E) |

<div align="center">

<sub>© 2026 PT Arah Karya Sinergi (AKS)</sub>

</div>
