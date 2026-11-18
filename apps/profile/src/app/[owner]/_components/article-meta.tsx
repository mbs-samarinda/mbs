import { Badge } from "@mbs/ui/components/badge";

import { ARTICLE_KINDS, badgeOwners, formatDate } from "@/articles.ts";
import type { Article } from "@/articles.ts";
import { type Owner, ownerByKey } from "@/owners.ts";

/**
 * The type, named rather than implied: the mix leans to notices, and a listing
 * that called everything by one type's name would be named after the emptiest.
 * The status pairs are shared and fixed, so they keep their colours on every
 * owner's site, SMK's blue one included. Opini takes success because alarm is
 * kept for errors and the brand guide forbids inventing a fifth status.
 */
const TYPE_VARIANT = { berita: "info", pengumuman: "warning", opini: "success" } as const;

export const TypeBadge = ({ type }: { type: Article["type"] }) => (
  <Badge variant={TYPE_VARIANT[type]}>{ARTICLE_KINDS[type]}</Badge>
);

/** A listing row's or card's top line: type, owners, date, and an Opini's author. */
export const ArticleMeta = ({ article, site }: { article: Article; site: Owner["key"] }) => (
  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
    <TypeBadge type={article.type} />
    <OwnerBadges article={article} site={site} />
    <span className="text-xs text-muted-foreground tabular-nums">
      {formatDate(article.publishedAt)}
    </span>
    {article.byline && <span className="text-xs text-muted-foreground">· {article.byline}</span>}
  </span>
);

/**
 * One quiet badge per owner, beside the type badge. Each wears its own school's
 * palette through `data-owner`, so an SMK badge is blue on SMP's green site.
 * Same tint-and-ink shape as the type badge, so the pair reads as one row.
 */
const OwnerBadges = ({ article, site }: { article: Article; site: Owner["key"] }) =>
  badgeOwners(article, site).map((key) => (
    <Badge key={key} data-owner={key} className="bg-surface-brand text-primary">
      {ownerByKey(key).level}
    </Badge>
  ));
