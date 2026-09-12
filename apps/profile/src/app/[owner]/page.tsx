import { notFound } from "next/navigation";

import { OWNERS, ownerHost } from "../../owners.ts";

export default async function OwnerHomePage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner: key } = await params;
  // The layout above rejects a key that is no owner's before this renders, so
  // this cannot fire. It raises rather than falling back to an owner, because
  // substituting one would turn the failure the guard exists to stop — one
  // owner's content under another owner's hostname — into a successful page.
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) notFound();

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-semibold">{owner.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{ownerHost(owner)}</p>
    </main>
  );
}
