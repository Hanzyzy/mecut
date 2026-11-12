# mecut

> Autonomous coding loop untuk terminal — ketik satu prompt, biarkan AI terus memperbaiki project-mu sampai waktu habis.

`mecut` adalah CLI yang menjalankan AI secara berulang-ulang di direktori project kamu. Kamu cukup
memberi satu tugas (misalnya *"perbagus tampilan web ini"*), dan `mecut` akan terus mengirim tugas
itu ke AI — iterasi demi iterasi — sampai batas waktu yang kamu tentukan habis.

Cocok untuk:
- Menyempurnakan UI/UX secara bertahap dalam waktu lama.
- Refactor besar yang butuh banyak putaran.
- Eksperimen "biarkan AI bekerja 2 jam" sambil kamu tinggalkan.

---

## ✨ Fitur

- ⏱ **Countdown timer real-time** — lihat sisa waktu berjalan langsung di terminal.
- 🔁 **Loop otomatis** — prompt yang sama dikirim ulang setiap AI selesai bekerja.
- 🧠 **Sesi & model terkunci** — AI melanjutkan konteks yang sama dan model tidak berubah di tengah jalan.
- 🤖 **Mode otonom** — AI tidak akan bertanya balik; ia langsung mengerjakan tugas.
- 📚 **Pilih model** dengan `/model` (dari provider yang sudah ada di opencode).
- ➕ **Tambah provider sendiri** dengan `/provider add` (OpenAI-compatible: baseURL + API key).
- 🛡 **Penanganan error otomatis** — retry dengan jeda + backoff eksponensial saat rate limit / gangguan jaringan.
- 🎯 **Deteksi perubahan file** — tiap iterasi ditandai apakah ada file yang berubah.
- 🤝 **Didukung opencode** — memakai semua provider/model yang sudah kamu konfigurasi di `opencode`.

---

## 📋 Prasyarat

1. **Node.js 18+** (disarankan 20/22).
2. **opencode** terpasang dan sudah dikonfigurasi minimal satu provider/model.
   - Cek dengan: `opencode models`
   - Panduan: https://opencode.ai

---

## 🚀 Instalasi

```bash
git clone https://github.com/Hanzyzy/mecut.git
cd mecut
npm install
npm run build
npm link
```

Setelah `npm link`, perintah `mecut` bisa dipanggil dari **folder mana pun**.

> Tidak ingin `npm link`? Jalankan langsung dengan `node dist/cli.js` dari folder project.

---

## 🕹 Cara pakai

```bash
cd path/ke/project-kamu
mecut
```

Alurnya:

```
$ mecut
╭─ mecut v1.0 — Autonomous Coding Loop ────────────╮
│ Folder: C:\project\web-saya                       │
╰──────────────────────────────────────────────────╯
Durasi kerja? (contoh: 2h, 30m, 90s): 2h
Prompt tugas: perbagus tampilan web ini
[Enter untuk mulai]
```

Lalu saat berjalan, tampil status seperti:

```
╭─────────────────────────────────────────────────╮
│ ⏱ 01:59:58 sisa | berlalu 00:00:02 | iterasi #1  │
│ model: provider/model | sesi: ses_xxx            │
│ tokens: 24.6k | biaya: $0.0000 | bekerja         │
╰─────────────────────────────────────────────────╯
```

### Flag opsional

```bash
mecut --durasi 2h --model provider/model --retry 5s
```

| Flag | Arti | Contoh |
|---|---|---|
| `--durasi` | Durasi total kerja | `2h`, `30m`, `90s` |
| `--model` | Model yang dipakai (terkunci selama sesi) | `bansosai/deepseek-v4-pro` |
| `--retry` | Jeda antar-retry saat error | `5s`, `10s` |

---

## ⌨️ Perintah di dalam TUI

| Perintah | Fungsi |
|---|---|
| `/model` | Pilih model (hanya sebelum mulai / setelah selesai — **dikunci saat loop berjalan**) |
| `/provider add` | Tambah provider baru (id, nama, baseURL, API key, daftar model) |
| `/provider list` | Lihat provider tambahan |
| `/durasi 2h` | Ubah durasi (saat loop berjalan hanya menyesuaikan sisa waktu) |
| `/retry 10s` | Ubah jeda retry |
| `/iterasi` | Ringkas hasil iterasi terakhir |
| `/stop` | Hentikan loop (ringkasan ditampilkan) |
| `/help` | Bantuan |
| `Ctrl+C` | Keluar / hentikan loop |

