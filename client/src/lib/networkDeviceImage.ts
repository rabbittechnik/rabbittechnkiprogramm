/**
 * Dateiname-Slug für lokale Gerätebilder unter `/network-devices/{slug}.webp|.png|.svg`.
 * Muss stabil bleiben, damit eigene Fotos im Ordner `client/public/network-devices/` zuverlässig gemappt werden.
 */
export function slugForNetworkDeviceImage(model: string): string {
  return model
    .toLowerCase()
    .replace(/fritz!/gi, "fritz")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
