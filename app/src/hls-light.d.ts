// hls.js는 light 빌드(`hls.js/light`)의 타입 선언을 따로 싣지 않는다. 같은 API의 부분집합이므로 본 패키지 타입을 다시 내보낸다(preview.md PV9).
declare module 'hls.js/light' {
  import Hls from 'hls.js';
  export default Hls;
}
