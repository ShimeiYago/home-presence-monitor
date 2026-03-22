export type DdbAttributeType = "S" | "N" | "B";

export type DdbKeySchema = {
  partitionKey: string;
  sortKey?: string;
};

export type DdbGsiSchema = {
  indexName: string;
  partitionKey: string;
  sortKey?: string;
  projectionType?: "ALL";
};

export type DdbTableSchema = {
  /**
   * Stable suffix used to build the physical table name.
   * The default naming rule is `${prefix}-${nameSuffix}`.
   */
  nameSuffix: string;

  /** Base table key schema. */
  keySchema: DdbKeySchema;

  /** Global secondary indexes required by the application. */
  globalSecondaryIndexes?: DdbGsiSchema[];

  /** Whether this table enables TTL using the standard ttl attribute. */
  ttlEnabled?: boolean;

  /** Defaults to PAY_PER_REQUEST in local bootstrap code. */
  billingMode?: "PAY_PER_REQUEST";
};

/**
 * Shared DynamoDB schemas.
 *
 * Goal: keep the *shape* (keys / indexes) in one place, so that:
 * - CDK can reference it when defining tables
 * - Local bootstrap script can reference it when creating tables in DynamoDB Local
 */
export const ddbTableSchemas = {
  HEARTBEATS: {
    nameSuffix: "Heartbeats",
    keySchema: { partitionKey: "PK", sortKey: "SK" },
    ttlEnabled: true,
    billingMode: "PAY_PER_REQUEST",
  },

  ACTIVITIES: {
    nameSuffix: "Activities",
    keySchema: { partitionKey: "PK", sortKey: "SK" },
    ttlEnabled: true,
    billingMode: "PAY_PER_REQUEST",
  },
} as const satisfies Record<string, DdbTableSchema>;

export const resolveDdbAttributeType = (
  attributeName: string,
): DdbAttributeType =>
  attributeName.endsWith("Epoch") || attributeName === "ttl" ? "N" : "S";

export type DdbTableSchemaKey = keyof typeof ddbTableSchemas;

export const buildDdbTableName = (
  env: string,
  schemaKey: DdbTableSchemaKey,
): string =>
  `HomePresenceMonitor-${env}-${ddbTableSchemas[schemaKey].nameSuffix}`;
