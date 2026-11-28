// S3 access for the overlay: presigned GETs, the public manifest and
// per-prefix listings. The AWS SDK is imported only here, and this module is
// loaded lazily, so it never enters the HTML or API startup bundles.

import { GetObjectCommand, ListObjectsV2Command, S3Client, type ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DataOverlayS3Config } from "./config";

export type DataObjectSummary = { key: string; bytes: number; lastModified: string | null };

export interface DataOverlayStorage {
  /** A presigned GET URL for `key`. Private objects also ask S3 to answer
   * with `Cache-Control: private, no-store`. */
  presignGet(key: string, expiresInSeconds: number, options: { private: boolean }): Promise<string>;
  /** The object's text, or null when it does not exist. */
  readText(key: string): Promise<string | null>;
  /** Objects under `prefix`, at most `limit`, and whether more exist. */
  list(prefix: string, limit: number): Promise<{ objects: DataObjectSummary[]; truncated: boolean }>;
}

type SendClient = Pick<S3Client, "send">;
type Presigner = (client: SendClient, command: GetObjectCommand, options: { expiresIn: number }) => Promise<string>;

function isMissing(error: unknown) {
  const name = (error as { name?: string } | null)?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

export function createS3Storage(
  config: Pick<DataOverlayS3Config, "bucket">,
  {
    client,
    presign = getSignedUrl as unknown as Presigner,
  }: { client: SendClient; presign?: Presigner },
): DataOverlayStorage {
  const Bucket = config.bucket;
  return {
    presignGet(key, expiresInSeconds, options) {
      const command = new GetObjectCommand({
        Bucket,
        Key: key,
        ...(options.private ? { ResponseCacheControl: "private, no-store" } : {}),
      });
      return presign(client, command, { expiresIn: expiresInSeconds });
    },
    async readText(key) {
      try {
        const output = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return (await output.Body?.transformToString("utf-8")) ?? "";
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async list(prefix, limit) {
      const objects: DataObjectSummary[] = [];
      let token: string | undefined;
      do {
        const output: ListObjectsV2CommandOutput = await client.send(new ListObjectsV2Command({
          Bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: Math.min(1000, limit - objects.length + 1),
        }));
        for (const item of output.Contents ?? []) {
          if (!item.Key) continue;
          objects.push({ key: item.Key, bytes: item.Size ?? 0, lastModified: item.LastModified?.toISOString() ?? null });
        }
        token = output.IsTruncated ? output.NextContinuationToken : undefined;
      } while (token && objects.length <= limit);
      const truncated = objects.length > limit || Boolean(token);
      return { objects: objects.slice(0, limit), truncated };
    },
  };
}

export function createS3StorageFromConfig(config: DataOverlayS3Config): DataOverlayStorage {
  const client = new S3Client({
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return createS3Storage(config, { client });
}
