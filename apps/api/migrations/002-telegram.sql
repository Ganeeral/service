ALTER TABLE submission_requests ADD COLUMN telegram_link_encrypted jsonb;
ALTER TABLE appointments ADD COLUMN internal_note text NOT NULL DEFAULT '' CHECK (length(internal_note) <= 2000);

CREATE TABLE appointment_link_tokens (
  token_hash text PRIMARY KEY,
  appointment_id uuid NOT NULL REFERENCES appointments(id),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by text
);

CREATE TABLE telegram_updates (
  update_id bigint PRIMARY KEY,
  user_id text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error_code text
);
CREATE INDEX telegram_update_pending ON telegram_updates (available_at, update_id) WHERE processed_at IS NULL;

CREATE TABLE telegram_flows (
  user_id text PRIMARY KEY,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);

CREATE TABLE telegram_messages (
  id uuid PRIMARY KEY,
  job_id uuid REFERENCES notification_jobs(id),
  chat_id text NOT NULL,
  audience text NOT NULL CHECK (audience IN ('owner', 'customer')),
  method text NOT NULL DEFAULT 'sendMessage',
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_token uuid,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, chat_id)
);
CREATE INDEX telegram_message_pending ON telegram_messages (available_at) WHERE state IN ('pending','processing');
