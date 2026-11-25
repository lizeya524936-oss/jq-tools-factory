import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeWeightSensorFrames, type WeightSensorFrame } from '../lib/weightSensorFrames';
import { useSerialPort, type UseSerialPortOptions } from './useSerialPort';

const cleanups: Array<() => void | Promise<void>> = [];
const header = [0xaa, 0x55, 0x03, 0x99];
const flushReads = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function packet(id: number, length: number, adc: number): Uint8Array {
  const bytes = new Uint8Array(6 + length).fill(adc);
  bytes.set([...header, id, 1]);
  return bytes;
}

function observe() {
  const frames: WeightSensorFrame[] = [];
  const unsubscribe = subscribeWeightSensorFrames(frame => frames.push(frame));
  cleanups.push(unsubscribe);
  return { frames, unsubscribe };
}

async function connect(options: UseSerialPortOptions, probe?: Uint8Array) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    open: async () => {
      port.readable = new ReadableStream({ start(next) {
        controller = next;
        if (probe) { next.enqueue(probe); probe = undefined; }
      } });
    },
    close: async () => { port.readable = null; },
    getInfo: () => ({ usbProductId: 42 }),
  };
  vi.stubGlobal('navigator', { serial: { requestPort: async () => port } });
  let device!: ReturnType<typeof useSerialPort>;
  function Harness() { device = useSerialPort(options); return null; }
  renderToStaticMarkup(createElement(Harness));
  cleanups.push(() => device.disconnect());
  expect(await device.connect(probe ? 0 : 921600, true)).toBe(true);
  return async (bytes: Uint8Array) => { controller.enqueue(bytes); await flushReads(); };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllGlobals();
});

describe('calibration frames from the host serial parser', () => {
  it('emits complete equal matrices in one read separately, with matching ids and times for subscribers', async () => {
    const a = observe();
    const b = observe();
    const send = await connect({ role: 'sensor', sensorProtocol: '16x16' });
    const first = packet(1, 128, 7), second = packet(2, 144, 7);
    await send(first);
    expect(a.frames).toHaveLength(0);
    const earliest = performance.now();
    await send(new Uint8Array([...second, ...first, ...second]));
    expect(a.frames).toHaveLength(2);
    expect(b.frames).toEqual(a.frames);
    expect(a.frames[0]).toMatchObject({ rows: 16, cols: 16 });
    expect(a.frames[0].matrix.flat()).toEqual(Array(256).fill(7));
    expect(a.frames[1].sequence).toBe(a.frames[0].sequence + 1);
    expect(a.frames[0].receivedAt).toBeGreaterThanOrEqual(earliest);
    expect(a.frames[1].receivedAt).toBeGreaterThanOrEqual(a.frames[0].receivedAt);
    expect(a.frames[1].receivedAt).toBeLessThanOrEqual(performance.now());
    a.unsubscribe();
    const c = observe();
    expect(c.frames).toHaveLength(0);
    await send(new Uint8Array([...first, ...second]));
    expect(a.frames).toHaveLength(2);
    expect(c.frames[0].sequence).toBe(a.frames[1].sequence + 1);
  });

  it('retains mapped 32×32 matrix coordinates', async () => {
    const { frames } = observe();
    const send = await connect({ role: 'sensor', sensorProtocol: '32x32' });
    const raw = new Uint8Array(1028);
    raw.set(header);
    raw[4 + 480] = 63;
    await send(raw);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ rows: 32, cols: 32 });
    expect(frames[0].matrix[0][0]).toBe(63);
  });

  it('delivers rectangular 14×20 frames after both packets', async () => {
    const { frames } = observe();
    const send = await connect({ role: 'sensor', sensorProtocol: 'custom_xingchen' });
    await send(packet(1, 140, 3));
    expect(frames).toHaveLength(0);
    await send(packet(2, 156, 4));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ rows: 14, cols: 20 });
    expect(frames[0].matrix.flat()).toEqual([...Array(140).fill(3), ...Array(140).fill(4)]);
  });

  it('starts calibration frames only after the adaptive baud probe', async () => {
    const { frames } = observe();
    const full = packet(1, 256, 13);
    const batch = new Uint8Array([...full, ...full, ...full]);
    const send = await connect({ role: 'sensor', sensorProtocol: 'adaptive_16x16' }, batch);
    expect(frames).toHaveLength(0);
    await send(batch);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames[0].matrix.flat()).toEqual(Array(256).fill(13));
  });

  it('ignores the force port', async () => {
    const { frames } = observe();
    const send = await connect({ role: 'force' });
    await send(new Uint8Array([0x23, 0, 0, 0x80, 0x3f, 0x0a]));
    expect(frames).toHaveLength(0);
  });
});
