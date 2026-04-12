import { rgb } from "pdf-lib";

/** Wie `SignatureCanvas` (#060b13) – Striche der Unterschrift sind weiß. */
export const SIGNATURE_PAD_BG = rgb(6 / 255, 11 / 255, 19 / 255);

/** Skalierung mit Mindesthöhe, damit feine Linien im PDF nicht verschwinden. */
export function signatureDrawSize(
  imageWidth: number,
  imageHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    return { width: Math.min(maxWidth, 200), height: Math.min(maxHeight, 80) };
  }
  let s = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
  const minH = 52;
  if (imageHeight * s < minH) {
    s = Math.min(maxWidth / imageWidth, minH / imageHeight);
  }
  if (s > 1) s = 1;
  return { width: imageWidth * s, height: imageHeight * s };
}
