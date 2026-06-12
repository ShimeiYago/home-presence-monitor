"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Cpu, House, Router } from "lucide-react";
import type {
  Activity as ActivityRecord,
  GetDeviceSourceIpResponse,
} from "@home-presence-monitor/contracts/api";
import { MONITOR_THRESHOLDS } from "@home-presence-monitor/config/monitor";
import { OverviewCard } from "@/components/dashboard/overview-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchActivities,
  fetchDeviceSourceIp,
  fetchLatestHeartbeat,
} from "@/lib/device-api";
import { DEVICES } from "@/lib/devices";
import { resolveApiConfig, type ApiConfig } from "@/lib/runtime-config";
import { formatJstDateTimeMinute, minutesSince } from "@/lib/time";

type SourceIpSummary = GetDeviceSourceIpResponse | null;

type CardStatus = {
  label: string;
  isAlert: boolean;
  detail: string;
};

type DeviceSummary = {
  deviceId: string;
  label: string;
  latestHeartbeatAt: string | null;
  heartbeatFetchFailed: boolean;
  sourceIpSummary: SourceIpSummary;
  sourceIpFetchFailed: boolean;
};

type HouseMotionSummary = {
  activityTotal: number;
  lastWindowMotionTotal: number;
  consecutiveNonDetectionCount: number;
  isHealthy: boolean;
};

const WINDOW_MS = MONITOR_THRESHOLDS.sensorActivityWindowMinutes * 60 * 1000;
const LOOKBACK_WINDOW_COUNT =
  MONITOR_THRESHOLDS.sensorConsecutiveNonDetectionAlertThreshold;

const floorToIntervalMs = (valueMs: number, intervalMs: number): number =>
  Math.floor(valueMs / intervalMs) * intervalMs;

const buildHouseMotionRange = () => {
  const windowEndMs = floorToIntervalMs(Date.now(), WINDOW_MS);
  const windowStartMs = windowEndMs - WINDOW_MS * LOOKBACK_WINDOW_COUNT;

  return {
    from: new Date(windowStartMs).toISOString(),
    to: new Date(windowEndMs).toISOString(),
    windowStarts: Array.from({ length: LOOKBACK_WINDOW_COUNT }, (_, index) =>
      new Date(windowStartMs + WINDOW_MS * index).toISOString(),
    ),
  };
};

const summarizeHouseMotion = (
  recordsByDevice: ActivityRecord[][],
  windowStarts: string[],
): HouseMotionSummary => {
  const totalsByWindow = new Map(
    windowStarts.map((windowStart) => [windowStart, 0]),
  );

  for (const records of recordsByDevice) {
    for (const record of records) {
      if (!totalsByWindow.has(record.windowStart)) {
        continue;
      }

      totalsByWindow.set(
        record.windowStart,
        (totalsByWindow.get(record.windowStart) ?? 0) + record.motionCount,
      );
    }
  }

  const orderedTotals = windowStarts.map(
    (windowStart) => totalsByWindow.get(windowStart) ?? 0,
  );
  let consecutiveNonDetectionCount = 0;

  for (let index = orderedTotals.length - 1; index >= 0; index -= 1) {
    if (
      orderedTotals[index] >=
      MONITOR_THRESHOLDS.sensorMotionCountHealthyThreshold
    ) {
      break;
    }

    consecutiveNonDetectionCount += 1;
  }

  return {
    activityTotal: orderedTotals.reduce((sum, value) => sum + value, 0),
    lastWindowMotionTotal: orderedTotals[orderedTotals.length - 1] ?? 0,
    consecutiveNonDetectionCount,
    isHealthy:
      consecutiveNonDetectionCount <
      MONITOR_THRESHOLDS.sensorConsecutiveNonDetectionAlertThreshold,
  };
};

