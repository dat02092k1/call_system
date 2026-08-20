import { describe, expect, it } from "vitest";
import {
  StreamingLinearResampler,
  float32ToPcm16,
} from "../asterisk/pcm";

describe("Asterisk browser PCM", () => {
  it("clamps Float32 samples into signed PCM16", () => {
    expect(Array.from(float32ToPcm16(new Float32Array([-2, -1, 0, 1, 2])))).toEqual([
      -32768,
      -32768,
      0,
      32767,
      32767,
    ]);
  });

  it("keeps resampling phase across microphone chunks", () => {
    const source = Float32Array.from(
      { length: 480 },
      (_, index) => Math.sin((index / 480) * Math.PI * 4),
    );
    const resampler = new StreamingLinearResampler(48_000, 16_000);
    const chunks = [
      resampler.process(source.slice(0, 127)),
      resampler.process(source.slice(127, 311)),
      resampler.process(source.slice(311)),
    ];
    const result = Float32Array.from(chunks.flatMap((chunk) => Array.from(chunk)));

    expect(result.length).toBe(160);
    expect(result[0]).toBeCloseTo(source[0], 5);
    expect(result[159]).toBeCloseTo(source[477], 5);
  });

  it("rejects invalid sample rates", () => {
    expect(() => new StreamingLinearResampler(0, 16_000)).toThrow(/sample rate/);
  });
});
