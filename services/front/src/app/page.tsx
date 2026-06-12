"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, Cpu, House, Router } from "lucide-react";
import type {
  Activity as ActivityRecord,
  GetDeviceSourceIpResponse,
} from "@home-presence-monitor/contracts/api";
import { MONITOR_THRESHOLDS } from "@home-presence-monitor/config/monitor";
import { OverviewCard } from "@/components/dashboard/overview-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchActivities,
  fetchDeviceSourceIp,
  fetchLatestHeartbeat,
} from "@/lib/device-api";
import { buildDeviceDetailHref, DEVICES } from "@/lib/devices";
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
          const heartbeatFetchFailed =
            result.heartbeatResult.status === "rejected";
          const sourceIpFetchFailed =
            result.sourceIpResult.status === "rejected";

          nextDeviceSummaries.push({
            deviceId: result.device.id,
            label: result.device.label,
            latestHeartbeatAt:
              result.heartbeatResult.status === "fulfilled"
                ? (result.heartbeatResult.value?.lastHeartbeatAt ?? null)
                : null,
            heartbeatFetchFailed,
            sourceIpSummary:
              result.sourceIpResult.status === "fulfilled"
                ? result.sourceIpResult.value
                : null,
            sourceIpFetchFailed,
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

    if (!houseMotionSummary.isHealthy) {
      return {
        label: "異常あり",
        isAlert: true,
        detail: `直近${MONITOR_THRESHOLDS.sensorActivityWindowMinutes}分 ${houseMotionSummary.lastWindowMotionTotal}回 / 連続非検出 ${houseMotionSummary.consecutiveNonDetectionCount}/${MONITOR_THRESHOLDS.sensorConsecutiveNonDetectionAlertThreshold}回（${ruleText}）`,
      };
    }

    return {
      label: "正常",
      isAlert: false,
      detail: `直近${MONITOR_THRESHOLDS.sensorActivityWindowMinutes}分 ${houseMotionSummary.lastWindowMotionTotal}回 / 連続非検出 ${houseMotionSummary.consecutiveNonDetectionCount}/${MONITOR_THRESHOLDS.sensorConsecutiveNonDetectionAlertThreshold}回（${ruleText}）`,
    };
  }, [houseMotionSummary, isLoading]);

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

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200 px-4 py-8 text-slate-900 sm:px-6">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6">
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
            title="家全体の活動"
            titleIcon={<Activity className="h-5 w-5 text-slate-600" />}
            description="直近1時間の合計センサー検知回数"
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
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {deviceSummaries.map((summary) => {
            const heartbeatStatus = (() => {
              const heartbeatRuleText = `${MONITOR_THRESHOLDS.heartbeatStaleMinutes}分以上未受信で異常`;

              if (summary.heartbeatFetchFailed) {
                return {
                  label: "取得失敗",
                  isAlert: true,
                  detail: "heartbeat の取得に失敗しました",
                } satisfies CardStatus;
              }

              if (!summary.latestHeartbeatAt) {
                return {
                  label: "異常あり",
                  isAlert: true,
                  detail: `heartbeat は未記録です（${heartbeatRuleText}）`,
                } satisfies CardStatus;
              }

              const ageMinutes = minutesSince(summary.latestHeartbeatAt);
              if (ageMinutes > MONITOR_THRESHOLDS.heartbeatStaleMinutes) {
                return {
                  label: "異常あり",
                  isAlert: true,
                  detail: `最終受信から${ageMinutes}分（${heartbeatRuleText}）`,
                } satisfies CardStatus;
              }

              return {
                label: "正常",
                isAlert: false,
                detail: `最終受信から${ageMinutes}分（${heartbeatRuleText}）`,
              } satisfies CardStatus;
            })();

            const sourceIpText = summary.sourceIpFetchFailed
              ? "取得失敗"
              : (summary.sourceIpSummary?.sourceIp ?? "未記録");
            const sourceIpDetail = summary.sourceIpFetchFailed
              ? "送信元IPの取得に失敗しました"
              : summary.sourceIpSummary
                ? `最終観測: ${formatJstDateTimeMinute(summary.sourceIpSummary.observedAt)} JST`
                : "heartbeat 受信時の送信元IPはまだ記録されていません";

            return (
              <Card
                key={summary.deviceId}
                className="rounded-2xl border-slate-200/80 bg-white/95 shadow-sm"
              >
                <CardHeader className="gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg font-semibold text-slate-900">
                        {summary.label}
                      </CardTitle>
                      <CardDescription>{summary.deviceId}</CardDescription>
                    </div>
                    {heartbeatStatus.isAlert ? (
                      <Badge variant="destructive">
                        {heartbeatStatus.label}
                      </Badge>
                    ) : (
                      <Badge className="border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600">
                        {heartbeatStatus.label}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                        <span className="inline-flex items-center gap-2">
                          <Cpu className="h-4 w-4" />
                          Heartbeat
                        </span>
                      </p>
                      <p className="mt-3 text-lg font-semibold text-slate-900">
                        {summary.latestHeartbeatAt
                          ? formatJstDateTimeMinute(summary.latestHeartbeatAt)
                          : "未記録"}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {heartbeatStatus.detail}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                        <span className="inline-flex items-center gap-2">
                          <Router className="h-4 w-4" />
                          Source IP
                        </span>
                      </p>
                      <p className="mt-3 text-lg font-semibold text-slate-900">
                        {sourceIpText}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {sourceIpDetail}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Link
                      href={buildDeviceDetailHref(
                        "/heartbeats",
                        summary.deviceId,
                      )}
                      className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
                    >
                      Heartbeat履歴
                    </Link>
                    <Link
                      href={buildDeviceDetailHref(
                        "/activities",
                        summary.deviceId,
                      )}
                      className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
                    >
                      Activity履歴
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {isLoading &&
            deviceSummaries.length === 0 &&
            DEVICES.map((device) => (
              <Card
                key={device.id}
                className="rounded-2xl border-slate-200/80 bg-white/95 shadow-sm"
              >
                <CardHeader className="gap-3">
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-24 w-full rounded-xl" />
                  <Skeleton className="h-24 w-full rounded-xl" />
                  <Skeleton className="h-10 w-44 rounded-xl" />
                </CardContent>
              </Card>
            ))}
        </section>
      </main>
    </div>
  );
}
