# Committee sign-in

A staff member signs in to the committee app with a Google account an administrator approved, and lands on an empty dashboard that shows their name. Any other account is told it has no access.

## Sub-features

- **Dashboard.** An active staff session opens it.
- **Refusal at Google.** An account that is not approved comes back to the sign-in screen with the reason.
- **Refusal after sign-in.** An account whose staff profile is inactive sees a refusal and a way out.
- **API unreachable.** A plain message with a retry.

## How to get to it (user POV)

- `$ADMIN_URL` typed by hand or from a bookmark. Nothing links to it.

## Driving it with drive.mjs

Preconditions:

- Baseline from the index. `stack.sh sim -- --staff-session kepala@mbss.sch.id` prints a `cookie:` line and creates that staff member as an administrator. Put the cookie in a Playwright storage state for `localhost` and pass it with `--state`.

- **Dashboard.** Run `drive --state /tmp/staff.json goto:$ADMIN_URL/ "see:heading:Dasbor" shot:dashboard errors`. The header shows the staff name.
- **Refusal at Google.** Run `drive goto:$ADMIN_URL/masuk?error=account_not_approved "see:button:Pilih akun Google lain" shot:refused`. This is the address the API sends a refused account to; Google itself is out of reach.
- **Refusal after sign-in.** Set `is_active = false` on the row in `staff_users` (setup by SQL, say so), then run `drive --state /tmp/staff.json goto:$ADMIN_URL/ "see:heading:Akun ini belum punya akses" "click:button:Keluar" "see:button:Masuk dengan Google"`.
- **API unreachable.** Run `stack.sh api-off`, then `drive goto:$ADMIN_URL/ "see:heading:Server tidak bisa dihubungi" shot:down`. Run `stack.sh api-on` after.

## Gotchas

- The session check answers 403 for an inactive profile, and Chromium prints that as a console error. `errors` does not count it.
