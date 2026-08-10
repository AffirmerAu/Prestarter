import type { Env } from "./env";

// Direct Resend HTTP API call — separate from the Supabase Auth SMTP relay (also Resend,
// but that path is Supabase's own, only used for magic links). This is the application
// sending its own transactional email.
async function sendEmail(env: Env, to: string, subject: string, html: string, text: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html, text }),
    });
    if (!res.ok) {
      console.error("Resend send failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    // Onboarding email is a courtesy, not a hard dependency — a Resend outage must not
    // block creating a client. The caller reports success/failure back to the admin so a
    // failed send isn't silently lost, but it never rolls back the client creation itself.
    console.error("Resend send threw", err);
    return false;
  }
}

// Sent once, when an admin creates a client's first contact (spec architecture table:
// Resend handles "onboarding" — this is that). Points the contact at the portal to request
// their own magic link rather than pre-generating one server-side: a generated link expires
// long before someone gets around to opening a welcome email days later, whereas the normal
// self-serve sign-in flow has no such shelf life.
export async function sendOnboardingEmail(
  env: Env,
  opts: { to: string; contactName: string; clientName: string },
): Promise<boolean> {
  const portalUrl = "https://app.prestarter.au";
  const subject = `${opts.clientName} now has access to your training videos`;
  const text =
    `Hi ${opts.contactName},\n\n` +
    `${opts.clientName} now has access to your licensed training videos on Prestarter.\n\n` +
    `Sign in at ${portalUrl} with this email address (${opts.to}) to get a one-time sign-in link — ` +
    `no password needed.\n\n` +
    `From there you'll find your videos, QR codes for posters, and embeddable links.\n\n` +
    `— Affirmer`;
  const html =
    `<p>Hi ${opts.contactName},</p>` +
    `<p><strong>${opts.clientName}</strong> now has access to your licensed training videos on Prestarter.</p>` +
    `<p>Sign in at <a href="${portalUrl}">${portalUrl}</a> with this email address (${opts.to}) to get a ` +
    `one-time sign-in link — no password needed.</p>` +
    `<p>From there you'll find your videos, QR codes for posters, and embeddable links.</p>` +
    `<p>— Affirmer</p>`;
  return sendEmail(env, opts.to, subject, html, text);
}
