import fs from "node:fs";
import path from "node:path";
import { getDataRoot } from "./dataPaths.js";

/** Append-only JSON-Zeilen unter persistentem Data-Root (Railway Volume). */
export function appendSumupWebhookLog(payload: unknown): void {
  try {
    const line = JSON.stringify({ t: new Date().toISOString(), payload }) + "\n";
    const p = path.join(getDataRoot(), "sumup-webhook.log");
    fs.appendFileSync(p, line, { encoding: "utf8" });
  } catch (e) {
    console.error("[sumup-webhook.log]", e);
  }
}
