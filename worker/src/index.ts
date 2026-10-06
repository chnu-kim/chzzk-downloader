// Worker 진입점(docs/design/worker.md §3). fetch는 routes.ts가, 상태는 Durable Object AuthStore가 맡는다.
import { handle } from "./routes";
import { AuthStore } from "./store/AuthStore";

export { AuthStore };

export default {
  fetch: (req, env) => handle(req, env),
} satisfies ExportedHandler<Env>;
