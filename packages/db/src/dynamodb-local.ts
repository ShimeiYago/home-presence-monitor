/**
 * DynamoDB Local 用のダミー認証情報。
 *
 * DynamoDB Local は「署名つきリクエスト」を期待するため、AWS SDK / AWS CLI からアクセスする際に
 * 何らかの credential を渡さないと `Unable to locate credentials` で失敗することがあります。
 *
 * これはローカル開発専用です。本番/ステージングでは利用しないでください。
 */
export const dynamodbLocalCredentials = {
  accessKeyId: "local",
  secretAccessKey: "local",
} as const;
