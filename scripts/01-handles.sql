-- Owner-reviewed optional handle registry. Run once in the existing project.
-- No chat/auth tables are changed. Messaging works without this registry.
BEGIN;
CREATE TABLE IF NOT EXISTS public.termnl_handles (
  name text PRIMARY KEY CHECK (name ~ '^[a-z0-9][a-z0-9_-]{2,19}$'),
  pubkey text UNIQUE NOT NULL CHECK (pubkey ~ '^[0-9a-f]{64}$'),
  relays jsonb NOT NULL CHECK (jsonb_typeof(relays)='array' AND jsonb_array_length(relays) BETWEEN 1 AND 8),
  claim_event_id text UNIQUE NOT NULL CHECK (claim_event_id ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.termnl_handles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.termnl_handles FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.termnl_handles TO service_role;
COMMIT;
