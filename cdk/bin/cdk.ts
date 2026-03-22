#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import * as cdk from "aws-cdk-lib";
import { loadSiteConfig } from "../site-config";
import { CdkStack } from "../lib/cdk-stack";

loadDotenv({
  path: resolve(__dirname, "..", ".env"),
});

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const siteConfig = loadSiteConfig();

new CdkStack(app, `${siteConfig.siteNameKey}-CdkStack`, {
  env,
  siteConfig,
});
