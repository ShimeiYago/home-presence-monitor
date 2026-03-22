import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_route53 as route53,
  aws_route53_targets as route53Targets,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
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

interface SiteStackProps extends StackProps {
  siteConfig: SiteConfig;
}

export class CdkStack extends Stack {
  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);

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

    new s3deploy.BucketDeployment(this, "StaticSiteDeployment", {
      sources: [s3deploy.Source.asset(SITE_BUILD_PATH)],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    new CfnOutput(this, "CloudFrontDomain", {
      value: distribution.distributionDomainName,
    });

    new CfnOutput(this, "SiteBucketName", {
      value: siteBucket.bucketName,
    });
  }
}
