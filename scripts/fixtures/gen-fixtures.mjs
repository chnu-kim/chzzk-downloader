#!/usr/bin/env node
// testdata/의 합성 fixture를 결정적으로 만든다. 실제 방송·채널·서명 값은 하나도 쓰지 않는다.
//
//   node scripts/fixtures/gen-fixtures.mjs           # 다시 쓴다
//   node scripts/fixtures/gen-fixtures.mjs --check   # 저장소의 파일과 바이트가 같은지만 본다(다르면 1)
//
// 값은 모두 가짜다: 채널 ID는 0으로 채운 32자리 hex, 호스트는 *.example.invalid,
// 서명 토큰은 exp=0·hmac=0000 같은 자리표시자다. 채팅 닉네임·본문·작성자 해시도 가짜다(가상시청자N, user-hash-NN). 시각·길이·비트레이트도 둥근 가짜 값이다. 테스트가 기대는 구조(필드 이름, inKey 분기,
// 이중 인코딩 JSON, variant 5개, 세그먼트 30개, MPD의 PD/UUID/audio 구성, fMP4 상자 순서)는 그대로 둔다.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---- 가짜 식별자 ----

export const FAKE = {
  hls: {
    videoNo: 9000001,
    videoId: '000000000000000000000000000000000A01',
    channelId: '000000000000000000000000000000a1',
    channelName: '테스트채널',
    title: '테스트 다시보기',
  },
  vod: {
    videoNo: 9000002,
    videoId: '000000000000000000000000000000000B02',
    channelId: '000000000000000000000000000000b2',
    channelName: '가상채널',
    title: '가상 일반 VOD 제목 (괄호) 테스트',
    inKey: 'V1' + '0'.repeat(80) + 'b2',
  },
  // 클립을 만든 사람의 채널. 소유(원 채널)와 달라야 owner/maker를 헷갈린 버그가 드러난다.
  maker: {
    channelId: '000000000000000000000000000000d4',
    channelName: '제작자채널',
  },
  clip: {
    clipId: 'TestClip01',
    videoId: '000000000000000000000000000000000C03',
    channelId: '000000000000000000000000000000c3',
    channelName: '클립채널',
    title: '테스트 클립 하나',
    inKey: 'V1' + '0'.repeat(80) + 'c3',
  },
  live: {
    liveId: 9000003,
    channelId: '000000000000000000000000000000e5',
    channelName: '생방송채널',
    title: '테스트 생방송',
  },
  clipMulti: {
    clipId: 'TestClip02',
    videoId: '000000000000000000000000000000000C04',
    title: '테스트 클립 둘 - A vs B | 여러 화질 #태그',
    inKey: 'V1' + '0'.repeat(80) + 'c4',
  },
};

const HLS_HOST = 'https://hls.example.invalid';
const VOD_HOST = 'https://vod.example.invalid';
const CLIP_HOST = 'https://clip.example.invalid';
const IMG_HOST = 'https://img.example.invalid';
const HLS_DIR = `${HLS_HOST}/live_rewind/kr/streamkey0`;
const HDNTS = 'hdnts=st=0~exp=0~acl=*/kr/*~hmac=0000';
// master 쿼리(hdnts)와 variant 경로 토큰(hdntl)의 hmac 자리를 서로 다르게 둔다(경로에 쿼리 값을 잘못 옮기면 드러나게).
// hex가 아닌 글자로 시작하므로 검사기·이력 치환 규칙(hmac=<hex>)에 걸리지 않는다.
const HDNTL = 'hdntl=exp=0~acl=*/kr/*~data=hdntl~hmac=fakepath';

// ---- 빠른 다시보기(inKey 없음) ----

const TRACKS = [
  ['720p', 'high', 2500000, 160000, '60.0', 1280, 720],
  ['480p', 'main', 1200000, 128000, '30.0', 854, 480],
  ['360p', 'main', 500000, 96000, '30.0', 640, 360],
  ['144p', 'main', 100000, 64000, '30.0', 256, 144],
  ['1080p', 'high', 6000000, 160000, '60.0', 1920, 1080],
];

function livePlayback() {
  return {
    meta: {
      videoId: FAKE.hls.videoId,
      streamSeq: 1,
      liveId: '1',
      paidLive: false,
      cdnInfo: { cdnType: 'TEST' },
      cmcdEnabled: false,
      liveRewind: true,
      duration: 740,
      playbackAuthType: 'NONE',
    },
    api: [{ name: 'playCount', path: `${IMG_HOST}/playCount` }],
    media: [
      {
        mediaId: 'HLS',
        protocol: 'HLS',
        path: `${HLS_DIR}/vod_playlist.m3u8?${HDNTS}`,
        encodingTrack: TRACKS.map(([id, vp, vb, ab, fr, w, h]) => ({
          encodingTrackId: id,
          videoProfile: vp,
          audioProfile: 'LC',
          videoCodec: 'H264',
          videoBitRate: vb,
          audioBitRate: ab,
          videoFrameRate: fr,
          videoWidth: w,
          videoHeight: h,
          audioSamplingRate: 48000,
          audioChannel: 2,
          avoidReencoding: id === '1080p',
          videoDynamicRange: 'SDR',
        })),
      },
    ],
    thumbnail: {
      types: ['720', '480', '360', '270', '144'],
      representThumbnailList: [`${IMG_HOST}/thumb/live_0.jpg`],
    },
  };
}

