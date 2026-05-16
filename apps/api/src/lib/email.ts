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

export type SaverReservedEmailInput = {
  to: string;
  saverName: string;
  itemService: string;
  itemUrl: string;
};

export type SaverArchivedEmailInput = {
  to: string;
  saverName: string;
  itemService: string;
};

export type NewMessageEmailInput = {
  to: string;
  recipientName: string;
  senderName: string;
  itemService: string;
  /** Trimmed message body — caller truncates to ~120 chars. */
  preview: string;
  /** Deep-link to the conversation page. */
  threadUrl: string;
};

/**
 * Owner-side "Your listing was reserved" email.
 *
 * Never throws — every failure path logs + reports to Sentry instead.
 * The reserve handler must never fail because of an email-side hiccup
 * (Resend rate-limit, DNS, unverified domain, etc.). The user already
 * holds the lock at the SQL level by the time this fires.
 */
export async function sendReservedEmail(input: ReservedEmailInput): Promise<void> {
  await sendTransactional({
    to: input.to,
    subject: `${input.reserverName} reserved your "${input.itemService}" listing`,
    text: [
      `Hi ${input.ownerName},`,
      "",
      `${input.reserverName} just reserved your "${input.itemService}" listing on e-Sharevice.`,
      "",
      `View the listing: ${input.itemUrl}`,
      "",
      "If you weren't expecting this, you can review or cancel from the listing page.",
      "",
      "— e-Sharevice",
    ].join("\n"),
    html: bodyHtml({
      greeting: `Hi ${input.ownerName},`,
      lead: `<strong>${esc(input.reserverName)}</strong> just reserved your "<strong>${esc(input.itemService)}</strong>" listing on e-Sharevice.`,
      cta: { label: "View listing", href: input.itemUrl },
      footer: "If you weren't expecting this, you can review or cancel from the listing page.",
    }),
  });
}

/**
 * Saver-side "An item you saved was reserved" email.
 *
 * Fires to every user who bookmarked the item OTHER than the reserver
 * themselves and the owner (the owner gets the primary reserved-email
 * already — avoid double-sending). Same swallow-on-failure contract
 * as the owner notification.
 */
export async function sendItemReservedEmailToSaver(
  input: SaverReservedEmailInput,
): Promise<void> {
  await sendTransactional({
    to: input.to,
    subject: `"${input.itemService}" — an item you saved was just reserved`,
    text: [
      `Hi ${input.saverName},`,
      "",
      `"${input.itemService}" — an item you bookmarked on e-Sharevice — was just reserved by another member.`,
      "",
      "It may become available again if the reservation is cancelled.",
      "",
      `View the listing: ${input.itemUrl}`,
      "",
      "— e-Sharevice",
    ].join("\n"),
    html: bodyHtml({
      greeting: `Hi ${input.saverName},`,
      lead: `"<strong>${esc(input.itemService)}</strong>" — an item you bookmarked on e-Sharevice — was just reserved by another member.`,
      cta: { label: "View listing", href: input.itemUrl },
      footer: "It may become available again if the reservation is cancelled.",
    }),
  });
}

/**
 * Saver-side "An item you saved is no longer available" email.
 *
 * Fires to every user who bookmarked the item OTHER than the owner
 * (they're the one archiving). No CTA link — the listing is gone.
 */
export async function sendItemArchivedEmailToSaver(
  input: SaverArchivedEmailInput,
): Promise<void> {
  await sendTransactional({
    to: input.to,
    subject: `"${input.itemService}" — an item you saved is no longer available`,
    text: [
      `Hi ${input.saverName},`,
      "",
      `"${input.itemService}" — an item you bookmarked on e-Sharevice — has been removed by its owner and is no longer available.`,
      "",
      "We'll keep showing you new listings on the home page.",
      "",
      "— e-Sharevice",
    ].join("\n"),
    html: bodyHtml({
      greeting: `Hi ${input.saverName},`,
      lead: `"<strong>${esc(input.itemService)}</strong>" — an item you bookmarked on e-Sharevice — has been removed by its owner and is no longer available.`,
      footer: "We'll keep showing you new listings on the home page.",
    }),
  });
}

