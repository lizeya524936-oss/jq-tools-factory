import { summarizeSamples, type CalibrationPoint } from './calibration';

export const SETTLE_MS = 3000;
export const SAMPLE_MS = 2000;
export const STALE_MS = 750;
export interface CaptureFrame {
  elapsedMs: number;
  adcAverage: number;
  channelValues: number[];
  sequence: number;
}
export interface CaptureWindow {
  massG: number;
  startedAt: number;
  indices: number[];
  rows: number;
  cols: number;
  lastSequence: number;
  frames: CaptureFrame[];
  error: string | null;
}
export function createCapture(massG: number, indices: number[], rows: number, cols: number, now: number): CaptureWindow {
  if (!indices.length) throw new Error('请先选择传感器区域。');
  return { massG, startedAt: now, indices: [...indices], rows, cols, lastSequence: -1, frames: [], error: null };
}
export function appendCaptureFrame(window: CaptureWindow, frame: { matrix: number[][]; rows: number; cols: number; sequence: number; receivedAt: number }) {
  if (window.error || frame.sequence <= window.lastSequence) return;
  window.lastSequence = frame.sequence;
  if (frame.rows !== window.rows || frame.cols !== window.cols) {
    window.error = '设备矩阵尺寸已变更，请重新选区并采集。';
    return;
  }
  const elapsedMs = frame.receivedAt - window.startedAt;
  if (elapsedMs < SETTLE_MS || elapsedMs > SETTLE_MS + SAMPLE_MS) return;
  const values = window.indices.map(index => frame.matrix[Math.floor(index / frame.cols)]?.[index % frame.cols]);
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 255)) {
    window.error = '选区包含无效 ADC，请检查设备协议。';
    return;
  }
  window.frames.push({ elapsedMs, adcAverage: values.reduce((sum, value) => sum + value, 0) / values.length, channelValues: values, sequence: frame.sequence });
}
export function finishCapture(window: CaptureWindow, now: number, lastFrameAt: number): CalibrationPoint {
  if (window.error) throw new Error(window.error);
  if (now - lastFrameAt > STALE_MS) throw new Error('设备数据中断，本档未保存，请重新采集。');
  if (now - window.startedAt < SETTLE_MS + SAMPLE_MS) throw new Error('采集尚未完成。');
  const frames = window.frames;
  if (frames.length < 10 || frames[frames.length - 1].elapsedMs - frames[0].elapsedMs < SAMPLE_MS * 0.75) {
    throw new Error('有效新帧不足，请检查连接后重新采集。');
  }
  const saturatedSamples = frames.filter(frame => frame.channelValues.some(value => value >= 255)).length;
  if (saturatedSamples) throw new Error('选区有通道达到 ADC 255，请检查受力位置或选区后重新采集。');
  const summary = summarizeSamples(frames.map(frame => frame.adcAverage));
  return { massG: window.massG, adc: summary.median, sd: summary.sd, count: frames.length, durationMs: frames[frames.length - 1].elapsedMs - frames[0].elapsedMs, capturedAt: new Date().toISOString(), saturatedSamples };
}
