import { isUmbrella, type Owner, ownerByKey, ownerUrl } from "@/owners.ts";

/** Who an owner is, for search engines. Each school sits under Madina Boarding School. */
export function organizationOf(owner: Owner) {
  if (isUmbrella(owner)) {
    return { "@type": "EducationalOrganization", name: owner.name, url: ownerUrl(owner) };
  }
  const umbrella = ownerByKey("mbs");
  return {
    "@type": "School",
    name: owner.name,
    url: ownerUrl(owner),
    parentOrganization: {
      "@type": "EducationalOrganization",
      name: umbrella.name,
      url: ownerUrl(umbrella),
    },
  };
}

/**
 * Structured data for search engines, as the Next JSON-LD guide renders it.
 * `<` is escaped so text an editor typed cannot close the script tag early.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify({ "@context": "https://schema.org", ...data });
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json.replace(/</g, "\\u003c") }}
    />
  );
}
