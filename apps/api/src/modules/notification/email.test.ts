import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import { createSmtpMailer, SendError } from "./email.ts";

async function closedPort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (typeof address !== "object" || address === null) throw new Error("No port.");
  return address.port;
}

describe("SMTP mailer", () => {
  it("names the system error when the server refuses the connection", async () => {
    const mailer = createSmtpMailer({
      url: `smtp://127.0.0.1:${await closedPort()}`,
      from: "ppdb@mbss.test",
      domain: "mbss.test",
    });
    const sending = mailer.send({
      id: "00000000-0000-0000-0000-000000000001",
      to: "wali@example.test",
      subject: "Halo",
      text: "Halo.",
      html: "<p>Halo.</p>",
    });
    await expect(sending).rejects.toThrow(SendError);
    await expect(sending).rejects.toMatchObject({
      errorClass: "ECONNREFUSED",
      responseCode: null,
    });
    mailer.close();
  });
});
