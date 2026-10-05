import { SCHOOLS } from "@mbs/school-config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAlbums, getPage } from "../../../cms.ts";
import { OWNERS } from "../../../owners.ts";
import { PageHead, Photo, SECTION, WIDTH } from "../sections.tsx";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const { owner: key } = await params;
  const school = SCHOOLS.find((candidate) => candidate.key === key);
  if (!school) return {};

  const page = await getPage(school.key, "galeri");
  return {
    title: page?.seo?.metaTitle ?? "Galeri",
    description: page?.seo?.metaDescription ?? undefined,
  };
}

const MONTH = new Intl.DateTimeFormat("id-ID", {
  month: "long",
  year: "numeric",
  timeZone: "Asia/Makassar",
});

/**
 * Every album a school has published, newest activity first, each opening its
 * own page of photographs.
 *
 * Albums rather than one stream of photos: a parent looks for the event their
 * child was in, and an album is how an editor uploads one. Not composed, the
 * same arrangement as `/fasilitas`; the `Page` row holds the title and SEO.
 *
 * School-only. The umbrella keeps no photographs of its own, so the apex is sent
 * to the branded 404 by `ownerLacksPath` before this renders.
 */
export default async function GaleriPage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  const school = SCHOOLS.find((candidate) => candidate.key === key);
  if (!owner || !school) notFound();

  const albums = await getAlbums(owner.key);

  return (
    <main>
      <PageHead heading="Galeri" body="Foto kegiatan santri, per kegiatan." />

      <section className={SECTION}>
        <div className={WIDTH}>
          {albums.length === 0 ? (
            <p className="text-base text-muted-foreground">Belum ada album yang dipublikasikan.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-x-3 gap-y-6 lg:grid-cols-3 lg:gap-x-6 lg:gap-y-10">
              {albums.map((album) => (
                <li key={album.slug}>
                  <a href={`/galeri/${album.slug}`} className="group flex flex-col gap-2.5">
                    <Photo
                      image={album.photos[0] ?? null}
                      label="Sampul"
                      className="aspect-4/3 w-full"
                      sizes="(min-width: 1024px) 400px, 50vw"
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-bold text-pretty group-hover:text-primary lg:text-[17px]">
                        {album.title}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums lg:text-sm">
                        {album.photos.length} foto · {MONTH.format(new Date(album.date))}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
