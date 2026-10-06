// vite ?raw 가져오기(파일 내용 문자열). test/bindings.test.ts가 .dev.vars.example을 읽는다
declare module "*?raw" {
  const text: string;
  export default text;
}
