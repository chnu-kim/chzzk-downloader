#!/usr/bin/env node
// 디자인 시스템 문서 전수 대조(governance.md DX23). node scripts/design/spec-check.mjs [--root <dir>] → 어긋남을 찍고 있으면 exit 1.
// 검사: (1) 연구 ID 존재 (2) 옛 인용 잔재 (3) 토큰 이름 존재·값 일치 (4) 상수 이름 존재 (5) ADR·D·R·검사 번호 존재
//       (6) content.md 키 인용 존재 (7) 금지어 (8) X-* 근거 인용 (9) vocab.ts ICON_BUTTON_ICONS = foundations §9 표(vocab.ts가 있을 때만)
// 편집 때 쓴 scratchpad 도구(인계 폴더 spec-tools/)를 단계 (a)에서 옮긴 것이다. 절대 경로는 저장소 루트(ROOT) 기준으로 바꿨다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 문서 전수 대조. 어긋남을 `파일:줄: 내용` 문자열 목록으로 돌려준다. */
export function check(root = ROOT) {
const sys = path.join(root, 'docs/design/system');
const docs = ['README', 'foundations', 'components', 'patterns', 'content', 'platform', 'web', 'governance'].map((n) => [n + '.md', fs.readFileSync(path.join(sys, n + '.md'), 'utf8')]);
const adrDir = path.join(sys, 'adr');
for (const f of fs.readdirSync(adrDir).sort()) docs.push(['adr/' + f, fs.readFileSync(path.join(adrDir, f), 'utf8')]);
const research = fs.readFileSync(path.join(root, 'docs/research/design-system.md'), 'utf8');
const problems = [];
const warn = (file, line, msg) => problems.push(`${file}:${line}: ${msg}`);
const lines = (t) => t.split('\n');
const stripCode = (t) => t.replace(/```[\s\S]*?```/g, (m) => m.split('\n').map(() => '').join('\n'));

// (1) 연구 ID
const rid = new Set(research.match(/\b(?:E|X)-(?:APPLE|KO|DESK|A11Y|ID|SCALE)-[A-Za-z0-9]+\b/g));
const gid = new Set(research.match(/\bG-[A-Z0-9]+-[A-Za-z0-9]+\b/g));
const jid = new Set(research.match(/\bJ-(?:[ABC]|S\d|F-[ABC]\d+|R\d|Q\d)\b/g));
const afam = new Set([...research.matchAll(/\bA-(VIS|PRIM|FEAT|COPY|DRIFT|LIT|WORKER)\b/g)].map((m) => m[1]));
const koSection = /^E-KO-[AB]\d$/; // 절 단위 인용 허용(연구 §0.2)
for (const [file, text] of docs) {
  lines(stripCode(text)).forEach((l, i) => {
    for (const m of l.matchAll(/`?\b((?:E|X)-(?:APPLE|KO|DESK|A11Y|ID|SCALE)-[A-Za-z0-9]+)\b`?/g)) {
      const id = m[1];
      if (!rid.has(id) && !koSection.test(id) && !/^E-A11Y-F\d+$/.test(id) && !/^E-ID-F\d+$/.test(id) && !/^E-DESK-[RENL]\*$/.test(id) && !id.endsWith('*')) warn(file, i + 1, `연구 문서에 없는 ID ${id}`);
      if (id.startsWith('X-') && !/버리|refuted|쓰지 않|뒤집|대신|인용 금지|근거로 쓰지|부분|보고서 선택값|refuted이나|이라 하지|틀린|근거 없음|인용하지/.test(l)) warn(file, i + 1, `X-ID를 근거처럼 인용? ${id}`);
    }
    for (const m of l.matchAll(/\b(G-[A-Z0-9]+-[A-Za-z0-9]+)\b/g)) if (!gid.has(m[1]) && !m[1].endsWith('*')) warn(file, i + 1, `연구 문서에 없는 ID ${m[1]}`);
    for (const m of l.matchAll(/\b(J-(?:[ABC]|S\d|F-[ABC]\d+|R\d|Q\d))\b/g)) if (!jid.has(m[1])) warn(file, i + 1, `연구 문서에 없는 ID ${m[1]}`);
    for (const m of l.matchAll(/\bA-([A-Z]+)-/g)) if (!afam.has(m[1])) warn(file, i + 1, `모르는 감사 가족 A-${m[1]}`);
    for (const m of l.matchAll(/\bQ(\d{1,2})\b/g)) { const n = +m[1]; if (n < 1 || n > 27) warn(file, i + 1, `Q${n} 범위 밖`); }
    // (2) 옛 인용 잔재
    for (const re of [/verify-[a-z-]+\.md/, /audit-[a-z-]+\.md/, /gap-[a-z-]+\.md/, /research-[a-z]+\.md/, /v-apple 확정/, /v-ko [AB]\d/, /v-desk [RENL]-\d/, /\bR-(NT|DL|CF|FC|MO)-\d/, /(?<![A-Za-z`-])V-\d\d(?!\d)/, /scratchpad/, /메모리 `/, /`[A-Z]-[A-Z0-9]+-[A-Za-z0-9]+`[·~](?!`)[A-Za-z]*-?\d/]) {
      if (re.test(l) && !/단계 \(a\)에서|scratchpad 도구|편집 때 쓴|`spec-tools\/`|참조 목업/.test(l)) warn(file, i + 1, `옛 인용 잔재 ${re}`);
    }
  });
}

// (3) 토큰
const found = docs.find(([f]) => f === 'foundations.md')[1];
const block = found.slice(found.indexOf('## 13. 생성물 기대 모양'));
const tokenDefs = new Map();
for (const m of block.matchAll(/(--[a-z][a-z0-9-]*):\s*([^;]+);/g)) if (!tokenDefs.has(m[1])) tokenDefs.set(m[1], m[2].trim());
// 문서가 이력·비교로 언급하는 이름(옛 별칭은 단계 (c)에서 사라졌다)
const legacyOk = new Set(['--p', '--success', '--success-ink', '--success-soft', '--icon-stroke-sm', '--fg-tertiary', '--bg-dark', '--muted', '--line', '--warn', '--box', '--ref-black-a8', '--bw-1', '--bw-2', '--hit-floor', '--action-gap', '--overlay-line', '--space-4', '--switch-travel', '--scroll-padding', '--text-hero', '--leading-hero', '--shadow-', '--z-', '--space-', '--text-', '--leading-', '--motion-', '--ref-', '--radius-', '--control-h', '--control-h-sm', '--control-h-lg', '--ref-gray-', '--ref-black-', '--ref-white-', '--', '--accent-', '--danger-', '--ref-white', '--control-', '--ref-blue-', '--ref-red-', '--ref-amber-', '--weight-', '--font-', '--icon-', '--switch-', '--gap-', '--row-h', '--x']);
const tokenPrefix = /^--(bg|surface|raised|track|fg|separator|border|accent|danger|warning|on|focus|scrim|shadow|font|weight|text|leading|space|edge|gap|radius|control|row|toolbar|hit|icon|switch|radio|progress|badge|content|reading|dialog|label|pct|motion|ease|z|ref|p|success|dur|line|muted|warn|box|bw|action|overlay|scroll|x)(-|$)/;
const numeric = (v) => { const m = v.match(/^(\d+(?:\.\d+)?)(px|ms)$/); return m ? m[1] : null; };
for (const [file, text] of docs) {
  lines(text).forEach((l, i) => {
    for (const m of l.matchAll(/`(--[a-z][a-z0-9-]*)`/g)) {
      const t = m[1];
      if (!tokenPrefix.test(t)) continue;
      if (!tokenDefs.has(t) && !legacyOk.has(t) && !/legacy|옛 토큰|옛 이름|A 후보|a-worker|A-WORKER|초안|편집 전|지웠다|폐기|후보가 제안|이름을 바꿨|이름 바꿈/.test(l)) warn(file, i + 1, `foundations §13에 없는 토큰 ${t}`);
    }
    // 이름 + 값: `--x` 440 또는 `--x`(440) 또는 `--x` 440px / `--x` 54 × `--y` 24
    for (const m of l.matchAll(/`(--[a-z][a-z0-9-]*)`\s*(?:\(|= |)\s*(\d+(?:\.\d+)?)(?:px|ms)?(?![\d.%:])/g)) {
      const t = m[1], v = m[2];
      const def = tokenDefs.get(t); if (!def) continue;
      const n = numeric(def);
      if (n && n !== v && !/(?:터치|coarse|→|~|x-large|large|읽기|reading|대신|아니라|이던|에서|였다|reduce|1ms)/.test(l)) warn(file, i + 1, `토큰 값 불일치 ${t}: 문서 ${v}, §13 ${n}`);
    }
  });
}

// (4) 상수 이름(§14)
const sec14 = found.slice(found.indexOf('## 14. 상수 표'));
const consts = new Set([...sec14.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1]).flatMap((s) => s.split('` / `')));
for (const m of sec14.matchAll(/`([A-Z][A-Z0-9_]+)` \/ `([A-Z][A-Z0-9_]+)`/g)) { consts.add(m[1]); consts.add(m[2]); }
const constOk = new Set(['AREA_SKIP', 'AREAS', 'NON_CODE', 'NON_CODE_GLOBS', 'LINT_ONLY', 'MASTER_ONLY_JOBS', 'PAGE_REJECTED', 'NOTIFY_TITLE', 'NOTIFY_FAILED_TITLE', 'MARKER_KEYS', 'UNIT_GAP', 'OBSERVED_JOBS', 'CODE_GATED_JOBS', 'HOOKS', 'GATES', 'SETUP_ALLOW', 'CODE_IF', 'SITE_CSS', 'SITE_CSS_HASH', 'TOKENS_CSS', 'TOKENS_CSS_HASH', 'ASSETS', 'NOTICE_UNOFFICIAL', 'NOTICE_SHORT', 'PUBLIC_ORIGIN', 'ADMIN_CHANNEL_IDS', 'CHZZK_GALLERY', 'CHZZK_REDIRECT_URI', 'BUTTON_VARIANT', 'NOTICE_VARIANT', 'TONE', 'SIZE', 'KIND', 'PROGRESS_STATE', 'BOOLEAN_PROPS', 'ICON_BUTTON_ICONS', 'VARIANT', 'LEAK_SENTINEL', 'KAKAOTALK', 'DIST_BASE_URL', 'CI_VERIFY_TOKEN', 'R2_BUCKET', 'VERIFY_VIA', 'NSIS', 'MSI', 'JAWS', 'NVDA', 'PROGRESS_INTERVAL', 'DEFAULT_BACKGROUND', 'EFBIG', 'ENOSPC', 'EACCES', 'EROFS', 'ENOENT', 'EIO', 'ENAMETOOLONG', 'ES_CONTINUOUS', 'MAX_PATH', 'NFC', 'NFD', 'TCC', 'OBS', 'OS', 'CSP', 'CLDR', 'ICU', 'ETA', 'EMA', 'SAC', 'VFR', 'DR', 'DO', 'R2', 'S3', 'UA', 'OG', 'ADR', 'PR', 'CI', 'CD', 'DOM', 'API', 'JSON', 'HTML', 'CSS', 'TS', 'JS', 'IPC', 'DTO', 'PNG', 'SVG', 'ICO', 'HLS', 'MPD', 'VOD', 'KST', 'URL', 'GB', 'MB', 'KB', 'TB', 'LGPL', 'MIT', 'ISC', 'SEQ', 'SUS', 'DTCG', 'LF', 'FIFO', 'HIG', 'WCAG', 'NN', 'APG', 'ARIA', 'AA', 'GTK', 'GNOME', 'AUMID', 'MS', 'SF', 'CJK', 'KR', 'UTF', 'UUID', 'ID', 'KIPRIS', 'KWCAG', 'ES_AWAYMODE_REQUIRED', 'ES_DISPLAY_REQUIRED', 'WEBKIT_DISABLE_', 'WEBKIT_DISABLE_DMABUF_RENDERER', '__NV_DISABLE_', 'NS', 'A', 'B', 'C', 'D', 'E', 'F', 'H', 'G', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AT', 'TTS', 'IME', 'VO', 'XDG_VIDEOS_DIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CHZZK_SMOKE_OUT', 'FAT32', 'NTFS', 'SMB', 'CIFS', 'APFS', 'RAIL', 'PIPC', 'NAVER', 'TDS', 'SEED', 'KRDS', 'HDR', 'SDR', 'DPR', 'RFC', 'QA1340', 'TN3127', 'HSL', 'OKLCH', 'OKLAB', 'LMS', 'RGB', 'SHA', 'PNG', 'PD', 'HTTP', 'CSRF', 'PRG', 'E0', 'E1', 'E2', 'E3', 'E4', 'QR', 'IDS', 'MDN', 'XML', 'CCS', 'DMG', 'BOM', 'ZWSP', 'WJ', 'C0', 'C1', 'U', 'ODS', 'AWS_LC_SYS_PREBUILT_NASM', 'UPDATE_BINDINGS', 'TS_RS_LARGE_INT', 'CHZZK_WORKER_BASE', 'CHZZK_E2E_API_BASE', 'CHZZK_E2E_DIR', 'CHZZK_HOOK_FAST', 'FUZZ_SECONDS', 'DRIFT_SIMULATE', 'PRIVATE_DENYLIST', 'GH_TOKEN', 'RULESET_READ_TOKEN', 'TAG_BLOCK', 'CHZZK_NID_AUT', 'CHZZK_NID_SES', 'NID_AUT', 'NID_SES', 'NID_', 'A11Y', 'AC', 'DC', 'DL', 'DS', 'DP', 'DX', 'DT', 'DI', 'DA', 'UT', 'PS', 'HC', 'IN', 'NT', 'DL', 'CF', 'FC', 'MO', 'GOV', 'MOJ', 'BIDI', 'PPT', 'KFM', 'OSS', 'XXXXXX', 'H', 'MM', 'SS', 'YYYY', 'DD', 'HH', 'ASCII', 'NNNN', 'CTA', 'CRUD', 'NVDA', 'ERROR', 'PAUSED', 'NORMAL', 'TRUE', 'AUTO', 'FAIL', 'PASS', 'UI', 'GUI', 'CLI', 'SPA', 'DNS', 'CDN', 'VPN', 'NEW', 'MIB', 'GIB', 'KIB', 'AES']);
for (const [file, text] of docs) {
  lines(text).forEach((l, i) => {
    for (const m of l.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)) {
      if (!consts.has(m[1]) && !constOk.has(m[1]) && !/[A-Z]+_[A-Z]+\s*=|상수 이름|옛|초안/.test(l)) warn(file, i + 1, `foundations §14에 없는 상수 ${m[1]}`);
    }
  });
}

// (5) ADR·D·R·검사 번호
const adrs = new Set(fs.readdirSync(adrDir).map((f) => 'ADR-' + f.slice(0, 4)));
const gov = docs.find(([f]) => f === 'governance.md')[1];
const checks = new Set([...gov.matchAll(/^\| (D[TLSPXCIA]\d{1,2}) \|/gm)].map((m) => m[1]));
const ranges = { DT: 17, DL: 14, DS: 9, DP: 5, DX: 23, DC: 12, DI: 7, DA: 11 };
for (const [file, text] of docs) {
  lines(stripCode(text)).forEach((l, i) => {
    for (const m of l.matchAll(/ADR-(\d{4})/g)) if (!adrs.has('ADR-' + m[1])) warn(file, i + 1, `없는 ADR-${m[1]}`);
    for (const m of l.matchAll(/(?<![A-Za-z-])D(\d{1,2})\b(?!\.|~|-)/g)) { const n = +m[1]; if (n > 62 && !/D(1|2|3|4|5|6|7)\b/.test(m[0])) warn(file, i + 1, `D${n} 범위 밖`); }
    for (const m of l.matchAll(/(?<![A-Za-z-])R(\d{1,2})\b(?![-.])/g)) { const n = +m[1]; if (n > 10 && !/g-(web|privacy|shell|install|save|outage|power|launch|ime|repeat|engine|id|evid|legal|ugt) [A-Z]*\d/.test(l)) warn(file, i + 1, `R${n} 범위 밖(리뷰 항목은 R1~R10)`); }
    for (const m of l.matchAll(/\b(D[TLSPXCIA])(\d{1,2})\b/g)) { const fam = m[1], n = +m[2]; if (n > ranges[fam] || n < 1) warn(file, i + 1, `${fam}${n} 범위 밖`); }
    for (const m of l.matchAll(/\bUT(\d)\b/g)) if (+m[1] < 1 || +m[1] > 7) warn(file, i + 1, `UT${m[1]} 범위 밖`);
    for (const m of l.matchAll(/\bV(\d)\b(?!-)/g)) if (+m[1] < 1 || +m[1] > 8) warn(file, i + 1, `V${m[1]} 범위 밖`);
  });
}
// (6) content.md 키
const content = docs.find(([f]) => f === 'content.md')[1];
const keys = new Set([...content.matchAll(/`([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9*]+)+)`/g)].map((m) => m[1]));
const keyOk = /^(a|form|body|use|main|html|div|span|section|nav|header|footer|input|select|button|table|th|td|ol|ul|li|p|pre|code|img|svg|path|kbd|label|fieldset|details|summary|dl|dt|dd|article|h1|h2|h3|app|docs|worker|scripts|design|crates|release|ci|fuzz|xtask|testdata|help|licenses|node|npm|pnpm|cargo|tauri|vite|playwright|tokens|site-css|site|ui|icons|copy|errors|ko|format|timing|jobs|receive|focus|guards|vocab|retention|entry|html|icon|pages|core|store|http|routes|config|log|mark|consts|baseline|app\.|ko\.|wrangler|gates|tools|measure|ratchet|smoke|bundle|e2e|public-scan|push-guard|snapshot|run|repo-settings|pin-actions|gen-fixtures|shots|stem|blur2|contrast|adr|allow|pr-template|lint|check-tokens|css|spec-check|icons-blur|tokens\.|assets|naming|retry|part|progressive|segmented|progress|url|info|mpd|hls|client|download|fsutil|settings|credentials|legacy|ownership|error|manager|services|commands|sink|lib|main|build_rules|build|e2e-native|e2e-fixture-server|worker-config|s3-fake|artifact-check|fixtures|views|components|landing-view|admin-view|hygiene|deploy-contract|fake-chzzk|seed-release|e2e-lib|e2e-dev|channel-id-check|cicd|chzzk|window|document|navigator|context|page|test|window-state|chzzk\.naver|Intl\.|console\.|NSProcessInfo|NSPasteboard|NSView|NSString|Window::|CSS\.|e\.|el\.|document\.|context\.|page\.|test\.|ol\.|Element|HTMLElement|statfs\.|tokio::|Menu::|PredefinedMenuItem|packageManager|tauri\.|bundle\.|plugins\.|core:|window-state:|ratchet\.json|RATCHET_LOG|typos|zizmor|deny|machete|tauri-plugin|design-|gallery\.spec|shots\.spec|flow\.spec|settings\.spec|errors\.spec|routes\.test|views\.test|landing\.test|format\.test|site-css\.test|hygiene\.test|csp\.test|tokens\.test|jobs\.test|adr\.test|allow\.test|pr-template\.test|tokens\.mjs|lint\.mjs|copy\.mjs|icons\.mjs|shots\.mjs|stem\.mjs|contrast\.mjs|spec-check\.mjs|icons-blur\.mjs|check-tokens\.mjs|css\.mjs|ratchet\.mjs|e2e-native\.mjs|smoke\.mjs|bundle\.mjs|public-scan\.mjs|worker-config\.mjs|gen-fixtures\.mjs|pin-actions\.mjs|repo-settings\.mjs|e2e-fixture-server\.mjs|s3-fake\.mjs|artifact-check\.mjs|m\.py|calc|Playwright|chrome|safari|macos|webkitgtk|1Password|io\.github|com\.apple|style:|style=|data-|aria-|role=|class=|href=|type=|id=|name=|for=|rel=|media=|content=|viewBox|width=|height=|fill=|stroke|vector-effect|placeholder=|readonly|disabled|autocomplete|spellcheck|autocorrect|autocapitalize|inputmode|tabindex|hidden|open|inert|lang=|charset|sizes=|crossorigin|loading=|decoding=|method=|action=|enctype=|accept=|required|min=|max=|step=|value=|selected|checked|multiple|size=|cols=|rows=|wrap=|target=|download=|ping=|referrerpolicy|hreflang|integrity|nonce|async|defer|src=|alt=|title=|xattr|apt|sudo|git|gh|node|xvfb-run|actool|iconutil|dpkg|cp|cd|ls|rm|mv|mkdir|touch|cat|grep|sed|awk|find|sort|uniq|head|tail|wc|tr|cut|echo|printf|test|true|false|exit|pmset|powercfg|systemd-inhibit|gnome-session-inhibit|fc-list|tccutil|kill|ps|top|open|say|afplay|osascript|defaults|launchctl|hdiutil|codesign|spctl|notarytool|stapler|productbuild|pkgbuild|installer|security|xcrun|xcodebuild|swift|cargo|rustc|rustup|clippy|rustfmt|wasm|wrangler|miniflare|workerd|vitest|jsdom|axe|lighthouse|puppeteer|chromium|firefox|webkit|msedge|edge|ie|opera|brave|vivaldi|arc|tor|whale|naver|kakao|discord|instagram|facebook|twitter|youtube|twitch|afreeca|chzzk)/;
for (const [file, text] of docs) {
  if (!/^(patterns|web|components|platform|README|foundations|governance)\.md$/.test(file)) continue;
  lines(stripCode(text)).forEach((l, i) => {
    for (const m of l.matchAll(/`([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)`/g)) {
      const k = m[1];
      if (/[A-Z].*\.|\.(ts|mjs|md|json|css|svelte|rs|toml|yml|yaml|html|png|svg|ico|dmg|deb|exe|msi|icns|icon|car|plist|txt|mp4|part|tmp|js|cjs|conf|lock)$/.test(k)) continue;
      if (!keys.has(k) && !keys.has(k.replace(/\.(title|body|help|label|a11y)$/, '.*'))) {
        // 접두 와일드카드 허용: content에 `auth.denied.*` 꼴이 있으면 통과
        const parts = k.split('.');
        let ok = false;
        for (let j = parts.length - 1; j >= 1; j--) if (keys.has(parts.slice(0, j).join('.') + '.*')) ok = true;
        if (!ok && !keyOk.test(k) && !/파일|경로|함수|command|메서드|속성|이벤트|API|플러그인|모듈|키 접두|접미|꼴|같은 키|예:/.test(l)) warn(file, i + 1, `content.md §15에 없는 키 ${k}`);
      }
    }
  });
}
// (7) 금지어(문서 본문. 코드 블록·백틱 밖)
const banned = [[/최근 VOD/, '최근 VOD → 최근 영상'], [/그룹명 ?"?멈춤/, '멈춤 그룹명'], [/허용 빼기|허용 채널|허용된 채널|허용을 뺄|허용목록/, '허용 → 허가'], [/\bpill\b(?! 모양|이라)/, 'pill → 배지'], [/\.\.\./, '세 점'], [/허용 목록 7종|아이콘 버튼[^|]*7종|7종만/, '아이콘 7종']];
for (const [file, text] of docs) {
  if (file === 'content.md') continue;
  lines(stripCode(text)).forEach((l, i) => {
    if (/^\s+--/.test(l)) return;
    const bare = l.replace(/`[^`]*`/g, '');
    for (const [re, msg] of banned) if (re.test(bare) && !/금지|쓰지 않|→|초안|편집 전|옛|검토|결함|낱말|이름만|대체|오독/.test(bare)) warn(file, i + 1, `금지어 ${msg}: ${bare.slice(0, 80)}`);
  });
}

// (9) DX23: vocab.ts의 ICON_BUTTON_ICONS = foundations §9 표. vocab.ts는 단계 (b)에서 생기므로 없으면 건너뛴다
const vocabPath = path.join(root, 'app/src/lib/components/ui/vocab.ts');
if (fs.existsSync(vocabPath)) {
  const vocab = fs.readFileSync(vocabPath, 'utf8').replace(/\r\n/g, '\n');
  const vm = vocab.match(/ICON_BUTTON_ICONS\s*=\s*\[([^\]]*)\]/);
  const row = lines(found).find((l) => l.startsWith('| 글자 없는 아이콘 버튼'));
  if (!vm) warn('app/src/lib/components/ui/vocab.ts', 1, 'ICON_BUTTON_ICONS 정의 없음');
  else if (!row) warn('foundations.md', 1, '§9 표에 "글자 없는 아이콘 버튼" 행 없음');
  else {
    const inCode = new Set([...vm[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
    const cell = row.split(' | ')[1] ?? '';
    const inDoc = new Set([...cell.matchAll(/`([a-z][a-z0-9-]*)`/g)].map((m) => m[1]).filter((n) => n !== 'aria-label'));
    for (const n of inDoc) if (!inCode.has(n)) warn('app/src/lib/components/ui/vocab.ts', 1, `ICON_BUTTON_ICONS에 없는 아이콘 ${n}(foundations §9 표에는 있다)`);
    for (const n of inCode) if (!inDoc.has(n)) warn('foundations.md', 1, `§9 표에 없는 아이콘 ${n}(vocab.ts ICON_BUTTON_ICONS에는 있다)`);
  }
}

  return problems;
}

function main(argv) {
  const i = argv.findIndex((a) => a === '--root' || a === '--repo');
  let root = ROOT;
  if (i >= 0) {
    if (!argv[i + 1]) { console.error('spec-check: --root 값이 없다'); return 2; }
    root = path.resolve(argv[i + 1]);
  }
  let problems;
  try { problems = check(root); } catch (e) { console.error(`spec-check: ${e.message}`); return 2; }
  if (problems.length) { console.log(problems.join('\n')); console.log(`\n${problems.length} 건`); return 1; }
  console.log('spec-check: 0 건');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
