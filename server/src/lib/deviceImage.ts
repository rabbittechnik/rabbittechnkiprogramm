/**
 * Gerätebilder: Wikimedia Commons (ohne API-Key), optional Unsplash, Fallback Picsum.
 */

function readProcessEnv(name: string): string | undefined {
  const g = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.[name];
}

function picsumFallback(query: string): { image_url: string; source: string } {
  let hash = 0;
  for (let i = 0; i < query.length; i++) hash = (hash * 31 + query.charCodeAt(i)) >>> 0;
  const seed = `rt-${hash}`;
  return {
    image_url: `https://picsum.photos/seed/${encodeURIComponent(seed)}/480/360`,
    source: "picsum_seed",
  };
}

async function wikimediaFirstImageUrl(search: string): Promise<string | null> {
  const q = search.trim() || "computer hardware";
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: q,
    srnamespace: "6",
    srlimit: "8",
    format: "json",
    origin: "*",
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    query?: { search?: { title: string }[] };
  };
  const hits = data.query?.search;
  if (!hits?.length) return null;

  for (const h of hits) {
    const title = h.title;
    const p2 = new URLSearchParams({
      action: "query",
      titles: title,
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: "480",
      format: "json",
      origin: "*",
    });
    const r2 = await fetch(`https://commons.wikimedia.org/w/api.php?${p2}`);
    if (!r2.ok) continue;
    const j2 = (await r2.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            imageinfo?: { thumburl?: string; url?: string }[];
          }
        >;
      };
    };
    const pages = j2.query?.pages;
    if (!pages) continue;
    const page = Object.values(pages)[0];
    const info = page?.imageinfo?.[0];
    const url = info?.thumburl || info?.url;
    if (url && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) return url;
  }
  return null;
}

async function unsplashImageUrl(query: string, accessKey: string): Promise<string | null> {
  const q = encodeURIComponent(query.trim() || "laptop");
  const url = `https://api.unsplash.com/search/photos?query=${q}&per_page=1&orientation=landscape&client_id=${encodeURIComponent(accessKey)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: { urls?: { regular?: string } }[] };
  return data.results?.[0]?.urls?.regular ?? null;
}

export type DeviceImageResult = {
  image_url: string;
  source: string;
  hint?: string;
};

export async function resolveDeviceImage(query: string): Promise<DeviceImageResult> {
  const provider = (readProcessEnv("RABBIT_DEVICE_IMAGE_PROVIDER") ?? "wikimedia").toLowerCase();
  const unsplashKey = readProcessEnv("UNSPLASH_ACCESS_KEY") ?? "";

  if (provider === "unsplash" && unsplashKey) {
    const u = await unsplashImageUrl(query, unsplashKey);
    if (u) return { image_url: u, source: "unsplash" };
    const fb = picsumFallback(query);
    return { ...fb, hint: "Unsplash lieferte kein Bild – Fallback." };
  }

  if (provider === "picsum") {
    return picsumFallback(query);
  }

  // default: wikimedia
  try {
    const w = await wikimediaFirstImageUrl(query);
    if (w) return { image_url: w, source: "wikimedia_commons" };
  } catch {
    /* ignore */
  }

  const fb = picsumFallback(query);
  return {
    ...fb,
    hint: "Kein Commons-Treffer – Platzhalter. Tipp: UNSPLASH_ACCESS_KEY und RABBIT_DEVICE_IMAGE_PROVIDER=unsplash",
  };
}
