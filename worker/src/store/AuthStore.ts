// Durable Object AuthStore(docs/design/worker.md §5). W1은 wrangler.jsonc의 exports 선언(클래스 AuthStore·바인딩 AUTH)을
// 고정하기 위한 빈 클래스다. RPC 메서드·스키마·alarm은 W3에서 채운다.
import { DurableObject } from "cloudflare:workers";

export class AuthStore extends DurableObject<Env> {}
