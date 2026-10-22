/** Caption fonts, bundled with the site (SIL Open Font License; see src/assets/fonts/OFL-*.txt). */
import anton from "../assets/fonts/Anton_400Regular.ttf?url";
import bangers from "../assets/fonts/Bangers_400Regular.ttf?url";
import poppins from "../assets/fonts/Poppins_800ExtraBold.ttf?url";
import devanagari from "../assets/fonts/NotoSansDevanagari_800ExtraBold.ttf?url";
import kannada from "../assets/fonts/NotoSansKannada_800ExtraBold.ttf?url";
import { FONT_FAMILY, type FontKey } from "./captions";

export const FONT_URLS: Record<FontKey, string> = { anton, bangers, poppins, devanagari, kannada };

/** CSS @font-face rules for the live preview overlay (same files the export uses). */
export function fontFaceCss(): string {
  return (Object.keys(FONT_URLS) as FontKey[])
    .map((k) => `@font-face{font-family:"${FONT_FAMILY[k]}";src:url(${FONT_URLS[k]}) format("truetype");font-display:swap}`)
    .join("\n");
}

const cache = new Map<FontKey, Uint8Array>();
export async function loadFontBytes(key: FontKey): Promise<Uint8Array> {
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await fetch(FONT_URLS[key]);
  if (!res.ok) throw new Error("A caption font could not be loaded.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  cache.set(key, bytes);
  return bytes;
}
