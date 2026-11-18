import { expect, test } from "bun:test";
import { WorkQueue } from "./work-queue";

const tick = () => new Promise(resolve => setTimeout(resolve, 1));

test("workers start on items as they arrive and respect the limit", async () => {
  const queue = new WorkQueue<number>();
  const seen: number[] = [];
  let active = 0, peak = 0;
  const drained = queue.drain(2, async item => {
    active++; peak = Math.max(peak, active);
    await tick();
    seen.push(item);
    active--;
  });
  queue.push(1);
  await tick(); await tick();
  expect(seen).toEqual([1]); // Processed before the producer finished.
  for (const item of [2, 3, 4, 5]) queue.push(item);
  queue.close();
  await drained;
  expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  expect(peak).toBe(2);
});

test("an empty closed queue drains immediately", async () => {
  const queue = new WorkQueue<number>();
  queue.close();
  await queue.drain(4, async () => { throw Error("no items"); });
});

test("a worker failure stops intake and rejects drain", async () => {
  const queue = new WorkQueue<number>();
  const seen: number[] = [];
  for (const item of [1, 2, 3]) queue.push(item);
  const drained = queue.drain(1, async item => {
    if (item === 2) throw Error("upload failed");
    seen.push(item);
  });
  await expect(drained).rejects.toThrow("upload failed");
  queue.push(4); // Ignored after failure, never throws at the producer.
  expect(seen).toEqual([1]);
  expect(queue.failed).toBe(true);
});

test("a producer failure rejects drain with the producer's error", async () => {
  const queue = new WorkQueue<number>();
  const drained = queue.drain(2, async () => {});
  queue.push(1);
  queue.fail(Error("embedding failed"));
  await expect(drained).rejects.toThrow("embedding failed");
});
