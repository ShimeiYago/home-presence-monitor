import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getDdbDocClient, getTableName } from "../ddb";
import { isRecord, readBoolean, readNumber, readString } from "../guards";

export type MonitorStateRecord = {
  deviceId: string;
  isHealthy?: boolean;
  updatedAt?: string;
  reason?: string;
  heartbeatAgeMinutes?: number;
  activityTotal?: number;
  consecutiveNonDetectionCount?: number;
  lastObservedSourceIp?: string;
  lastObservedSourceIpAt?: string;
};

export type MonitorStateItem = {
  PK: string;
  SK: string;
  deviceId: string;
  isHealthy?: boolean;
  updatedAt?: string;
  reason?: string;
  heartbeatAgeMinutes?: number;
  activityTotal?: number;
  consecutiveNonDetectionCount?: number;
  lastObservedSourceIp?: string;
  lastObservedSourceIpAt?: string;
};

export type MonitorEvaluationUpdate = {
  deviceId: string;
  isHealthy: boolean;
  updatedAt: string;
  reason: string;
  heartbeatAgeMinutes?: number;
  activityTotal: number;
  consecutiveNonDetectionCount: number;
};

export type LatestObservedSourceIpUpdate = {
  deviceId: string;
  sourceIp: string;
  observedAt: string;
};

const DEVICE_PK_PREFIX = "DEVICE#";
const MONITOR_STATE_SK = "MONITOR_STATE#LATEST";

export const buildMonitorStatePk = (deviceId: string): string =>
  `${DEVICE_PK_PREFIX}${deviceId}`;

export const buildMonitorStateSk = (): string => MONITOR_STATE_SK;

