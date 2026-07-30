import { describe, expect, test } from "bun:test";
import {
  buildCentralDirectory,
  mapWithConcurrency,
} from "../workflows/build-download-cache";

const entry = {
  name: "asset.bin",
  crc32: 0x12345678,
  compressedSize: 4,
  uncompressedSize: 4,
  localHeaderOffset: 100,
  dosTime: 0,
  dosDate: 0x5821,
};

describe("download archive central directory", () => {
  test("keeps small archives in ZIP32 format", () => {
    const directory = buildCentralDirectory([entry], 200);
    const recordLength = 46 + Buffer.byteLength(entry.name);

    expect(directory.readUInt32LE(0)).toBe(0x02014b50);
    expect(directory.readUInt16LE(6)).toBe(20);
    expect(directory.readUInt16LE(30)).toBe(0);
    expect(directory.readUInt32LE(42)).toBe(entry.localHeaderOffset);
    expect(directory.readUInt32LE(recordLength)).toBe(0x06054b50);
  });

  test("writes ZIP64 offsets when the archive passes 4 GiB", () => {
    const largeOffset = 0x1_0000_0000 + 123;
    const directory = buildCentralDirectory(
      [{ ...entry, localHeaderOffset: largeOffset }],
      largeOffset + 500,
    );
    const nameLength = Buffer.byteLength(entry.name);
    const recordLength = 46 + nameLength + 12;
    const zip64EndOffset = recordLength;
    const locatorOffset = zip64EndOffset + 56;
    const endOffset = locatorOffset + 20;

    expect(directory.readUInt16LE(6)).toBe(45);
    expect(directory.readUInt16LE(30)).toBe(12);
    expect(directory.readUInt32LE(42)).toBe(0xffffffff);
    expect(directory.readUInt16LE(46 + nameLength)).toBe(0x0001);
    expect(directory.readUInt16LE(48 + nameLength)).toBe(8);
    expect(directory.readBigUInt64LE(50 + nameLength)).toBe(
      BigInt(largeOffset),
    );

    expect(directory.readUInt32LE(zip64EndOffset)).toBe(0x06064b50);
    expect(directory.readBigUInt64LE(zip64EndOffset + 48)).toBe(
      BigInt(largeOffset + 500),
    );
    expect(directory.readUInt32LE(locatorOffset)).toBe(0x07064b50);
    expect(directory.readBigUInt64LE(locatorOffset + 8)).toBe(
      BigInt(largeOffset + 500 + recordLength),
    );
    expect(directory.readUInt32LE(endOffset)).toBe(0x06054b50);
    expect(directory.readUInt32LE(endOffset + 16)).toBe(0xffffffff);
  });
});

describe("download archive asset fetching", () => {
  test("bounds concurrency and preserves result order", async () => {
    let active = 0;
    let maxActive = 0;
    const values = Array.from({ length: 20 }, (_, index) => index);

    const results = await mapWithConcurrency(values, 3, async (value) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Bun.sleep(1);
      active--;
      return value * 2;
    });

    expect(maxActive).toBe(3);
    expect(results).toEqual(values.map((value) => value * 2));
  });
});
