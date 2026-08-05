import type { Env } from "./env";
import { pgSelect, pgPatch, pgInsert } from "./supabase";

// Nightly automatic transitions (spec section 10): paid -> due past paid_to; due -> overdue
// past paid_to + grace_days. Entering overdue blocks token issue immediately (enforced live
// in entitlement.ts, not dependent on this having run yet today — see the belt-and-suspenders
// date check there).

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function runBillingTransitions(env: Env): Promise<void> {
  const today = todayISO();

  const paidPastDue = await pgSelect<{ id: string; paid_to: string }>(
    env,
    `clients?billing_state=eq.paid&paid_to=lt.${today}&select=id,paid_to`,
  );
  for (const client of paidPastDue) {
    await pgPatch(env, `clients?id=eq.${client.id}`, { billing_state: "due" });
    await pgInsert(env, "billing_events", { client_id: client.id, action: "marked_due", actor: "system" });
    await pgInsert(env, "audit_log", {
      actor: "system",
      action: "auto_marked_due",
      subject_type: "clients",
      subject_id: client.id,
      detail: { paid_to: client.paid_to },
    });
  }

  const duePastGrace = await pgSelect<{ id: string; paid_to: string; grace_days: number }>(
    env,
    `clients?billing_state=eq.due&select=id,paid_to,grace_days`,
  );
  for (const client of duePastGrace) {
    if (today > addDaysISO(client.paid_to, client.grace_days)) {
      await pgPatch(env, `clients?id=eq.${client.id}`, { billing_state: "overdue" });
      await pgInsert(env, "billing_events", { client_id: client.id, action: "marked_overdue", actor: "system" });
      await pgInsert(env, "audit_log", {
        actor: "system",
        action: "auto_marked_overdue",
        subject_type: "clients",
        subject_id: client.id,
        detail: { paid_to: client.paid_to, grace_days: client.grace_days },
      });
    }
  }
}
