import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { getDb, users } from "@esharevice/db";
import { captureException } from "../instrument.js";
import { emailConfigured, env } from "../env.js";

let _client: Resend | null = null;

function client(): Resend | null {
  if (!emailConfigured()) return null;
  if (_client) return _client;
  _client = new Resend(env.RESEND_API_KEY);
  return _client;
}

/**
 * Categories that map 1-1 to a `email_<category>_enabled` column on `users`.
 * Add a new category here ONLY after adding the matching column via migration;
 * the helpers below switch on this string to decide which pref gates the send.
 */
export type EmailCategory = "new_message" | "reserved" | "saved_item_changed";

/**
 * What every send helper needs to know about the recipient. Resolved by
 * `loadRecipient()` from `users.id` so call sites only pass an id — the
 * helper centralises the email lookup, the preference gate, and the
 * unsubscribe-token plumbing.
 */
type Recipient = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  email_token: string;
  email_new_message_enabled: boolean;
  email_reserved_enabled: boolean;
  email_saved_item_changed_enabled: boolean;
};

async function loadRecipient(userId: string): Promise<Recipient | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      first_name: users.first_name,
      last_name: users.last_name,
      email_token: users.email_token,
      email_new_message_enabled: users.email_new_message_enabled,
      email_reserved_enabled: users.email_reserved_enabled,
      email_saved_item_changed_enabled: users.email_saved_item_changed_enabled,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

function isEnabled(r: Recipient, cat: EmailCategory): boolean {
  switch (cat) {
    case "new_message":
      return r.email_new_message_enabled;
    case "reserved":
      return r.email_reserved_enabled;
    case "saved_item_changed":
      return r.email_saved_item_changed_enabled;
  }
}