---

## 🤖 Bagaimana AI tetap "jalan sendiri"?

Setiap kali `mecut` memanggil AI, ia menyisipkan instruksi mode otonom:

> Jangan bertanya, jangan minta konfirmasi. Ambil keputusan sendiri, langsung ubah file, dan
> selesaikan tugas. Ini iterasi berulang — pertahankan hasil sebelumnya dan tingkatkan bertahap.

Hasilnya, AI tidak akan menghentikan loop dengan pertanyaan seperti *"apakah Anda ingin saya …?"*.

---

## ⚙️ Konfigurasi

Semua pengaturan tersimpan di:

```
~/.mecut/config.json
```

Contoh isi:

```json
{
  "version": 1,
  "activeModel": "bansosai/deepseek-v4-pro",
  "durationMs": 7200000,
  "retryDelayMs": 5000,
  "errorBackoffAfter": 3,
  "maxBackoffMs": 300000,
  "errorStopAfter": 0,
  "iterationTimeoutMs": 1800000,
  "sessionMode": "same",
  "savedModels": [],
  "providers": {}
}
```

| Kunci | Arti |
|---|---|
| `activeModel` | Model terakhir yang dipakai |
| `durationMs` | Durasi default (ms) |
| `retryDelayMs` | Jeda dasar antar-retry (ms) |
| `errorBackoffAfter` | Setelah N error beruntun, jeda naik eksponensial |
| `maxBackoffMs` | Batas maksimum jeda (ms) |
| `errorStopAfter` | Stop otomatis setelah N error beruntun (`0` = nonaktif) |
| `iterationTimeoutMs` | Batas waktu satu iterasi |
| `sessionMode` | `same` = lanjutkan sesi yang sama |
| `savedModels` | Daftar model yang pernah kamu pilih |
| `providers` | Provider tambahan |

### Menambah provider sendiri

Lewat TUI: jalankan `mecut` lalu ketik `/provider add`.

Lalu isi:
- **ID** (mis. `myprovider`)
- **Base URL** (mis. `https://api.example.com/v1`)
- **API key** (boleh kosong jika tidak perlu)
- **Daftar model**, pisahkan dengan koma (mis. `gpt-4o, gpt-4o-mini`)

Provider ini ditulis ke `~/.mecut/config.json` **dan** ke `~/.config/opencode/opencode.json`
(dengan backup otomatis `*.bak-mecut-<timestamp>`), sehingga langsung dikenali opencode.

---

## 🛠 Cara kerja (singkat)

1. Satu iterasi = satu proses `opencode run` dengan prompt tugas + instruksi otonom.
2. Output JSON dari opencode dibaca untuk mendeteksi kapan AI selesai (`step_finish`).
3. Setelah selesai, `mecut` membandingkan snapshot file (via `git status` atau direktori) untuk
   menandai apakah ada perubahan.
4. Loop berlanjut sampai durasi habis. Error di-retry otomatis sesuai aturan backoff.

> Catatan teknis: opencode tidak mengeluarkan stream JSON ketika stdout berupa pipe, jadi `mecut`
> memanggil `opencode.exe` asli dan mengalihkan output ke file log di `~/.mecut/runtime/`.

---

## ❓ FAQ

**Q: Apakah bisa dipakai berbarengan dengan opencode biasa?**
Bisa. `mecut` memakai konfigurasi opencode kamu. Saat menambah provider, file opencode di-backup
otomatis lebih dulu.

**Q: Model error terus dan token habis?**
Model tidak akan diganti otomatis (sesuai desain). `mecut` akan retry dengan jeda/backoff sampai
waktu habis, atau hentikan manual dengan `/stop`.

**Q: Bisa memperpanjang waktu saat sedang berjalan?**
Bisa, lewat `/durasi 2h` saat loop aktif (hanya menyesuaikan sisa waktu, tidak memundurkan).

**Q: Terminal tidak mendukung mode interaktif?**
Gunakan terminal asli (Windows Terminal / PowerShell), bukan pipe/redirect.

---

## 📄 Lisensi

MIT
