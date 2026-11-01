import { createApp } from "./app";
import { env } from "./env";
import { resumeIndexing, startIndexingSweep } from "./lib/ai-jobs";
import { startLifecycleWorker } from "./services/lifecycle";

const app = createApp();

app.listen(env.SERVER_PORT, () => {
  console.log(`[backend] listening on http://localhost:${env.SERVER_PORT}`);

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    startLifecycleWorker();
    // Rooms whose indexing was cut short by a restart, or never ran, are indexed in the background.
    resumeIndexing().catch((err: unknown) => console.error("[ai-jobs] could not resume indexing:", err));
    // Rooms whose job is lost while the server keeps running are picked up again.
    startIndexingSweep();
  }
});