function recipientName(r: Recipient): string {
  return `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "there";
}

/**
 * Build the public unsubscribe URL embedded in every email of a given
 * category. The category lands in the `c` query param; the token is the
 * non-enumerable per-user capability that authorises the flip.
 */
function unsubscribeUrl(token: string, category: EmailCategory): string {
  const base = (env.WEB_PUBLIC_URL ?? env.OIDC_ISSUER.replace(/\/application\/o\/[^/]+\/?$/, "")).replace(
    /\/$/,
    "",
  );
  return `${base}/unsubscribe?token=${encodeURIComponent(token)}&c=${encodeURIComponent(category)}`;
}

export type ReservedEmailInput = {
  recipientId: string;
  reserverName: string;
  itemService: string;
  itemUrl: string;
};

export type SaverReservedEmailInput = {
  recipientId: string;
  itemService: string;
  itemUrl: string;
};

export type SaverArchivedEmailInput = {
  recipientId: string;
  itemService: string;
};

export type NewMessageEmailInput = {
  recipientId: string;
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
 *
 * Gated on the `reserved` preference column for the recipient; if the
 * owner has opted out, this is a silent no-op.
 */
export async function sendReservedEmail(input: ReservedEmailInput): Promise<void> {
  const r = await loadRecipient(input.recipientId);
  if (!r) return;
  if (!isEnabled(r, "reserved")) return;
  const ownerName = recipientName(r);
  const unsub = unsubscribeUrl(r.email_token, "reserved");
  await sendTransactional({
    to: r.email,
    subject: `${input.reserverName} reserved your "${input.itemService}" listing`,
    text: composeText(
      [
        `Hi ${ownerName},`,
        "",
        `${input.reserverName} just reserved your "${input.itemService}" listing on e-Sharevice.`,
        "",
        `View the listing: ${input.itemUrl}`,
        "",
        "If you weren't expecting this, you can review or cancel from the listing page.",
      ].join("\n"),
      unsub,
      "reservation",
    ),
    html: bodyHtml({
      greeting: `Hi ${ownerName},`,
      lead: `<strong>${esc(input.reserverName)}</strong> just reserved your "<strong>${esc(input.itemService)}</strong>" listing on e-Sharevice.`,
      cta: { label: "View listing", href: input.itemUrl },
      footer: "If you weren't expecting this, you can review or cancel from the listing page.",
      unsubscribeUrl: unsub,
      unsubscribeLabel: "reservation",
    }),
    listUnsubscribe: unsub,
  });
}

/**
 * Saver-side "An item you saved was reserved" email.
 *
 * Fires to every user who bookmarked the item OTHER than the reserver
 * themselves and the owner (the owner gets the primary reserved-email
 * already — avoid double-sending). Same swallow-on-failure contract
 * as the owner notification. Gated on the `saved_item_changed` pref.
 */
export async function sendItemReservedEmailToSaver(
  input: SaverReservedEmailInput,
): Promise<void> {
  const r = await loadRecipient(input.recipientId);
  if (!r) return;
  if (!isEnabled(r, "saved_item_changed")) return;
  const saverName = recipientName(r);
  const unsub = unsubscribeUrl(r.email_token, "saved_item_changed");
  await sendTransactional({
    to: r.email,
    subject: `"${input.itemService}" — an item you saved was just reserved`,
    text: composeText(
      [
        `Hi ${saverName},`,
        "",
        `"${input.itemService}" — an item you bookmarked on e-Sharevice — was just reserved by another member.`,
        "",
        "It may become available again if the reservation is cancelled.",
        "",
        `View the listing: ${input.itemUrl}`,
      ].join("\n"),
      unsub,
      "saved-item updates",
    ),
    html: bodyHtml({
      greeting: `Hi ${saverName},`,
      lead: `"<strong>${esc(input.itemService)}</strong>" — an item you bookmarked on e-Sharevice — was just reserved by another member.`,
      cta: { label: "View listing", href: input.itemUrl },
      footer: "It may become available again if the reservation is cancelled.",
      unsubscribeUrl: unsub,
      unsubscribeLabel: "saved-item updates",
    }),
    listUnsubscribe: unsub,
  });
}

/**
 * Saver-side "An item you saved is no longer available" email.
 *
 * Fires to every user who bookmarked the item OTHER than the owner
 * (they're the one archiving). No CTA link — the listing is gone.
 * Gated on the `saved_item_changed` pref.
 */
export async function sendItemArchivedEmailToSaver(
  input: SaverArchivedEmailInput,
): Promise<void> {
  const r = await loadRecipient(input.recipientId);
  if (!r) return;
  if (!isEnabled(r, "saved_item_changed")) return;
  const saverName = recipientName(r);
  const unsub = unsubscribeUrl(r.email_token, "saved_item_changed");
  await sendTransactional({
    to: r.email,
    subject: `"${input.itemService}" — an item you saved is no longer available`,
    text: composeText(
      [
        `Hi ${saverName},`,
        "",
        `"${input.itemService}" — an item you bookmarked on e-Sharevice — has been removed by its owner and is no longer available.`,
        "",
        "We'll keep showing you new listings on the home page.",
      ].join("\n"),
      unsub,
      "saved-item updates",
    ),
    html: bodyHtml({
      greeting: `Hi ${saverName},`,
      lead: `"<strong>${esc(input.itemService)}</strong>" — an item you bookmarked on e-Sharevice — has been removed by its owner and is no longer available.`,
      footer: "We'll keep showing you new listings on the home page.",
      unsubscribeUrl: unsub,
      unsubscribeLabel: "saved-item updates",
    }),
    listUnsubscribe: unsub,
  });
}

/**
 * "You have a new message" email.
 *
 * Sent to the OTHER participant of a conversation when a message lands AND
 * the recipient hasn't opened the thread recently. The caller does the
 * active-view suppression check against `last_read_at` before invoking
 * this; this helper additionally gates on the per-user `new_message` pref.
 */
export async function sendNewMessageEmail(input: NewMessageEmailInput): Promise<void> {
  const r = await loadRecipient(input.recipientId);
  if (!r) return;
  if (!isEnabled(r, "new_message")) return;
  const rcptName = recipientName(r);
  const unsub = unsubscribeUrl(r.email_token, "new_message");
  // Hard preview cap — the body field is up to 4000 chars; an email subject
  // line truncated at 80 keeps the most-clicked metadata visible across
  // every client. The HTML preview gets a 240-char window before ellipsis.
  const subjectPreview =
    input.preview.length > 80 ? `${input.preview.slice(0, 77)}…` : input.preview;
  const htmlPreview =
    input.preview.length > 240 ? `${input.preview.slice(0, 237)}…` : input.preview;
  await sendTransactional({
    to: r.email,
    subject: `${input.senderName}: ${subjectPreview}`,
    text: composeText(
      [
        `Hi ${rcptName},`,
        "",
        `${input.senderName} sent you a message about "${input.itemService}" on e-Sharevice:`,
        "",
        `  ${input.preview}`,
        "",
        `Reply: ${input.threadUrl}`,
      ].join("\n"),
      unsub,
      "message notifications",
    ),
    html: bodyHtml({
      greeting: `Hi ${rcptName},`,
      lead: `<strong>${esc(input.senderName)}</strong> sent you a message about "<strong>${esc(input.itemService)}</strong>" on e-Sharevice:<br><br><span style="display: block; margin: 12px 0; padding: 10px 14px; border-left: 3px solid oklch(43% 0.15 195); background: #f6f8fa; color: #333; white-space: pre-wrap;">${esc(htmlPreview)}</span>`,
      cta: { label: "Reply", href: input.threadUrl },
      footer:
        "You're receiving this because you have an active conversation on e-Sharevice. Replies happen on the thread page.",
      unsubscribeUrl: unsub,
      unsubscribeLabel: "message notifications",
    }),
    listUnsubscribe: unsub,
  });
}

// ─────────────────────── internal helpers

type SendInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Value for the RFC 2369/8058 `List-Unsubscribe` header. */
  listUnsubscribe: string;
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
      headers: {
        "List-Unsubscribe": `<${input.listUnsubscribe}>`,
      },
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

/**
 * Append a plain-text unsubscribe footer to the body. The footer line is
 * the only one users grep for in their mail clients when they want out;
 * keep the URL explicit and on its own line so it's clickable everywhere.
 */
function composeText(body: string, unsubscribe: string, label: string): string {
  return `${body}\n\n— e-Sharevice\n\n---\nUnsubscribe from ${label}: ${unsubscribe}`;
}

function bodyHtml(parts: {
  greeting: string;
  lead: string;
  cta?: { label: string; href: string };
  footer: string;
  unsubscribeUrl: string;
  unsubscribeLabel: string;
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
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="font-size: 12px; color: #999;">
        Don't want these?
        <a href="${esc(parts.unsubscribeUrl)}" style="color: #2563eb;">Unsubscribe from ${esc(parts.unsubscribeLabel)}</a>.
      </p>
    </div>
  `;
}
