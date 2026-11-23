import { randomUUID } from "node:crypto";

import { schema, type Database } from "@mbs/db";
import type { BetterAuthOptions } from "better-auth";
import { eq, lt, sql } from "drizzle-orm";

type RateLimitStorage = NonNullable<NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]>;

const KEEP_MS = 60 * 60 * 1000;

/**
 * Better Auth keys a limit by IP and path only, so two instances over one table
 * share every path they have in common. The prefix keeps each app's counts its own.
 *
 * The window starts at the first request and then ends, so `last_request` holds
 * that start. Better Auth's own storage moves it on every request, which locks
 * out a shared mobile IP that is slow but never idle for a whole window.
 */
export function createRateLimitStorage(
  db: Database,
  prefix: string,
  now: () => number = Date.now,
): RateLimitStorage {
  const r = schema.rateLimit;
  return {
    async consume(path, rule) {
      const key = `${prefix}|${path}`;
      const at = now();
      const windowMs = rule.window * 1000;
      const isOver = sql`${r.lastRequest} <= ${at - windowMs}`;

      // One statement, so two requests at once cannot both take the last place.
      const [allowed] = await db
        .insert(r)
        .values({ id: randomUUID(), key, count: 1, lastRequest: at })
        .onConflictDoUpdate({
          target: r.key,
          set: {
            count: sql`case when ${isOver} then 1 else ${r.count} + 1 end`,
            lastRequest: sql`case when ${isOver} then ${at} else ${r.lastRequest} end`,
          },
          setWhere: sql`${isOver} or ${r.count} < ${rule.max}`,
        })
        .returning({ count: r.count });

      if (!allowed) {
        const [row] = await db.select({ start: r.lastRequest }).from(r).where(eq(r.key, key));
        const left = (row?.start ?? at) + windowMs - at;
        return { allowed: false, retryAfter: Math.max(1, Math.ceil(left / 1000)) };
      }
      if (allowed.count === 1) await db.delete(r).where(lt(r.lastRequest, at - KEEP_MS));
      return { allowed: true, retryAfter: null };
    },
  };
}
