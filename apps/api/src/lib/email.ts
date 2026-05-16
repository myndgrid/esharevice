import { Resend } from "resend";
import { captureException } from "../instrument.js";
import { emailConfigured, env } from "../env.js";

let _client: Resend | null = null;

function client(): Resend | null {
  if (!emailConfigured()) return null;
  if (_client) return _client;
  _client = new Resend(env.RESEND_API_KEY);
  return _client;
}

export type ReservedEmailInput = {
  to: string;
  ownerName: string;
  reserverName: string;
  itemService: string;
  itemUrl: string;
};

/**
 * "Your listing was reserved" email.
 *
 * Never throws — every failure path logs + reports to Sentry instead.
 * The reserve handler must never fail because of an email-side hiccup
 * (Resend rate-limit, DNS, unverified domain, etc.). The user already
 * holds the lock at the SQL level by the time this fires.
 */
export async function sendReservedEmail(input: ReservedEmailInput): Promise<void> {
  const c = client();
  if (!c) return; // email not configured — silent no-op for dev/test
  const fromAddress = env.EMAIL_FROM;
  if (!fromAddress) return;

  const subject = `${input.reserverName} reserved your "${input.itemService}" listing`;
  try {
    const { error } = await c.emails.send({
      from: fromAddress,
      to: input.to,
      subject,
      text: textBody(input),
      html: htmlBody(input),
    });
    if (error) {
      // The most common cause is "domain not verified" — surface clearly.
      // eslint-disable-next-line no-console
      console.warn("[email] resend rejected:", error.name, error.message);
      captureException(new Error(`Resend rejected: ${error.name} ${error.message}`));
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[email] resend threw:", err);
    captureException(err);
  }
}

function textBody(input: ReservedEmailInput): string {
  return [
    `Hi ${input.ownerName},`,
    "",
    `${input.reserverName} just reserved your "${input.itemService}" listing on e-Sharevice.`,
    "",
    `View the listing: ${input.itemUrl}`,
    "",
    "If you weren't expecting this, you can review or cancel from the listing page.",
    "",
    "— e-Sharevice",
  ].join("\n");
}

function htmlBody(input: ReservedEmailInput): string {
  // Plain inline HTML — Resend handles transactional rendering. Keep it
  // simple enough that any client (Gmail, Outlook, Apple Mail) renders
  // sensibly without bespoke CSS.
  const safe = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111;">
      <p>Hi ${safe(input.ownerName)},</p>
      <p><strong>${safe(input.reserverName)}</strong> just reserved your "<strong>${safe(input.itemService)}</strong>" listing on e-Sharevice.</p>
      <p style="margin: 24px 0;">
        <a href="${safe(input.itemUrl)}" style="display: inline-block; padding: 10px 16px; background: #2563eb; color: #fff; border-radius: 6px; text-decoration: none; font-weight: 600;">View listing</a>
      </p>
      <p style="font-size: 14px; color: #666;">If you weren't expecting this, you can review or cancel from the listing page.</p>
      <p style="font-size: 12px; color: #999; margin-top: 32px;">— e-Sharevice</p>
    </div>
  `;
}
