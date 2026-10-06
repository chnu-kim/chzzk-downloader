// DO SQLite 래퍼(docs/design/worker.md 구현 중 변경 17 (다)·21). 소스에서 SQL을 실행하는 곳은 이 파일 하나다(worker-config.mjs가 검사한다).
// 읽고 쓴 행 수를 누적한다: 무료 한도(DO 쓰기 10만 행/일)의 계량이고, 테스트가 "이 호출은 쓰기 0"을 단언하는 근거다.

export type Row = Record<string, SqlStorageValue>;

export class Db {
  rowsRead = 0;
  rowsWritten = 0;

  constructor(private readonly sql: SqlStorage) {}

  /** 모든 행. 두 카운터를 누적한다 */
  all<T extends Row>(query: string, ...binds: SqlStorageValue[]): T[] {
    const cursor = this.sql.exec<T>(query, ...binds);
    const rows = cursor.toArray();
    this.rowsRead += cursor.rowsRead;
    this.rowsWritten += cursor.rowsWritten;
    return rows;
  }

  /** 첫 행 또는 null(cursor.one()은 빈 결과에 던진다) */
  first<T extends Row>(query: string, ...binds: SqlStorageValue[]): T | null {
    return this.all<T>(query, ...binds)[0] ?? null;
  }

  /** 쓰기 문장. 이 문장이 쓴 행 수를 돌려준다(0이면 바뀐 행이 없다) */
  run(query: string, ...binds: SqlStorageValue[]): number {
    const before = this.rowsWritten;
    this.all(query, ...binds);
    return this.rowsWritten - before;
  }
}
