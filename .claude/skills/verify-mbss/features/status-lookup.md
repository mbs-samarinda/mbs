# Status without an account

A relative opens `/cek`, types the registration number and the child's NIK, and sees the child's name, school, number, stage and the road so far. They can change nothing. The answer is gone after Back, a reload, or leaving the page.

## Sub-features

- **Entry.** "Cek status tanpa masuk" under the sign-in form.
- **Answer.** Whose turn it is, the stage, the milestones with their dates. Never the fee, a reason, the history or a contact.
- **Miss.** One message for an unknown number, a number that cannot exist and a wrong NIK.
- **Limits.** 5 wrong tries on one number in 15 minutes and 20 in a day; 20 tries from one address in 15 minutes.
- **No traces.** Nothing in the URL, the title, storage or the logs.

## How to get to it (user POV)

- `Cek status tanpa masuk` on the parent app's sign-in screen, or `$ADMISSION_URL/cek` typed by hand.

## Driving it with drive.mjs

Preconditions:

- Baseline from the index, a cycle (`stack.sh sim -- cycle open`) and an application. Register one as in [Family registration](./family-registration.md); the recipe there gives NIK `6472010101010001` and, on a fresh stack, number `SMP-0001`.

- **Answer.** Run `drive --mobile goto:$ADMISSION_URL/masuk "click:link:Cek status tanpa masuk" "fill:textbox:Nomor pendaftaran=smp 1" "fill:textbox:NIK anak=6472 0101 0101 0001" "click:button:Lihat status" "see:heading:Menunggu pembayaran" shot:answer errors`. `answer.url` ends with `/cek`, and `answer.aria.txt` has no fee, no NIK and no history.
- **Miss.** Fill a wrong NIK, then an unknown number, then `bukan nomor`. Each shows `Nomor pendaftaran dan NIK belum cocok. Periksa lagi keduanya.` and `drive.log` shows one `http 404` each.
- **Limit.** Five wrong NIKs, then the right one: `text:Terlalu banyak percobaan` and a wait in minutes. Sign-in with a code still works.
- **Gone.** After the answer, `goto:$ADMISSION_URL/cek` shows an empty form.
- **Hidden decision.** `stack.sh sim -- apply SMP-0001 DECIDE` at `INTERVIEWED` changes nothing on the page.
- **Committee host.** `curl -i -H "Host: $STAFF_HOST" -H 'content-type: application/json' -d '{"json":{}}' $API_URL/api/rpc/public/application/checkStatus` answers 404, as any unknown path does. With `Host: $FAMILY_HOST` it answers 400.

## Gotchas

- Every request here comes from 127.0.0.1, so a script meets the limit of 20 per address before anything else. `delete from status_check_tries` in the run's `mbs_core` starts over. That is setup, not proof.
- Back and the browser's back-forward cache need a Playwright script; `drive.mjs` has no step for them.
