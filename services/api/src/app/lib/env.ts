import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  DYNAMODB_ENDPOINT: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

export const getEnv = (): Env => {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }
  return cachedEnv;
};
