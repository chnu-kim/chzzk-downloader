// 사이트 스타일시트(docs/design/worker.md §8.1 구현 중 변경 35 (마)). 소스의 문자열 하나이고 경로에 내용 해시가 들어가 불변 캐시다.
// 내용을 바꾸면 SITE_CSS_HASH도 바꾼다(test/unit/site-css.test.ts가 기대값을 알려 준다). 인라인 스타일은 CSP가 막는다.
import type { Ctx } from "../routes";
import { errorJson } from "./respond";

export const SITE_CSS = `:root{color-scheme:light dark;--bg:#fafafa;--fg:#1b1b1b;--muted:#5f6368;--line:#d9d9d9;--accent:#008a4e;--warn:#b3261e;--box:#efefef}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#ececec;--muted:#a3a3a3;--line:#353535;--accent:#3ddc8a;--warn:#ff8a80;--box:#222}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
main{max-width:56rem;margin:0 auto;padding:1.5rem 1rem 3rem}
header{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:.75rem;margin-bottom:1.5rem}
h1{font-size:1.5rem;margin:0 0 1rem}
h2{font-size:1.15rem;margin:2rem 0 .75rem}
.muted{color:var(--muted)}
.warn{color:var(--warn)}
.code{font:600 2rem/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.1em}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;margin:.5rem 0 1rem}
th,td{text-align:left;padding:.4rem .5rem;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600}
code,.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85em;word-break:break-all}
pre{background:var(--box);padding:.75rem;overflow-x:auto;border-radius:6px}
form.inline{display:inline;margin:0}
button{font:inherit;padding:.35rem .9rem;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.danger{color:var(--warn);border-color:var(--warn)}
input[type=text]{font:inherit;padding:.35rem .5rem;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);width:100%}
details{border:1px solid var(--line);border-radius:6px;padding:.5rem .75rem;margin:.5rem 0}
summary{cursor:pointer;font-weight:600}
a{color:var(--accent)}`;

/** SHA-256(SITE_CSS) 앞 16 hex */
export const SITE_CSS_HASH = "8335b0f32a0f91ee";
export const SITE_CSS_PATH = `/assets/site.${SITE_CSS_HASH}.css`;

/** GET /assets/:file. 해시가 맞는 이름 하나만 200이고 불변 캐시다(no-store의 유일한 예외) */
export function siteCss(_req: Request, ctx: Ctx): Response {
  if (ctx.params.file !== `site.${SITE_CSS_HASH}.css`) return errorJson(404, "not_found");
  return new Response(SITE_CSS, {
    status: 200,
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
