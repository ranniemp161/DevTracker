import { S3Client } from '@aws-sdk/client-s3';

export function r2StorageConfig() {
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_TASK_MEDIA_BUCKET,
    TASK_MEDIA_CDN_ORIGIN,
    TASK_MEDIA_CDN_SECRET,
  } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_TASK_MEDIA_BUCKET)
    return null;
  return {
    bucket: R2_TASK_MEDIA_BUCKET,
    cdn:
      TASK_MEDIA_CDN_ORIGIN && TASK_MEDIA_CDN_SECRET
        ? { origin: TASK_MEDIA_CDN_ORIGIN, secret: TASK_MEDIA_CDN_SECRET }
        : null,
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    }),
  };
}
