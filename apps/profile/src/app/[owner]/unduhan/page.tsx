import { SCHOOLS } from "@mbs/school-config";
import { DownloadIcon, FileTextIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getFiles, getPage, mediaUrl, type Berkas } from "../../../cms.ts";
import { OWNERS } from "../../../owners.ts";
import { PageHead, SECTION, WIDTH, formatDate } from "../sections.tsx";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const { owner: key } = await params;
  const school = SCHOOLS.find((candidate) => candidate.key === key);
  if (!school) return {};

  const page = await getPage(school.key, "unduhan");
  return {
    title: page?.seo?.metaTitle ?? "Unduhan",
    description: page?.seo?.metaDescription ?? undefined,
  };
}

const ONE_DECIMAL = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

/** "860 KB", "3,4 MB". Parents read this to decide whether to spend their data. */
function fileType({ ext, size }: Berkas["file"]) {
  const kb = Math.max(1, Math.round(size));
  const amount = kb < 1024 ? `${kb} KB` : `${ONE_DECIMAL.format(size / 1024)} MB`;
  return `${ext.replace(/^\./, "").toUpperCase()} · ${amount}`;
}

/**
 * Every file a school has published, most recently updated first.
 *
 * One flat list rather than grouped by category: a school holds a handful of
 * files, and the newest is usually the one a parent came for. The category is a
 * column instead.
 *
 * The link opens the file rather than forcing a download. Files live on the
 * storage host, a different origin, where browsers ignore `download` anyway.
 *
 * School-only, like `/galeri`.
 */
export default async function UnduhanPage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  const school = SCHOOLS.find((candidate) => candidate.key === key);
  if (!owner || !school) notFound();

  const files = await getFiles(owner.key);

  return (
    <main>
      <PageHead heading="Unduhan" body="Berkas resmi sekolah untuk santri dan orang tua." />

      <section className={SECTION}>
        <div className={WIDTH}>
          {files.length === 0 ? (
            <p className="text-base text-muted-foreground">Belum ada berkas yang dipublikasikan.</p>
          ) : (
            <>
              {/* Phones get a list rather than a squeezed table: the whole row is
                  the target, and the category moves into the line under the title. */}
              <ul className="divide-y divide-border sm:hidden">
                {files.map((file) => (
                  <li key={file.documentId}>
                    <a href={mediaUrl(file.file)} className="group flex items-center gap-3 py-3.5">
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[15px] font-semibold text-pretty group-hover:text-primary">
                          {file.title}
                        </span>
                        <span className="text-[13px] text-muted-foreground tabular-nums">
                          {file.category} · {fileType(file.file)} · {formatDate(file.publishedAt)}
                        </span>
                      </span>
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border text-primary">
                        <DownloadIcon aria-hidden className="size-4.5" strokeWidth={1.75} />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>

              <table className="hidden w-full text-sm sm:table">
                <thead className="bg-muted text-left text-muted-foreground">
                  <tr>
                    <th className="rounded-l-lg px-3 py-2.5 font-medium">Berkas</th>
                    <th className="px-3 py-2.5 font-medium">Kategori</th>
                    <th className="px-3 py-2.5 font-medium">Ukuran</th>
                    <th className="px-3 py-2.5 font-medium">Diperbarui</th>
                    <th className="rounded-r-lg px-3 py-2.5">
                      <span className="sr-only">Unduh</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {files.map((file) => (
                    <tr key={file.documentId}>
                      <td className="px-3 py-3.5">
                        <span className="flex items-center gap-3 text-[15px] font-semibold text-pretty">
                          <FileTextIcon
                            aria-hidden
                            className="bg-surface-brand size-9 shrink-0 rounded-lg p-2 text-primary"
                            strokeWidth={1.75}
                          />
                          {file.title}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-muted-foreground">{file.category}</td>
                      <td className="px-3 py-3.5 whitespace-nowrap text-muted-foreground tabular-nums">
                        {fileType(file.file)}
                      </td>
                      <td className="px-3 py-3.5 whitespace-nowrap text-muted-foreground tabular-nums">
                        {formatDate(file.publishedAt)}
                      </td>
                      <td className="px-3 py-3.5 text-right">
                        <a
                          href={mediaUrl(file.file)}
                          className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
                        >
                          <DownloadIcon aria-hidden className="size-4" strokeWidth={1.75} />
                          Unduh<span className="sr-only"> {file.title}</span>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
