# Mobile-Kundenannahme: sicherer Eingangskanal

Der Server stellt einen **Staging-Endpunkt** bereit. Eine Übertragung legt
zunächst nur einen prüfbaren Eingang in `mobile_intake_submissions` an. Sie
erzeugt weder einen Kunden noch ein Gerät, einen Reparaturauftrag, eine Rechnung
oder eine E-Mail. Das verhindert Doppelbuchungen und versehentliche Änderungen
an produktiven Stammdaten.

## Server-Konfiguration

Vor dem Einsatz in Railway muss ausschließlich als Server-Variable ein eigener,
zufällig erzeugter Wert gesetzt werden:

`RABBIT_MOBILE_SYNC_KEY=<mindestens 32 zufällige Zeichen>`

Der Wert gehört nie in Git, Screenshots oder ein öffentliches Web-/PWA-Bundle.
Für eine reine Browser-PWA ist ein dauerhaft eingebetteter Schlüssel nicht
sicher. Sie braucht deshalb entweder einen eigenen sicheren Backend-Proxy oder
eine interaktive Werkstatt-Anmeldung und einen anders gestalteten Endpunkt.

## Anfragevertrag

`POST /api/mobile-intake/submissions`

Erforderliche Header:

```text
Content-Type: application/json
X-Rabbit-Mobile-Key: <RABBIT_MOBILE_SYNC_KEY>
Idempotency-Key: <pro Annahme stabiler, zufälliger Schlüssel mit 16–128 Zeichen>
```

Beispielkörper:

```json
{
  "customer": { "name": "Max Mustermann", "email": "max@example.invalid", "phone": "+49 30 123", "address": null },
  "device": { "device_type": "Laptop", "brand": "Acer", "model": "Aspire 5", "serial_number": "ABC123" },
  "problem_key": "display",
  "problem_label": "Display defekt",
  "description": "Bild flackert nach dem Einschalten.",
  "accessories": "Netzteil",
  "pre_damage_notes": "Gehäuse Kratzer",
  "legal_consent": true,
  "signature_data_url": null,
  "service_codes": [],
  "source_created_at": "2026-11-05T15:00:00+01:00"
}
```

Eine erfolgreiche Annahme antwortet mit `202` und `{ "id", "status":
"pending", "duplicate": false }`. Beim erneuten Senden desselben
`Idempotency-Key` antwortet der Server mit `200` und `duplicate: true`; die
Mobile-App darf die Daten danach aus ihrer Offline-Warteschlange entfernen.

Die Werkstatt kann die Eingänge mit `GET /api/mobile-intake/submissions` (Bearer-
Token mit Werkstatt-Vollzugriff) prüfen.

## Explizite Übernahme

`POST /api/mobile-intake/submissions/:id/import` benötigt Werkstatt-Vollzugriff
und einen JSON-Körper. Dabei muss genau eine der beiden Kundenentscheidungen
explizit getroffen werden:

```json
{ "confirm": true, "customer_id": "bestehende-kunden-id" }
```

oder

```json
{ "confirm": true, "create_customer": true }
```

Der Import erstellt anschließend Kunde (nur bei bestätigter Neuanlage), Gerät,
Reparatur, Entwurfsrechnung und vorhandene Leistungspositionen in einer
Transaktion; der Mobile-Eingang wird als `imported` markiert. PDFs werden danach
erzeugt. Es wird dabei absichtlich **keine** Annahme-E-Mail automatisch gesendet.
Ein einmal importierter oder abgelehnter Eingang kann nicht nochmals importiert
werden. Ein Abgleich gleichnamiger Kunden ist bewusst nicht automatisch: Die
Werkstatt entscheidet sichtbar, welcher Kunde verwendet wird.
