"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Cpu, House, Router } from "lucide-react";
import { DEVICE_IDS } from "@home-presence-monitor/config/device";
import type { GetDeviceSourceIpResponse } from "@home-presence-monitor/contracts/api";
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
import { resolveApiConfig, type ApiConfig } from "@/lib/runtime-config";
import { buildRange } from "@/lib/time-range";
import { formatJstDateTimeMinute, minutesSince } from "@/lib/time";

type SensorSummary = {
  recordCount: number;
  motionTotal: number;
};

type SourceIpSummary = GetDeviceSourceIpResponse | null;

type CardStatus = {
  label: string;
  isAlert: boolean;
  detail: string;
};

export default function Home() {
  const selectedDevice = DEVICE_IDS[0] ?? "";
  const [latestHeartbeatAt, setLatestHeartbeatAt] = useState<string | null>(
    null,
  );
  const [sensorSummary, setSensorSummary] = useState<SensorSummary | null>(
    null,
  );
  const [sourceIpSummary, setSourceIpSummary] = useState<SourceIpSummary>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const apiConfig = useMemo<ApiConfig>(() => resolveApiConfig(), []);

  const isApiConfigured = Boolean(apiConfig.apiBaseUrl && apiConfig.apiKey);

  const refresh = useCallback(async () => {
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

    if (!selectedDevice) {
      setErrorMessage("deviceId が見つかりません。");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const [activitiesResult, heartbeatResult, sourceIpResult] =
      await Promise.allSettled([
        fetchActivities(
          apiConfig.apiBaseUrl,
          apiConfig.apiKey,
          selectedDevice,
          buildRange("1h"),
        ),
        fetchLatestHeartbeat(
          apiConfig.apiBaseUrl,
          apiConfig.apiKey,
          selectedDevice,
        ),
        fetchDeviceSourceIp(
          apiConfig.apiBaseUrl,
          apiConfig.apiKey,
          selectedDevice,
        ),
      ]);

    const errors: string[] = [];

    if (activitiesResult.status === "fulfilled") {
      const { activities } = activitiesResult.value;
      const motionTotal = activities.reduce(
        (sum, activity) => sum + activity.motionCount,
        0,
      );
      setSensorSummary({
        recordCount: activities.length,
        motionTotal,
      });
    } else {
      setSensorSummary(null);
      errors.push(
        `Activities取得失敗: ${activitiesResult.reason instanceof Error ? activitiesResult.reason.message : String(activitiesResult.reason)}`,
      );
    }

    if (heartbeatResult.status === "fulfilled") {
      setLatestHeartbeatAt(heartbeatResult.value?.lastHeartbeatAt ?? null);
    } else {
      setLatestHeartbeatAt(null);
      errors.push(
        `Heartbeat取得失敗: ${heartbeatResult.reason instanceof Error ? heartbeatResult.reason.message : String(heartbeatResult.reason)}`,
      );
    }

    if (sourceIpResult.status === "fulfilled") {
      setSourceIpSummary(sourceIpResult.value);
    } else {
      setSourceIpSummary(null);
      errors.push(
        `送信元IP取得失敗: ${sourceIpResult.reason instanceof Error ? sourceIpResult.reason.message : String(sourceIpResult.reason)}`,
      );
    }

    if (errors.length > 0) {
      setErrorMessage(errors.join("\n"));
    }

    setIsLoading(false);
  }, [apiConfig.apiBaseUrl, apiConfig.apiKey, selectedDevice]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [refresh]);

  const heartbeatStatus = useMemo<CardStatus>(() => {
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
  }, [isLoading, latestHeartbeatAt]);

  const sensorStatus = useMemo<CardStatus>(() => {
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
  }, [isLoading, sensorSummary]);

  const sourceIpStatus = useMemo<CardStatus>(() => {
    if (isLoading && sourceIpSummary === null) {
      return {
        label: "確認中",
        isAlert: false,
        detail: "最新の送信元IPを取得中です",
      };
    }

    if (!sourceIpSummary) {
      return {
        label: "未記録",
        isAlert: true,
        detail: "heartbeat 受信時の送信元IPはまだ記録されていません",
      };
    }

    return {
      label: "記録あり",
      isAlert: false,
      detail: `最終観測: ${formatJstDateTimeMinute(sourceIpSummary.observedAt)} JST`,
    };
  }, [isLoading, sourceIpSummary]);

  const heartbeatPrimary =
    isLoading && !latestHeartbeatAt ? (
      <Skeleton className="h-8 w-48" />
    ) : (
      <span
        className={
          heartbeatStatus.isAlert ? "text-red-600" : "text-emerald-600"
        }
      >
        {heartbeatStatus.label}
      </span>
    );

  const sensorPrimary =
    isLoading && !sensorSummary ? (
      <Skeleton className="h-8 w-24" />
    ) : (
      <span
        className={sensorStatus.isAlert ? "text-red-600" : "text-emerald-600"}
      >
        {sensorSummary?.motionTotal ?? 0} 回
      </span>
    );

  const sourceIpPrimary =
    isLoading && sourceIpSummary === null ? (
      <Skeleton className="h-8 w-40" />
    ) : (
      <span
        className={sourceIpStatus.isAlert ? "text-slate-500" : "text-slate-900"}
      >
        {sourceIpSummary?.sourceIp ?? "未記録"}
      </span>
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
            description="直近1時間のセンサー検知回数"
            status={
              sensorStatus.isAlert ? (
                <Badge variant="destructive">{sensorStatus.label}</Badge>
              ) : (
                <Badge className="border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600">
                  {sensorStatus.label}
                </Badge>
              )
            }
            primary={sensorPrimary}
            secondary={sensorStatus.detail}
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
            secondary={sourceIpStatus.detail}
          />
        </section>
      </main>
    </div>
  );
}
