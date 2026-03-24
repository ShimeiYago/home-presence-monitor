export type RuntimeConfig = {
  NEXT_PUBLIC_API_BASE_URL?: string;
  NEXT_PUBLIC_API_KEY?: string;
};

export type ApiConfig = {
  apiBaseUrl?: string;
  apiKey?: string;
};

const readRuntimeConfig = (): RuntimeConfig => {
  if (typeof window === "undefined") {
    return {};
  }

  return (
    (window as Window & { __HPM_RUNTIME_CONFIG__?: RuntimeConfig })
      .__HPM_RUNTIME_CONFIG__ ?? {}
  );
};

export const resolveApiConfig = (): ApiConfig => {
  const runtimeConfig = readRuntimeConfig();
  const apiBaseUrl = (
    runtimeConfig.NEXT_PUBLIC_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL
  )?.replace(/\/+$/, "");
  const apiKey = (
    runtimeConfig.NEXT_PUBLIC_API_KEY ?? process.env.NEXT_PUBLIC_API_KEY
  )?.trim();

  return {
    apiBaseUrl,
    apiKey: apiKey && apiKey.length > 0 ? apiKey : undefined,
  };
};

type ApiErrorShape = {
  error?: {
    message?: string;
  };
};

export const parseApiErrorMessage = async (
  response: Response,
): Promise<string> => {
  try {
    const data = (await response.json()) as ApiErrorShape;
    if (data.error?.message) {
      return data.error.message;
    }
  } catch {
    // Fallback below
  }

  return `HTTP ${response.status}`;
};
