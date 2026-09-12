import { notFound } from "next/navigation";

import { OWNERS, ownerHost } from "../../owners.ts";

export default async function OwnerHomePage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner: key } = await params;
  // The only guard on the segment. Paths the middleware matcher skips —
  // /favicon.ico, /_next — arrive here with that path as the owner key, and
  // without this they would serve the first owner's content under another
  // owner's hostname, which is the one failure owner resolution exists to stop.
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) notFound();

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-semibold">{owner.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{ownerHost(owner)}</p>
    </main>
  );
}
