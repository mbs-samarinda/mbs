import { SCHOOLS } from "@mbs/school-config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAlbum, mediaUrl } from "../../../../cms.ts";
import { OWNERS, ownerUrl } from "../../../../owners.ts";
import { EntryHead, Photo, SECTION, WIDTH, formatLongDate } from "../../sections.tsx";

type Params = Promise<{ owner: string; slug: string }>;

const SECTION_INFO = { base: "/galeri", label: "Galeri" } as const;

/** Resolves the school and the album together, or gives up. */
async function read(params: Params) {
  const { owner: key, slug } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  const school = SCHOOLS.find((candidate) => candidate.key === key);
  if (!owner || !school) return null;

  const album = await getAlbum(owner.key, slug);
  return album ? { owner, album } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const found = await read(params);
  if (!found) return {};

  const { owner, album } = found;
  const title = album.seo?.metaTitle ?? album.title;
  const description = album.seo?.metaDescription ?? undefined;
  const share = album.seo?.shareImage ?? album.photos[0];

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${ownerUrl(owner)}galeri/${album.slug}`,
      images: share ? [mediaUrl(share)] : undefined,
    },
  };
}

/** Blocking, for the reason `/fasilitas/[slug]` gives. */
export const instant = false;

/**
 * One album's photographs. Each opens the original in the browser's own viewer:
 * a lightbox would be new interface and motion for what a link already does.
 */
export default async function AlbumPage({ params }: { params: Params }) {
  const found = await read(params);
  if (!found) notFound();

  const { album } = found;
  const summary = `${album.photos.length} foto · ${formatLongDate(album.date)}`;

  return (
    <main>
      <EntryHead entry={{ title: album.title, summary }} section={SECTION_INFO} />

      <section className={SECTION}>
        <ul className={`${WIDTH} grid grid-cols-3 gap-1 md:grid-cols-4 md:gap-2 lg:grid-cols-5`}>
          {album.photos.map((photo, index) => (
            <li key={photo.url}>
              <a href={mediaUrl(photo)} className="block">
                <Photo
                  // Every photo needs a name here, because it is the link's
                  // only content. An editor's alt text wins when there is one.
                  image={{
                    ...photo,
                    alternativeText: photo.alternativeText ?? `${album.title}, foto ${index + 1}`,
                  }}
                  label="Foto"
                  className="aspect-square w-full rounded-md"
                  sizes="(min-width: 1024px) 240px, (min-width: 768px) 25vw, 33vw"
                />
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
