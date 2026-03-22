# Next.js CDK Static i18n Template

Template repository for a static Next.js app deployed to AWS (S3 + CloudFront via CDK).  
Build the frontend, run deployment command, and you’ll get a multi-language static site served over CloudFront.

## Setup

- Run `npm install` at the repo root to install the workspace dependencies.

## Adding dependencies

Use npm workspaces from the repo root so each package stays isolated:

- Frontend (`front/`): `npm install <package-name> --workspace front` (add `-D` for dev deps).
- CDK (`cdk/`): `npm install <package-name> --workspace cdk` (add `-D` for dev deps).

Running commands from the root keeps the lockfile consistent and avoids manually dropping into each workspace.

## Development

- Start the frontend dev server with `npm run dev:front` (Next.js runs inside `front/`).
- Scaffold UI components via `npm run shadcn:add -- button` (replace `button` with any supported components name).

## Deployment

### Prerequisites

- You can run the AWS CDK CLI against the target account (credentials configured and the account bootstrapped for CDK usage).
- If you want to use a custom domain, the `hostedZoneDomain` must already exist in Route53 within the same AWS account.
- If you want to use a custom domain, a certificate for the domain you will serve (for example `*.example.com`) is issued in the account. Provide its ARN via `cdk/site-config.json` if you want to reuse it; otherwise the stack will request a DNS-validated certificate in `us-east-1` automatically using the hosted zone.

### Steps

0. **One-time prep** – Edit `front/.env` and `cdk/site-config.json`.
   - No custom domain: keep `siteNameKey` only.
   - Custom domain: set `domainName`, `hostedZoneDomain`, and (optionally) `certificateArn`.
1. Run `npm run build:front` to produce the static assets in `front/out`.
2. Run `npm run deploy:cdk` to upload the assets, create/update the CloudFront distribution, and (if configured) publish the DNS records.

The CDK deployment prints the CloudFront domain and S3 bucket name as stack outputs; use them for verification or DNS troubleshooting.

### Destroying the stack

- Run `npm run destroy:cdk` to tear down the CloudFront distribution, S3 bucket, and supporting Route53/CERT resources.
- CDK will prompt for confirmation; add `-- --force` after the command if you need to skip the prompt (for example `npm run destroy:cdk -- --force`).
