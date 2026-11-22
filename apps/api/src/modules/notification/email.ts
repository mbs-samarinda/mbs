import { createTransport } from "nodemailer";

/** One message, already rendered. */
export type OutgoingEmail = {
  /** The notification id. The Message-ID is made from it. */
  id: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

/** What the provider answered, kept on the attempt row. Never the message. */
export type SendResult = { responseCode: string | null };

/**
 * The one door to an email provider. The worker sends through it, and tests
 * swap in the fake below, so no test talks to a real mail server.
 */
export type Mailer = {
  send(message: OutgoingEmail): Promise<SendResult>;
  close(): void;
};

/** A refused or failed send, with only what is safe to store and log. */
export class SendError extends Error {
  readonly errorClass: string;
  readonly responseCode: string | null;

  constructor(errorClass: string, responseCode: string | null) {
    super(`Send failed: ${errorClass}${responseCode ? ` ${responseCode}` : ""}`);
    this.errorClass = errorClass;
    this.responseCode = responseCode;
  }
}

/**
 * Delivery is at least once: a crash after the server accepted a message but
 * before the worker wrote SENT sends it again. So the Message-ID comes from
 * the notification id, the same on every try, and mail clients that see the
 * same Message-ID twice show one message.
 */
export function messageIdFor(id: string, domain: string) {
  return `<${id}@${domain}>`;
}

export function createSmtpMailer(options: { url: string; from: string; domain: string }): Mailer {
  const transport = createTransport({
    url: options.url,
    pool: true,
    // Short, so a stuck server fails a send well inside the worker's lease
    // instead of holding the row while another worker takes it over.
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

/** "250 2.0.0 Ok: queued" -> "250". */
function replyCode(response: unknown) {
  if (typeof response !== "string") return null;
  return /^\d{3}/.exec(response)?.[0] ?? null;
}

/**
 * Keeps the error's kind and the server's reply code. The server's text and
 * Nodemailer's message can quote the recipient, so neither goes further.
 */
function toSendError(error: unknown) {
  if (!(error instanceof Error)) return new SendError("Unknown", null);
  const code = "code" in error && typeof error.code === "string" ? error.code : error.name;
  const responseCode =
    "responseCode" in error && typeof error.responseCode === "number"
      ? String(error.responseCode)
      : null;
  return new SendError(code, responseCode);
}

/** An in-memory mailer for tests. `failNext` makes the next sends throw. */
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
