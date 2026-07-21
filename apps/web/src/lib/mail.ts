/**
 * MailProvider: same adapter pattern as the AI provider interface (plan
 * §11) — swap implementations by config, never hard-couple to one vendor.
 * Falls back to logging the link instead of failing when RESEND_API_KEY
 * isn't set, per the plan's rule: "if an external service cannot be
 * configured, implement a documented adapter and fallback state."
 */

import { SITE_NAME } from "@/lib/brand";

interface MailProvider {
  send(params: { to: string; subject: string; html: string }): Promise<void>;
}

class ConsoleMailProvider implements MailProvider {
  async send({ to, subject, html }: { to: string; subject: string; html: string }) {
    console.log(
      `[ConsoleMailProvider] RESEND_API_KEY not set — logging email instead of sending.\nTo: ${to}\nSubject: ${subject}\n${html}`,
    );
  }
}

class ResendMailProvider implements MailProvider {
  private client: Promise<import("resend").Resend>;

  constructor(apiKey: string) {
    this.client = import("resend").then(({ Resend }) => new Resend(apiKey));
  }

  async send({ to, subject, html }: { to: string; subject: string; html: string }) {
    const resend = await this.client;
    const from = process.env.EMAIL_FROM ?? "onboarding@resend.dev";
    await resend.emails.send({ from, to, subject, html });
  }
}

function createMailProvider(): MailProvider {
  const apiKey = process.env.RESEND_API_KEY;
  return apiKey ? new ResendMailProvider(apiKey) : new ConsoleMailProvider();
}

export const mailProvider = createMailProvider();

export function verificationEmailHtml(link: string) {
  return `<p>Confirm your email for ${SITE_NAME}:</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`;
}

export function passwordResetEmailHtml(link: string) {
  return `<p>Reset your ${SITE_NAME} password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`;
}