const parseDeviceIdFromPk = (pk: string): string | undefined => {
  const match = pk.match(/^DEVICE#(.+)$/);
  return match?.[1];
};

export const parseMonitorStateRecord = (
  item: unknown,
): MonitorStateRecord | undefined => {
  if (!isRecord(item)) {
    return undefined;
  }

  const pk = readString(item, "PK");
  const sk = readString(item, "SK");
  const deviceId = readString(item, "deviceId");
  const isHealthy = readBoolean(item, "isHealthy");
  const updatedAt = readString(item, "updatedAt");
  const reason = readString(item, "reason");
  const heartbeatAgeMinutes = readNumber(item, "heartbeatAgeMinutes");
  const activityTotal = readNumber(item, "activityTotal");
  const consecutiveNonDetectionCount = readNumber(
    item,
    "consecutiveNonDetectionCount",
  );
  const lastObservedSourceIp = readString(item, "lastObservedSourceIp");
  const lastObservedSourceIpAt = readString(item, "lastObservedSourceIpAt");

  if (!pk || !sk) {
    return undefined;
  }

  const parsedDeviceId = parseDeviceIdFromPk(pk);
  if (
    !parsedDeviceId ||
    sk !== MONITOR_STATE_SK ||
    (deviceId !== undefined && parsedDeviceId !== deviceId)
  ) {
    return undefined;
  }

  return {
    deviceId: deviceId ?? parsedDeviceId,
    ...(isHealthy === undefined ? {} : { isHealthy }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(reason === undefined ? {} : { reason }),
    ...(heartbeatAgeMinutes === undefined ? {} : { heartbeatAgeMinutes }),
    ...(activityTotal === undefined ? {} : { activityTotal }),
    ...(consecutiveNonDetectionCount === undefined
      ? {}
      : { consecutiveNonDetectionCount }),
    ...(lastObservedSourceIp === undefined ? {} : { lastObservedSourceIp }),
    ...(lastObservedSourceIpAt === undefined ? {} : { lastObservedSourceIpAt }),
  };
};

export const buildMonitorStateItem = (
  record: MonitorStateRecord,
): MonitorStateItem => ({
  PK: buildMonitorStatePk(record.deviceId),
  SK: buildMonitorStateSk(),
  deviceId: record.deviceId,
  ...(record.isHealthy === undefined ? {} : { isHealthy: record.isHealthy }),
  ...(record.updatedAt === undefined ? {} : { updatedAt: record.updatedAt }),
  ...(record.reason === undefined ? {} : { reason: record.reason }),
  ...(record.heartbeatAgeMinutes === undefined
    ? {}
    : { heartbeatAgeMinutes: record.heartbeatAgeMinutes }),
  ...(record.activityTotal === undefined
    ? {}
    : { activityTotal: record.activityTotal }),
  ...(record.consecutiveNonDetectionCount === undefined
    ? {}
    : {
        consecutiveNonDetectionCount: record.consecutiveNonDetectionCount,
      }),
  ...(record.lastObservedSourceIp === undefined
    ? {}
    : { lastObservedSourceIp: record.lastObservedSourceIp }),
  ...(record.lastObservedSourceIpAt === undefined
    ? {}
    : { lastObservedSourceIpAt: record.lastObservedSourceIpAt }),
});

const updateMonitorState = async (
  deviceId: string,
  fieldsToSet: Record<string, string | number | boolean>,
  fieldsToRemove: string[] = [],
): Promise<void> => {
  const expressionAttributeNames: Record<string, string> = {
    "#deviceId": "deviceId",
  };
  const expressionAttributeValues: Record<string, string | number | boolean> = {
    ":deviceId": deviceId,
  };
  const setClauses = ["#deviceId = :deviceId"];
  const removeClauses: string[] = [];

  for (const [fieldName, fieldValue] of Object.entries(fieldsToSet)) {
    const fieldAlias = `#${fieldName}`;
    const valueAlias = `:${fieldName}`;
    expressionAttributeNames[fieldAlias] = fieldName;
    expressionAttributeValues[valueAlias] = fieldValue;
    setClauses.push(`${fieldAlias} = ${valueAlias}`);
  }

  for (const fieldName of fieldsToRemove) {
    const fieldAlias = `#${fieldName}`;
    expressionAttributeNames[fieldAlias] = fieldName;
    removeClauses.push(fieldAlias);
  }

  const updateExpressionParts = [`SET ${setClauses.join(", ")}`];
  if (removeClauses.length > 0) {
    updateExpressionParts.push(`REMOVE ${removeClauses.join(", ")}`);
  }

  await getDdbDocClient().send(
    new UpdateCommand({
      TableName: getTableName("MONITOR_STATES"),
      Key: {
        PK: buildMonitorStatePk(deviceId),
        SK: buildMonitorStateSk(),
      },
      UpdateExpression: updateExpressionParts.join(" "),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    }),
  );
};

export const updateMonitorEvaluation = async (
  record: MonitorEvaluationUpdate,
): Promise<void> => {
  await updateMonitorState(
    record.deviceId,
    {
      isHealthy: record.isHealthy,
      updatedAt: record.updatedAt,
      reason: record.reason,
      activityTotal: record.activityTotal,
      consecutiveNonDetectionCount: record.consecutiveNonDetectionCount,
      ...(record.heartbeatAgeMinutes === undefined
        ? {}
        : { heartbeatAgeMinutes: record.heartbeatAgeMinutes }),
    },
    record.heartbeatAgeMinutes === undefined ? ["heartbeatAgeMinutes"] : [],
  );
};

export const updateLatestObservedSourceIp = async (
  params: LatestObservedSourceIpUpdate,
): Promise<void> => {
  await updateMonitorState(params.deviceId, {
    lastObservedSourceIp: params.sourceIp,
    lastObservedSourceIpAt: params.observedAt,
  });
};

export const getMonitorStateByDevice = async (params: {
  deviceId: string;
}): Promise<MonitorStateRecord | undefined> => {
  const result = await getDdbDocClient().send(
    new GetCommand({
      TableName: getTableName("MONITOR_STATES"),
      Key: {
        PK: buildMonitorStatePk(params.deviceId),
        SK: buildMonitorStateSk(),
      },
    }),
  );

  return result.Item ? parseMonitorStateRecord(result.Item) : undefined;
};
