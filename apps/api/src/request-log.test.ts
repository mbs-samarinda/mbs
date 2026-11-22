import Fastify from "fastify";
import { expect, it } from "vitest";

import { requestLogFields } from "./app.ts";

it("logs the request path without its query string", async () => {
  const lines: string[] = [];
  const app = Fastify({
    logger: {
      stream: { write: (line: string) => lines.push(line) },
      serializers: { req: requestLogFields },
    },
  });
  app.get("/api/auth/callback/google", () => "ok");

  await app.inject({ method: "GET", url: "/api/auth/callback/google?code=one-time-code&state=s1" });
  await app.close();

  const logged = lines.join("");
  expect(logged).toContain('"url":"/api/auth/callback/google"');
  expect(logged).not.toContain("one-time-code");
});
