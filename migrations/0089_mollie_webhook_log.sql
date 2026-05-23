-- Mollie webhook diagnostiek-log
-- Sla elke binnenkomende webhook-call op zodat we kunnen verifiëren of
-- Mollie ons echt bereikt. Helpt bij debuggen van "status blijft pending"
-- problemen — dan zien we meteen of Mollie ons al dan niet gebeld heeft.
--
-- Beperkt tot recente entries (admin kan oude wegklikken via UI).

CREATE TABLE IF NOT EXISTS mollie_webhook_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id TEXT,                    -- tr_xxx van Mollie
  payment_type TEXT,                  -- metadata.type: membership/donation/activity/ticket
  mollie_status TEXT,                 -- paid/open/canceled/failed
  local_action TEXT,                  -- bv. 'updated_membership_77_to_paid'
  http_status INTEGER,                -- response status we hebben teruggegeven aan Mollie
  error_message TEXT,                 -- bij fout
  raw_body TEXT,                      -- max 500 chars, voor debugging
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mollie_webhook_log_created ON mollie_webhook_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mollie_webhook_log_payment ON mollie_webhook_log(payment_id);
