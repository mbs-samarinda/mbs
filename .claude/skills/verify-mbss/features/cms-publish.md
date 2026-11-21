# CMS publish

An editor changes a school's content in the Strapi admin and publishes it. The CMS then tells the profile site to drop its content cache, so the change appears on the next visits instead of after the hour-long cache window. This is the journey that proves the three layers fit together: Strapi's database, the CMS's revalidate call, and the profile's cache.

## Sub-features

- `publish-login` covers logging in to the Strapi admin.
- `publish-edit` covers opening an entry from a Content Manager list and changing a field.
- `publish-save` covers Save, which stores a draft. The public site does not change.
- `publish-publish` covers Publish, which makes the draft public and calls the profile's `/api/revalidate`.
- `publish-visible` is the profile page showing the change.
- `revalidate-auth` covers `/api/revalidate`, which refuses a request without the shared secret.

## How to get to it (user POV)

- Open `localhost:1437/admin` and log in.
- Choose `Content Manager`, then a collection type such as `Pengumuman`, `Berita`, `Opini`, `Fasilitas` or `Halaman`, then an entry.
- Change a field, choose `Save`, then choose `Publish`.

## Driving it with drive.mjs

Preconditions:

- Baseline from the index, with `stack.sh admin` run once this run.
- SMP's Pengumuman `Perubahan jam layanan tata usaha` is published. Its list row is linked by its id, `3`, on a fresh run.
- Use one `--state "$EVIDENCE/cms-publish/state.json"` on every CMS call below, so the login carries over.

- **Baseline view.** Visit the profile first, so the old title is cached. Run `drive goto:$SMP_URL/artikel/pengumuman "text:Perubahan jam layanan tata usaha" shot:before`.
- **Log in.** Run `drive --state ... goto:$CMS_URL/admin "fill:textbox:Email=verify@mbss.test" "fill:textbox:Password=Verify-mbss-1" click:button:Login "text:Content Manager" shot:logged-in`. The admin home loads.
- **Open the entry.** Run `drive --state ... goto:$CMS_URL/admin/content-manager/collection-types/api::pengumuman.pengumuman see:heading:Pengumuman tryclick:button:Skip click:link:3 see:button:Publish shot:edit`. `edit.aria.txt` has `heading "Perubahan jam layanan tata usaha" [level=1]` and `textbox "title"`.
- **Edit and publish.** Run `drive --state ... <the open-entry steps> "fill:textbox:title=Jam layanan tata usaha diperpanjang" click:button:Save text:Saved click:button:Publish shot:published`. The heading changes to the new title.
- **Side effects.** Run `grep 'POST /api/revalidate' "$EVIDENCE/logs/profile.log"`; it shows `200`. Run `curl -s -H "authorization: Bearer $CMS_READ_TOKEN" "$CMS_URL/api/pengumuman-list?filters%5BownerKey%5D=smp&fields%5B0%5D=title"`; it returns the new title.
- **Visible on the site.** Run `drive goto:$SMP_URL/artikel/pengumuman "text:Jam layanan tata usaha diperpanjang" shot:after`. The first visit shows the new title.
- **Revalidate refuses strangers.** Run `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:$PROFILE_PORT/api/revalidate`; it prints `401`. Run it again with `-H "x-revalidate-secret: $REVALIDATE_SECRET"`; it returns `{"revalidated":true,"tag":"cms"}`.

## Gotchas

- A publish expires the content cache (`revalidateTag(tag, { expire: 0 })`), so the first visit after it waits on Strapi and shows the change. Old content on that visit is a regression.
- Strapi shows a "Content manager" guided tour the first time an admin opens a list, and it blocks clicks. `tryclick:button:Skip` dismisses it, and does nothing once a saved `--state` remembers it was dismissed.
- Save alone changes only the draft. The site must not change until Publish. That is worth asserting on its own.
- `text:Published` can match the entry's old status badge. Prove publication through the profile page and the REST read, not that text.
- Row links are named by the entry id (`3`), and ids change once entries are published and edited again. Find the row in a `shot` of the list first.
- During Strapi's first boot, `logs/cms.log` shows several `Profile revalidation failed: fetch failed` lines. The seed publishes before the profile starts, so these are expected at boot only.
