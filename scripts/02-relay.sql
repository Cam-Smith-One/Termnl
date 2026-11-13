-- Storage for the Termnl relay (wss://termnl.app/relay). Run once in the existing Supabase project.
-- Holds only encrypted gift wraps; rows older than 30 days are removed by the relay itself.
BEGIN;
CREATE TABLE IF NOT EXISTS public.termnl_relay_events (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
  p text NOT NULL CHECK (p ~ '^[0-9a-f]{64}$'),
  created_at bigint NOT NULL,
  event jsonb NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS termnl_relay_events_p_created ON public.termnl_relay_events (p, created_at DESC);
CREATE INDEX IF NOT EXISTS termnl_relay_events_stored ON public.termnl_relay_events (stored_at);
ALTER TABLE public.termnl_relay_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.termnl_relay_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.termnl_relay_events TO service_role;
COMMIT;
