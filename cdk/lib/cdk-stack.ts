import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  aws_apigateway as apigateway,
  aws_chatbot as chatbot,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_dynamodb as dynamodb,
  aws_events as events,
  aws_events_targets as eventsTargets,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as lambdaNodejs,
  aws_route53 as route53,
  aws_route53_targets as route53Targets,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  aws_sns as sns,
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  StackProps,
  Tags,
  custom_resources as cr,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { SiteConfig } from "../site-config";

const SITE_BUILD_PATH = resolve(
  __dirname,
  "..",
  "..",
  "services",
  "front",
  "out",
);
const API_ENTRY_PATH = resolve(
  __dirname,
  "..",
  "..",
  "services",
  "api",
  "src",
  "lambda",
  "handler.ts",
);
const API_TSCONFIG_PATH = resolve(
  __dirname,
  "..",
  "..",
  "services",
  "api",
  "tsconfig.json",
);
const JOB_ENTRY_PATH = resolve(
  __dirname,
  "..",
  "..",
  "services",
  "job",
  "handdler.ts",
);
const JOB_TSCONFIG_PATH = resolve(
  __dirname,
  "..",
  "..",
  "services",
  "job",
  "tsconfig.json",
);
const DB_SCHEMA_MODULE_PATH = resolve(
  __dirname,
  "..",
  "..",
  "packages",
  "db",
  "src",
  "schema",
);
const DDB_TABLE_ENV = "production";

interface SiteStackProps extends StackProps {
  siteConfig: SiteConfig;
}

type DdbAttributeType = "S" | "N" | "B";

type DdbTableSchema = {
  keySchema: {
    partitionKey: string;
    sortKey?: string;
  };
  globalSecondaryIndexes?: Array<{
    indexName: string;
    partitionKey: string;
    sortKey?: string;
  }>;
  ttlEnabled?: boolean;
};

type DdbSchemaModule = {
  buildDdbTableName: (env: string, schemaKey: string) => string;
  ddbTableSchemas: Record<string, DdbTableSchema>;
  resolveDdbAttributeType: (attributeName: string) => DdbAttributeType;
};

const loadDdbSchemaModule = (): DdbSchemaModule =>
  require(DB_SCHEMA_MODULE_PATH) as DdbSchemaModule;

const toCdkAttributeType = (type: DdbAttributeType): dynamodb.AttributeType => {
  switch (type) {
    case "N":
      return dynamodb.AttributeType.NUMBER;
    case "B":
      return dynamodb.AttributeType.BINARY;
    case "S":
    default:
      return dynamodb.AttributeType.STRING;
  }
};

const buildDdbAttribute = (
  attributeName: string,
  resolveAttributeType: (attributeName: string) => DdbAttributeType,
): dynamodb.Attribute => ({
  name: attributeName,
  type: toCdkAttributeType(resolveAttributeType(attributeName)),
});

