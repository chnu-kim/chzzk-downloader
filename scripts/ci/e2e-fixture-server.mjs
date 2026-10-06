#!/usr/bin/env node
// 네이티브 E2E의 가짜 치지직 서버(docs/design/cicd.md §6 "네이티브 E2E"). `testdata/`의 합성 fixture만 서빙한다:
// 빠른 다시보기(HLS) 영상 하나(`testdata/hls/`)의 info → master → media(앞 두 조각 + ENDLIST) → init·조각 둘.
// `--features e2e` 앱이 `CHZZK_E2E_API_BASE`로 이 서버를 API·vodplay 기본 주소로 쓴다. 네트워크는 루프백뿐이다.
//
//   node scripts/ci/e2e-fixture-server.mjs [--port N]   # 직접 띄워 보기(주소를 출력하고 Ctrl+C까지 돈다)
//
// 결과 파일은 init‖seg0‖seg1과 바이트가 같아야 한다(코어 segmented.rs fixture_concat_box_order와 같은 기대값).
// 판정용 sha256은 expectedOutput()이 fixture에서 계산한다.

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT } from './gates.mjs';

// testdata/hls/video_info.json의 videoNo와 그 주소(앱 입력줄에 넣는다)
export const HLS_VIDEO_NO = 9000001;
export const HLS_URL = `https://chzzk.naver.com/video/${HLS_VIDEO_NO}`;
// fixture의 미디어 호스트(testdata/README.md). 서버 주소로 바꾼다(이중 인코딩 JSON 안에서도 단순 치환으로 된다)
export const MEDIA_HOSTS = ['hls.example.invalid', 'clip.example.invalid', 'vod.example.invalid'];
// media playlist에서 남길 조각 수(fixture 조각 파일은 seg0·seg1 둘뿐이다)
const KEEP_SEGMENTS = 2;

const fixture = (root, rel) => readFileSync(join(root, 'testdata', rel));

export function rewriteHosts(text, origin) {
  let s = text;
  for (const h of MEDIA_HOSTS) s = s.replaceAll(`https://${h}`, origin);
  return s;
}

// media playlist의 앞 n개 조각만 남기고 ENDLIST를 붙인다(태그 줄은 조각 앞의 것만 남는다)
export function truncateMedia(text, n = KEEP_SEGMENTS) {
  const kept = [];
  let uris = 0;
  for (const line of text.split('\n')) {
    if (uris === n) break;
    if (line !== '' && !line.startsWith('#')) uris++;
    kept.push(line);
  }
  return `${kept.join('\n')}\n#EXT-X-ENDLIST\n`;
}

export function expectedOutput(root = ROOT) {
  const bytes = Buffer.concat(['hls/init.mp4', 'hls/seg0.m4v', 'hls/seg1.m4v'].map((f) => fixture(root, f)));
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

// 경로 → [content-type, body] (없으면 null). origin은 http://127.0.0.1:<port>
export function route(root, path, origin) {
  if (path === `/service/v2/videos/${HLS_VIDEO_NO}`) {
    return ['application/json', Buffer.from(rewriteHosts(fixture(root, 'hls/video_info.json').toString('utf8'), origin))];
  }
  if (path.endsWith('/vod_playlist.m3u8')) return ['application/vnd.apple.mpegurl', fixture(root, 'hls/master.m3u8')];
  if (path.endsWith('/vod_chunklist.m3u8')) {
    return ['application/vnd.apple.mpegurl', Buffer.from(truncateMedia(fixture(root, 'hls/media.m3u8').toString('utf8')))];
  }
  if (/\/\d+p_0_0_0\.m4s$/.test(path)) return ['video/mp4', fixture(root, 'hls/init.mp4')];
  const seg = /\/\d+p_seg(\d+)\.m4v$/.exec(path);
  if (seg && Number(seg[1]) < KEEP_SEGMENTS) return ['video/mp4', fixture(root, `hls/seg${seg[1]}.m4v`)];
  return null;
}

// 서버를 띄운다 → { url(끝에 /), log: [{method, path, status}], close() }. 요청 기록은 판정에 쓴다(쿼리는 버린다).
export function start({ root = ROOT, port = 0 } = {}) {
  const log = [];
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      const origin = `http://127.0.0.1:${server.address().port}`;
      const hit = req.method === 'GET' ? route(root, u.pathname, origin) : null;
      log.push({ method: req.method, path: u.pathname, status: hit ? 200 : 404 });
      if (!hit) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': hit[0], 'content-length': hit[1].length }).end(hit[1]);
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/`;
      resolve({ url, log, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

export async function main(argv) {
  let port = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && /^\d+$/.test(argv[i + 1] ?? '')) port = Number(argv[++i]);
    else {
      console.error('사용법: e2e-fixture-server.mjs [--port N]');
      return 2;
    }
  }
  const s = await start({ port });
  console.log(`e2e fixture 서버: ${s.url} (영상 주소 ${HLS_URL}, 기대 결과 ${JSON.stringify(expectedOutput())})`);
  return new Promise(() => {});
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