function videoInfo(o) {
  return {
    code: 200,
    message: null,
    content: {
      videoNo: o.videoNo,
      videoId: o.videoId,
      videoTitle: o.title,
      videoType: 'REPLAY',
      publishDate: o.publishDate,
      thumbnailImageUrl: `${IMG_HOST}/thumb/${o.videoNo}.jpg`,
      trailerUrl: null,
      duration: o.duration,
      readCount: 0,
      publishDateAt: 0,
      categoryType: 'ETC',
      videoCategory: 'test',
      videoCategoryValue: 'test',
      exposure: true,
      adult: false,
      clipActive: false,
      livePv: 0,
      tags: ['테스트'],
      commentActive: true,
      channel: {
        channelId: o.channelId,
        channelName: o.channelName,
        channelImageUrl: `${IMG_HOST}/channel/${o.channelId}.png`,
        verifiedMark: false,
        verifiedMarkType: null,
        officialChannel: false,
      },
      blindType: null,
      watchTimeline: null,
      paidProductId: null,
      tvAppViewingPolicyType: 'ALLOWED',
      chapterActive: false,
      paidPromotion: false,
      inKey: o.inKey,
      radioModeInKey: null,
      previewUrl: null,
      liveOpenDate: o.liveOpenDate,
      vodStatus: o.vodStatus,
      // 원본처럼 JSON이 든 "문자열"이다(파서 계약).
      liveRewindPlaybackJson: o.playback ? JSON.stringify(o.playback) : null,
      encryptionType: o.encryptionType,
      prevVideo: null,
      nextVideo: null,
      userAdultStatus: null,
      adParameter: null,
      paidProduct: null,
      membershipBenefitType: 'NONE',
      chapters: [],
    },
  };
}

const json = (v) => JSON.stringify(v, null, 2) + '\n';

// ---- 생방송(live-detail) ----

const LIVE_DIR = `${HLS_HOST}/live/kr/streamkey0`;

// HLS(일반)와 LLHLS(저지연) 두 media가 모두 protocol "HLS"다. 파서는 mediaId로 고른다.
// 순서를 바꿔 LLHLS를 앞에 둔 변형으로 "첫 HLS"를 고르는 버그를 잡는다.
function liveMedia(id, file) {
  return {
    mediaId: id,
    protocol: 'HLS',
    path: `${LIVE_DIR}/${file}?${HDNTS}`,
    p2pPath: `/live/kr/streamkey0/${file}?p2p=0`,
    ...(id === 'LLHLS' ? { latency: 'lowLatency' } : {}),
    encodingTrack: [
      ...TRACKS.map(([tid, vp, vb, ab, fr, w, h]) => ({
        encodingTrackId: tid,
        videoProfile: vp,
        audioProfile: 'LC',
        videoCodec: 'H264',
        videoBitRate: vb,
        audioBitRate: ab,
        videoFrameRate: fr,
        videoWidth: w,
        videoHeight: h,
        audioSamplingRate: 48000,
        audioChannel: 2,
        avoidReencoding: false,
        videoDynamicRange: 'SDR',
      })),
      // 영상 없는 트랙. 화질 목록에서 빠져야 한다.
      { encodingTrackId: 'audioOnly', audioProfile: 'LC', audioCodec: 'AAC', audioBitRate: 128000, audioSamplingRate: 48000, audioChannel: 2 },
    ],
  };
}

