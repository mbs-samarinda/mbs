import { createTransport } from "nodemailer";

export type OutgoingEmail = {
  id: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type SendResult = { responseCode: string | null };

export type Mailer = {
  send(message: OutgoingEmail): Promise<SendResult>;
  close(): void;
};

export class SendError extends Error {
  readonly errorClass: string;
  readonly responseCode: string | null;

  constructor(errorClass: string, responseCode: string | null) {
    super(`Send failed: ${errorClass}${responseCode ? ` ${responseCode}` : ""}`);
    this.errorClass = errorClass;
    this.responseCode = responseCode;
  }
}

export function messageIdFor(id: string, domain: string) {
  return `<${id}@${domain}>`;
}

export function createSmtpMailer(options: { url: string; from: string; domain: string }): Mailer {
  const transport = createTransport({
    url: options.url,
    pool: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return {
    async send(message) {
      try {
        const info = await transport.sendMail({
          from: options.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          messageId: messageIdFor(message.id, options.domain),
        });
        return { responseCode: replyCode(info.response) };
      } catch (error) {
        throw toSendError(error);
      }
    },
    close() {
      transport.close();
    },
  };
}

function replyCode(response: unknown) {
  if (typeof response !== "string") return null;
  return /^\d{3}/.exec(response)?.[0] ?? null;
}

/** The server's text and Nodemailer's message can quote the recipient, so neither goes further. */
function toSendError(error: unknown) {
  if (!(error instanceof Error)) return new SendError("Unknown", null);
  const code = "code" in error && typeof error.code === "string" ? error.code : error.name;
  const responseCode =
    "responseCode" in error && typeof error.responseCode === "number"
      ? String(error.responseCode)
      : null;
  return new SendError(code, responseCode);
}

export function createFakeMailer() {
  const sent: OutgoingEmail[] = [];
  let failures = 0;
  const mailer = {
    sent,
    failNext(count = 1) {
      failures += count;
    },
    async send(message: OutgoingEmail): Promise<SendResult> {
      if (failures > 0) {
        failures -= 1;
        throw new SendError("ECONNECTION", null);
      }
      sent.push(message);
      return { responseCode: "250" };
    },
    close() {},
  };
  return mailer satisfies Mailer;
}

export type FakeMailer = ReturnType<typeof createFakeMailer>;
