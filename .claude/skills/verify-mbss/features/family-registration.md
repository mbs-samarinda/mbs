# Family registration

A signed-in parent registers a child at one school in four steps, then follows the application on its status page. The home page lists every child on the account. What is typed stays on the device until it is sent.

## Sub-features

- **Home.** The children with their stage and whose turn it is, or what can be done now: none announced, opens on a date, choose a school, closed.
- **Form.** `/daftar/sekolah`, `anak`, `wali` and `periksa`, each guarded by the ones before it.
- **Draft.** Kept in this browser per account, offered on the home page, gone after submit and sign-out.
- **Submit.** One application however often it is pressed, and one email.
- **Refusals.** Closed, a NIK already registered at that school, no answer, session ended.
- **Status.** `/status/<id>`: next step, stages, history. Anyone else's id is the not-found page.

## How to get to it (user POV)

- Sign in to the parent app. Choose a school on the home page, or `Daftarkan anak lain` below the list.
- Choose a child in the list for its status.

## Driving it with drive.mjs

Preconditions:

- Baseline from the index, and a signed-in `--state` file from [Family sign-in](./family-sign-in.md).
- A cycle: `stack.sh sim -- cycle open`. The other states are `upcoming`, `closed` and `none`; add `--off smk` or `--fee 0` to vary it. Each run converges from whatever was there.

- **Register.** Run `drive --mobile --state /tmp/family.json goto:$ADMISSION_URL/daftar/sekolah "click:radio:SMP Islam Terpadu Madina Rp250.000" click:button:Lanjut "fill:textbox:Nama lengkap anak=Aisyah Putri" "fill:textbox:NIK anak=6472.0101 0101.0001" fill:textbox:Tanggal=9 select:combobox:Bulan=Juli fill:textbox:Tahun=2014 click:radio:Perempuan "fill:textbox:Asal sekolah=SDN 1" click:button:Lanjut "fill:textbox:Nama lengkap orang tua/wali=Budi" click:radio:Ayah "fill:textbox:Nomor HP=0812 3456 7890" click:button:Lanjut shot:check "click:button:Kirim pendaftaran" "see:heading:Menunggu pembayaran" shot:status errors`. `status.aria.txt` holds the registration number, the fee and `Jangan transfer dulu`. Mailpit holds one email with the number.
- **Step guard.** With no draft, `goto:$ADMISSION_URL/daftar/periksa` ends on `/daftar/sekolah`.
- **Errors.** Press `Lanjut` on an empty step. Focus is in the first field, and each field's error is in its accessible description.
- **Draft.** Fill part of a step, reload the page with `goto`, and the fields hold what was typed.
- **Duplicate.** Register the same NIK at the same school from another account. The message names neither the other child nor the number.
- **Closed.** `stack.sh sim -- cycle closed`, then `goto:$ADMISSION_URL/daftar/anak`. It ends on the home page, which says so. Closing it between the check step and `Kirim pendaftaran` shows the refusal and keeps the form.
- **Status over time.** `stack.sh sim -- apply SMP-0001 UPLOAD_PAYMENT_PROOF`, then `APPROVE_PAYMENT`, and reload. `ADD_NOTE` and `DECIDE` must change nothing on the page.

## Gotchas

- The server decides whether registration is open. The app's own answer comes from the API's `Date` header, so changing the machine's clock does not change it.
- To lose an answer on purpose, use a Playwright route that fetches and then aborts `**/applications/submit`. `drive.mjs` has no step for it.
- Birth dates are 8 to 25 years before today in Samarinda.