function liveDetail({ status, llhlsFirst, playback, adult }) {
  const playbackJson = playback
    ? {
        meta: { videoId: null, streamSeq: 1, liveId: String(FAKE.live.liveId), paidLive: false, cdnInfo: { cdnType: 'TEST' }, cmcdEnabled: false, playbackAuthType: 'NONE' },
        serviceMeta: { contentType: 'LIVE' },
        live: { start: '2026-01-02T03:00:00.000Z', open: '2026-01-02T03:00:00.000Z', timeMachine: false, status },
        api: [],
        media: llhlsFirst
          ? [liveMedia('LLHLS', 'llhls_playlist.m3u8'), liveMedia('HLS', 'hls_playlist.m3u8')]
          : [liveMedia('HLS', 'hls_playlist.m3u8'), liveMedia('LLHLS', 'llhls_playlist.m3u8')],
        thumbnail: { snapshotThumbnailTemplate: `${IMG_HOST}/thumb/{type}.jpg`, types: ['480'] },
        multiview: [],
      }
    : null;
  return {
    code: 200,
    message: null,
    content: {
      liveId: FAKE.live.liveId,
      liveTitle: FAKE.live.title,
      status,
      liveImageUrl: `${IMG_HOST}/live/{type}.jpg`,
      defaultThumbnailImageUrl: null,
      concurrentUserCount: 10,
      accumulateCount: 100,
      openDate: '2026-01-02 12:00:00',
      closeDate: status === 'CLOSE' ? '2026-01-02 14:00:00' : null,
      adult: adult ?? false,
      clipActive: true,
      tags: ['테스트'],
      chatChannelId: 'N0000',
      categoryType: 'ETC',
      liveCategory: 'test',
      liveCategoryValue: 'test',
      timeMachineActive: false,
      // 원본처럼 JSON이 든 "문자열"이다(파서 계약).
      livePlaybackJson: playbackJson ? JSON.stringify(playbackJson) : null,
      channel: {
        channelId: FAKE.live.channelId,
        channelName: FAKE.live.channelName,
        channelImageUrl: `${IMG_HOST}/channel/${FAKE.live.channelId}.png`,
        verifiedMark: false,
        verifiedMarkType: null,
        officialChannel: false,
      },
      userAdultStatus: null,
    },
  };
}

function hlsVideoInfo() {
  return videoInfo({
    ...FAKE.hls,
    publishDate: '2026-01-02 13:00:00',
    liveOpenDate: '2026-01-02 12:00:00',
    duration: 740,
    inKey: null,
    vodStatus: 'NONE',
    playback: livePlayback(),
    encryptionType: null,
  });
}

function vodVideoInfo(encryptionType) {
  return videoInfo({
    ...FAKE.vod,
    publishDate: '2026-01-02 01:00:00',
    liveOpenDate: '2026-01-01 23:00:00',
    duration: 3600,
    vodStatus: 'ABR_HLS',
    playback: null,
    encryptionType,
  });
}

function masterM3u8() {
  const inf = [
    'BANDWIDTH=2660000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=60.00',
    'BANDWIDTH=1328000,CODECS="avc1.4D001F,mp4a.40.2",RESOLUTION=854x480,FRAME-RATE=30.00',
    'BANDWIDTH=596000,CODECS="avc1.4D001E,mp4a.40.2",RESOLUTION=640x360,FRAME-RATE=30.00',
    'BANDWIDTH=164000,CODECS="avc1.4D000C,mp4a.40.2",RESOLUTION=256x144,FRAME-RATE=30.00',
    'BANDWIDTH=6160000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60.00',
  ];
  let s = '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-INDEPENDENT-SEGMENTS\n\n';
  TRACKS.forEach(([id], i) => {
    s += `#EXT-X-STREAM-INF:${inf[i]}\n${id}/${HDNTL}/vod_chunklist.m3u8\n`;
  });
  return s;
}

const MAP = '#EXT-X-MAP:URI="144p_0_0_0.m4s?type=hls&filetype=.m4s"';
const seg = (i) => `144p_seg${i}.m4v`;
const HEADER =
  '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-TARGETDURATION:2\n' +
  '#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-DISCONTINUITY-SEQUENCE:0\n';

function mediaM3u8() {
  let s = HEADER + '#EXT-X-DATERANGE:ID="test-daterange",START-DATE="2026-01-02T03:00:00.000Z"\n\n';
  s += MAP + '\n';
  // liveOpenDate(KST 12:00)와 같은 시각의 UTC
  const t0 = Date.UTC(2026, 0, 2, 3, 0, 0, 0);
  for (let i = 0; i < 30; i++) {
    s += `#EXT-X-PROGRAM-DATE-TIME:${new Date(t0 + i * 2000).toISOString()}\n`;
    s += `#EXTINF:2.000000,\n${seg(i)}\n`;
  }
  return s + '#EXT-X-ENDLIST\n';
}

// media.m3u8의 헤더(PDT·DATERANGE 제외)와 앞 3개 세그먼트에 태그 하나만 넣거나 뺀 변형.
function variant({ afterMap = '', before = {}, extinf = {}, endlist = true }) {
  let s = HEADER + MAP + '\n' + afterMap;
  for (let i = 0; i < 3; i++) {
    s += before[i] ?? '';
    s += `#EXTINF:${extinf[i] ?? '2.000000'},\n${seg(i)}\n`;
  }
  return endlist ? s + '#EXT-X-ENDLIST\n' : s;
}

