CREATE TABLE public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  amount_paise integer not null,
  status text not null default 'pending',
  customer_name text,
  customer_note text,
  utr text unique,
  confirmed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

CREATE TABLE public.upi_transactions (
  id uuid primary key default gen_random_uuid(),
  utr text not null unique,
  amount_paise integer not null,
  payer_vpa text,
  payer_name text,
  note text,
  paid_at timestamptz not null,
  source text not null default 'watcher',
  created_at timestamptz not null default now()
);

CREATE TABLE public.gateway_settings (
  id integer primary key default 1,
  merchant_vpa text not null default 'umme.pay@ybl',
  payee_name text not null default 'Umme Pay',
  match_window_minutes integer not null default 240,
  order_expiry_minutes integer not null default 20,
  updated_at timestamptz not null default now()
);

INSERT INTO public.gateway_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

GRANT ALL ON public.payment_orders TO service_role;
GRANT ALL ON public.upi_transactions TO service_role;
GRANT ALL ON public.gateway_settings TO service_role;

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upi_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_settings ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_payment_orders_status_amount ON public.payment_orders (status, amount_paise);
CREATE INDEX idx_upi_transactions_paid_at ON public.upi_transactions (paid_at);