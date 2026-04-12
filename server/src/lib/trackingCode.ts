import { customAlphabet } from "nanoid";

const gen = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 8);
const genHb = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 8);

export function makeTrackingCode(): string {
  return `RT-${gen()}`;
}

export function makeHardwareOrderRef(): string {
  return `HB-${genHb()}`;
}
