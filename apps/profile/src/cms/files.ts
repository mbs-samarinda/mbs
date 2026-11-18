import { cacheLife, cacheTag } from "next/cache";

import type { Owner } from "@/owners.ts";

import { cms, CMS_TAG, PAGE_LIMIT } from "./client.ts";

/** A file on `/unduhan`. */
export type Berkas = {
  readonly documentId: string;
  readonly title: string;
  readonly category: "Akademik" | "Pendaftaran" | "Asrama" | "Umum";
  /** When it was last published, which is what "Diperbarui" means to a parent. */
  readonly publishedAt: string;
  readonly file: {
    readonly url: string;
    /** `.pdf`, with the dot. */
    readonly ext: string;
    /** Kilobytes, as Strapi stores it. */
    readonly size: number;
  };
};

/** Every file an owner has published, most recently updated first. */
export async function getFiles(ownerKey: Owner["key"]): Promise<Berkas[]> {
  "use cache";
  cacheLife("content");
  cacheTag(CMS_TAG, `files:${ownerKey}`);

  const rows = await cms<Omit<Berkas, "file"> & { file: Berkas["file"] | null }>("berkas-list", [
    ["filters[ownerKey][$eq]", ownerKey],
    ["sort[0]", "publishedAt:desc"],
    ["pagination[pageSize]", String(PAGE_LIMIT)],
    ["populate[file]", "true"],
  ]);

  // `required` is checked when an editor saves, not afterwards: deleting the
  // file from the Media Library leaves a published row pointing at nothing.
  // Dropped here, or one missing PDF takes the whole page down.
  return rows.flatMap(({ file, ...row }) => (file ? [{ ...row, file }] : []));
}
