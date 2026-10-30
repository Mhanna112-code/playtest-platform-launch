// (Owner, Oct 29, batch 30 §19) Branded HTML emails: every email the app sends gets ONE shared layout, with its plain text kept alongside (the same words). The body is
// the email's text; its main link is a button with the plain link written under it (for mail apps that block buttons). The owner's logo (public/email-logo-full.png,
// the "PlaytestPlatform" wordmark, transparent with dark text) sits at the BOTTOM, in a light footer so it stays readable in dark mode, above the footer lines.
// Table layout, inline CSS, at most 560px wide: readable in Gmail, Outlook and Apple Mail.

/** The email's main link, shown as a button. */
export type EmailButton = { label: string; url: string };

export type LayoutOpts = {
  button?: EmailButton;
  /** The footer's "Notification settings" link: for summaries and other notices, not for confirm / reset emails. */
  settings?: boolean;
  /** The site's address (APP_URL). */
  base: string;
};

export const EMAIL_LOGO_PATH = "/email-logo-full.png";
export const EMAIL_FOOTER_LINE = "You got this email because you have a Playtest account.";
export const EMAIL_FOOTER_SITE = "Playtest · playtestplatform.com";
export const EMAIL_SETTINGS_LABEL = "Notification settings";

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const TEXT = "#141829";
const MUTED = "#646f8c";
const LINK = "#47506b";

/** Escapes text for HTML (every line of an email may hold what a person typed). */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const URL_RE = /https?:\/\/[^\s<>"]+/g;
const link = (url: string, label: string, style = `color:${LINK};text-decoration:underline;`) => `<a href="${esc(url)}" style="${style}">${label}</a>`;
/** Any address inside a line becomes a link (its text is the address itself, so the words stay the same). */
const linkify = (line: string) => {
  let out = "", at = 0;
  for (const m of line.matchAll(URL_RE)) {
    out += esc(line.slice(at, m.index)) + link(m[0], esc(m[0]), `color:${LINK};text-decoration:underline;word-break:break-all;`);
    at = (m.index ?? 0) + m[0].length;
  }
  return out + esc(line.slice(at));
};

function button(b: EmailButton) {
  return (
    `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:14px 0 6px 0;"><tr>` +
    `<td align="center" bgcolor="#d8fc52" style="border-radius:10px;background:#d8fc52;border-bottom:3px solid #62820b;">` +
    `<a href="${esc(b.url)}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:700;color:#0a0d18;text-decoration:none;border-radius:10px;">${esc(b.label)}</a>` +
    `</td></tr></table>` +
    `<p style="margin:0 0 14px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};word-break:break-all;">${link(b.url, esc(b.url), `color:${MUTED};text-decoration:underline;`)}</p>`
  );
}

/** One line of the body. A line ending in an address ("• Ana sent her answers https://…") links its words to it; a bare address is a link. */
function line(raw: string) {
  const indent = /^\s+/.exec(raw)?.[0].length ?? 0;
  const text = raw.trim();
  const style = `margin:0 0 6px ${indent ? 18 : 0}px;font-family:${FONT};font-size:15px;line-height:22px;color:${TEXT};`;
  const tail = /^(.*\S)\s+(https?:\/\/\S+)$/.exec(text);
  const inner = tail && !/https?:\/\//.test(tail[1]) ? link(tail[2], esc(tail[1]), `color:${TEXT};text-decoration:underline;`) : linkify(text);
  return `<p style="${style}">${inner}</p>`;
}

/** The body: the text line by line (a blank line is a gap); the main link's own line becomes the button, or the button follows the text. */
function body(text: string, b?: EmailButton) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // The closing "Playtest" signature stays last, under the button.
  let sig = "";
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length && lines[lines.length - 1].trim() === "Playtest") {
    sig = lines.pop()!;
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  }
  let placed = false;
  const out = lines.map((l) => {
    if (!l.trim()) return `<div style="height:10px;line-height:10px;font-size:10px;">&nbsp;</div>`;
    if (b && !placed && l.trim() === b.url) {
      placed = true;
      return button(b);
    }
    return line(l);
  });
  if (b && !placed) out.push(button(b));
  if (sig) out.push(`<div style="height:10px;line-height:10px;font-size:10px;">&nbsp;</div>`, line(sig));
  return out.join("\n");
}

/** The whole HTML email around the text. */
export function emailHtml(subject: string, text: string, o: LayoutOpts) {
  const base = o.base.replace(/\/$/, "");
  const footer = [
    `<a href="${esc(base)}" target="_blank" style="text-decoration:none;"><img src="${esc(base + EMAIL_LOGO_PATH)}" width="240" height="60" alt="PlaytestPlatform" style="display:block;width:240px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;margin:0 auto 12px auto;" /></a>`,
    `<p style="margin:0 0 4px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">${esc(EMAIL_FOOTER_LINE)}${o.settings ? ` ${link(`${base}/app/notifications`, esc(EMAIL_SETTINGS_LABEL), `color:${MUTED};text-decoration:underline;`)}` : ""}</p>`,
    `<p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">${esc(EMAIL_FOOTER_SITE)}</p>`,
  ].join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef1f6;" bgcolor="#eef1f6">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#eef1f6" style="background:#eef1f6;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;border-collapse:separate;">
<tr><td bgcolor="#ffffff" style="background:#ffffff;padding:28px 28px 22px 28px;border-radius:14px 14px 0 0;">
${body(text, o.button)}
</td></tr>
<tr><td align="center" bgcolor="#f6f7f9" style="background:#f6f7f9;padding:22px 28px 24px 28px;border-top:1px solid #e3e7ef;border-radius:0 0 14px 14px;text-align:center;">
${footer}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
