// worker-gen.mjs 단위 테스트(node --test). 임시 루트에 최소 사본을 만들어 생성·검사 종료 코드를 본다:
// 깨끗한 씨앗 0, 생성물 손 수정 1, md 부분집합 밖 1, ids 누락 1.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PATHS, ROOT, TARGETS, WORKER_ICONS, assetSizeErrors, check, icoLayers, idsErrors, main, parseHelp, pngSize, write } from './worker-gen.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'worker-gen.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'worker-gen-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

// ── 합성 입력 ──
const ICONS_TS = `export const ICONS = {
  x: { set: 'lucide', name: 'x', version: '9.9.9', paths: ['M18 6 6 18'] },
${WORKER_ICONS.map((n) => `  '${n}': { set: 'lucide', name: '${n}', version: '9.9.9', paths: ['M1 1h2', 'M3 3h4'] },`).join('\n')}
} as const;
`;
const LICENSE = 'Lucide icons (fake 9.9.9)\n\nISC License\n\nPermission to use, copy, modify, and/or distribute this software.\n';

/** 머리만 맞는 PNG 조각(생성기는 IHDR 크기만 읽는다) */
function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function ico(sizes) {
  const layers = sizes.map((s) => png(s, s));
  const head = Buffer.alloc(6 + layers.length * 16);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(layers.length, 4);
  let off = head.length;
  layers.forEach((l, i) => {
    const o = 6 + i * 16;
    head[o] = sizes[i];
    head[o + 1] = sizes[i];
    head.writeUInt32LE(l.length, o + 8);
    head.writeUInt32LE(off, o + 12);
    off += l.length;
  });
  return Buffer.concat([head, ...layers]);
}

const HELP_A = '# 첫 도움말\n\n문단 하나예요. 둘째 줄도 같은 문단이에요.\n\n1. 하나\n2. 둘\n\n```\ncmd --flag "x"\n```\n';
const HELP_B = '# 둘째\n\n한 문단.\n';

let seq = 0;
/** 최소 사본. files로 덮어쓰고 null이면 지운다. write: true면 생성물까지 쓴다 */
function mk(files = {}, { gen = true } = {}) {
  const d = join(tmp, `r${seq++}`);
  const all = {
    [PATHS.appIcons]: ICONS_TS,
    [PATHS.license]: LICENSE,
    [`${PATHS.assetsDir}/icon.svg`]: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>\n',
    [`${PATHS.assetsDir}/favicon.ico`]: ico([16, 32]),
    [`${PATHS.assetsDir}/apple-touch-icon.png`]: png(180, 180),
    [`${PATHS.assetsDir}/og.png`]: png(1200, 630),
    'help/a-one.md': HELP_A,
    'help/b.md': HELP_B,
    ...files,
  };
  for (const [rel, body] of Object.entries(all)) {
    if (body === null) continue;
    mkdirSync(dirname(join(d, rel)), { recursive: true });
    writeFileSync(join(d, rel), body);
  }
  if (gen) write(d);
  return d;
}

const cli = (root, ...args) => spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });

