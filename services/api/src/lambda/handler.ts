import { handle } from "hono/aws-lambda";
import { createApp } from "../app/app";

let cachedHandler: ReturnType<typeof handle> | undefined;

const getHandler = () => {
  if (!cachedHandler) {
    // Important: create the app only after runtime env is initialized,
    // because env parsing is cached inside the app.
    cachedHandler = handle(createApp());
  }
  return cachedHandler;
};

export const handler: ReturnType<typeof handle> = async (event, context) => {
  return getHandler()(event, context);
};