const SYNTHETIC_MEDIA = {
  'media_discontinuity.m3u8': variant({ before: { 2: '#EXT-X-DISCONTINUITY\n' } }),
  'media_two_maps.m3u8': variant({
    before: { 2: '#EXT-X-MAP:URI="144p_1_0_0.m4s?type=hls&filetype=.m4s"\n' },
  }),
  'media_key_aes.m3u8': variant({
    afterMap: '#EXT-X-KEY:METHOD=AES-128,URI="https://key.example.invalid/key"\n',
  }),
  'media_key_none.m3u8': variant({ afterMap: '#EXT-X-KEY:METHOD=NONE\n' }),
  'media_byterange.m3u8': variant({ before: { 1: '#EXT-X-BYTERANGE:1000@0\n' } }),
  'media_no_endlist.m3u8': variant({ endlist: false }),
  'media_long_extinf.m3u8': variant({ extinf: { 1: '2.500000' } }),
};

// ---- DASH MPD ----

const MPD_HEAD = (videoId, duration) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<MPD xmlns:nvod="urn:naver:vod:2020" xmlns="urn:mpeg:dash:schema:mpd:2011" ' +
  `type="static" mediaPresentationDuration="${duration}" minBufferTime="PT3.000S" ` +
  `nvod:videoId="${videoId}" nvod:serverTime="2026-01-01T00:00:00+0900" nvod:expireTime="2026-01-01T08:00:00+0900">\n` +
  `<Period id="${videoId}" duration="${duration}" bitstreamSwitching="true">\n`;

const LOUDNESS =
  '<Role schemeIdUri="urn:naver:vod:loudnessnormalize:2019-0"><nvod:LoudnessNormalize enable="true" version="1.0">' +
  '<nvod:Property name="targetLoudness">-16.0</nvod:Property></nvod:LoudnessNormalize></Role>';

function pdRep({ id, bandwidth, width, height, fps, codecs, url }) {
  const q = id.slice(3);
  const res = q.split('P_')[0];
  return (
    `<Representation id="${id}" bandwidth="${bandwidth}" width="${width}" height="${height}" frameRate="${fps}" mimeType="video/mp4" codecs="${codecs}">` +
    `<nvod:Label kind="qualityId">${q}</nvod:Label><nvod:Label kind="fps">${fps}</nvod:Label>` +
    `<nvod:Label kind="resolution">${res}</nvod:Label><BaseURL>${url}</BaseURL></Representation>\n`
  );
}

// PD가 아닌 미끼: PD와 같은 qualityId·fps·resolution 라벨, 서명이 붙은 BaseURL(/hls/), SegmentTemplate.
// PD 판정(mime·id·/pd/)만이 이것을 걸러야 한다.
function hlsRep(uuid, { q, bandwidth, width, height, fps, host, sig }) {
  const res = q.split('P_')[0];
  return (
    `<Representation id="${uuid}" bandwidth="${bandwidth}" width="${width}" height="${height}" frameRate="${fps}" codecs="avc1.4d401f,mp4a.40.2" ` +
    `nvod:m3u="${host}/hls/${uuid}.m3u8?${sig}">` +
    `<nvod:Label kind="qualityId">${q}</nvod:Label><nvod:Label kind="fps">${fps}</nvod:Label>` +
    `<nvod:Label kind="resolution">${res}</nvod:Label><BaseURL>${host}/hls/${uuid}/?${sig}</BaseURL>` +
    '<SegmentTemplate media="seg_$Number$.ts" initialization="init.ts" timescale="1000" duration="2000" startNumber="1"/>' +
    '</Representation>\n'
  );
}

function audioRep(uuid, { bandwidth, url }) {
  return (
    `<Representation id="${uuid}" bandwidth="${bandwidth}" mimeType="audio/mp4" codecs="mp4a.40.2">` +
    `<nvod:Label kind="qualityId">AUDIO_${bandwidth / 1000}</nvod:Label><BaseURL>${url}</BaseURL>` +
    '<SegmentList timescale="1000" duration="2000"><Initialization range="0-999"/><SegmentURL mediaRange="1000-1999"/></SegmentList>' +
    '</Representation>\n'
  );
}

