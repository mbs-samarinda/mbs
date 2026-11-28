# Payment

A family transfers the registration fee to the school's account and uploads the receipt. The committee looks at the receipt on a desk of its own and approves it or sends it back with a reason the family reads. File bytes never pass through the API: the browser PUTs them straight to the bucket with a URL the API signed.

## Sub-features

- **Next step.** The status page says what is due and offers `Bayar`.
- **Transfer.** `/bayar/<id>`: the amount, the account number, the bank and the holder, each with a `Salin` button that copies the digits a banking app takes.
- **Upload.** `Foto` or `Pilih berkas`, a preview of what was chosen, `Kirim bukti`. A photo is shrunk in the browser; a PDF and a HEIC go as they are. Over 10 MB, or neither a photo nor a PDF, is refused under the field.
- **Waiting.** The status page shows the receipt that was sent and says the committee is checking it.
- **Rejected.** The reason sits at the top of `/bayar`, kept as written, clamped to four lines, and the family uploads again. The old attempt keeps its rejection.
- **Desk.** `/pembayaran` in the committee app: the queue oldest first, the proof at full width with zoom and rotate, one row of facts, `Setujui` and `Tolak`.
- **Locked approval.** `Setujui` stays disabled until the proof is on screen. A PDF or an undecodable photo offers `Buka berkas`, and opening it unlocks the decision.
- **Already handled.** A proof someone else decided says so and offers the next one.
- **No fee.** A cycle at Rp0 has no payment step at all.

## How to get to it (user POV)

- Family: the `Bayar` button on a child's status page, or `/bayar/<id>` by hand.
- Committee: `Pembayaran` in the sidebar, which carries how many proofs wait.

## Driving it with drive.mjs

Preconditions:

- Baseline from the index, a signed-in `--state` from [Family sign-in](./family-sign-in.md), a registered child from [Family registration](./family-registration.md), and a staff `--state` from [Committee sign-in](./committee-sign-in.md).
- An open cycle with a bank account: `stack.sh sim -- cycle open`. Set the account by SQL on `admission_cycles` (`bank_name`, `bank_account_number`, `bank_account_holder`) and say so.
- A receipt to send. Make one with ffmpeg rather than committing a binary; see the P7 lanes in the plan.

- **Pay.** Run `drive --mobile --state /tmp/family.json goto:$ADMISSION_URL/status/<id> "click:link:Bayar" "see:heading:Pembayaran" shot:bayar "upload:button:Pilih berkas=/tmp/p7-lanes/receipt.jpg" "see:button:Kirim bukti" "click:button:Kirim bukti" "see:heading:Panitia memeriksa bukti transfer" shot:cek errors`.
- **Approve.** Run `drive --state /tmp/staff.json goto:$ADMIN_URL/pembayaran "see:heading:Pembayaran" shot:desk "click:button:Setujui" "text:Tidak ada bukti yang menunggu" shot:empty errors`. The family's status page then reads `Unggah dokumen`, and Mailpit holds `Pembayaran sudah dikonfirmasi`.
- **Reject.** `"click:button:Tolak" "fill:textbox:Alasan untuk keluarga=Nominalnya kurang Rp50.000." "click:button:Tolak bukti"`. The family's `/bayar` shows the note at the top and takes a new file. Two `payments` rows exist and the first keeps its `payment_reviews` row.
- **Refused files.** `upload:button:Pilih berkas=/tmp/p7-lanes/bad.gif` says `Kirim foto atau PDF saja.`; a file over 10 MB says so too. Neither reaches the bucket.
- **Slow 4G.** Add `--slow4g` to the family run with a 6 MB photo. The stored `files.byte_size` is under 1 MB and the upload finishes.
- **A cut network.** `offline:on` during the PUT, then `offline:off` and `Kirim bukti` again. `abort:payments/sendProof` drops only the answer. Either way one `payments` row exists after the retry.
- **An expired link.** Read a proof's signed URL from the desk, `wait:` past its five minutes, then fetch it. The bucket answers 403.
- **Two staff at once.** Decide the same `paymentId` from two sessions. One wins; the other reads `Bukti ini sudah ditangani staf lain.`
- **Views are audited.** Open three proofs, then `select count(*) from audit_logs where action = 'file.viewed'`. It is 3, and no row holds an object key.
- **No fee.** `stack.sh sim -- cycle open --fee 0`, register, and the status page goes straight to `Unggah dokumen` with payment already ticked on the road.

## Gotchas

- Opening a proof is what records a staff view, so nothing may preload it. A `prefetch` on the queue link would make every audit count wrong.
- The signed download URL lasts five minutes and the signed upload URL fifteen. A desk left open longer asks for a new one, which is an honest new view.
- `ppdb-sim apply <number> UPLOAD_PAYMENT_PROOF` writes the event but no `payments` row, so the desk will not show it. Seed the desk through the family app, or by SQL for a queue of 200.
- The bucket is SeaweedFS's S3 gateway, not MinIO, whose community images stopped being published in 2026. `stack.sh bucket-off` and `bucket-on` take it away and bring it back.
