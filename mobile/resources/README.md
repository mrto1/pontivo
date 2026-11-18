# Bildmaterial für die App

Diese Dateien müssen von Ihnen (oder einem Designer) geliefert werden, sie lassen sich nicht erfinden:
- `icon.png`: 1024 × 1024 px, ohne Transparenz und ohne abgerundete Ecken (die Stores runden selbst). Verwenden Sie das Pontivo-Logo.
- `icon-foreground.png` (nur Android, adaptives Icon): 1024 × 1024 px, Motiv in der mittleren Fläche (ca. 66 %), transparenter Hintergrund; dazu eine Hintergrundfarbe.
- `splash.png`: 2732 × 2732 px, Motiv mittig.
- Store-Bilder: Screenshots (Handy hoch, bei iOS zusätzlich iPad, wenn iPad unterstützt wird), Play-Store-Banner 1024 × 500 px.

Danach erzeugen `@capacitor/assets` bzw. Android Studio / Xcode die Grössen (siehe ../README.md).
