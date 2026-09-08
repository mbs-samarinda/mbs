import { SCHOOLS, type SchoolKey } from "@mbs/school-config";
import { notFound } from "next/navigation";

// One page per school, prerendered at build time. The hostname never reaches
// the page; middleware has already turned it into this segment.
export function generateStaticParams() {
  return SCHOOLS.map((school) => ({ school: school.key }));
}

export default async function SchoolHomePage({
  params,
}: {
  params: Promise<{ school: SchoolKey }>;
}) {
  const { school: key } = await params;
  const school = SCHOOLS.find((candidate) => candidate.key === key);
  if (!school) notFound();

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-semibold">{school.name}</h1>
      {/* Literal gray: this app does not import @mbs/ui, so it has no token layer. */}
      <p className="mt-2 text-sm text-gray-600">{school.level}</p>
    </main>
  );
}
