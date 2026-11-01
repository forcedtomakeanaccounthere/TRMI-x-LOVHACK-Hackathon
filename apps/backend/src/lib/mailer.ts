import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env";

// Local Supabase's Mailpit inbox (`[local_smtp] smtp_port` in supabase/config.toml).
const DEV_SMTP = { host: "127.0.0.1", port: 54325 };

let transporter: Transporter | null = null;

function transport() {
  const host = env.SMTP_HOST ?? DEV_SMTP.host;
  const port = env.SMTP_PORT ?? (env.SMTP_HOST ? 587 : DEV_SMTP.port);
  transporter ??= nodemailer.createTransport({
    host,
    port,
    // 465 is TLS from the start; other ports upgrade with STARTTLS when the server offers it.
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transporter;
}

const from = () => env.MAIL_FROM ?? (env.SMTP_USER ? `LinkRoom <${env.SMTP_USER}>` : "LinkRoom <no-reply@linkroom.local>");

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// The link is the first one in the HTML, so mail clients' previews (and our tests) pick it up.
export function verificationEmail(link: string, name?: string) {
  const hi = name ? `Hi ${name},` : "Hi,";
  const text = `${hi}\n\nConfirm your email to finish creating your LinkRoom account:\n${link}\n\nThe link works once. If you didn't sign up, ignore this email.\n`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f6f7fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">
    <p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#2f5bff;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600">Confirm your email</a></p>
    <p style="margin:0 0 12px">${escapeHtml(hi)}</p>
    <p style="margin:0 0 12px">Click the button above to finish creating your LinkRoom account. You'll land back on the sign-in page.</p>
    <p style="margin:0 0 12px;font-size:13px;color:#555">Button not working? Paste this into your browser:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
    <p style="margin:0;font-size:13px;color:#555">The link works once. If you didn't sign up, ignore this email.</p>
  </div>
</body></html>`;
  return { subject: "Confirm your LinkRoom account", text, html };
}

// A password reset: the link opens /forgot-password on the frontend, where the new password is set.
export function passwordResetEmail(link: string, name?: string) {
  const hi = name ? `Hi ${name},` : "Hi,";
  const text = `${hi}\n\nSomeone asked to reset the password for your LinkRoom account. Choose a new one here:\n${link}\n\nThe link works once and expires soon. If it wasn't you, ignore this email: your password stays the same.\n`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f6f7fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">
    <p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#2f5bff;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600">Choose a new password</a></p>
    <p style="margin:0 0 12px">${escapeHtml(hi)}</p>
    <p style="margin:0 0 12px">Someone asked to reset the password for your LinkRoom account. Click the button above to choose a new one.</p>
    <p style="margin:0 0 12px;font-size:13px;color:#555">Button not working? Paste this into your browser:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
    <p style="margin:0;font-size:13px;color:#555">The link works once and expires soon. If it wasn't you, ignore this email: your password stays the same.</p>
  </div>
</body></html>`;
  return { subject: "Reset your LinkRoom password", text, html };
}

// A mention in a room chat or a note: brings the tagged reader back into the room.
export function mentionEmail(opts: { link: string; roomTitle: string; actorName: string; body: string }) {
  const excerpt = opts.body.length > 280 ? `${opts.body.slice(0, 280)}…` : opts.body;
  const text = `Hi,\n\n${opts.actorName} mentioned you in "${opts.roomTitle}":\n\n"${excerpt}"\n\nJump back into the room:\n${opts.link}\n\nYou get this because someone tagged you (@you). Notifications can be turned off by leaving the room.\n`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f6f7fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">
    <p style="margin:0 0 6px">${escapeHtml(opts.actorName)} mentioned you</p>
    <h1 style="margin:0 0 20px;font-size:20px;font-weight:600">${escapeHtml(opts.roomTitle)}</h1>
    <blockquote style="margin:0 0 24px;border-left:3px solid #2f5bff;padding:4px 16px;color:#444;font-size:15px">&ldquo;${escapeHtml(excerpt)}&rdquo;</blockquote>
    <p style="margin:0 0 24px"><a href="${escapeHtml(opts.link)}" style="display:inline-block;background:#2f5bff;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600">Open the room</a></p>
    <p style="margin:0;font-size:13px;color:#555">You get this because someone tagged you (@you) in a LinkRoom room.</p>
  </div>
</body></html>`;
  return { subject: `${opts.actorName} mentioned you in ${opts.roomTitle}`, text, html };
}

export async function sendMentionEmail(
  to: string,
  opts: { link: string; roomTitle: string; actorName: string; body: string },
) {
  await transport().sendMail({ from: from(), to, ...mentionEmail(opts) });
}

export async function sendVerificationEmail(to: string, link: string, name?: string) {
  await transport().sendMail({ from: from(), to, ...verificationEmail(link, name) });
}

export async function sendPasswordResetEmail(to: string, link: string, name?: string) {
  await transport().sendMail({ from: from(), to, ...passwordResetEmail(link, name) });
}