export class CdkStack extends Stack {
  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);
    Tags.of(this).add("Product", "home-presence-monitor");

    const { domainName, hostedZoneDomain, certificateArn, siteNameKey } =
      props.siteConfig;
    const hasCustomDomain = Boolean(domainName && hostedZoneDomain);

    if (hasCustomDomain && !domainName!.endsWith(hostedZoneDomain!)) {
      throw new Error(
        `The provided domainName (${domainName}) must be contained within hostedZoneDomain (${hostedZoneDomain}).`,
      );
    }

    if (!existsSync(SITE_BUILD_PATH)) {
      throw new Error(
        `Static assets not found at ${SITE_BUILD_PATH}. Run "npm run build:front" before deploying the CDK stack.`,
      );
    }

    if (!existsSync(API_ENTRY_PATH)) {
      throw new Error(
        `API Lambda entrypoint not found at ${API_ENTRY_PATH}. Confirm services/api/src/lambda/handler.ts exists.`,
      );
    }

    if (!existsSync(JOB_ENTRY_PATH)) {
      throw new Error(
        `Job Lambda entrypoint not found at ${JOB_ENTRY_PATH}. Confirm services/job/handdler.ts exists.`,
      );
    }

    if (!existsSync(JOB_TSCONFIG_PATH)) {
      throw new Error(
        `Job Lambda tsconfig not found at ${JOB_TSCONFIG_PATH}. Confirm services/job/tsconfig.json exists.`,
      );
    }

    const basicAuthUsername = process.env.CLOUDFRONT_BASIC_AUTH_USERNAME;
    const basicAuthPassword = process.env.CLOUDFRONT_BASIC_AUTH_PASSWORD;
    const slackChannelId = "C0AN31Z2ML7";
    const slackWorkspaceId = "T0ANXC5475F";

    if (!basicAuthUsername || !basicAuthPassword) {
      throw new Error(
        "CLOUDFRONT_BASIC_AUTH_USERNAME and CLOUDFRONT_BASIC_AUTH_PASSWORD must be set (recommended: cdk/.env) before CDK synth/deploy.",
      );
    }

    const expectedAuthorizationHeader = `Basic ${Buffer.from(
      `${basicAuthUsername}:${basicAuthPassword}`,
      "utf8",
    ).toString("base64")}`;

    const hostedZone = hasCustomDomain
      ? route53.HostedZone.fromLookup(this, "HostedZone", {
          domainName: hostedZoneDomain!,
        })
      : undefined;

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(
      this,
      "SiteOAI",
      {
        comment: `Access identity for ${domainName ?? siteNameKey}`,
      },
    );
    siteBucket.grantRead(originAccessIdentity);

    const certificate = hasCustomDomain
      ? certificateArn
        ? acm.Certificate.fromCertificateArn(
            this,
            "ImportedCertificate",
            certificateArn,
          )
        : new acm.DnsValidatedCertificate(this, "SiteCertificate", {
            domainName: domainName!,
            hostedZone: hostedZone!,
            region: "us-east-1",
          })
      : undefined;

    const cleanUrlFunction = new cloudfront.Function(this, "CleanUrlFunction", {
      code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  var headers = request.headers || {};
  var authorizationHeader =
    headers.authorization && headers.authorization.value;
  var expectedAuthorizationHeader = ${JSON.stringify(expectedAuthorizationHeader)};

  if (authorizationHeader !== expectedAuthorizationHeader) {
    return {
      statusCode: 401,
      statusDescription: 'Unauthorized',
      headers: {
        'www-authenticate': {
          value: 'Basic realm="HomePresenceMonitor"'
        },
        'cache-control': {
          value: 'no-store'
        }
      }
    };
  }

  var uri = request.uri || '/';

  if (!uri.includes('.')) {
    if (uri.slice(-1) === '/') {
      uri = uri.slice(0, -1);
    }
    if (uri === '') {
      uri = '/';
    } else {
      uri += '.html';
      request.uri = uri;
    }
  }

  return request;
}`),
    });

    const distribution = new cloudfront.Distribution(this, "SiteDistribution", {
      comment: siteNameKey,
      defaultRootObject: "index.html",
      domainNames: hasCustomDomain ? [domainName!] : undefined,
      certificate: hasCustomDomain ? certificate : undefined,
      minimumProtocolVersion: hasCustomDomain
        ? cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021
        : undefined,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: new origins.S3Origin(siteBucket, { originAccessIdentity }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        functionAssociations: [
          {
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            function: cleanUrlFunction,
          },
        ],
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: "/404.html",
          ttl: Duration.minutes(5),
        },
      ],
    });

    if (hasCustomDomain) {
      const recordName =
        domainName === hostedZoneDomain
          ? undefined
          : domainName!.replace(`.${hostedZoneDomain}`, "");

      const aliasTarget = route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution),
      );

      new route53.ARecord(this, "SiteAliasRecord", {
        zone: hostedZone!,
        recordName,
        target: aliasTarget,
      });

      new route53.AaaaRecord(this, "SiteAliasRecordIpv6", {
        zone: hostedZone!,
        recordName,
        target: aliasTarget,
      });
    }

    const staticSiteDeployment = new s3deploy.BucketDeployment(
      this,
      "StaticSiteDeployment",
      {
        sources: [s3deploy.Source.asset(SITE_BUILD_PATH)],
        destinationBucket: siteBucket,
        distribution,
        distributionPaths: ["/*"],
      },
    );

    const frontOrigins = hasCustomDomain
      ? [
          `https://${domainName!}`,
          `https://${distribution.distributionDomainName}`,
        ]
      : [`https://${distribution.distributionDomainName}`];

    const { buildDdbTableName, ddbTableSchemas, resolveDdbAttributeType } =
      loadDdbSchemaModule();

    const nodeEnv = String(
      this.node.tryGetContext("nodeEnv") ??
        process.env.NODE_ENV ??
        "production",
    );

    const tableEntries = Object.entries(ddbTableSchemas);
    const tables: dynamodb.Table[] = [];
    const tablesBySchemaKey: Record<string, dynamodb.Table> = {};

    for (const [schemaKey, schema] of tableEntries) {
      const table = new dynamodb.Table(this, `${schemaKey}Table`, {
        tableName: buildDdbTableName(DDB_TABLE_ENV, schemaKey),
        partitionKey: buildDdbAttribute(
          schema.keySchema.partitionKey,
          resolveDdbAttributeType,
        ),
        ...(schema.keySchema.sortKey
          ? {
              sortKey: buildDdbAttribute(
                schema.keySchema.sortKey,
                resolveDdbAttributeType,
              ),
            }
          : {}),
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        timeToLiveAttribute: schema.ttlEnabled ? "ttl" : undefined,
        encryption: dynamodb.TableEncryption.AWS_MANAGED,
        removalPolicy: RemovalPolicy.RETAIN,
      });

      for (const gsi of schema.globalSecondaryIndexes ?? []) {
        table.addGlobalSecondaryIndex({
          indexName: gsi.indexName,
          partitionKey: buildDdbAttribute(
            gsi.partitionKey,
            resolveDdbAttributeType,
          ),
          ...(gsi.sortKey
            ? {
                sortKey: buildDdbAttribute(
                  gsi.sortKey,
                  resolveDdbAttributeType,
                ),
              }
            : {}),
          projectionType: dynamodb.ProjectionType.ALL,
        });
      }

      tables.push(table);
      tablesBySchemaKey[schemaKey] = table;
    }

    const apiFunction = new lambdaNodejs.NodejsFunction(this, "ApiFunction", {
      entry: API_ENTRY_PATH,
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(15),
      bundling: {
        format: lambdaNodejs.OutputFormat.CJS,
        target: "node20",
        sourceMap: true,
        tsconfig: API_TSCONFIG_PATH,
      },
      environment: {
        NODE_ENV: nodeEnv,
        CORS_ALLOWED_ORIGINS: Fn.join(",", frontOrigins),
      },
    });

    const heartbeatsTable = tablesBySchemaKey.HEARTBEATS;
    const activitiesTable = tablesBySchemaKey.ACTIVITIES;
    const monitorStatesTable = tablesBySchemaKey.MONITOR_STATES;

    if (!heartbeatsTable || !activitiesTable || !monitorStatesTable) {
      throw new Error(
        "Required tables (HEARTBEATS, ACTIVITIES, MONITOR_STATES) were not initialized.",
      );
    }

    heartbeatsTable.grantReadWriteData(apiFunction);
    activitiesTable.grantReadWriteData(apiFunction);

    const monitorAlertTopic = new sns.Topic(this, "MonitorAlertTopic", {
      topicName: `${siteNameKey}-monitor-alerts`,
    });

    new chatbot.SlackChannelConfiguration(this, "MonitorSlackChannel", {
      slackChannelConfigurationName: `${siteNameKey}-monitor-alerts`,
      slackWorkspaceId,
      slackChannelId,
      notificationTopics: [monitorAlertTopic],
      loggingLevel: chatbot.LoggingLevel.ERROR,
      guardrailPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("ReadOnlyAccess"),
      ],
    });

    const monitorJobFunction = new lambdaNodejs.NodejsFunction(
      this,
      "MonitorJobFunction",
      {
        entry: JOB_ENTRY_PATH,
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout: Duration.seconds(15),
        bundling: {
          format: lambdaNodejs.OutputFormat.CJS,
          target: "node20",
          sourceMap: true,
          tsconfig: JOB_TSCONFIG_PATH,
        },
        environment: {
          NODE_ENV: DDB_TABLE_ENV,
          ALERT_TOPIC_ARN: monitorAlertTopic.topicArn,
          FRONTEND_URL: `https://${distribution.distributionDomainName}`,
        },
      },
    );

    heartbeatsTable.grantReadData(monitorJobFunction);
    activitiesTable.grantReadData(monitorJobFunction);
    monitorStatesTable.grantReadWriteData(monitorJobFunction);
    monitorAlertTopic.grantPublish(monitorJobFunction);

    const monitorJobRule = new events.Rule(this, "MonitorJobRule", {
      schedule: events.Schedule.rate(Duration.minutes(5)),
    });
    monitorJobRule.addTarget(
      new eventsTargets.LambdaFunction(monitorJobFunction),
    );

    const apiGateway = new apigateway.RestApi(this, "ApiGateway", {
      restApiName: `${siteNameKey}-Api`,
      deployOptions: {
        stageName: "prod",
      },
      defaultCorsPreflightOptions: {
        allowOrigins: frontOrigins,
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization", "x-api-key"],
        allowCredentials: true,
      },
    });

    const apiIntegration = new apigateway.LambdaIntegration(apiFunction);

    const healthzResource = apiGateway.root.addResource("healthz");
    healthzResource.addMethod("GET", apiIntegration, { apiKeyRequired: true });

    const v1Resource = apiGateway.root.addResource("v1");
    const devicesResource = v1Resource.addResource("devices");
    const deviceIdResource = devicesResource.addResource("{deviceId}");

    const activitiesResource = deviceIdResource.addResource("activities");
    activitiesResource.addMethod("GET", apiIntegration, {
      apiKeyRequired: true,
    });
    activitiesResource.addMethod("POST", apiIntegration, {
      apiKeyRequired: true,
    });

    const heartbeatsResource = deviceIdResource.addResource("heartbeats");
    heartbeatsResource.addMethod("GET", apiIntegration, {
      apiKeyRequired: true,
    });
    heartbeatsResource.addMethod("POST", apiIntegration, {
      apiKeyRequired: true,
    });

    const latestHeartbeatResource = heartbeatsResource.addResource("latest");
    latestHeartbeatResource.addMethod("GET", apiIntegration, {
      apiKeyRequired: true,
    });

    const apiKey = apiGateway.addApiKey("ApiKey", {
      apiKeyName: `${siteNameKey}-ApiKey`,
    });

    const usagePlan = apiGateway.addUsagePlan("ApiUsagePlan", {
      name: `${siteNameKey}-UsagePlan`,
    });
    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({
      stage: apiGateway.deploymentStage,
    });

    const apiKeyValueReader = new cr.AwsCustomResource(
      this,
      "ApiKeyValueReader",
      {
        onCreate: {
          service: "APIGateway",
          action: "getApiKey",
          parameters: {
            apiKey: apiKey.keyId,
            includeValue: true,
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            `${siteNameKey}-ApiKeyValue`,
          ),
        },
        onUpdate: {
          service: "APIGateway",
          action: "getApiKey",
          parameters: {
            apiKey: apiKey.keyId,
            includeValue: true,
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            `${siteNameKey}-ApiKeyValue`,
          ),
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ["apigateway:GET"],
            resources: ["*"],
          }),
        ]),
      },
    );

    const runtimeConfigBody = Fn.join("", [
      "window.__HPM_RUNTIME_CONFIG__ = ",
      Stack.of(this).toJsonString({
        NEXT_PUBLIC_API_BASE_URL: apiGateway.url,
        NEXT_PUBLIC_API_KEY: apiKeyValueReader.getResponseField("value"),
      }),
      ";\n",
    ]);
    const runtimeConfigRevision = `${Date.now()}`;

    const runtimeConfigWriter = new cr.AwsCustomResource(
      this,
      "RuntimeConfigWriter",
      {
        onCreate: {
          service: "S3",
          action: "putObject",
          parameters: {
            Bucket: siteBucket.bucketName,
            Key: "runtime-config.js",
            Body: runtimeConfigBody,
            ContentType: "application/javascript; charset=utf-8",
            CacheControl: "no-store, max-age=0",
            Metadata: {
              revision: runtimeConfigRevision,
            },
          },
          physicalResourceId: cr.PhysicalResourceId.fromResponse("ETag"),
        },
        onUpdate: {
          service: "S3",
          action: "putObject",
          parameters: {
            Bucket: siteBucket.bucketName,
            Key: "runtime-config.js",
            Body: runtimeConfigBody,
            ContentType: "application/javascript; charset=utf-8",
            CacheControl: "no-store, max-age=0",
            Metadata: {
              revision: runtimeConfigRevision,
            },
          },
          physicalResourceId: cr.PhysicalResourceId.fromResponse("ETag"),
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ["s3:PutObject"],
            resources: [siteBucket.arnForObjects("runtime-config.js")],
          }),
        ]),
      },
    );

    runtimeConfigWriter.node.addDependency(staticSiteDeployment);
    runtimeConfigWriter.node.addDependency(apiKeyValueReader);

    const runtimeConfigInvalidator = new cr.AwsCustomResource(
      this,
      "RuntimeConfigInvalidator",
      {
        onCreate: {
          service: "CloudFront",
          action: "createInvalidation",
          parameters: {
            DistributionId: distribution.distributionId,
            InvalidationBatch: {
              CallerReference: `${siteNameKey}-runtime-config-${Date.now()}`,
              Paths: {
                Quantity: 1,
                Items: ["/runtime-config.js"],
              },
            },
          },
          physicalResourceId:
            cr.PhysicalResourceId.fromResponse("Invalidation.Id"),
        },
        onUpdate: {
          service: "CloudFront",
          action: "createInvalidation",
          parameters: {
            DistributionId: distribution.distributionId,
            InvalidationBatch: {
              CallerReference: `${siteNameKey}-runtime-config-${Date.now()}`,
              Paths: {
                Quantity: 1,
                Items: ["/runtime-config.js"],
              },
            },
          },
          physicalResourceId:
            cr.PhysicalResourceId.fromResponse("Invalidation.Id"),
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
      },
    );

    runtimeConfigInvalidator.node.addDependency(runtimeConfigWriter);

    new CfnOutput(this, "CloudFrontDomain", {
      value: distribution.distributionDomainName,
    });

    new CfnOutput(this, "SiteBucketName", {
      value: siteBucket.bucketName,
    });

    new CfnOutput(this, "ApiBaseUrl", {
      value: apiGateway.url,
    });

    new CfnOutput(this, "ApiKeyId", {
      value: apiKey.keyId,
    });
  }
}
