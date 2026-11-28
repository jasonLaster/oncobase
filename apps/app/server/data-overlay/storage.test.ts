import { expect, test } from "bun:test";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { createS3Storage } from "./storage";

test("presigned GETs carry the bucket, key and expiry, and private ones ask S3 not to cache", async () => {
  const calls: { input: unknown; expiresIn: number }[] = [];
  const storage = createS3Storage({ bucket: "bucket-1" }, {
    client: { send: (async () => { throw new Error("presigning must not call S3"); }) as never },
    presign: async (_client, command, { expiresIn }) => {
      expect(command).toBeInstanceOf(GetObjectCommand);
      calls.push({ input: command.input, expiresIn });
      return "https://signed.example/";
    },
  });
  expect(await storage.presignGet("public/a.csv", 900, { private: false })).toBe("https://signed.example/");
  await storage.presignGet("private/curefirst/a.pdf", 300, { private: true });
  expect(calls).toEqual([
    { input: { Bucket: "bucket-1", Key: "public/a.csv" }, expiresIn: 900 },
    { input: { Bucket: "bucket-1", Key: "private/curefirst/a.pdf", ResponseCacheControl: "private, no-store" }, expiresIn: 300 },
  ]);
});

test("readText returns null for a missing object and rethrows other failures", async () => {
  let failure: unknown = Object.assign(new Error("missing"), { name: "NoSuchKey" });
  const storage = createS3Storage({ bucket: "b" }, {
    client: { send: (async (command: GetObjectCommand) => {
      expect(command.input).toEqual({ Bucket: "b", Key: "public/manifest.json" });
      if (failure) throw failure;
      return { Body: { transformToString: async () => "{\"datasets\":[]}" } };
    }) as never },
  });
  expect(await storage.readText("public/manifest.json")).toBeNull();
  failure = Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
  await expect(storage.readText("public/manifest.json")).rejects.toThrow("denied");
  failure = null;
  expect(await storage.readText("public/manifest.json")).toBe("{\"datasets\":[]}");
});

test("list pages through ListObjectsV2 under one prefix and stops at the limit", async () => {
  const inputs: unknown[] = [];
  const pages = [
    { Contents: [{ Key: "private/curefirst/a", Size: 1 }, { Key: "private/curefirst/b", Size: 2 }], IsTruncated: true, NextContinuationToken: "t1" },
    { Contents: [{ Key: "private/curefirst/c", Size: 3, LastModified: new Date(0) }], IsTruncated: false },
  ];
  const storage = createS3Storage({ bucket: "b" }, {
    client: { send: (async (command: ListObjectsV2Command) => {
      expect(command).toBeInstanceOf(ListObjectsV2Command);
      inputs.push(command.input);
      return pages[inputs.length - 1];
    }) as never },
  });
  const all = await storage.list("private/curefirst/", 10);
  expect(all).toEqual({ truncated: false, objects: [
    { key: "private/curefirst/a", bytes: 1, lastModified: null },
    { key: "private/curefirst/b", bytes: 2, lastModified: null },
    { key: "private/curefirst/c", bytes: 3, lastModified: "1970-01-01T00:00:00.000Z" },
  ] });
  expect(inputs).toEqual([
    { Bucket: "b", Prefix: "private/curefirst/", ContinuationToken: undefined, MaxKeys: 11 },
    { Bucket: "b", Prefix: "private/curefirst/", ContinuationToken: "t1", MaxKeys: 9 },
  ]);
  inputs.length = 0;
  const limited = await storage.list("private/curefirst/", 1);
  expect(limited.truncated).toBe(true);
  expect(limited.objects.map(object => object.key)).toEqual(["private/curefirst/a"]);
  expect(inputs).toHaveLength(1);
});
