import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getOrderStatus } from "@/lib/gateway";
import { buildUpiIntent, formatExpiryTime, formatRupees } from "@/lib/umme";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="group flex w-full items-center justify-between rounded-xl border border-border bg-muted/40 px-4 py-3 text-left transition-colors hover:border-ring"
    >
      <span className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="flex items-center gap-2 font-mono text-sm font-medium text-foreground">
        {value}
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground group-hover:text-ring">
          {copied ? "copied" : "copy"}
        </span>
      </span>
    </button>
  );
}

function StepIndicator({ active = false, done, label }: { active?: boolean; done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold " +
          (done
            ? "border-primary bg-primary text-primary-foreground"
            : active
              ? "border-primary text-primary umme-pulse"
              : "border-border text-muted-foreground")
        }
      >
        {done ? "✓" : ""}
      </span>
      <span className={"text-sm " + (done || active ? "text-foreground" : "text-muted-foreground")}>
        {label}
      </span>
    </li>
  );
}

export function OrderTracker({ orderCode }: { orderCode: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["umme-order", orderCode],
    queryFn: () => getOrderStatus({ data: { orderCode } }),
    refetchInterval: (query) =>
      query.state.data?.order.status === "pending" ? 5000 : false,
  });

  const order = data?.order;
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!order || !data?.merchantVpa) return;
    let cancelled = false;
    (async () => {
      try {
        const QRCode = await import("qrcode");
        const intent = buildUpiIntent(
          data.merchantVpa,
          data.payeeName,
          order.amount_paise,
          order.order_code,
        );
        const url = await QRCode.toDataURL(intent, {
          width: 512,
          margin: 1,
          color: { dark: "#0b1e1c", light: "#ffffff" },
        });
        if (!cancelled) setQrDataUrl(url);
      } catch {
        /* QR generation failed; intent link still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order?.order_code, data?.merchantVpa, data?.payeeName, order?.amount_paise]);

  if (isLoading || !order) {
    return (
      <Card className="umme-card mx-auto w-full max-w-md">
        <CardContent className="space-y-4 p-6">
          <Skeleton className="h-8 w-40 bg-muted" />
          <Skeleton className="mx-auto h-56 w-56 rounded-2xl bg-muted" />
          <Skeleton className="h-10 w-full bg-muted" />
        </CardContent>
      </Card>
    );
  }

  const amount = formatRupees(order.amount_paise);
  const intent =
    data?.merchantVpa && order.status === "pending"
      ? buildUpiIntent(data.merchantVpa, data.payeeName, order.amount_paise, order.order_code)
      : null;

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <Card className="umme-card overflow-hidden">
        <CardContent className="space-y-6 p-6 sm:p-8">
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Order {order.order_code}
            </p>
            <p className="mt-1 font-display text-4xl font-bold tracking-tight text-foreground">
              ₹{amount}
            </p>
            {order.status === "pending" && (
              <p className="mt-2 text-sm text-muted-foreground">
                Pay exactly this amount — it identifies your payment automatically.
              </p>
            )}
            {order.status === "confirmed" && (
              <Badge className="mt-2 bg-primary text-primary-foreground hover:bg-primary">
                Payment confirmed
              </Badge>
            )}
            {order.status === "expired" && (
              <Badge variant="outline" className="mt-2 border-border text-muted-foreground">
                Order expired
              </Badge>
            )}
          </div>

          {order.status === "pending" && (
            <>
              <div className="mx-auto w-fit rounded-2xl bg-white p-3 shadow-lg">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="UPI payment QR code" className="h-52 w-52" />
                ) : (
                  <div className="h-52 w-52 animate-pulse rounded-xl bg-muted" />
                )}
              </div>
              {intent && (
                <Button asChild size="lg" className="w-full text-base font-semibold">
                  <a href={intent}>Pay with any UPI app</a>
                </Button>
              )}
              <div className="space-y-2">
                <CopyField label="Pay to UPI ID" value={data?.merchantVpa ?? ""} />
                <CopyField label="Exact amount" value={`₹${amount}`} />
              </div>
              <p className="text-center text-xs leading-relaxed text-muted-foreground">
                Umme Pay checks incoming payments automatically and confirms this
                order itself — usually within 4 minutes. Order expires at{" "}
                {formatExpiryTime(order.expires_at)}.
              </p>
            </>
          )}

          {order.status === "confirmed" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-primary/40 bg-primary/10 p-4 text-center">
                <p className="font-display text-2xl font-semibold text-primary">
                  Payment verified
                </p>
                {order.confirmed_at && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Confirmed at {formatExpiryTime(order.confirmed_at)}
                  </p>
                )}
              </div>
              {order.utr && <CopyField label="UTR reference" value={order.utr} />}
              <Button asChild variant="secondary" className="w-full">
                <Link to="/">Create another payment</Link>
              </Button>
            </div>
          )}

          {order.status === "expired" && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                This order timed out before a matching payment was found.
              </p>
              <Button asChild variant="secondary" className="w-full">
                <Link to="/">Start a new payment</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="umme-card">
        <CardContent className="p-5">
          <ol className="space-y-3">
            <StepIndicator done label="Order created" />
            <StepIndicator
              active={order.status === "pending"}
              done={order.status === "confirmed"}
              label={
                order.status === "confirmed"
                  ? "Payment received on UPI"
                  : "Waiting for your payment"
              }
            />
            <StepIndicator
              active={order.status === "pending"}
              done={order.status === "confirmed"}
              label="Auto-verification against UTR ledger"
            />
            <StepIndicator
              done={order.status === "confirmed"}
              label={
                order.status === "confirmed"
                  ? "Confirmed"
                  : order.status === "expired"
                    ? "Expired"
                    : "Confirmed — UTR recorded"
              }
            />
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
