-- Welche Restriktionsfelder sich geändert haben (NULL = alle, z. B. Vollabgleich).
-- Channex möchte nur die geänderten Werte erhalten, nicht den ganzen Zustand.
ALTER TABLE channex_outbox ADD COLUMN fields text[];
