CREATE TABLE service_catalog (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_-]{0,59}$'),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  enabled boolean NOT NULL DEFAULT false
);

CREATE TABLE intake_slots (
  id uuid PRIMARY KEY,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  published boolean NOT NULL DEFAULT false,
  CHECK (end_at > start_at),
  EXCLUDE USING gist (tstzrange(start_at, end_at, '[)') WITH &&)
);

CREATE TABLE closed_dates (
  day date PRIMARY KEY,
  closed boolean NOT NULL DEFAULT false
);

CREATE TABLE appointments (
  id uuid PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  slot_id uuid NOT NULL REFERENCES intake_slots(id),
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled', 'completed', 'no_show')),
  source text NOT NULL CHECK (source IN ('web', 'manual')),
  name text NOT NULL,
  phone_original text NOT NULL,
  phone_normalized text NOT NULL,
  telegram_username text,
  telegram_user_id text,
  vehicle_make text NOT NULL,
  vehicle_model text NOT NULL,
  vehicle_year integer,
  mileage integer CHECK (mileage >= 0 AND mileage <= 5000000),
  service_key text NOT NULL REFERENCES service_catalog(key),
  service_title text NOT NULL,
  problem text NOT NULL,
  consent_version text NOT NULL,
  consent_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_appointment_per_slot ON appointments (slot_id) WHERE status IN ('pending', 'confirmed');
CREATE INDEX appointment_customer ON appointments (telegram_user_id) WHERE telegram_user_id IS NOT NULL;

CREATE TABLE appointment_events (
  id uuid PRIMARY KEY,
  appointment_id uuid NOT NULL REFERENCES appointments(id),
  revision integer NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('web', 'operator', 'owner', 'customer')),
  actor_id text,
  operation text NOT NULL,
  old_status text,
  new_status text NOT NULL,
  old_slot_id uuid REFERENCES intake_slots(id),
  new_slot_id uuid NOT NULL REFERENCES intake_slots(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, revision)
);

CREATE TABLE notification_jobs (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES appointment_events(id),
  recipient text NOT NULL CHECK (recipient IN ('owner', 'customer')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_token uuid,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, recipient)
);
CREATE INDEX notification_pending ON notification_jobs (available_at) WHERE state IN ('pending', 'processing');

CREATE TABLE submission_requests (
  key_hash text PRIMARY KEY,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  appointment_id uuid NOT NULL REFERENCES appointments(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
