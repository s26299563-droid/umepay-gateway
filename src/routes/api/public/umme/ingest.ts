import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { matchPendingOrders } from "@/lib/gateway-server";

/**
 * Watcher ingest endpoint.
 *
 * The device/automation that watches the merchant UPI account pushes every
 * incoming payment here. Each transaction is stored in the ledger (deduped
 * by UTR) and immediately matched against pending orders by exact amount.
 * Caller is authenticated with a shared token in the `x-umme-token` header.
 */

const txSchema = z.object({
  utr: z.string().min(6).max(40),
  amount: z.number().positive().max(10_000_000),
  payer_vpa: z.string().max(120).optional(),
  payer_name: z.string().max(120).optional(),
  note: z.string().max(200).optional(),
  paid_at: z.string().min(10).max(40).optional(),
  source: z.string().max(40).optional(),
});

const ingestSchema = z.object({
  transactions: z.array(txSchema).min(1).max(200),
});

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-umme-token",
  };
}

function tokenMatches(provided: string | null, secret: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/umme/ingest")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      POST: async ({ request }) => {
        const headers = corsHeaders();
        const secret = process.env["UMME_INGEST_TOKEN"];
        if (!secret) {
          return Response.json(
            { error: "Ingest is not configured" },
            { status: 500, headers },
          );
        }
        if (!tokenMatches(request.headers.get("x-umme-token"), secret)) {
          return Response.json({ error: "Unauthorized" }, { status: 401, headers });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400, headers });
        }
        const parsed = ingestSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "Invalid payload", issues: parsed.error.issues },
            { status: 400, headers },
          );
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const db = supabaseAdmin;
        const now = new Date().toISOString();
        const rows = parsed.data.transactions.map((tx) => ({
          utr: tx.utr,
          amount_paise: Math.round(tx.amount * 100),
          payer_vpa: tx.payer_vpa ?? null,
          payer_name: tx.payer_name ?? null,
          note: tx.note ?? null,
          paid_at: tx.paid_at ?? now,
          source: tx.source ?? "watcher",
        }));

        const { error } = await db
          .from("upi_transactions")
          .upsert(rows, { onConflict: "utr", ignoreDuplicates: true });
        if (error) {
          return Response.json(
            { error: "Could not record transactions" },
            { status: 500, headers },
          );
        }

        const amounts = [...new Set(rows.map((row) => row.amount_paise))];
        let confirmed = 0;
        for (const amountPaise of amounts) {
          confirmed += await matchPendingOrders(db, amountPaise);
        }
        return Response.json(
          { ok: true, received: rows.length, confirmed },
          { headers },
        );
      },
    },
  },
});
