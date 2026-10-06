// vitest(Workers 런타임, docs/design/worker.md §12.2). 실제 비밀값 파일을 열지 않는다(worker.md 구현 중 변경 5):
//   - 플러그인은 wrangler에 env 파일 목록을 넘기지 않아 그대로 두면 설정 폴더의 비밀값 파일(1Password FIFO 마운트)을 연다.
//     environment "example"이면 wrangler가 환경별 파일 .dev.vars.example을 먼저 찾아 쓰고 그 파일은 열지 않는다
//     (wrangler.jsonc에는 env 절이 없어 최상위 설정이 그대로 쓰인다. "No environment found" 경고는 이것 때문이다).
//   - 그래도 모든 키를 .dev.vars.example 값으로 다시 덮는다(miniflare.bindings가 이긴다, 실측). test/bindings.test.ts가
//     "각 바인딩 = 자리표시"와 문자열 바인딩 집합을 단언한다(CI는 worker gate가 심은 LEAK_SENTINEL 씨앗이 섞이면 실패).
//   - scripts/ci/worker-config.mjs가 주석을 지운 이 파일에서 wrangler 객체 안의 environment "example"·configPath를 본다.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const EXAMPLE = fileURLToPath(new URL("./.dev.vars.example", import.meta.url));
// 이 파일이 없으면 wrangler가 실제 비밀값 파일로 넘어간다. 플러그인이 설정을 읽기 전에 멈춘다
if (!existsSync(EXAMPLE)) throw new Error("worker/.dev.vars.example이 없다(vitest가 실제 비밀값을 읽게 된다)");

// KEY=VALUE 줄만(빈 줄·# 주석 무시). 자리표시 값은 따옴표·이스케이프가 없다(scripts/ci/worker-config.mjs가 확인한다)
function parseDevVars(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) throw new Error(`.dev.vars.example 줄 형식이 틀렸다: ${t.slice(0, 20)}`);
    out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc", environment: "example" },
      miniflare: { bindings: parseDevVars(readFileSync(EXAMPLE, "utf8")) },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
