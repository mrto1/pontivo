-- Channex gibt pro ARI-Request eine Task-ID zurück (Nachweis für Zertifizierung und Support)
ALTER TABLE channex_outbox ADD COLUMN task_id text;
