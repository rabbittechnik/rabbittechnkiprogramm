Offline-Gerätebilder (Netzwerk-Wizard)
=====================================

Lege hier eigene Fotos ab – sie werden aus dem Build mit ausgeliefert und vom Service Worker gecacht.

Dateiname = Slug aus dem Modellnamen (klein, FRITZ! → fritz, Sonderzeichen → Bindestrich).

Beispiele (Modell → Datei):
  FRITZ!Box 7590 AX     → fritzbox-7590-ax.webp
  FRITZ!Repeater 1200   → fritzrepeater-1200.png

Reihenfolge im UI: .webp → .png → .svg → eingebautes SVG-Fallback.

Unterstützte Formate: WebP, PNG, SVG. Empfohlen: quadratisch oder 4:3, max. ca. 400 px Kantenlänge (klein halten für schnellen Build).

Nach neuen Dateien: App neu deployen bzw. `npm run build` im Projektroot.
