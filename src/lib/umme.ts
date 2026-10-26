export type OrderStatusValue = "pending" | "confirmed" | "expired";

export interface UmmeOrder {
  order_code: string;
  amount_paise: number;
  status: OrderStatusValue;
  utr: string | null;
  confirmed_at: string | null;
  expires_at: string;
  customer_name: string | null;
  customer_note: string | null;
}

export interface OrderStatusResponse {
  order: UmmeOrder;
  merchantVpa: string;
  payeeName: string;
}

export function formatRupees(paise: number): string {
  return (paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Builds a standard UPI intent URL. Every order carries a unique total
 * (unique paise), so the gateway can recognise the payment by amount + UTR.
 */
export function buildUpiIntent(
  vpa: string,
  payeeName: string,
  amountPaise: number,
  orderCode: string,
): string {
  const amount = (amountPaise / 100).toFixed(2);
  const params = new URLSearchParams({
    pa: vpa,
    pn: payeeName,
    am: amount,
    cu: "INR",
    tr: orderCode,
    tn: `Umme Pay ${orderCode}`,
  });
  return `upi://pay?${params.toString()}`;
}

export function formatExpiryTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