function vodMpd() {
  const v = FAKE.vod.videoId;
  const base = `${VOD_HOST}/vod/${v}/pd/1000`;
  const sig = '_lsu_sa_=0000';
  return (
    MPD_HEAD(v, 'PT1H0M0.000S') +
    `<AdaptationSet maxWidth="1280" maxHeight="720" mimeType="video/mp4">${LOUDNESS}\n` +
    pdRep({
      id: 'PD_144P_256_128_64',
      bandwidth: 200000,
      width: 256,
      height: 144,
      fps: 30,
      codecs: 'avc1.4dc00c,mp4a.40.2',
      url: `${base}/00000000-0000-0000-0000-000000000144.mp4?${sig}`,
    }) +
    pdRep({
      id: 'PD_720P_1280_4000_192',
      bandwidth: 3200000,
      width: 1280,
      height: 720,
      fps: 60,
      codecs: 'avc1.4d4020,mp4a.40.2',
      url: `${base}/00000000-0000-0000-0000-000000000720.mp4?${sig}`,
    }) +
    '</AdaptationSet>\n' +
    // video/mp2t: mimeType은 AdaptationSet에서 상속된다.
    `<AdaptationSet maxWidth="1280" maxHeight="720" mimeType="video/mp2t" nvod:m3u="${VOD_HOST}/hls/master.m3u8?${sig}">\n` +
    hlsRep('00000000-0000-0000-0000-0000000000b1', {
      q: '720P_1280_4000_192',
      bandwidth: 3200000,
      width: 1280,
      height: 720,
      fps: 60,
      host: VOD_HOST,
      sig,
    }) +
    hlsRep('00000000-0000-0000-0000-0000000000b2', {
      q: '144P_256_128_64',
      bandwidth: 200000,
      width: 256,
      height: 144,
      fps: 30,
      host: VOD_HOST,
      sig,
    }) +
    '</AdaptationSet>\n' +
    '<AdaptationSet mimeType="audio/mp4">\n' +
    audioRep('00000000-0000-0000-0000-0000000000b3', { bandwidth: 128000, url: `${VOD_HOST}/vod/${v}/audio/0.m4a?${sig}` }) +
    '</AdaptationSet>\n</Period>\n</MPD>\n'
  );
}

function clipMultiMpd() {
  const v = FAKE.clipMulti.videoId;
  // %xx로 인코딩한 서명 쿼리(파서가 그대로 보존해야 한다).
  const sig = 'hdnts=exp%3D0%7Eacl%3D%2Fclip%2F*%7Ehmac%3D0000';
  const base = `${CLIP_HOST}/clip/${v}/pd/1000`;
  return (
    MPD_HEAD(v, 'PT30.000S') +
    `<AdaptationSet maxWidth="720" maxHeight="1280" mimeType="video/mp4">${LOUDNESS}\n` +
    pdRep({
      id: 'PD_720P_1280_2048_192',
      bandwidth: 1800000,
      width: 720,
      height: 1280,
      fps: 30,
      codecs: 'avc1.4d401f,mp4a.40.2',
      url: `${base}/00000000-0000-0000-0000-000000000720.mp4?${sig}`,
    }) +
    pdRep({
      id: 'PD_480P_854_1024_128',
      bandwidth: 1000000,
      width: 480,
      height: 854,
      fps: 30,
      codecs: 'avc1.4d401f,mp4a.40.2',
      url: `${base}/00000000-0000-0000-0000-000000000480.mp4?${sig}`,
    }) +
    '</AdaptationSet>\n' +
    `<AdaptationSet maxWidth="720" maxHeight="1280" mimeType="video/mp2t" nvod:m3u="${CLIP_HOST}/hls/master.m3u8?${sig}">\n` +
    hlsRep('00000000-0000-0000-0000-0000000000c1', {
      q: '720P_1280_2048_192',
      bandwidth: 1800000,
      width: 720,
      height: 1280,
      fps: 30,
      host: CLIP_HOST,
      sig,
    }) +
    hlsRep('00000000-0000-0000-0000-0000000000c2', {
      q: '480P_854_1024_128',
      bandwidth: 1000000,
      width: 480,
      height: 854,
      fps: 30,
      host: CLIP_HOST,
      sig,
    }) +
    '</AdaptationSet>\n' +
    '<AdaptationSet mimeType="audio/mp4">\n' +
    audioRep('00000000-0000-0000-0000-0000000000c3', { bandwidth: 128000, url: `${CLIP_HOST}/clip/${v}/audio/0.m4a?${sig}` }) +
    '</AdaptationSet>\n</Period>\n</MPD>\n'
  );
}

function clipPlayinfo(o) {
  const chan = ({ channelId, channelName }) => ({
    channelId,
    channelName,
    channelImageUrl: `${IMG_HOST}/channel/${channelId}.png`,
    verifiedMark: false,
  });
  return (
    JSON.stringify({
      code: 200,
      message: null,
      content: {
        contentType: 'CLIP',
        contentId: o.clipId,
        videoId: o.videoId,
        vodStatus: 'ABR_HLS',
        contentTitle: o.title,
        categoryType: 'ETC',
        categoryValue: 'test',
        adult: false,
        inKey: o.inKey,
        naverOnly: false,
        readCount: 0,
        commentCount: 0,
        userAdultStatus: 'NOT_LOGIN_USER',
        ownerChannel: chan(FAKE.clip),
        makerChannel: chan(FAKE.maker),
        tvAppViewingPolicyType: 'ALLOWED',
      },
    }) + '\n'
  );
}

// ---- fMP4 ----

