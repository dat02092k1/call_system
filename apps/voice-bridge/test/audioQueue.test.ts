import { describe, expect, it } from "vitest";
import { BoundedAsyncQueue } from "../src/audioQueue.js";

describe("BoundedAsyncQueue", () => {
  it("drops the oldest queued item when capacity is reached", async () => {
    const queue = new BoundedAsyncQueue<number>(2);
    queue.push(1);
    queue.push(2);
    queue.push(3);

    expect(await queue.shift()).toBe(2);
    expect(await queue.shift()).toBe(3);
    expect(queue.droppedCount).toBe(1);
    expect(queue.size).toBe(0);
  });

  it("delivers a newly pushed item to a waiting consumer", async () => {
    const queue = new BoundedAsyncQueue<string>(1);
    const pending = queue.shift();
    queue.push("audio");

    await expect(pending).resolves.toBe("audio");
  });

  it("drains queued items before returning undefined after close", async () => {
    const queue = new BoundedAsyncQueue<number>(2);
    queue.push(1);
    queue.close();
    queue.close();

    expect(await queue.shift()).toBe(1);
    expect(await queue.shift()).toBeUndefined();
    expect(queue.push(2)).toBe(false);
  });
});
