import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getDdbDocClient, getTableName } from "../ddb";
import { isRecord, readBoolean, readNumber, readString } from "../guards";

export type MonitorStateRecord = {
  deviceId: string;
  isHealthy: boolean;
  updatedAt: string;
  reason: string;
  heartbeatAgeMinutes?: number;
  activityTotal: number;
};

export type MonitorStateItem = {
  PK: string;
  SK: string;
  deviceId: string;
  isHealthy: boolean;
  updatedAt: string;
  reason: string;
  heartbeatAgeMinutes?: number;
  activityTotal: number;
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

  if (
    !pk ||
    !sk ||
    !deviceId ||
    isHealthy === undefined ||
    !updatedAt ||
    !reason ||
    activityTotal === undefined
  ) {
    return undefined;
  }

  const parsedDeviceId = parseDeviceIdFromPk(pk);
  if (
    !parsedDeviceId ||
    parsedDeviceId !== deviceId ||
    sk !== MONITOR_STATE_SK
  ) {
    return undefined;
  }

  return {
    deviceId,
    isHealthy,
    updatedAt,
    reason,
    heartbeatAgeMinutes,
    activityTotal,
  };
};

export const buildMonitorStateItem = (
  record: MonitorStateRecord,
): MonitorStateItem => ({
  PK: buildMonitorStatePk(record.deviceId),
  SK: buildMonitorStateSk(),
  deviceId: record.deviceId,
  isHealthy: record.isHealthy,
  updatedAt: record.updatedAt,
  reason: record.reason,
  heartbeatAgeMinutes: record.heartbeatAgeMinutes,
  activityTotal: record.activityTotal,
});

export const putMonitorState = async (
  record: MonitorStateRecord,
): Promise<void> => {
  await getDdbDocClient().send(
    new PutCommand({
      TableName: getTableName("MONITOR_STATES"),
      Item: buildMonitorStateItem(record),
    }),
  );
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
