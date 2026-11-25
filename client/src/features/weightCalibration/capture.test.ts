import { describe, expect, it } from 'vitest';
import {
  SAMPLE_MS,
  SETTLE_MS,
  STALE_MS,
  appendCaptureFrame,
  createCapture,
  finishCapture,
  type CaptureWindow,
} from './capture';

const START = 1000;

function frame(sequence: number, elapsedMs: number, matrix = [[10, 20], [30, 40]]) {
  return { matrix, rows: 2, cols: 2, sequence, receivedAt: START + elapsedMs };
}

function populatedWindow(): CaptureWindow {
  const window = createCapture(50, [0, 1], 2, 2, START);
  for (let i = 0; i < 20; i++) {
    appendCaptureFrame(window, frame(i + 1, SETTLE_MS + i * 100, [[10 + i, 20 + i], [30, 40]]));
  }
  return window;
}

describe('frame-based six-level capture', () => {
  it('requires a selected region and copies its channel indices', () => {
    expect(() => createCapture(0, [], 16, 16, START)).toThrow();
    const indices = [0, 1];
    const window = createCapture(0, indices, 2, 2, START);
    indices.push(3);
    expect(window.indices).toEqual([0, 1]);
  });

  it('does not count duplicate or older sequences as additional samples', () => {
    const window = createCapture(50, [0], 2, 2, START);
    appendCaptureFrame(window, frame(10, 3100));
    appendCaptureFrame(window, frame(10, 3200));
    appendCaptureFrame(window, frame(9, 3300));
    appendCaptureFrame(window, frame(11, 3400));
    expect(window.frames.map(sample => sample.sequence)).toEqual([10, 11]);
  });

  it('retains identical ADC values from different incoming frames', () => {
    const window = createCapture(0, [0, 1], 2, 2, START);
    for (let i = 0; i < 20; i++) appendCaptureFrame(window, frame(i + 1, 3000 + i * 100));
    expect(window.frames).toHaveLength(20);
    expect(window.frames.every(sample => sample.adcAverage === 15)).toBe(true);
    const point = finishCapture(window, START + 5000, START + 4900);
    expect(point.count).toBe(20);
    expect(point.adc).toBe(15);
    expect(point.sd).toBe(0);
  });

  it('excludes settling and post-window data but retains both sample boundaries', () => {
    const window = createCapture(50, [0], 2, 2, START);
    const offsets = [0, SETTLE_MS - 1, SETTLE_MS, SETTLE_MS + SAMPLE_MS, SETTLE_MS + SAMPLE_MS + 1];
    offsets.forEach((offset, index) => appendCaptureFrame(window, frame(index + 1, offset)));
    expect(window.frames.map(sample => sample.elapsedMs)).toEqual([SETTLE_MS, SETTLE_MS + SAMPLE_MS]);
  });

  it('cannot finish before the sampling interval is complete', () => {
    const window = populatedWindow();
    expect(() => finishCapture(window, START + 4999, START + 4900)).toThrow(/尚未完成/);
  });

  it('rejects stale data at completion instead of reusing the last ADC value', () => {
    const window = populatedWindow();
    expect(() => finishCapture(window, START + 5000, START + 5000 - STALE_MS - 1)).toThrow(/数据中断/);
    expect(() => finishCapture(window, START + 5000, START + 5000 - STALE_MS)).not.toThrow();
  });

  it('rejects many samples concentrated in too short a time span', () => {
    const window = createCapture(50, [0], 2, 2, START);
    for (let i = 0; i < 30; i++) appendCaptureFrame(window, frame(i + 1, 4700 + i * 5));
    expect(() => finishCapture(window, START + 5000, START + 4900)).toThrow(/新帧不足/);
  });

  it('rejects too few frames even when they span the whole interval', () => {
    const window = createCapture(50, [0], 2, 2, START);
    for (let i = 0; i < 9; i++) appendCaptureFrame(window, frame(i + 1, 3000 + i * 250));
    expect(() => finishCapture(window, START + 5000, START + 5000)).toThrow(/新帧不足/);
  });

  it('summarizes per-frame regional averages, retaining the full capture evidence', () => {
    const window = populatedWindow();
    const point = finishCapture(window, START + 5000, START + 4900);
    expect(point.massG).toBe(50);
    expect(point.count).toBe(20);
    expect(point.adc).toBe(24.5);
    expect(point.durationMs).toBe(1900);
    expect(point.saturatedSamples).toBe(0);
    expect(point.sd).toBeCloseTo(Math.sqrt(35), 12);
    expect(Number.isFinite(Date.parse(point.capturedAt))).toBe(true);
    expect(window.frames[0].channelValues).toEqual([10, 20]);
    expect(window.frames.at(-1)?.channelValues).toEqual([29, 39]);
  });

  it('rejects channel saturation even when the regional average is below 255', () => {
    const window = populatedWindow();
    appendCaptureFrame(window, frame(21, 4950, [[255, 0], [0, 0]]));
    expect(window.frames.at(-1)?.adcAverage).toBe(127.5);
    expect(() => finishCapture(window, START + 5000, START + 4950)).toThrow(/255/);
  });

  it('cancels on dimension changes even during the settling period', () => {
    const window = populatedWindow();
    appendCaptureFrame(window, { ...frame(30, 2000), rows: 1, cols: 4, matrix: [[1, 2, 3, 4]] });
    expect(window.error).toMatch(/矩阵尺寸/);
    expect(() => finishCapture(window, START + 5000, START + 4900)).toThrow(/矩阵尺寸/);
    const count = window.frames.length;
    appendCaptureFrame(window, frame(31, 4950));
    expect(window.frames).toHaveLength(count);
  });

  it('rejects malformed matrices and non-finite or out-of-range channel values', () => {
    for (const matrix of [[[NaN, 2], [3, 4]], [[-1, 2], [3, 4]], [[256, 2], [3, 4]], [[], []]]) {
      const window = createCapture(50, [0], 2, 2, START);
      appendCaptureFrame(window, frame(1, 3500, matrix));
      expect(window.error).toMatch(/无效 ADC/);
    }
  });
});
