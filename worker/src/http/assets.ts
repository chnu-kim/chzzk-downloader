// 에셋 표(docs/design/system/web.md §4 "에셋 표", 계약 §2.4). GET /assets/:file은 이 표를 조회한다.
// 표 = 스타일시트(site-css.generated.ts) + 체크인된 바이너리 에셋(assets.generated.ts의 base64). 주소에 내용 해시가 들어가 불변 캐시다.
// 디코드(atob)는 모듈을 적재할 때 한 번이다. 표 밖 이름은 404 JSON(no-store)이다.
import type { Ctx } from "../routes";
import { ASSETS } from "./assets.generated";
import { errorJson } from "./respond";
import { SITE_CSS, SITE_CSS_HASH } from "./site-css.generated";

export type AssetName = "site.css" | "icon.svg" | "favicon.ico" | "apple-touch-icon.png" | "og.png";

interface Entry {
  readonly type: string;
  readonly body: Uint8Array;
  /** `<이름>.<해시>.<확장자>` */
  readonly file: string;
}

const IMMUTABLE = "public, max-age=31536000, immutable";
// 해시 없는 주소(/favicon.ico)는 불변이 아니다
const ALIAS_CACHE = "public, max-age=86400";

/** 이름 → [이름 줄기, 확장자] */
function split(name: AssetName): readonly [string, string] {
  const i = name.lastIndexOf(".");
  return [name.slice(0, i), name.slice(i + 1)];
}

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function entry(name: AssetName, type: string, hash: string, body: Uint8Array): Entry {
  const [stem, ext] = split(name);
  return { type, body, file: `${stem}.${hash}.${ext}` };
}

const TABLE: Readonly<Record<AssetName, Entry>> = {
  "site.css": entry("site.css", "text/css; charset=utf-8", SITE_CSS_HASH, new TextEncoder().encode(SITE_CSS)),
  "icon.svg": entry("icon.svg", ASSETS["icon.svg"].type, ASSETS["icon.svg"].hash, decode(ASSETS["icon.svg"].b64)),
  "favicon.ico": entry("favicon.ico", ASSETS["favicon.ico"].type, ASSETS["favicon.ico"].hash, decode(ASSETS["favicon.ico"].b64)),
  "apple-touch-icon.png": entry("apple-touch-icon.png", ASSETS["apple-touch-icon.png"].type, ASSETS["apple-touch-icon.png"].hash, decode(ASSETS["apple-touch-icon.png"].b64)),
  "og.png": entry("og.png", ASSETS["og.png"].type, ASSETS["og.png"].hash, decode(ASSETS["og.png"].b64)),
};

/** 에셋의 공개 경로 `/assets/<줄기>.<해시>.<확장자>` */
export function assetPath(name: AssetName): string {
  return `/assets/${TABLE[name].file}`;
}

function serve(e: Entry, cacheControl: string): Response {
  // 응답마다 본문을 새로 만든다(모듈 값을 여러 응답이 같이 읽는다)
  return new Response(e.body.slice(), { status: 200, headers: { "Content-Type": e.type, "Cache-Control": cacheControl } });
}

/** GET /assets/:file. 해시가 맞는 표의 이름만 200이다 */
export function asset(_req: Request, ctx: Ctx): Response {
  const e = Object.values(TABLE).find((x) => x.file === ctx.params.file);
  return e === undefined ? errorJson(404, "not_found") : serve(e, IMMUTABLE);
}

/** GET /favicon.ico: 아이콘 에셋의 별칭(주소에 해시가 없다) */
export function faviconAlias(_req: Request, _ctx: Ctx): Response {
  return serve(TABLE["favicon.ico"], ALIAS_CACHE);
}