const u8 = (...b) => Uint8Array.from(b);
const be32 = (n) => u8((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const be16 = (n) => u8((n >>> 8) & 255, n & 255);
const be64 = (n) => Buffer.concat([be32(Math.floor(n / 2 ** 32)), be32(n >>> 0)]);
const ascii = (s) => Buffer.from(s, 'latin1');
const zeros = (n) => new Uint8Array(n);
const cat = (...parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));

const box = (type, ...payload) => {
  const body = cat(...payload);
  return cat(be32(8 + body.length), ascii(type), body);
};
const full = (type, version, flags, ...payload) =>
  box(type, u8(version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255), ...payload);

// 결정적인 가짜 페이로드(xorshift32). 실제 영상 바이트가 아니다.
function noise(n, seed) {
  let x = (seed * 2654435761) >>> 0 || 1;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 255;
  }
  return out;
}

const MATRIX = cat(be32(0x10000), zeros(12), be32(0x10000), zeros(12), be32(0x40000000));

function trak(id, handler) {
  const video = handler === 'vide';
  const tkhd = full('tkhd', 0, 7, zeros(8), be32(id), zeros(4), be32(0), zeros(8), be16(0), be16(0), be16(video ? 0 : 0x100), zeros(2), MATRIX, be32(video ? 256 << 16 : 0), be32(video ? 144 << 16 : 0));
  const mdhd = full('mdhd', 0, 0, zeros(8), be32(video ? 90000 : 48000), be32(0), be16(0x55c4), zeros(2));
  const hdlr = full('hdlr', 0, 0, zeros(4), ascii(handler), zeros(12), ascii(video ? 'Video\0' : 'Sound\0'));
  const xmhd = video ? full('vmhd', 0, 1, zeros(8)) : full('smhd', 0, 0, zeros(4));
  const dinf = box('dinf', full('dref', 0, 0, be32(1), full('url ', 0, 1)));
  const stbl = box(
    'stbl',
    full('stsd', 0, 0, be32(0)),
    full('stts', 0, 0, be32(0)),
    full('stsc', 0, 0, be32(0)),
    full('stsz', 0, 0, be32(0), be32(0)),
    full('stco', 0, 0, be32(0)),
  );
  return box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', xmhd, dinf, stbl)));
}

function initMp4() {
  const ftyp = box('ftyp', ascii('iso6'), be32(0), ascii('iso6'));
  const mvhd = full('mvhd', 0, 0, zeros(8), be32(1000), be32(0), be32(0x10000), be16(0x100), zeros(10), MATRIX, zeros(24), be32(3));
  const trex = (id) => full('trex', 0, 0, be32(id), be32(1), zeros(12));
  const mvex = box('mvex', trex(1), trex(2));
  return cat(ftyp, box('moov', mvhd, trak(1, 'vide'), trak(2, 'soun'), mvex));
}

function fragment(seq, track, baseTime, payload) {
  const samples = 4;
  const size = Math.floor(payload.length / samples);
  const trunBody = (offset) =>
    cat(be32(samples), be32(offset), ...Array.from({ length: samples }, () => cat(be32(1000), be32(size))));
  const build = (offset) =>
    box(
      'moof',
      full('mfhd', 0, 0, be32(seq)),
      box(
        'traf',
        full('tfhd', 0, 0x020000, be32(track)),
        full('tfdt', 1, 0, be64(baseTime)),
        full('trun', 0, 0x000301, trunBody(offset)),
      ),
    );
  const moof = build(build(0).length + 8);
  return cat(moof, box('mdat', payload));
}

function emsg(id) {
  return full('emsg', 0, 0, ascii('urn:example:test\0'), ascii('\0'), be32(1000), be32(0), be32(0), be32(id), ascii('test'));
}

function segment(msn) {
  const styp = box('styp', ascii('iso6'), be32(0), ascii('iso6'));
  const parts = [styp];
  for (let k = 0; k < 2; k++) {
    const track = k + 1;
    parts.push(fragment(msn * 2 + k + 1, track, msn * 2000, noise(2048 + 256 * k, msn * 16 + k + 1)), emsg(msn * 2 + k));
  }
  return cat(...parts);
}

// ---- 채팅(기능 ④) ----
// 닉네임·본문·작성자 해시는 모두 가짜다(가상시청자N, user-hash-NN). profile·extras는 JSON이 든 **문자열**이다.

const CHAT_EPOCH = 1767322800000; // 2026-01-02 12:00:00 KST(가짜 작성 시각 기준)

function chatMsg({ at, user, text = '테스트 메시지', type = 1, status = 'NORMAL', profile, extras = '{}' }) {
  return {
    chatChannelId: 'N1fakeChat',
    messageTime: CHAT_EPOCH + at,
    userIdHash: `user-hash-${String(user).padStart(2, '0')}`,
    content: text,
    extras,
    messageTypeCode: type,
    messageStatusType: status,
    profile: profile === undefined ? JSON.stringify({ nickname: `가상시청자${user}` }) : profile,
    playerMessageTime: at,
  };
}