const summarizeHeartbeatStatus = (
  summary: DeviceSummary,
): CardStatus & { ageMinutes?: number } => {
  const heartbeatRuleText = `${MONITOR_THRESHOLDS.heartbeatStaleMinutes}分以上未受信で異常`;

  if (summary.heartbeatFetchFailed) {
    return {
      label: "取得失敗",
      isAlert: true,
      detail: "heartbeat の取得に失敗しました",
    };
  }

  if (!summary.latestHeartbeatAt) {
    return {
      label: "異常あり",
      isAlert: true,
      detail: `heartbeat は未記録です（${heartbeatRuleText}）`,
    };
  }

  const ageMinutes = minutesSince(summary.latestHeartbeatAt);
  if (ageMinutes > MONITOR_THRESHOLDS.heartbeatStaleMinutes) {
    return {
      label: "異常あり",
      isAlert: true,
      detail: `最終受信から${ageMinutes}分（${heartbeatRuleText}）`,
      ageMinutes,
    };
  }

  return {
    label: "正常",
    isAlert: false,
    detail: `最終受信から${ageMinutes}分（${heartbeatRuleText}）`,
    ageMinutes,
  };
};

export default function Home() {
  const [deviceSummaries, setDeviceSummaries] = useState<DeviceSummary[]>([]);
  const [houseMotionSummary, setHouseMotionSummary] =
    useState<HouseMotionSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const apiConfig = useMemo<ApiConfig>(() => resolveApiConfig(), []);

  const isApiConfigured = Boolean(apiConfig.apiBaseUrl && apiConfig.apiKey);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void (async () => {
        if (!apiConfig.apiBaseUrl) {
          setErrorMessage("NEXT_PUBLIC_API_BASE_URL が設定されていません。");
          setIsLoading(false);
          return;
        }

        if (!apiConfig.apiKey) {
          setErrorMessage("NEXT_PUBLIC_API_KEY が設定されていません。");
          setIsLoading(false);
          return;
        }

        const apiBaseUrl = apiConfig.apiBaseUrl;
        const apiKey = apiConfig.apiKey;

        setIsLoading(true);
        setErrorMessage(null);

        const range = buildHouseMotionRange();
        const results = await Promise.all(
          DEVICES.map(async (device) => {
            const [activitiesResult, heartbeatResult, sourceIpResult] =
              await Promise.allSettled([
                fetchActivities(apiBaseUrl, apiKey, device.id, {
                  from: range.from,
                  to: range.to,
                }),
                fetchLatestHeartbeat(apiBaseUrl, apiKey, device.id),
                fetchDeviceSourceIp(apiBaseUrl, apiKey, device.id),
              ]);

            return {
              device,
              activitiesResult,
              heartbeatResult,
              sourceIpResult,
            };
          }),
        );

        const nextDeviceSummaries: DeviceSummary[] = [];
        const activityErrors: string[] = [];
        const errors: string[] = [];
        const recordsByDevice: ActivityRecord[][] = [];

        for (const result of results) {
          nextDeviceSummaries.push({
            deviceId: result.device.id,
            label: result.device.label,
            latestHeartbeatAt:
              result.heartbeatResult.status === "fulfilled"
                ? (result.heartbeatResult.value?.lastHeartbeatAt ?? null)
                : null,
            heartbeatFetchFailed: result.heartbeatResult.status === "rejected",
            sourceIpSummary:
              result.sourceIpResult.status === "fulfilled"
                ? result.sourceIpResult.value
                : null,
            sourceIpFetchFailed: result.sourceIpResult.status === "rejected",
          });

          if (result.activitiesResult.status === "fulfilled") {
            recordsByDevice.push(result.activitiesResult.value.activities);
          } else {
            activityErrors.push(
              `${result.device.label} activity取得失敗: ${result.activitiesResult.reason instanceof Error ? result.activitiesResult.reason.message : String(result.activitiesResult.reason)}`,
            );
          }

          if (result.heartbeatResult.status === "rejected") {
            const reason = result.heartbeatResult.reason;
            errors.push(
              `${result.device.label} heartbeat取得失敗: ${reason instanceof Error ? reason.message : String(reason)}`,
            );
          }

          if (result.sourceIpResult.status === "rejected") {
            const reason = result.sourceIpResult.reason;
            errors.push(
              `${result.device.label} 送信元IP取得失敗: ${reason instanceof Error ? reason.message : String(reason)}`,
            );
          }
        }

        setDeviceSummaries(nextDeviceSummaries);
        setHouseMotionSummary(
          activityErrors.length === 0
            ? summarizeHouseMotion(recordsByDevice, range.windowStarts)
            : null,
        );

        const nextErrors = [...activityErrors, ...errors];
        if (nextErrors.length > 0) {
          setErrorMessage(nextErrors.join("\n"));
        }

        setIsLoading(false);
      })();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [apiConfig.apiBaseUrl, apiConfig.apiKey]);

  const heartbeatSummaries = useMemo(
    () =>
      deviceSummaries.map((summary) => ({
        ...summary,
        status: summarizeHeartbeatStatus(summary),
      })),
    [deviceSummaries],
  );

  const heartbeatStatus = useMemo<CardStatus>(() => {
    if (isLoading && heartbeatSummaries.length === 0) {
      return {
        label: "確認中",
        isAlert: false,
        detail: "各デバイスの heartbeat を取得中です",
      };
    }

    if (heartbeatSummaries.length === 0) {
      return {
        label: "異常あり",
        isAlert: true,
        detail: "heartbeat 情報を取得できませんでした",
      };
    }

    const alertDevices = heartbeatSummaries.filter(
      (summary) => summary.status.isAlert,
    );
    if (alertDevices.length > 0) {
      return {
        label: "異常あり",
        isAlert: true,
        detail: alertDevices
          .map((summary) => `${summary.label}: ${summary.status.detail}`)
          .join(" / "),
      };
    }

    return {
      label: "正常",
      isAlert: false,
      detail: heartbeatSummaries
        .map((summary) => `${summary.label}: ${summary.status.detail}`)
        .join(" / "),
    };
  }, [heartbeatSummaries, isLoading]);

  const houseMotionStatus = useMemo<CardStatus>(() => {
    const ruleText = `直近${MONITOR_THRESHOLDS.sensorActivityWindowMinutes}分の合計 ${MONITOR_THRESHOLDS.sensorMotionCountHealthyThreshold}回以上で正常`;

    if (isLoading && !houseMotionSummary) {
      return {
        label: "確認中",
        isAlert: false,
        detail: "家全体のセンサー記録を集計中です",
      };
    }

    if (!houseMotionSummary) {
      return {
        label: "異常あり",
        isAlert: true,
        detail: "家全体のセンサー記録の取得に失敗しました",
      };
    }

    return {
      label: houseMotionSummary.isHealthy ? "正常" : "異常あり",
      isAlert: !houseMotionSummary.isHealthy,
      detail: `直近${MONITOR_THRESHOLDS.sensorActivityWindowMinutes}分 ${houseMotionSummary.lastWindowMotionTotal}回 / 連続非検出 ${houseMotionSummary.consecutiveNonDetectionCount}/${MONITOR_THRESHOLDS.sensorConsecutiveNonDetectionAlertThreshold}回（${ruleText}）`,
    };
  }, [houseMotionSummary, isLoading]);

  const sourceIpStatus = useMemo<CardStatus>(() => {
    if (isLoading && deviceSummaries.length === 0) {
      return {
        label: "確認中",
        isAlert: false,
        detail: "各デバイスの送信元IPを取得中です",
      };
    }

    if (deviceSummaries.length === 0) {
      return {
        label: "未記録",
        isAlert: true,
        detail: "送信元IP情報を取得できませんでした",
      };
    }

    const hasFetchFailure = deviceSummaries.some(
      (summary) => summary.sourceIpFetchFailed,
    );
    const missingSourceIpCount = deviceSummaries.filter(
      (summary) => !summary.sourceIpFetchFailed && !summary.sourceIpSummary,
    ).length;

    if (!hasFetchFailure && missingSourceIpCount === 0) {
      return {
        label: "記録あり",
        isAlert: false,
        detail: "各デバイスの最新送信元IPを表示しています",
      };
    }

    return {
      label: "未記録",
      isAlert: true,
      detail: "未記録または取得失敗のデバイスがあります",
    };
  }, [deviceSummaries, isLoading]);

  const sourceIpLines = useMemo(
    () =>
      deviceSummaries.map((summary) => {
        if (summary.sourceIpFetchFailed) {
          return `${summary.label}: 取得失敗`;
        }

        if (!summary.sourceIpSummary) {
          return `${summary.label}: 未記録`;
        }

        return `${summary.label}: ${summary.sourceIpSummary.sourceIp}`;
      }),
    [deviceSummaries],
  );

  const heartbeatPrimary =
    isLoading && heartbeatSummaries.length === 0 ? (
      <Skeleton className="h-8 w-32" />
    ) : (
      <span
        className={
          heartbeatStatus.isAlert ? "text-red-600" : "text-emerald-600"
        }
      >
        {heartbeatStatus.isAlert ? "異常あり" : "全デバイス正常"}
      </span>
    );

  const houseMotionPrimary =
    isLoading && !houseMotionSummary ? (
      <Skeleton className="h-8 w-24" />
    ) : (
      <span
        className={
          houseMotionStatus.isAlert ? "text-red-600" : "text-emerald-600"
        }
      >
        {houseMotionSummary?.activityTotal ?? 0} 回
      </span>
    );

  const sourceIpPrimary =
    isLoading && deviceSummaries.length === 0 ? (
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-6 w-40" />
      </div>
    ) : (
      <>
        {sourceIpLines.map((line) => (
          <span
            key={line}
            className="block text-base font-medium leading-7 text-slate-900"
          >
            {line}
          </span>
        ))}
      </>
    );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200 px-4 py-8 text-slate-900 sm:px-6">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="flex items-center gap-3">
          <House className="h-7 w-7 text-slate-700" />
          <h1 className="text-3xl font-semibold tracking-tight">
            活動検知モニター
          </h1>
        </header>

        {!isApiConfigured && (
          <Alert variant="destructive">
            <AlertTitle>API設定エラー</AlertTitle>
            <AlertDescription>
              `NEXT_PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_API_KEY` または
              `/runtime-config.js` を設定してください。
            </AlertDescription>
          </Alert>
        )}

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>取得エラー</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">
              {errorMessage}
            </AlertDescription>
          </Alert>
        )}

        <section className="space-y-4">
          <OverviewCard
            title="ラズパイ状態"
            titleIcon={<Cpu className="h-5 w-5 text-slate-600" />}
            status={
              heartbeatStatus.isAlert ? (
                <Badge variant="destructive">{heartbeatStatus.label}</Badge>
              ) : (
                <Badge className="border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600">
                  {heartbeatStatus.label}
                </Badge>
              )
            }
            primary={heartbeatPrimary}
            secondary={heartbeatStatus.detail}
            href="/heartbeats"
          />

          <OverviewCard
            title="センサー記録"
            titleIcon={<Activity className="h-5 w-5 text-slate-600" />}
            description="直近1時間の家全体センサー検知回数"
            status={
              houseMotionStatus.isAlert ? (
                <Badge variant="destructive">{houseMotionStatus.label}</Badge>
              ) : (
                <Badge className="border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600">
                  {houseMotionStatus.label}
                </Badge>
              )
            }
            primary={houseMotionPrimary}
            secondary={houseMotionStatus.detail}
            href="/activities"
          />

          <OverviewCard
            title="送信元ルーターIP"
            titleIcon={<Router className="h-5 w-5 text-slate-600" />}
            status={
              sourceIpStatus.isAlert ? (
                <Badge variant="destructive">{sourceIpStatus.label}</Badge>
              ) : (
                <Badge className="border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600">
                  {sourceIpStatus.label}
                </Badge>
              )
            }
            primary={sourceIpPrimary}
          />
        </section>
      </main>
    </div>
  );
}
