import type { Env } from "./env";
import { pgInsert } from "./supabase";
import { sendOnboardingEmail } from "./email";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function generateAccessKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface CreateClientBody {
  name?: unknown;
  mark_as?: unknown;
  plan_tier?: unknown;
  term_start?: unknown;
  term_end?: unknown;
  daily_cap_advisory?: unknown;
  contact_name?: unknown;
  contact_email?: unknown;
}

// Same upsert-by-lookup pattern as supabase/seed/seed-test-clients.mjs: create the auth
// user, and if one already exists for this email (a contact moving to a new client, or the
// admin re-running after a partial failure), look it up instead of treating that as an error.
async function findOrCreateAuthUser(env: Env, email: string): Promise<string> {
  const createRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (createRes.ok) {
    const user = await createRes.json<{ id: string }>();
    return user.id;
  }

  const listRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const list = await listRes.json<{ users?: { id: string; email: string }[] }>();
  const found = list.users?.find((u) => u.email === email);
  if (!found) throw new Error(`Could not create or find auth user for ${email}`);
  return found.id;
}

// Creates a client (spec section 5), an initial access key, and — if a first contact is
// given — that contact plus the Supabase Auth user their magic-link sign-in needs, then
// sends the onboarding email. The contact is optional: an admin may want to set up
// entitlements before anyone can sign in, and can add contacts afterward from the client
// detail page.
export async function handleCreateClient(env: Env, actorEmail: string, body: CreateClientBody): Promise<Response> {
  const name = body.name;
  const markAs = body.mark_as;
  const planTier = body.plan_tier;
  const termStart = body.term_start;
  const termEnd = body.term_end;
  const dailyCap = body.daily_cap_advisory;

  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof markAs !== "string" ||
    !markAs.trim() ||
    typeof planTier !== "string" ||
    !planTier.trim() ||
    typeof termStart !== "string" ||
    typeof termEnd !== "string" ||
    typeof dailyCap !== "number" ||
    !Number.isFinite(dailyCap) ||
    dailyCap <= 0
  ) {
    return json(
      { message: "name, mark_as, plan_tier, term_start, term_end and daily_cap_advisory are required" },
      400,
    );
  }
  if (termEnd <= termStart) {
    return json({ message: "term_end must be after term_start" }, 400);
  }

  const contactName = typeof body.contact_name === "string" ? body.contact_name.trim() : "";
  const contactEmail = typeof body.contact_email === "string" ? body.contact_email.trim() : "";
  if ((contactName && !contactEmail) || (!contactName && contactEmail)) {
    return json({ message: "contact_name and contact_email must be provided together" }, 400);
  }

  const client = await pgInsert<{ id: string }>(env, "clients", {
    name,
    mark_as: markAs,
    plan_tier: planTier,
    term_start: termStart,
    term_end: termEnd,
    // Whole first term prepaid, matching how test clients are seeded — an admin who wants a
    // different starting billing state (e.g. invoiced net-30) can adjust it from the client
    // detail page immediately after.
    billing_state: "paid",
    paid_to: termEnd,
    daily_cap_advisory: dailyCap,
  });

  await pgInsert(env, "audit_log", {
    actor: actorEmail,
    action: "create_client",
    subject_type: "clients",
    subject_id: client.id,
    detail: { name, plan_tier: planTier, term_start: termStart, term_end: termEnd },
  });

  const accessKey = generateAccessKey();
  await pgInsert(env, "access_keys", { client_id: client.id, key: accessKey });

  let onboardingEmailSent: boolean | null = null;
  if (contactEmail) {
    const userId = await findOrCreateAuthUser(env, contactEmail);
    await pgInsert(env, "client_contacts", {
      client_id: client.id,
      user_id: userId,
      email: contactEmail,
      name: contactName,
      role: "safety_manager",
    });
    onboardingEmailSent = await sendOnboardingEmail(env, {
      to: contactEmail,
      contactName,
      clientName: name,
    });
  }

  return json({ id: client.id, access_key: accessKey, onboarding_email_sent: onboardingEmailSent });
}