/**
 * "You have a new message" email.
 *
 * Sent to the OTHER participant of a conversation when a message lands AND
 * the recipient hasn't opened the thread recently. The caller does the
 * suppression check against `last_read_at` before invoking this — the
 * helper itself is unconditional once you've decided to send.
 */
export async function sendNewMessageEmail(input: NewMessageEmailInput): Promise<void> {
  // Hard preview cap — the body field is up to 4000 chars; an email subject
  // line truncated at 80 keeps the most-clicked metadata visible across
  // every client. The HTML preview gets a 240-char window before ellipsis.
  const subjectPreview =
    input.preview.length > 80 ? `${input.preview.slice(0, 77)}…` : input.preview;
  const htmlPreview =
    input.preview.length > 240 ? `${input.preview.slice(0, 237)}…` : input.preview;
  await sendTransactional({
    to: input.to,
    subject: `${input.senderName}: ${subjectPreview}`,
    text: [
      `Hi ${input.recipientName},`,
      "",
      `${input.senderName} sent you a message about "${input.itemService}" on e-Sharevice:`,
      "",
      `  ${input.preview}`,
      "",
      `Reply: ${input.threadUrl}`,
      "",
      "— e-Sharevice",
    ].join("\n"),
    html: bodyHtml({
      greeting: `Hi ${input.recipientName},`,
      lead: `<strong>${esc(input.senderName)}</strong> sent you a message about "<strong>${esc(input.itemService)}</strong>" on e-Sharevice:<br><br><span style="display: block; margin: 12px 0; padding: 10px 14px; border-left: 3px solid oklch(43% 0.15 195); background: #f6f8fa; color: #333; white-space: pre-wrap;">${esc(htmlPreview)}</span>`,
      cta: { label: "Reply", href: input.threadUrl },
      footer:
        "You're receiving this because you have an active conversation on e-Sharevice. Replies happen on the thread page.",
    }),
  });
}

// ─────────────────────── internal helpers

type SendInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

async function sendTransactional(input: SendInput): Promise<void> {
  const c = client();
  if (!c) return; // email not configured — silent no-op for dev/test
  const fromAddress = env.EMAIL_FROM;
  if (!fromAddress) return;

  try {
    const { error } = await c.emails.send({
      from: fromAddress,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    if (error) {
      // The most common cause is "domain not verified" — surface clearly.
      console.warn("[email] resend rejected:", error.name, error.message);
      captureException(new Error(`Resend rejected: ${error.name} ${error.message}`));
    }
  } catch (err) {
    console.warn("[email] resend threw:", err);
    captureException(err);
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bodyHtml(parts: {
  greeting: string;
  lead: string;
  cta?: { label: string; href: string };
  footer: string;
}): string {
  // Plain inline HTML — Resend handles transactional rendering. Keep it
  // simple enough that any client (Gmail, Outlook, Apple Mail) renders
  // sensibly without bespoke CSS. The `greeting` + `lead` may include
  // pre-built HTML; the cta + footer are wrapped here.
  const ctaBlock = parts.cta
    ? `
      <p style="margin: 24px 0;">
        <a href="${esc(parts.cta.href)}" style="display: inline-block; padding: 10px 16px; background: #2563eb; color: #fff; border-radius: 6px; text-decoration: none; font-weight: 600;">${esc(parts.cta.label)}</a>
      </p>`
    : "";
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111;">
      <p>${esc(parts.greeting)}</p>
      <p>${parts.lead}</p>${ctaBlock}
      <p style="font-size: 14px; color: #666;">${esc(parts.footer)}</p>
      <p style="font-size: 12px; color: #999; margin-top: 32px;">— e-Sharevice</p>
    </div>
  `;
}
