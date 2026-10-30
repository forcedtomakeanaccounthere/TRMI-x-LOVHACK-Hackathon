import { createApp } from "./app";
import { env } from "./env";

const app = createApp();

app.listen(env.SERVER_PORT, () => {
  console.log(`[backend] listening on http://localhost:${env.SERVER_PORT}`);
});
