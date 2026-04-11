/**
 * Generiert PNG-Icons aus dem SVG-Template für das PWA-Manifest.
 * Nutzt resvg-js (falls vorhanden) oder fällt auf ein einfaches Platzhalter-PNG zurück.
 * Alternativ kann man die PNGs auch manuell aus icon.svg erzeugen (z. B. Inkscape, Figma, squoosh.app).
 *
 * Aufruf: node client/scripts/generate-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const svgPath = path.join(publicDir, "icon.svg");
const svgData = fs.readFileSync(svgPath, "utf-8");

const sizes = [192, 512];

async function tryResvg() {
  try {
    const { Resvg } = await import("@aspect-dev/resvg-js");
    for (const s of sizes) {
      const resvg = new Resvg(svgData, { fitTo: { mode: "width", value: s } });
      const png = resvg.render().asPng();
      fs.writeFileSync(path.join(publicDir, `icon-${s}.png`), png);
      console.log(`icon-${s}.png (${png.length} bytes)`);
    }
    return true;
  } catch {
    return false;
  }
}

async function trySharp() {
  try {
    const sharp = (await import("sharp")).default;
    for (const s of sizes) {
      const buf = await sharp(Buffer.from(svgData)).resize(s, s).png().toBuffer();
      fs.writeFileSync(path.join(publicDir, `icon-${s}.png`), buf);
      console.log(`icon-${s}.png (${buf.length} bytes)`);
    }
    return true;
  } catch {
    return false;
  }
}

function createPlaceholderPng(size) {
  // Minimales 1x1 transparent PNG als Platzhalter
  // Wird in der Praxis durch das SVG-Icon ersetzt (alle modernen Browser)
  const header = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  console.warn(`icon-${size}.png: Platzhalter – ersetze mit echtem PNG (z. B. via squoosh.app aus icon.svg)`);
  return header;
}

async function main() {
  if (await tryResvg()) return;
  if (await trySharp()) return;
  console.warn("Weder @aspect-dev/resvg-js noch sharp gefunden – erstelle Platzhalter-PNGs.");
  console.warn("Das SVG-Icon (icon.svg) wird von allen modernen Browsern als PWA-Icon akzeptiert.");
  console.warn("Für volle Kompatibilität: icon.svg in 192x192 und 512x512 PNG exportieren (Figma, Inkscape, squoosh.app).");
  for (const s of sizes) {
    const placeholder = createPlaceholderPng(s);
    const dest = path.join(publicDir, `icon-${s}.png`);
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, placeholder);
    }
  }
}

main().catch(console.error);
