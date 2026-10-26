import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient;

/**
 * Matches pending payment orders against the incoming UPI transaction ledger.
 *
 * A transaction confirms an order when:
 *  - the amount matches exactly (each order gets unique paise),
 *  - the transaction was paid after the order was created (small slack),
 *  - the order has not expired,
 *  - the UTR has not already been used by another order (unique constraint).
 *
 * Returns the number of orders confirmed. Safe to call repeatedly — every
 * call is idempotent for already-processed rows.
 */
export async function matchPendingOrders(
  db: Db,
  amountPaise?: number,
): Promise<number> {
  const { data: settings } = await db
    .from("gateway_settings")
    .select("match_window_minutes")
    .eq("id", 1)
    .maybeSingle();
  const windowMs = (settings?.match_window_minutes ?? 240) * 60_000;
  const now = Date.now();

  let ordersQuery = db
    .from("payment_orders")
    .select("id, amount_paise, created_at, expires_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (amountPaise != null) {
    ordersQuery = ordersQuery.eq("amount_paise", amountPaise);
  }
  const { data: orders } = await ordersQuery;
  if (!orders?.length) return 0;

  let txQuery = db
    .from("upi_transactions")
    .select("utr, amount_paise, paid_at")
    .order("paid_at", { ascending: false })
    .limit(500);
  if (amountPaise != null) {
    txQuery = txQuery.eq("amount_paise", amountPaise);
  } else {
    txQuery = txQuery.gte(
      "paid_at",
      new Date(now - windowMs).toISOString(),
    );
  }
  const { data: transactions } = await txQuery;
  if (!transactions?.length) return 0;

  let confirmed = 0;
  for (const order of orders) {
    const created = new Date(order.created_at).getTime();
    const expiry = new Date(order.expires_at).getTime();

    if (expiry < now) {
      await db
        .from("payment_orders")
        .update({ status: "expired" })
        .eq("id", order.id)
        .eq("status", "pending");
      continue;
    }

    const match = transactions.find((tx) => {
      const paidAt = new Date(tx.paid_at).getTime();
      return (
        tx.amount_paise === order.amount_paise &&
        paidAt >= created - windowMs &&
        paidAt <= Math.min(now, expiry)
      );
    });
    if (!match) continue;

    const { error } = await db
      .from("payment_orders")
      .update({
        status: "confirmed",
        utr: match.utr,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .eq("status", "pending");
    if (!error) confirmed += 1;
  }
  return confirmed;
}
