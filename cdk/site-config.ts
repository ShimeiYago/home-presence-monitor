import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type SiteConfig = {
  siteNameKey: string;
  domainName?: string;
  hostedZoneDomain?: string;
  certificateArn?: string;
};

const DEFAULT_CONFIG_PATH = resolve(__dirname, "site-config.json");

export function loadSiteConfig(
  configPath: string = DEFAULT_CONFIG_PATH,
): SiteConfig {
  const path = resolve(configPath);

  if (!existsSync(path)) {
    throw new Error(
      `Site config not found at ${path}. Create it from site-config.example.json.`,
    );
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SiteConfig>;

  if (!parsed.siteNameKey) {
    throw new Error('site-config.json must specify "siteNameKey".');
  }

  if (parsed.domainName && !parsed.hostedZoneDomain) {
    throw new Error(
      'site-config.json must specify "hostedZoneDomain" when "domainName" is set.',
    );
  }

  if (!parsed.domainName && parsed.hostedZoneDomain) {
    throw new Error(
      'site-config.json must specify "domainName" when "hostedZoneDomain" is set.',
    );
  }

  return {
    siteNameKey: parsed.siteNameKey,
    domainName: parsed.domainName,
    hostedZoneDomain: parsed.hostedZoneDomain,
    certificateArn: parsed.certificateArn,
  };
}
