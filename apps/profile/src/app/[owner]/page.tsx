import { OWNERS, ownerHost } from "../../owners.ts";

export default async function OwnerHomePage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner: key } = await params;
  // The layout above rejected a key that is no owner's before this rendered,
  // so the lookup is here for the name rather than as a second guard.
  const owner = OWNERS.find((candidate) => candidate.key === key) ?? OWNERS[0];

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-semibold">{owner.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{ownerHost(owner)}</p>
    </main>
  );
}
