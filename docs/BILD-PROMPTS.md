# Bild-Prompts für die Pontivo-Website

Die Seite funktioniert ohne Fotos: Der Baukasten, die Brücken-Grafik und die Modul-Symbole sind als SVG im Code. Die Prompts unten sind für **zusätzliche** Bilder, die ich nicht selbst erzeugen kann (Fotos, Illustrationen). Passende Werkzeuge: Midjourney, Ideogram, Adobe Firefly, GPT-Image, Flux.

## Gemeinsamer Stil (an jeden Prompt anhängen)

> Swiss alpine, calm and trustworthy, flat editorial illustration with soft grain, restrained palette: deep lake teal #0b6a7a, slate #13262e, glacier milk off-white #eef2f1, one small accent of berry violet #8a2e57. No text, no logos, no people's faces, generous empty space on the left for a headline. Aspect ratio 16:9.

## 1. Hero-Foto (Platz: Kopfbereich, rechts)
Small family-run Swiss mountain hotel at golden hour, wooden balconies with geraniums, a guest's hand holding a smartphone in the foreground showing a booking confirmation (screen blurred), shallow depth of field, natural light, documentary photography. Realistic, not stock-like.

## 2. Illustration «Direkt statt Portal»
Two paths from a traveller's phone to a small alpine hotel: a long winding path through many toll booths (portals) versus a short direct bridge. Minimal flat illustration, the bridge in teal, the toll booths in muted grey.

## 3. Modul-Szenen (je 4:3, einzeln erzeugen)
- Rezeption: wooden reception desk with an old brass bell, a tablet showing a day list, morning light.
- Housekeeping: folded white linen, a handheld device with a tick list, soft daylight.
- Kurtaxe und Rechnung: a neat desk with a printed invoice and a QR code slip, a fountain pen, calm top-down view.
- Kartenterminal: small card reader on a reception counter, hand tapping a card, shallow depth of field.
- Türcode (Nuki): a modern keypad next to a dark wooden chalet door, evening light.
- Gruppen: a long set table in a mountain lodge dining room, empty, warm light.

## 3b. Hero-Band «Brücke in der Natur» (breites Foto, 21:9, ersetzt das gezeichnete Band)
Photorealistic landscape photograph, wide cinematic 21:9: an old stone arch bridge crossing a calm clear river in a green Swiss valley, soft morning light with light mist over the water, mirror-like reflection of the arches, forested hills in the background, a few wildflowers on the bank, no people, no text, no vehicles. Muted natural colors with a hint of teal in the water, gentle warm sunlight on the stone. Shot on a full-frame camera, 35 mm, shallow haze, high detail.
Hinweis: Auf Hell und Dunkel prüfen; für den Nachtmodus ein zweites Bild mit Abenddämmerung erzeugen («blue hour, warm lantern light on the bridge»).

## 4. Social-/Vorschaubild (1200×630)
Same style as the hero, with the Pontivo bridge arch (a simple arch over a lake) as the central shape, empty space for the logo.

## Einbau
Bilder als `public/marketing/<name>.webp` ablegen (max. 200 KB je Bild). Sag mir die Dateinamen, ich binde sie in die Plätze ein; bis dahin bleibt es bei den SVG-Grafiken.
