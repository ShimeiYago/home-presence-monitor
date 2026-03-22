import { serve } from "@hono/node-server";
import { createApp } from "../app/app";

const app = createApp();

serve({
  fetch: app.fetch,
  port: 3001,
});

console.log("Server running http://localhost:3001");