// ── 종료 코드 ──
test('깨끗한 씨앗: --check는 0, 생성물은 원천에서 나온다', () => {
  const d = mk();
  const r = cli(d, '--check');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(check(d), []);
  const icons = readFileSync(join(d, PATHS.out.icons), 'utf8');
  for (const n of WORKER_ICONS) assert.ok(icons.includes(`name: '${n}'`), n);
  assert.ok(!icons.includes("name: 'x'"), 'Worker가 쓰는 아이콘만 옮긴다');
  assert.match(readFileSync(join(d, PATHS.out.assets), 'utf8'), /"og\.png": \{ type: "image\/png", hash: "[0-9a-f]{16}", b64: "[A-Za-z0-9+/=]+" \}/);
  assert.match(readFileSync(join(d, PATHS.out.licenses), 'utf8'), /^\/\/ [^\n]*\nexport const LICENSES = \[\{ name: "Lucide", text: "Lucide icons/);
  assert.match(readFileSync(join(d, PATHS.out.help), 'utf8'), /\{ id: "a-one", title: "첫 도움말", blocks: \[/);
});

test('--write는 멱등이다(두 번 써도 같은 바이트)', () => {
  const d = mk();
  const before = TARGETS.map((t) => readFileSync(join(d, PATHS.out[t]), 'utf8'));
  write(d);
  assert.deepEqual(
    TARGETS.map((t) => readFileSync(join(d, PATHS.out[t]), 'utf8')),
    before,
  );
  assert.equal(readFileSync(join(d, PATHS.ids), 'utf8'), '{\n  "ids": [\n    "a-one",\n    "b"\n  ],\n  "retired": []\n}\n');
});

test('생성물을 손으로 고치면 --check는 1(대상마다)', () => {
  for (const t of TARGETS) {
    const d = mk();
    const p = join(d, PATHS.out[t]);
    writeFileSync(p, `${readFileSync(p, 'utf8')}// 손 수정\n`);
    const r = cli(d, '--check');
    assert.equal(r.status, 1, t);
    assert.match(r.stderr, new RegExp(`${PATHS.out[t].replace(/[.]/g, '\\.')}: 원천과 다르다`), t);
    // 다른 대상만 검사하면 영향이 없다
    const others = TARGETS.filter((x) => x !== t);
    assert.equal(cli(d, '--check', ...others).status, 0, `${t} 제외`);
  }
});

test('원천이 바뀌고 생성물을 다시 쓰지 않으면 1', () => {
  const d = mk();
  writeFileSync(join(d, PATHS.license), `${LICENSE}추가 줄\n`);
  assert.equal(cli(d, '--check', 'licenses').status, 1);
  writeFileSync(join(d, `${PATHS.assetsDir}/og.png`), png(1200, 630).fill(7, 28));
  assert.equal(cli(d, '--check', 'assets').status, 1);
});

test('생성물이 없으면 1이고 --write가 만든다', () => {
  const d = mk({}, { gen: false });
  assert.equal(cli(d, '--check', 'icons').status, 1);
  assert.equal(cli(d, '--write').status, 0);
  assert.equal(cli(d, '--check').status, 0);
});

test('md가 부분집합 밖이면 1(--write도 실패)', () => {
  const bad = {
    '둘째 제목': '# 제목\n\n## 소제목\n',
    글머리: '# 제목\n\n- 항목\n',
    '인라인 코드': '# 제목\n\n`x`를 쳐요.\n',
    링크: '# 제목\n\n[a](b)를 봐요.\n',
    '꺾쇠': '# 제목\n\n<b>굵게</b>\n',
    '번호 건너뜀': '# 제목\n\n1. 하나\n3. 셋\n',
    '닫히지 않은 펜스': '# 제목\n\n```\ncmd\n',
    '제목 없음': '문단만 있어요.\n',
    '줄바꿈 없는 끝': '# 제목\n\n문단',
  };
  for (const [why, md] of Object.entries(bad)) {
    const d = mk({ 'help/b.md': md }, { gen: false });
    writeFileSync(join(d, PATHS.ids), JSON.stringify({ ids: ['a-one', 'b'], retired: [] }));
    const r = cli(d, '--check', 'help');
    assert.equal(r.status, 1, `${why}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /help\/b\.md/, why);
    assert.equal(cli(d, '--write', 'help').status, 1, `${why} --write`);
  }
});

test('ids 누락: md가 ids.json에 없거나 ids의 md가 없으면 1', () => {
  const d = mk();
  const ids = join(d, PATHS.ids);
  // md는 있는데 ids에 없다(--write 없이 직접 고친 경우)
  writeFileSync(ids, JSON.stringify({ ids: ['a-one'], retired: [] }));
  const r = cli(d, '--check', 'help');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /help\/b\.md: help\/ids\.json의 ids에 없다/);
  // ids에 있는데 md가 없고 retired에도 없다
  writeFileSync(ids, JSON.stringify({ ids: ['a-one', 'b', 'gone'], retired: [] }));
  assert.match(cli(d, '--check', 'help').stderr, /gone의 help\/gone\.md가 없고 retired에도 없다/);
  // retired에 두면 통과(은퇴 id는 ids에 남는다)
  writeFileSync(ids, JSON.stringify({ ids: ['a-one', 'b', 'gone'], retired: ['gone'] }));
  writeFileSync(join(d, PATHS.out.help), readFileSync(join(d, PATHS.out.help), 'utf8'));
  assert.equal(cli(d, '--check', 'help').status, 0);
  // ids.json이 없다
  rmSync(ids);
  assert.equal(cli(d, '--check', 'help').status, 1);
});

test('--write는 새 md의 id를 ids 끝에 덧붙이고 기존 id·순서·retired는 건드리지 않는다', () => {
  const d = mk();
  writeFileSync(join(d, PATHS.ids), JSON.stringify({ ids: ['b', 'a-one', 'old'], retired: ['old'] }));
  writeFileSync(join(d, 'help/c-new.md'), '# 셋째\n\n문단.\n');
  assert.equal(cli(d, '--write', 'help').status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(d, PATHS.ids), 'utf8')), { ids: ['b', 'a-one', 'old', 'c-new'], retired: ['old'] });
  // 생성물 순서는 ids 순서이고 은퇴 id(md 없음)는 건너뛴다
  const gen = readFileSync(join(d, PATHS.out.help), 'utf8');
  assert.deepEqual([...gen.matchAll(/\{ id: "([^"]+)"/g)].map((m) => m[1]), ['b', 'a-one', 'c-new']);
  assert.equal(cli(d, '--check', 'help').status, 0);
});

test('id 규칙: 파일 이름·ids의 id는 ^[a-z0-9-]+$', () => {
  const errs = idsErrors({ ids: ['ok', 'Bad_Id', 'ok'], retired: ['zz'] }, ['ok', 'Bad_Id']);
  assert.ok(errs.some((e) => e.includes('"Bad_Id"가 ^[a-z0-9-]+$가 아니다')));
  assert.ok(errs.some((e) => e.includes('ok가 두 번 있다')));
  assert.ok(errs.some((e) => e.includes('retired의 zz가 ids에 없다')));
  assert.ok(errs.some((e) => e.includes('Bad_Id.md: 파일 이름(id)이')));
  assert.deepEqual(idsErrors({ ids: ['a'], retired: [] }, ['a']), []);
});

test('ids.json 모양이 틀리면 1', () => {
  for (const body of ['{', '[]', '{"ids":[]}', '{"ids":[1],"retired":[]}', '{"ids":[],"retired":[],"x":1}']) {
    const d = mk({}, { gen: false });
    writeFileSync(join(d, PATHS.ids), body);
    assert.equal(cli(d, '--check', 'help').status, 1, body);
  }
});

// ── md 부분집합 ──
test('parseHelp: 제목·문단(여러 줄은 공백으로)·목록·펜스', () => {
  assert.deepEqual(parseHelp(HELP_A), {
    title: '첫 도움말',
    blocks: [
      { t: 'p', text: '문단 하나예요. 둘째 줄도 같은 문단이에요.' },
      { t: 'ol', items: ['하나', '둘'] },
      { t: 'pre', text: 'cmd --flag "x"' },
    ],
  });
  assert.deepEqual(parseHelp('# 제목\n\n첫 줄\n둘째 줄\n').blocks, [{ t: 'p', text: '첫 줄 둘째 줄' }]);
  assert.deepEqual(parseHelp('# 제목\n\n```\n한 줄\n\n빈 줄 뒤\n```\n').blocks, [{ t: 'pre', text: '한 줄\n\n빈 줄 뒤' }]);
});

test('parseHelp: 저장소의 help/*.md가 모두 부분집합 안이다', () => {
  assert.equal(check(ROOT, ['help']).length, 0);
});

// ── 에셋 헤더 ──
test('에셋 크기: og 1200×630, apple-touch 180×180, ico는 16·32 층', () => {
  assert.deepEqual(pngSize(png(3, 4)), { width: 3, height: 4 });
  assert.equal(pngSize(Buffer.from('not png at all, definitely')), null);
  assert.deepEqual(icoLayers(ico([16, 32])).map((l) => [l.width, l.png?.width]), [[16, 16], [32, 32]]);
  const bytes = (over) => (name) => over[name] ?? { 'og.png': png(1200, 630), 'apple-touch-icon.png': png(180, 180), 'favicon.ico': ico([16, 32]) }[name];
  assert.deepEqual(assetSizeErrors(bytes({})), []);
  assert.match(assetSizeErrors(bytes({ 'og.png': png(1200, 600) }))[0], /og\.png: 크기 1200×600 ≠ 1200×630/);
  assert.match(assetSizeErrors(bytes({ 'apple-touch-icon.png': png(181, 180) }))[0], /apple-touch-icon\.png: 크기/);
  assert.match(assetSizeErrors(bytes({ 'favicon.ico': ico([32]) }))[0], /16×16 층이 없다/);
  assert.match(assetSizeErrors(bytes({ 'favicon.ico': ico([16]) }))[0], /32×32 층이 없다/);
  assert.match(assetSizeErrors(bytes({ 'favicon.ico': Buffer.from('xx') }))[0], /ICO가 아니다/);
  assert.match(assetSizeErrors(bytes({ 'og.png': Buffer.from('xx') }))[0], /og\.png: PNG가 아니다/);
});

test('에셋 크기가 틀리면 --check·--write 모두 1', () => {
  const d = mk({ [`${PATHS.assetsDir}/og.png`]: png(1200, 600) }, { gen: false });
  assert.equal(cli(d, '--check', 'assets').status, 1);
  assert.equal(cli(d, '--write', 'assets').status, 1);
});

test('svg는 줄끝을 LF로 맞춘다(CRLF 체크아웃에서도 해시가 같다)', () => {
  const lf = mk();
  const crlf = mk({ [`${PATHS.assetsDir}/icon.svg`]: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>\r\n' }, { gen: false });
  write(crlf, ['assets']);
  assert.equal(readFileSync(join(lf, PATHS.out.assets), 'utf8'), readFileSync(join(crlf, PATHS.out.assets), 'utf8'));
});

// ── 원천 오류·사용법 ──
test('licenses 원천에 생성 모듈로 옮길 수 없는 글자(<, 백틱)가 있으면 1', () => {
  for (const bad of ['<b>', '`x`', '${x}']) {
    const d = mk({ [PATHS.license]: `${LICENSE}${bad}\n` }, { gen: false });
    assert.equal(cli(d, '--write', 'licenses').status, 1, bad);
  }
});

test('Worker 아이콘이 앱 icons.ts에 없으면 1', () => {
  const d = mk({ [PATHS.appIcons]: ICONS_TS.replace(/^ {2}'monitor'.*\n/m, '') }, { gen: false });
  const r = cli(d, '--write', 'icons');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /monitor/);
});

test('사용법 오류는 2', () => {
  assert.equal(cli(mk(), '--bogus').status, 2);
  assert.equal(cli(mk()).status, 2);
  assert.equal(cli(mk(), '--write', '--check').status, 2);
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--check', 'help', '--root'], { encoding: 'utf8' }).status, 2);
  assert.equal(main(['--nope']), 2);
});

test('저장소: 생성물이 원천과 같다(--check 전부)', () => {
  assert.deepEqual(check(ROOT), []);
});
