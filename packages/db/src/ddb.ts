import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { buildDdbTableName, ddbTableSchemas } from "./schema";
import { dynamodbLocalCredentials } from "./dynamodb-local";
import { getEnv, Env } from "./env";

let cachedDocClient: DynamoDBDocumentClient | undefined;

export const getDdbDocClient = (): DynamoDBDocumentClient => {
  if (!cachedDocClient) {
    const env = getEnv();
    const baseClient = new DynamoDBClient({
      region: env.AWS_REGION,
      endpoint: env.DYNAMODB_ENDPOINT,
      ...(env.DYNAMODB_ENDPOINT
        ? {
            credentials: dynamodbLocalCredentials,
          }
        : {}),
    });

    cachedDocClient = DynamoDBDocumentClient.from(baseClient, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  }

  return cachedDocClient;
};

type DdbTableSchemaKey = keyof typeof ddbTableSchemas;

export const getTableName = <K extends DdbTableSchemaKey>(key: K): string => {
  // Env typing kept for future-proofing (e.g. endpoint/region).
  const _currentEnv: Env = getEnv();
  return buildDdbTableName(_currentEnv.NODE_ENV, key);
};