const chatPage = (next, chats, previous = []) => ({
  code: 200,
  message: null,
  content: { nextPlayerMessageTime: next, previousVideoChats: previous, videoChats: chats },
});

function chatFixtures() {
  const first = [
    chatMsg({ at: 10000, user: 1 }),
    chatMsg({ at: 11000, user: 2 }),
    chatMsg({ at: 12000, user: 3 }),
    chatMsg({ at: 13000, user: 4 }),
    chatMsg({ at: 15000, user: 5 }),
  ];
  const previous = [chatMsg({ at: 1000, user: 7 }), chatMsg({ at: 2000, user: 8 }), chatMsg({ at: 3000, user: 9 })];
  return {
    'page_first.json': json(chatPage(15000, first, previous)),
    'page_boundary.json': json(
      chatPage(17000, [chatMsg({ at: 15000, user: 5 }), chatMsg({ at: 15000, user: 6, text: '다른 메시지' }), chatMsg({ at: 17000, user: 1 })]),
    ),
    'page_boundary_twins.json': json(
      chatPage(18000, [chatMsg({ at: 15000, user: 5 }), chatMsg({ at: 15000, user: 5 }), chatMsg({ at: 18000, user: 2 })]),
    ),
    'page_last_null.json': json(chatPage(null, [chatMsg({ at: 20000, user: 3 })])),
    'page_not_advancing.json': json(chatPage(20000, [chatMsg({ at: 20000, user: 4 })])),
    'page_empty.json': json(chatPage(30000, [])),
    'page_kinds.json': json(
      chatPage(null, [
        chatMsg({ at: 1000, user: 1, text: '일반 메시지' }),
        chatMsg({ at: 2000, user: 2, text: '후원 메시지', type: 10, extras: '{"payAmount":1000}' }),
        chatMsg({ at: 3000, user: 3, text: '구독 메시지', type: 11 }),
        chatMsg({ at: 4000, user: 4, text: '시스템 메시지', type: 30, profile: 'null' }),
        chatMsg({ at: 5000, user: 5, text: '모르는 종류', type: 99 }),
        chatMsg({ at: 6000, user: 6, text: '가려진 메시지', status: 'HIDDEN' }),
        chatMsg({ at: 7000, user: 7, text: '프로필 없음', profile: null }),
        chatMsg({ at: 8000, user: 8, text: '프로필 깨짐', profile: '{"nickname":' }),
      ]),
    ),
    'page_escape.json': json(
      chatPage(null, [
        chatMsg({ at: 61234, user: 1, text: '{중괄호} 와 \\역슬래시' }),
        chatMsg({ at: 3600010, user: 2, text: '첫 줄\n둘째 줄' }),
        chatMsg({ at: 3600020, user: 3, text: '제어\u0007문자\t탭' }),
        chatMsg({ at: 3600030, user: 4, text: '12345', profile: null }),
        chatMsg({ at: 3600040, user: 5, text: '이모티콘 {:smile:} 끝' }),
        chatMsg({ at: 3600050, user: 6, text: '빈 줄\r\n\r\n뒤' }),
        chatMsg({ at: 3600060, user: 7, text: '   ' }),
      ]),
    ),
    'page_bad_shape.json': json(
      chatPage(null, [{ ...chatMsg({ at: 1000, user: 1, text: '형식 오류 본문' }), playerMessageTime: '1000' }]),
    ),
  };
}

// 자막 골든. 생성기가 기대값의 원천이고 Rust 골든 테스트(chat/subtitle.rs)가 바이트로 비교한다.
const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Chat,sans-serif,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,1,40,40,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

const CHAT_KINDS_ASS = `${ASS_HEADER}Dialogue: 0,0:00:01.00,0:00:06.00,Chat,,0,0,0,,가상시청자1: 일반 메시지
Dialogue: 0,0:00:02.00,0:00:07.00,Chat,,0,0,0,,가상시청자2 [후원]: 후원 메시지
Dialogue: 0,0:00:03.00,0:00:08.00,Chat,,0,0,0,,가상시청자3: 구독 메시지
Dialogue: 0,0:00:05.00,0:00:10.00,Chat,,0,0,0,,가상시청자5: 모르는 종류
Dialogue: 0,0:00:07.00,0:00:12.00,Chat,,0,0,0,,프로필 없음
Dialogue: 0,0:00:08.00,0:00:13.00,Chat,,0,0,0,,프로필 깨짐
`;

const CHAT_KINDS_SRT = `1
00:00:01,000 --> 00:00:06,000
가상시청자1: 일반 메시지

2
00:00:02,000 --> 00:00:07,000
가상시청자2 [후원]: 후원 메시지

3
00:00:03,000 --> 00:00:08,000
가상시청자3: 구독 메시지

4
00:00:05,000 --> 00:00:10,000
가상시청자5: 모르는 종류

5
00:00:07,000 --> 00:00:12,000
프로필 없음

6
00:00:08,000 --> 00:00:13,000
프로필 깨짐

`;

