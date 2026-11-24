# Family sign-in

A parent opens the parent app, signs in with a code from an email or with Google, and lands on the page they asked for. Signed out, every page of the app leads to the sign-in screen first. What is behind it is [Family registration](./family-registration.md).

## Sub-features

- **Email code.** Ask for a code, type or paste it, land signed in.
- **Refused code.** A wrong code shows its error under the code field.
- **Code cap.** At most 5 codes in 15 minutes for one address.
- **Deep link.** Sign-in returns to the page that was asked for.
- **Google.** The button leaves for Google's own page.
- **API unreachable.** A plain message with a retry, never a blank page.

## How to get to it (user POV)

- "Mulai Pendaftaran" on a school's Pendaftaran page.
- `$ADMISSION_URL` typed by hand.

## Driving it with drive.mjs

Preconditions:

- Baseline from the index. A stack that runs the parent app (`$ADMISSION_URL`).

- **Email code.** Run `drive --mobile --state /tmp/family.json goto:$ADMISSION_URL/ "fill:textbox:Alamat email=siti@example.com" "click:button:Kirim kode masuk" "see:heading:Periksa email kamu" shot:code`. Read the code from `$MAIL_URL/api/v1/messages`; it is in the subject. Then run `drive --mobile --state /tmp/family.json goto:$ADMISSION_URL/masuk "fill:textbox:Alamat email=siti@example.com" "click:button:Kirim kode masuk" "fill:textbox:Kode 6 angka=<newest code>" "see:heading:Pendaftaran belum dibuka" shot:home errors`. The second run asks for a new code, because the step that waits for it lives in one browser session: fetch the newest message, not the first.
- **Refused code.** In place of the code above, fill `000000`. `text:Kode belum cocok` appears under the boxes, and `drive.log` shows one `http 400`.
- **Code cap.** Ask for the same address 6 times. The sixth answers 429 and the page says 5 codes were sent. The fifth code still signs in.
- **Deep link.** Run `drive goto:$ADMISSION_URL/?dari=profil "see:button:Kirim kode masuk" shot:guard`. `guard.url` ends with `/masuk?lanjut=%2F%3Fdari%3Dprofil`.
- **API unreachable.** Run `stack.sh api-off`, then `drive goto:$ADMISSION_URL/ "see:heading:Server tidak bisa dihubungi" shot:down`. Run `stack.sh api-on` after.

## Gotchas

- Both apps are `localhost`, and browsers share cookies across ports. Here only the cookie names keep the two sessions apart; the host-only cookie itself is proved behind Caddy.
- The API allows 10 code requests a minute per address the request came from. Every request here comes from 127.0.0.1, so a fast script meets that limit before the cap.
- Google's page is out of reach. Assert the address the browser leaves for.
