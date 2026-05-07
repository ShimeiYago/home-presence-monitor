"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Cpu, House, Router } from "lucide-react";
import { DEVICES } from "@home-presence-monitor/config/device";
import { MONITOR_THRESHOLDS } from "@home-presence-monitor/config/monitor";
import { OverviewCard } from "@/components/dashboard/overview-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchActivities,
  fetchDeviceSourceIp,
  fetchLatestHeartbeat,
} from "@/lib/device-api";
import {
  buildDeviceDashboardSnapshot,
  type DeviceDashboardSnapshot,
  type SensorSummary,
} from "@/lib/device-dashboard";
import { buildDeviceDetailPath } from "@/lib/device-selection";
import { resolveApiConfig, type ApiConfig } from "@/lib/runtime-config";
import { buildRange } from "@/lib/time-range";
import { formatJstDateTimeMinute, minutesSince } from "@/lib/time";

type CardStatus = {
  label: string;
  isAlert: boolean;
  detail: string;
};

const buildStatusBadge = (status: CardStatus) =>
  status.isAlert ? (
    <Badge variant="destructive">{status.label}</Badge>
  ) : (
    <Badge className="border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600">
      {status.label}
    </Badge>
  );

export default function Home() {
  const [deviceSnapshots, setDeviceSnapshots] = useState<
    DeviceDashboardSnapshot[]
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const apiConfig = useMemo<ApiConfig>(() => resolveApiConfig(), []);

  const isApiConfigured = Boolean(apiConfig.apiBaseUrl && apiConfig.apiKey);

  const refresh = useCallback(async () => {
    const apiBaseUrl = apiConfig.apiBaseUrl;
    const apiKey = apiConfig.apiKey;

    if (!apiBaseUrl) {
      setErrorMessage("NEXT_PUBLIC_API_BASE_URL が設定されていません。");
      setIsLoading(false);
      return;
    }

    if (!apiKey) {
      setErrorMessage("NEXT_PUBLIC_API_KEY が設定されていません。");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const snapshots = await Promise.all(
      DEVICES.map(async (device) => {
        const [activitiesResult, heartbeatResult, sourceIpResult] =
          await Promise.allSettled([
            fetchActivities(apiBaseUrl, apiKey, device.id, buildRange("1h")),
            fetchLatestHeartbeat(apiBaseUrl, apiKey, device.id),
            fetchDeviceSourceIp(apiBaseUrl, apiKey, device.id),
          ]);

        return buildDeviceDashboardSnapshot(device, {
          activitiesResult,
          heartbeatResult,
          sourceIpResult,
        });
      }),
    );

    setDeviceSnapshots(snapshots);
    setIsLoading(false);
  }, [apiConfig.apiBaseUrl, apiConfig.apiKey]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [refresh]);

  const buildHeartbeatStatus = (
    latestHeartbeatAt: string | null | undefined,
  ): CardStatus => {
    const heartbeatRuleText = `${MONITOR_THRESHOLDS.heartbeatStaleMinutes}分以上未受信で異常`;

    if (isLoading && !latestHeartbeatAt) {
      return {
        label: "確認中",
        isAlert: false,
        detail: "最新 heartbeat を取得中です",
      };
    }

    if (!latestHeartbeatAt) {
      return {
        label: "異常あり",
        isAlert: true,
        detail: `heartbeat は未記録です（${heartbeatRuleText}）`,
      };
    }

    const ageMinutes = minutesSince(latestHeartbeatAt);
    if (ageMinutes > MONITOR_THRESHOLDS.heartbeatStaleMinutes) {
      return {
        label: "異常あり",
        isAlert: true,
        detail: `最終受信から${ageMinutes}分（${heartbeatRuleText}）`,
      };
    }

    return {
      label: "正常",
      isAlert: false,
      detail: `最終受信から${ageMinutes}分（${heartbeatRuleText}）`,
    };
  };

  const buildSensorStatus = (
    sensorSummary: SensorSummary | null | undefined,
  ): CardStatus => {
    if (isLoading && !sensorSummary) {
      return {
        label: "確認中",
        isAlert: false,
        detail: "センサー記録を取得中です",
      };
    }

    if (!sensorSummary) {
      return {
        label: "異常あり",
        isAlert: true,
        detail: "センサー記録の取得に失敗しました",
      };
    }

    if (sensorSummary.recordCount === 0) {
      return {
        label: "異常あり",
        isAlert: true,
        detail: "直近1時間で未記録です",
      };
    }

    if (
      sensorSummary.motionTotal <=
      MONITOR_THRESHOLDS.sensorMotionCountAlertThreshold
    ) {
      return {
        label: "異常あり",
        isAlert: true,
        detail: `直近1時間の合計 ${sensorSummary.motionTotal}回`,
      };
    }

    return {
      label: "正常",
      isAlert: false,
      detail: `直近1時間の合計 ${sensorSummary.motionTotal}回`,
    };
  };

  const buildSourceIpStatus = (
    snapshot: DeviceDashboardSnapshot | undefined,
  ): CardStatus => {
    if (isLoading && !snapshot) {
      return {
        label: "確認中",
        isAlert: false,
        detail: "最新の送信元IPを取得中です",
      };
    }

    if (!snapshot?.sourceIpSummary) {
      return {
        label: "未記録",
        isAlert: true,
        detail: "heartbeat 受信時の送信元IPはまだ記録されていません",
      };
    }

    return {
      label: "記録あり",
      isAlert: false,
      detail: `最終観測: ${formatJstDateTimeMinute(snapshot.sourceIpSummary.observedAt)} JST`,
    };
  };

  const deviceSections = DEVICES.map((device) => {
    const snapshot = deviceSnapshots.find(
      (item) => item.device.id === device.id,
    );
    const heartbeatStatus = buildHeartbeatStatus(snapshot?.latestHeartbeatAt);
    const sensorStatus = buildSensorStatus(snapshot?.sensorSummary);
    const sourceIpStatus = buildSourceIpStatus(snapshot);

    return {
      device,
      snapshot,
      heartbeatStatus,
      sensorStatus,
      sourceIpStatus,
      isHealthy: !heartbeatStatus.isAlert && !sensorStatus.isAlert,
    };
  });

  const householdSummary =
    isLoading && deviceSnapshots.length === 0
      ? {
          label: "確認中",
          isAlert: false,
          detail: "各 device の状態を読み込んでいます",
        }
      : (() => {
          const healthyCount = deviceSections.filter(
            (item) => item.isHealthy,
          ).length;
          if (healthyCount === deviceSections.length) {
            return {
              label: "全device正常",
              isAlert: false,
              detail: `${healthyCount}/${deviceSections.length} device が正常です`,
            };
          }

          return {
            label: "異常あり",
            isAlert: true,
            detail: `${deviceSections.length - healthyCount}/${deviceSections.length} device に異常があります`,
          };
        })();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200 px-4 py-8 text-slate-900 sm:px-6">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="space-y-3">
          <div className="flex items-center gap-3">
            <House className="h-7 w-7 text-slate-700" />
            <h1 className="text-3xl font-semibold tracking-tight">
              活動検知モニター
            </h1>
          </div>
          <p className="text-sm text-slate-600">
            household 全体の状態と、device ごとの heartbeat / activity /
            送信元IP を確認できます。
          </p>
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

        <Card className="rounded-3xl border-slate-200/80 bg-white/90 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle className="text-xl font-semibold text-slate-900">
              Household Summary
            </CardTitle>
            {buildStatusBadge(householdSummary)}
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <p>{householdSummary.detail}</p>
            <p className="font-medium text-slate-500">
              configured devices: {DEVICES.length}
            </p>
          </CardContent>
        </Card>

        <section className="space-y-6">
          {deviceSections.map(
            ({
              device,
              snapshot,
              heartbeatStatus,
              sensorStatus,
              sourceIpStatus,
              isHealthy,
            }) => (
              <section
                key={device.id}
                className="space-y-4 rounded-3xl border border-slate-200/80 bg-white/70 p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
                      {device.id}
                    </p>
                    <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                      {device.name}
                    </h2>
                  </div>
                  <Badge
                    variant={isHealthy ? "outline" : "destructive"}
                    className={
                      isHealthy
                        ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600"
                        : undefined
                    }
                  >
                    {isHealthy ? "正常" : "異常あり"}
                  </Badge>
                </div>

                {snapshot && snapshot.errors.length > 0 && (
                  <Alert variant="destructive">
                    <AlertTitle>{device.name} の取得エラー</AlertTitle>
                    <AlertDescription className="whitespace-pre-wrap">
                      {snapshot.errors.join("\n")}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-4 lg:grid-cols-3">
                  <OverviewCard
                    title="ラズパイ状態"
                    titleIcon={<Cpu className="h-5 w-5 text-slate-600" />}
                    status={buildStatusBadge(heartbeatStatus)}
                    primary={
                      isLoading && !snapshot?.latestHeartbeatAt ? (
                        <Skeleton className="h-8 w-48" />
                      ) : (
                        <span
                          className={
                            heartbeatStatus.isAlert
                              ? "text-red-600"
                              : "text-emerald-600"
                          }
                        >
                          {heartbeatStatus.label}
                        </span>
                      )
                    }
                    secondary={heartbeatStatus.detail}
                    href={buildDeviceDetailPath("/heartbeats", device.id)}
                  />

                  <OverviewCard
                    title="センサー記録"
                    titleIcon={<Activity className="h-5 w-5 text-slate-600" />}
                    description="直近1時間のセンサー検知回数"
                    status={buildStatusBadge(sensorStatus)}
                    primary={
                      isLoading && !snapshot?.sensorSummary ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <span
                          className={
                            sensorStatus.isAlert
                              ? "text-red-600"
                              : "text-emerald-600"
                          }
                        >
                          {snapshot?.sensorSummary?.motionTotal ?? 0} 回
                        </span>
                      )
                    }
                    secondary={sensorStatus.detail}
                    href={buildDeviceDetailPath("/activities", device.id)}
                  />

                  <OverviewCard
                    title="送信元ルーターIP"
                    titleIcon={<Router className="h-5 w-5 text-slate-600" />}
                    status={buildStatusBadge(sourceIpStatus)}
                    primary={
                      isLoading && !snapshot ? (
                        <Skeleton className="h-8 w-40" />
                      ) : (
                        <span
                          className={
                            sourceIpStatus.isAlert
                              ? "text-slate-500"
                              : "text-slate-900"
                          }
                        >
                          {snapshot?.sourceIpSummary?.sourceIp ?? "未記録"}
                        </span>
                      )
                    }
                    secondary={sourceIpStatus.detail}
                  />
                </div>
              </section>
            ),
          )}
        </section>
      </main>
    </div>
  );
}