const CHAT_ESCAPE_ASS = `${ASS_HEADER}Dialogue: 0,0:01:01.23,0:01:06.23,Chat,,0,0,0,,가상시청자1: ｛중괄호｝ 와 ＼역슬래시
Dialogue: 0,1:00:00.01,1:00:05.01,Chat,,0,0,0,,가상시청자2: 첫 줄\\N둘째 줄
Dialogue: 0,1:00:00.02,1:00:05.02,Chat,,0,0,0,,가상시청자3: 제어문자 탭
Dialogue: 0,1:00:00.03,1:00:05.03,Chat,,0,0,0,,12345
Dialogue: 0,1:00:00.04,1:00:05.04,Chat,,0,0,0,,가상시청자5: 이모티콘 :smile: 끝
Dialogue: 0,1:00:00.05,1:00:05.05,Chat,,0,0,0,,가상시청자6: 빈 줄\\N뒤
`;

const CHAT_ESCAPE_SRT = `1
00:01:01,234 --> 00:01:06,234
가상시청자1: ｛중괄호｝ 와 ＼역슬래시

2
01:00:00,010 --> 01:00:05,010
가상시청자2: 첫 줄
둘째 줄

3
01:00:00,020 --> 01:00:05,020
가상시청자3: 제어문자 탭

4
01:00:00,030 --> 01:00:05,030
 12345

5
01:00:00,040 --> 01:00:05,040
가상시청자5: 이모티콘 :smile: 끝

6
01:00:00,050 --> 01:00:05,050
가상시청자6: 빈 줄
뒤

`;

// ---- 출력 ----

export function outputs() {
  const files = {
    'testdata/hls/video_info.json': json(hlsVideoInfo()),
    'testdata/hls/master.m3u8': masterM3u8(),
    'testdata/hls/media.m3u8': mediaM3u8(),
    'testdata/hls/init.mp4': initMp4(),
    'testdata/hls/seg0.m4v': segment(0),
    'testdata/hls/seg1.m4v': segment(1),
    'testdata/live/live_detail.json': json(liveDetail({ status: 'OPEN', playback: true })),
    'testdata/live/live_detail_llhls_first.json': json(liveDetail({ status: 'OPEN', llhlsFirst: true, playback: true })),
    'testdata/live/live_detail_closed.json': json(liveDetail({ status: 'CLOSE', playback: false })),
    'testdata/live/live_detail_adult_blocked.json': json(liveDetail({ status: 'OPEN', playback: false, adult: true })),
    'testdata/vod/video_info.json': json(vodVideoInfo(null)),
    'testdata/vod/playback.mpd': vodMpd(),
    'testdata/clip/clip_playinfo.json': clipPlayinfo(FAKE.clip),
    'testdata/clip/clip_multi_playinfo.json': clipPlayinfo(FAKE.clipMulti),
    'testdata/clip/clip_multi.mpd': clipMultiMpd(),
    'testdata/synthetic/vod_info_aes.json': json(vodVideoInfo('AES')),
  };
  for (const [name, body] of Object.entries(SYNTHETIC_MEDIA)) {
    files[`testdata/synthetic/${name}`] = body;
  }
  for (const [name, body] of Object.entries(chatFixtures())) {
    files[`testdata/chat/${name}`] = body;
  }
  files['testdata/chat/expected/kinds.ass'] = CHAT_KINDS_ASS;
  files['testdata/chat/expected/kinds.srt'] = CHAT_KINDS_SRT;
  files['testdata/chat/expected/escape.ass'] = CHAT_ESCAPE_ASS;
  files['testdata/chat/expected/escape.srt'] = CHAT_ESCAPE_SRT;
  return files;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.some((a) => a !== '--check')) {
    console.error('사용법: gen-fixtures.mjs [--check]');
    process.exit(2);
  }
  const check = argv.includes('--check');
  let bad = 0;
  const all = Object.entries(outputs());
  for (const [rel, body] of all) {
    const path = join(ROOT, rel);
    const bytes = Buffer.from(body);
    if (check) {
      let cur;
      try {
        cur = readFileSync(path);
      } catch {
        cur = null;
      }
      if (!cur || !cur.equals(bytes)) {
        console.error(`다름: ${rel}`);
        bad++;
      }
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
      const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
      console.log(`${relative(ROOT, path)}  ${bytes.length} B  sha256 ${sha}`);
    }
  }
  if (bad) {
    console.error(`${bad}개 fixture가 생성기 출력과 다르다. node scripts/fixtures/gen-fixtures.mjs로 다시 만든다.`);
    process.exit(1);
  }
  // 성공 줄이 있어야 main이 실제로 돌았는지 로그로 알 수 있다(entry.test.mjs가 본다)
  if (check) console.log(`fixtures: ${all.length}개 바이트 동일`);
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
