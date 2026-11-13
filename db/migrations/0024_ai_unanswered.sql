-- KI-Chat-Auswertung (SPEC 14b): wie oft der Chat eine Frage nicht beantworten konnte (nur Zähler, nie Texte)
ALTER TABLE ai_usage ADD COLUMN unanswered integer NOT NULL DEFAULT 0 CHECK (unanswered >= 0);
