// 작은 LRU(docs/design/worker.md §9.1 SHA256SUMS 해석 캐시). 값에 null을 둘 수 있다(get의 undefined만 미스).
export class Lru<K, V> {
  readonly #map = new Map<K, V>();

  constructor(readonly max: number) {
    if (!Number.isSafeInteger(max) || max < 1) throw new RangeError("LRU 크기는 1 이상의 정수다");
  }

  /** 있으면 맨 뒤(가장 최근)로 옮기고 값을, 없으면 undefined */
  get(key: K): V | undefined {
    if (!this.#map.has(key)) return undefined;
    const value = this.#map.get(key) as V;
    this.#map.delete(key);
    this.#map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.#map.delete(key);
    this.#map.set(key, value);
    while (this.#map.size > this.max) {
      const oldest = this.#map.keys().next();
      if (oldest.done === true) break;
      this.#map.delete(oldest.value);
    }
  }

  clear(): void {
    this.#map.clear();
  }

  get size(): number {
    return this.#map.size;
  }
}
