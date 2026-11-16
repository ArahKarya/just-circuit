# Template proyek

File `*.circuit.tsx` di sini dipakai sebagai isi awal proyek baru (`src/lib/templates.ts`, di-import sebagai teks dengan `?raw`). Folder ini sengaja di luar `tsconfig` karena isinya kode tscircuit, bukan kode aplikasi.

Setiap kali mengubah template, cek dulu dengan:

```bash
mkdir -p /tmp/cek && cp templates/pico.circuit.tsx /tmp/cek/index.circuit.tsx && cd /tmp/cek && echo '{}' > package.json && tsci build index.circuit.tsx
```
