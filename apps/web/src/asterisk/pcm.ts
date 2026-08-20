export function float32ToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0
      ? Math.round(sample * 0x8000)
      : Math.round(sample * 0x7fff);
  }
  return output;
}

export class StreamingLinearResampler {
  private readonly ratio: number;
  private previousSample?: number;
  private nextPosition = 0;

  constructor(inputRate: number, outputRate: number) {
    if (
      !Number.isFinite(inputRate) ||
      !Number.isFinite(outputRate) ||
      inputRate <= 0 ||
      outputRate <= 0
    ) {
      throw new Error("Input and output sample rate must be positive");
    }
    this.ratio = inputRate / outputRate;
  }

  process(input: Float32Array): Float32Array {
    if (input.length === 0) return new Float32Array();

    let samples: Float32Array;
    if (this.previousSample === undefined) {
      samples = input;
    } else {
      samples = new Float32Array(input.length + 1);
      samples[0] = this.previousSample;
      samples.set(input, 1);
    }

    const output: number[] = [];
    while (this.nextPosition < samples.length) {
      const left = Math.floor(this.nextPosition);
      const right = Math.min(left + 1, samples.length - 1);
      if (left === samples.length - 1 && right === left) break;
      const fraction = this.nextPosition - left;
      output.push(samples[left] + (samples[right] - samples[left]) * fraction);
      this.nextPosition += this.ratio;
    }

    this.nextPosition -= samples.length - 1;
    this.previousSample = input[input.length - 1];
    return Float32Array.from(output);
  }
}
