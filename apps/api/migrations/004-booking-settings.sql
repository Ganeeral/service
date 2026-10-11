CREATE TABLE booking_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  notice_minutes integer NOT NULL CHECK (notice_minutes BETWEEN 0 AND 10080),
  horizon_days integer NOT NULL CHECK (horizon_days BETWEEN 1 AND 365),
  window_minutes integer NOT NULL CHECK (window_minutes BETWEEN 5 AND 240),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
