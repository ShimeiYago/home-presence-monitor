import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  type AttributeDefinition,
  type GlobalSecondaryIndex,
  type KeySchemaElement,
} from "@aws-sdk/client-dynamodb";
import {
  ddbTableSchemas,
  type DdbTableSchema,
  type DdbTableSchemaKey,
  resolveDdbAttributeType,
} from "../src/schema";
import { buildDdbTableName } from "../src/schema";
import { getEnv } from "../src/env";
import { dynamodbLocalCredentials } from "../src/dynamodb-local";

const env = getEnv();

const ensureTable = async (
  client: DynamoDBClient,
  tableName: string,
  params: {
    keySchema: KeySchemaElement[];
    attributeDefinitions: AttributeDefinition[];
    globalSecondaryIndexes?: GlobalSecondaryIndex[];
  },
): Promise<void> => {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`[skip] ${tableName}`);
    return;
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name !== "ResourceNotFoundException") {
      throw error;
    }
  }

  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: params.keySchema,
      AttributeDefinitions: params.attributeDefinitions,
      ...(params.globalSecondaryIndexes
        ? { GlobalSecondaryIndexes: params.globalSecondaryIndexes }
        : {}),
    }),
  );

  console.log(`[create] ${tableName}`);
};

const buildKeySchema = (schema: {
  keySchema: { partitionKey: string; sortKey?: string };
}): KeySchemaElement[] => {
  const keySchema: KeySchemaElement[] = [
    { AttributeName: schema.keySchema.partitionKey, KeyType: "HASH" as const },
  ];
  if (schema.keySchema.sortKey) {
    keySchema.push({
      AttributeName: schema.keySchema.sortKey,
      KeyType: "RANGE" as const,
    });
  }
  return keySchema;
};

const buildAttributeDefinitions = (schema: {
  keySchema: { partitionKey: string; sortKey?: string };
  globalSecondaryIndexes?: Array<{
    partitionKey: string;
    sortKey?: string;
  }>;
}): AttributeDefinition[] => {
  const names = new Set<string>();
  names.add(schema.keySchema.partitionKey);
  if (schema.keySchema.sortKey) {
    names.add(schema.keySchema.sortKey);
  }
  for (const gsi of schema.globalSecondaryIndexes ?? []) {
    names.add(gsi.partitionKey);
    if (gsi.sortKey) {
      names.add(gsi.sortKey);
    }
  }

  return [...names].map((name) => ({
    AttributeName: name,
    AttributeType: resolveDdbAttributeType(name),
  }));
};

const buildGlobalSecondaryIndexes = (schema: {
  globalSecondaryIndexes?: Array<{
    indexName: string;
    partitionKey: string;
    sortKey?: string;
  }>;
}): GlobalSecondaryIndex[] | undefined => {
  if (!schema.globalSecondaryIndexes?.length) {
    return undefined;
  }

  return schema.globalSecondaryIndexes.map((gsi) => ({
    IndexName: gsi.indexName,
    KeySchema: [
      { AttributeName: gsi.partitionKey, KeyType: "HASH" as const },
      ...(gsi.sortKey
        ? [{ AttributeName: gsi.sortKey, KeyType: "RANGE" as const }]
        : []),
    ],
    Projection: { ProjectionType: "ALL" },
  }));
};

const main = async (): Promise<void> => {
  const client = new DynamoDBClient({
    region: env.AWS_REGION,
    ...(env.DYNAMODB_ENDPOINT ? { endpoint: env.DYNAMODB_ENDPOINT } : {}),
    ...(env.DYNAMODB_ENDPOINT
      ? {
          credentials: dynamodbLocalCredentials,
        }
      : {}),
  });

  const entries = Object.entries(ddbTableSchemas) as Array<
    [DdbTableSchemaKey, DdbTableSchema]
  >;
  for (const [schemaKey, schema] of entries) {
    const tableName = buildDdbTableName(env.NODE_ENV, schemaKey);
    await ensureTable(client, tableName, {
      keySchema: buildKeySchema(schema),
      attributeDefinitions: buildAttributeDefinitions(schema),
      globalSecondaryIndexes: buildGlobalSecondaryIndexes(schema),
    });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
