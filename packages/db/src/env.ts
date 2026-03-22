import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  AWS_REGION: z.string().default("ap-northeast-1"),
  DYNAMODB_ENDPOINT: z.string().optional(),
});

export type DbEnv = z.infer<typeof envSchema>;
export type Env = DbEnv;

let cachedEnv: DbEnv | undefined;

export const resetEnvCache = (): void => {
  cachedEnv = undefined;
};

export const getEnv = (): DbEnv => {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }
  return cachedEnv;
};
