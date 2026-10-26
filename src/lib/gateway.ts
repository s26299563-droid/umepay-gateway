import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { matchPendingOrders } from "./gateway-server";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return out;
}

export const createOrder = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        amountRupees: z.number().min(1).max(100000),
        customerName: z.string().max(80).optional(),
        note: z.string().max(140).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const db = supabaseAdmin;

    const { data: settings } = await db
      .from("gateway_settings")
      .select("merchant_vpa, payee_name, order_expiry_minutes")
      .eq("id", 1)
      .maybeSingle();
    const expiryMinutes = settings?.order_expiry_minutes ?? 20;

    // The paise component makes the order total unique among pending
    // orders, so the watcher can auto-match payments by exact amount.
    let amountPaise = 0;
    const basePaise = Math.round(data.amountRupees * 100);
    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = basePaise + 1 + Math.floor(Math.random() * 99);
      const { data: clash } = await db
        .from("payment_orders")
        .select("id")
        .eq("amount_paise", candidate)
        .eq("status", "pending")
        .maybeSingle();
      if (!clash) {
        amountPaise = candidate;
        break;
      }
    }
    if (!amountPaise) amountPaise = basePaise + 1 + Math.floor(Math.random() * 99);

    const orderCode = "UM" + randomCode(6);
    const expiresAt = new Date(Date.now() + expiryMinutes * 60_000).toISOString();

    const { error } = await db.from("payment_orders").insert({
      order_code: orderCode,
      amount_paise: amountPaise,
      customer_name: data.customerName ?? null,
      customer_note: data.note ?? null,
      expires_at: expiresAt,
    });
    if (error) throw new Error("Could not create the payment order");

    return {
      orderCode,
      amountPaise,
      merchantVpa: settings?.merchant_vpa ?? "umme.pay@ybl",
      payeeName: settings?.payee_name ?? "Umme Pay",
      expiresAt,
    };
  });

export const getOrderStatus = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        orderCode: z
          .string()
          .min(4)
          .max(32)
          .regex(/^[A-Za-z0-9]+$/),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const db = supabaseAdmin;
    const code = data.orderCode.toUpperCase();

    const { data: order } = await db
      .from("payment_orders")
      .select("id, status, amount_paise")
      .eq("order_code", code)
      .maybeSingle();
    if (!order) return null;

    // Re-run the matcher on every poll so an already-fed payment
    // (ledger row arrived before this poll) still confirms instantly.
    if (order.status === "pending") {
      await matchPendingOrders(db, order.amount_paise);
    }

    const { data: fresh, error } = await db
      .from("payment_orders")
      .select(
        "order_code, amount_paise, status, utr, confirmed_at, expires_at, customer_name, customer_note",
      )
      .eq("id", order.id)
      .single();
    if (error || !fresh) return null;

    const { data: settings } = await db
      .from("gateway_settings")
      .select("merchant_vpa, payee_name")
      .eq("id", 1)
      .maybeSingle();

    return {
      order: fresh,
      merchantVpa: settings?.merchant_vpa ?? "",
      payeeName: settings?.payee_name ?? "Umme Pay",
    };
  });
