# Circuit Design Studio (CDS)

Desain PCB dengan kode [tscircuit](https://github.com/tscircuit/tscircuit) langsung di browser, dibantu asisten AI. Semua yang biasanya dilakukan lewat `tsci` CLI (preview skematik/PCB/3D, impor part JLCPCB, ekspor file produksi) ada di satu halaman web.

## Fitur

- **Editor + preview live**: editor Monaco, preview PCB / Schematic / 3D / BOM dari `@tscircuit/runframe`. Kode dijalankan di browser (web worker), bukan di server.
- **Chat AI**: minta rangkaian dengan bahasa biasa. AI menulis file baru secara lengkap dan mengubah file yang ada lewat edit sebagian (blok SEARCH/REPLACE), jadi desain besar tidak terpotong batas token. Kodenya langsung diterapkan dan dipreview; edit yang tidak cocok dikembalikan ke AI. Kalau build gagal, error dikirim balik ke AI untuk diperbaiki otomatis (default 2x, bisa diatur). Setiap perubahan dari AI bisa dibatalkan.
- **Pengaturan API LLM di web**: beberapa koneksi sekaligus, pilih yang aktif, tombol "Ambil model" untuk daftar model dari provider.
  - OpenAI-compatible: OpenRouter, Groq, Ollama lokal, 9router, OpenAI, atau endpoint `/v1/chat/completions` lainnya
  - Anthropic (Claude) native
  - Google Gemini native
- **Atur posisi (drag & drop di PCB)**: tombol "Atur posisi" membuka PCB yang bisa diseret. Komponen yang posisinya sudah ditulis di kode (`pcbX`/`pcbY`) diperbarui langsung di kode; komponen lain disimpan ke `manual-edits.json` (format resmi tscircuit, otomatis di-import ke `<board manualEdits={...}>`). Hapus tab `manual-edits.json` untuk mereset posisi manual.
- **Banyak proyek**: buat, ganti nama, duplikat, hapus, unduh ZIP (bisa dibuka langsung dengan `tsci dev`).
- **Impor part JLCPCB**: cari part (mis. `C46749`), lalu komponen TSX-nya ditambahkan ke `imports/` dan otomatis di-import ke file utama.
- **Ekspor** (menu File → Export di preview): Fabrication files (Gerber), KiCad project/library, STEP, GLB, Pinout SVG, Circuit JSON, dan lainnya.

## Arsitektur

```
browser (Vite + React 19)                       server (Express 5, kecil)
├─ IndexedDB: proyek, chat, pengaturan AI       ├─ POST /api/llm/chat    → stream NDJSON dari provider (Vercel AI SDK)
├─ runframe: eval TSX + viewer (web worker)     ├─ POST /api/llm/models  → daftar model provider
└─ Monaco editor                                └─ ALL  /api/jlc/proxy   → proxy CORS ke EasyEDA/JLCPCB (allowlist host)
```

Server tidak menyimpan apa pun. API key dikirim dari browser per request dan diteruskan ke provider.

## Menjalankan

Butuh Node 22+ dan pnpm.

```bash
pnpm install
cp .env.example .env    # opsional
pnpm dev                # web http://localhost:5180, API :8787
```

Lalu buka **Pengaturan AI** (ikon gerigi), tambahkan koneksi dari preset, isi API key, lalu Simpan.

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
| `RATE_LIMIT_PER_MINUTE` | `60` | Batas request chat/model AI (`/api/llm`) per IP per menit |
| `JLC_RATE_LIMIT_PER_MINUTE` | `1200` | Batas request proxy part JLCPCB per IP per menit (satu render preview bisa memicu puluhan) |

## Tes

```bash
pnpm test          # unit test (vitest)
pnpm test:e2e      # E2E Playwright; memakai mock LLM lokal (e2e/mock-llm.mjs)
```

Tes impor JLCPCB (`e2e/import.spec.ts`) memanggil API jlcsearch/EasyEDA yang asli, jadi butuh internet.

## Keamanan

- Proxy LLM menolak host privat (kecuali diizinkan), tidak mengikuti redirect, dan membatasi ukuran respons.
- Proxy JLCPCB hanya ke `easyeda.com`, `lcsc.com`, `jlcpcb.com`, `szlcsc.com` lewat HTTPS.
- API key ada di IndexedDB browser. Kode sirkuit (termasuk tulisan AI) dijalankan runframe di web worker pada origin yang sama, jadi secara teori kode jahat bisa membaca IndexedDB. Periksa kode dari sumber yang tidak dipercaya sebelum menjalankannya, dan pakai key dengan batas kuota.
- Tidak ada login: jangan buka server ke internet tanpa reverse proxy berautentikasi (mis. Cloudflare Access / Tailscale).

## Catatan

- Roadmap pengembangan: [docs/ROADMAP.md](docs/ROADMAP.md).

- `tsc` butuh heap besar karena tipe tscircuit sangat besar; `src/types/runframe.d.ts` berisi tipe ringkas untuk bagian runframe yang dipakai.
- Ekspor Altium tidak didukung (paketnya hanya tersedia dari git dan butuh build Bun). Pakai ekspor KiCad lalu impor ke Altium.
- Mesin eval tscircuit (`@tscircuit/eval`, ±21 MB) dilayani dari aplikasi sendiri di `/vendor/tscircuit-eval-<versi>.js` (lihat `vite-plugins/eval-worker.ts`), jadi preview tidak bergantung pada CDN. Versi `@tscircuit/eval`, `runframe`, dan `core` dikunci persis di `package.json`; naikkan ketiganya bersamaan.
- Beberapa hasil pengecekan tscircuit ditampilkan sebagai **peringatan**, bukan error, misalnya polaritas LED/dioda yang berbeda dengan part JLCPCB pilihan otomatis. Peringatan tidak memicu auto-fix AI.
- Preview PCB memakai WebGPU; pakai Chrome/Edge/Safari versi baru. Tes E2E menyalakan WebGPU software (SwiftShader) lewat argumen Chromium di `e2e/layout.spec.ts`.
- Geser komponen hanya di PCB. Schematic viewer di runframe versi ini belum mengirim event edit.
