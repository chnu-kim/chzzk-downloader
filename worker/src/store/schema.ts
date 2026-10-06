// DO AuthStore 마이그레이션 배열(docs/design/worker.md §5). W3에서 v1 SQL을 넣는다. /health의 schema는 이 배열의 길이다
// (코드가 아는 최신 버전. W1은 테이블이 없어 0).
export const MIGRATIONS: readonly string[] = [];
export const SCHEMA_VERSION = MIGRATIONS.length;
