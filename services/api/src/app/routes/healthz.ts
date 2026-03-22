import { Hono } from "hono";

export const healthRoute = new Hono();

healthRoute.get("/", (c) => c.json({ ok: true }));
