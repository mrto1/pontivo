-- 0006: Wertgutscheine (online kaufen, im Hotel einlösen, auch in Teilbeträgen)

CREATE TABLE vouchers (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                  uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  code                      text NOT NULL UNIQUE,             -- z. B. GS-ABCD-EFGH (gut lesbar, ohne 0/O/1/I)
  public_token              text NOT NULL UNIQUE,             -- Link zum Gutschein (Ansehen/Drucken)
  amount_rappen             integer NOT NULL CHECK (amount_rappen > 0),
  remaining_rappen          integer NOT NULL CHECK (remaining_rappen >= 0),
  platform_fee_rappen       integer NOT NULL DEFAULT 0,
  buyer_name                text NOT NULL,
  buyer_email               text NOT NULL,
  recipient_name            text NOT NULL DEFAULT '',
  message                   text NOT NULL DEFAULT '',
  language                  text NOT NULL DEFAULT 'de',
  status                    text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  stripe_session_id         text,
  stripe_payment_intent_id  text,
  valid_until               date NOT NULL,
  paid_at                   timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (remaining_rappen <= amount_rappen)
);
CREATE INDEX ON vouchers(hotel_id, created_at DESC);

CREATE TABLE voucher_redemptions (
  id             bigserial PRIMARY KEY,
  voucher_id     uuid NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  hotel_id       uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  amount_rappen  integer NOT NULL CHECK (amount_rappen > 0),
  note           text NOT NULL DEFAULT '',
  actor          text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON voucher_redemptions(voucher_id);
