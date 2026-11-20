-- Vertriebs-Cockpit der Plattform-Verwaltung (SPEC 19.31): Interessenten (Leads) mit Status, Verlauf und Mail-Vorlagen
CREATE TABLE sales_leads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  contact_name   text NOT NULL DEFAULT '',
  email          text NOT NULL DEFAULT '',
  phone          text NOT NULL DEFAULT '',
  website        text NOT NULL DEFAULT '',
  canton         char(2),
  source         text NOT NULL DEFAULT 'manuell' CHECK (source IN ('manuell', 'registrierung', 'empfehlung', 'messe', 'anfrage')),
  status         text NOT NULL DEFAULT 'neu' CHECK (status IN ('neu', 'kontaktiert', 'demo', 'angebot', 'gewonnen', 'verloren')),
  notes          text NOT NULL DEFAULT '',
  next_action_at date,
  hotel_id       uuid REFERENCES hotels(id) ON DELETE SET NULL,
  do_not_contact boolean NOT NULL DEFAULT false,
  last_mail_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sales_leads_hotel_idx ON sales_leads (hotel_id) WHERE hotel_id IS NOT NULL;
CREATE INDEX sales_leads_status_idx ON sales_leads (status, next_action_at);

CREATE TABLE sales_lead_events (
  id         bigserial PRIMARY KEY,
  lead_id    uuid NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('created', 'status', 'mail', 'note')),
  text       text NOT NULL DEFAULT '',
  actor      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_lead_events_lead_idx ON sales_lead_events (lead_id, created_at DESC);
