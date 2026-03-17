/**
 * useSerialPort - Web Serial API 串口连接管理 Hook
 * 支持力学仪器（CL2-500N-MH01）和传感器产品各自独立的串口连接
 *
 * 传感器数据帧格式（双包协议）：
 *   帧头：AA 55 03 99（4字节固定分隔符）
 *   PKT01：帧头 + 0x01(包号) + 0x01~0x05(设备类型) + 128字节（传感器第1~128点）
 *   PKT02：帧头 + 0x02(包号) + 0x01~0x05(设备类型) + 144字节（传感器第129~256点 + 16字节陀螺仪）
 *   设备类型：0x01=LH(Left Hand), 0x02=RH(Right Hand), 0x03=LF(Left Foot), 0x04=RF(Right Foot), 0x05=WB(Whole Body)
 *   矩阵：256字节 → 16×16，按行优先排列
 *
 * 力学仪器数据格式（CL2 二进制协议）：
 *   帧头: 0x23 + 4字节浮点数(小端float32) + 帧尾: 0x0A（总6字节/帧）
 *
 * CL2-500N-MH01 压力计初始化协议：
 *   连接命令:      0x23 0x50 0x00 0x0A
 *   开始采集命令:  0x23 0x51 0x00 0x0A
 *   停止采集命令:  0x23 0x52 0x00 0x0A
 *   重置/归零命令: 0x23 0x55 0x00 0x0A
 */
import { useState, useRef, useCallback } from 'react';
import { getSensorDataStreamV2 } from '@/lib/sensorDataStreamV2';

export type SerialPortRole = 'force' | 'sensor';
export type SerialStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SerialPortState {
  status: SerialStatus;
  portInfo: string | null;
  baudRate: number;
  errorMsg: string | null;
  bytesReceived: number;
  lastData: string | null;
}

/** 设备类型映射 */
export const DEVICE_TYPE_MAP: Record<number, string> = {
  0x01: 'LH', // Left Hand
  0x02: 'RH', // Right Hand
  0x03: 'LF', // Left Foot
  0x04: 'RF', // Right Foot
  0x05: 'WB', // Whole Body
};

export interface UseSerialPortOptions {
  role: SerialPortRole;
  onData?: (raw: string) => void;
  onForceData?: (newtonValue: number) => void;
  /** 传感器矩阵ADC数据回调，返回二维数组 matrixData[row][col] = 0~255 */
  onSensorMatrix?: (matrixData: number[][], rows: number, cols: number) => void;
  /** 兼容旧接口：一维数组，行优先展开 */
  onSensorData?: (adcValues: number[]) => void;
  /** 设备类型回调：当解析到设备类型字节时触发，返回类型字符串如 'LH'/'RH'/'LF'/'RF'/'WB' */
  onDeviceType?: (deviceType: string, deviceId: number) => void;
  /** 当前矩阵尺寸（用于解析帧体长度） */
  matrixRows?: number;
  matrixCols?: number;
}

const DEFAULT_BAUD_FORCE = 19200;
const DEFAULT_BAUD_SENSOR = 921600; // 与硬件一致

// 帧头字节序列：AA 55 03 99
const FRAME_HEADER = new Uint8Array([0xAA, 0x55, 0x03, 0x99]);
const FRAME_HEADER_LEN = FRAME_HEADER.length;

// 双包协议常量
const PKT01_TYPE = 0x01;
const PKT02_TYPE = 0x02;
const PKT01_DATA_LEN = 128;
const PKT02_DATA_LEN = 144; // 128字节传感器 + 16字节陀螺仪
const SENSOR_TOTAL = 256; // 总传感器点数
const DEVICE_TYPE_LEN = 1; // 设备类型字节长度（0x01~0x05）
// 帧结构：帧头(4B) + 包号(1B) + 设备类型(1B) + 数据(128B/144B)
const PKT_HEADER_OVERHEAD = 1 + DEVICE_TYPE_LEN; // 包号 + 设备类型 = 2字节

export function isWebSerialSupported(): boolean {
  return 'serial' in navigator;
}

/** 在字节缓冲区中搜索帧头，返回帧头起始位置，未找到返回-1 */
function findFrameHeader(buf: Uint8Array, offset: number = 0): number {
  for (let i = offset; i <= buf.length - FRAME_HEADER_LEN; i++) {
    if (
      buf[i] === 0xAA &&
      buf[i + 1] === 0x55 &&
      buf[i + 2] === 0x03 &&
      buf[i + 3] === 0x99
    ) {
      return i;
    }
  }
  return -1;
}

/** 将一维ADC数组按行优先顺序重建为二维矩阵 */
function buildMatrix(data: Uint8Array, rows: number, cols: number): number[][] {
  const matrix: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      row.push(idx < data.length ? data[idx] : 0);
    }
    matrix.push(row);
  }
  return matrix;
}

export function useSerialPort(options: UseSerialPortOptions) {
  const {
    role,
    onData,
    onForceData,
    onSensorMatrix,
    onSensorData,
    onDeviceType,
    matrixRows = 16,
    matrixCols = 16,
  } = options;

  const [state, setState] = useState<SerialPortState>({
    status: 'disconnected',
    portInfo: null,
    baudRate: role === 'force' ? DEFAULT_BAUD_FORCE : DEFAULT_BAUD_SENSOR,
    errorMsg: null,
    bytesReceived: 0,
    lastData: null,
  });

  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const readLoopRef = useRef<boolean>(false);

  // 二进制字节缓冲区（用于传感器帧解析）
  const binaryBufRef = useRef<Uint8Array>(new Uint8Array(0));
  // 力学仪器二进制缓冲区（CL2 协议：0x23 + float32LE + 0x0A）
  const forceBinaryBufRef = useRef<Uint8Array>(new Uint8Array(0));
  // 文本缓冲区（用于力学仪器ASCII解析 fallback）
  const textBufRef = useRef<string>('');

  // 双包缓冲区：存储PKT01和PKT02的数据
  const pkt01DataRef = useRef<Uint8Array | null>(null);
  const pkt02DataRef = useRef<Uint8Array | null>(null);

  // 当前矩阵尺寸（通过ref保持最新值，避免闭包陈旧问题）
  const matrixRowsRef = useRef(matrixRows);
  const matrixColsRef = useRef(matrixCols);
  matrixRowsRef.current = matrixRows;
  matrixColsRef.current = matrixCols;

  // 回调引用，确保始终调用最新版本
  const onDataRef = useRef(onData);
  const onForceDataRef = useRef(onForceData);
  const onSensorMatrixRef = useRef(onSensorMatrix);
  const onSensorDataRef = useRef(onSensorData);
  const onDeviceTypeRef = useRef(onDeviceType);
  onDataRef.current = onData;
  onForceDataRef.current = onForceData;
  onSensorMatrixRef.current = onSensorMatrix;
  onSensorDataRef.current = onSensorData;
  onDeviceTypeRef.current = onDeviceType;
  
  // 已识别的设备类型（避免重复触发回调）
  const lastDeviceIdRef = useRef<number | null>(null);
  
  // 性能优化：累计字节数和最新数据到 Ref，避免高频 setState
  const pendingBytesRef = useRef(0);
  const pendingLastDataRef = useRef<string | null>(null);
  const stateUpdateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 解析力学仪器数据（ASCII行格式 - fallback）
  const parseForceData = useCallback((line: string) => {
    const cleaned = line.trim();
    const match = cleaned.match(/([+-]?\d+\.?\d*)/);
    if (match) {
      const value = parseFloat(match[1]);
      if (!isNaN(value) && onForceDataRef.current) {
        onForceDataRef.current(value);
      }
    }
  }, []);

  /**
   * 解析 CL2 二进制协议帧（与 v1.3.1 SerialDriver.parseBuffer 完全一致）
   * 帧格式：0x23 + 4字节浮点数(小端float32) + 0x0A（总6字节）
   */
  const parseForceBinaryBuffer = useCallback(() => {
    let buf = forceBinaryBufRef.current;

    while (buf.length >= 6) {
      // 查找帧头 0x23
      let startIndex = -1;
      for (let i = 0; i <= buf.length - 6; i++) {
        if (buf[i] === 0x23) {
          startIndex = i;
          break;
        }
      }

      if (startIndex === -1) {
        // 没有找到帧头，清空缓冲区
        buf = new Uint8Array(0);
        break;
      }

      if (startIndex > 0) {
        // 移除帧头前的数据
        buf = buf.slice(startIndex);
      }

      // 检查是否有完整的帧（6字节）
      if (buf.length < 6) {
        break;
      }

      // 检查帧尾 0x0A
      if (buf[5] !== 0x0A) {
        // 帧尾不正确，跳过这个字节继续
        buf = buf.slice(1);
        continue;
      }

      // 提取 4 字节数据（索引 1~4）
      const dataBytes = buf.slice(1, 5);

      try {
        // 使用小端解析为 32 位浮点数
        const dataView = new DataView(dataBytes.buffer, dataBytes.byteOffset, 4);
        const value = dataView.getFloat32(0, true); // true = 小端

        if (!isNaN(value) && onForceDataRef.current) {
          onForceDataRef.current(value);
        }
      } catch (error) {
        console.error('[CL2] 解析错误:', error);
      }

      // 移除已处理的帧
      buf = buf.slice(6);
    }

    forceBinaryBufRef.current = buf;
  }, []);

  /**
   * 当两个包都收到时，拼合为完整的256字节传感器数据并触发回调
   */
  const processSensorPackets = useCallback(() => {
    if (!pkt01DataRef.current || !pkt02DataRef.current) {
      return; // 还有包未收到
    }

    // 拼合：PKT01 (128B) + PKT02前128B = 256B
    const fullData = new Uint8Array(SENSOR_TOTAL);
    fullData.set(pkt01DataRef.current, 0);
    fullData.set(pkt02DataRef.current.slice(0, 128), 128);

    // 构建16×16矩阵
    const matrix = buildMatrix(fullData, 16, 16);
    const adcValues = Array.from(fullData);

    // 使用新的数据流架构，确保数据同步和零延迟
    getSensorDataStreamV2().updateSensorData(matrix, adcValues, fullData);
    

    // 触发回调（兼容旧接口）
    if (onSensorMatrixRef.current) {
      onSensorMatrixRef.current(matrix, 16, 16);
    }

    if (onSensorDataRef.current) {
      onSensorDataRef.current(adcValues);
    }

    // 触发onData回调（原始帧十六进制字符串）
    if (onDataRef.current) {
      const hexStr = Array.from(fullData.slice(0, 32))
        .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
        .join(' ') + '...';
      onDataRef.current(hexStr);
    }

    // 性能优化：只写入 Ref，不触发 React 重渲染
    pendingBytesRef.current += SENSOR_TOTAL;
    pendingLastDataRef.current = `PKT01+PKT02[256B] ${Array.from(fullData.slice(0, 8)).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}...`;

    // 清空缓冲区，等待下一对包
    pkt01DataRef.current = null;
    pkt02DataRef.current = null;
  }, []);

  // 追加字节到二进制缓冲区
  const appendBinary = useCallback((chunk: Uint8Array) => {
    const prev = binaryBufRef.current;
    // 优化：如果缓冲区为空，直接使用新数据
    if (prev.length === 0) {
      binaryBufRef.current = new Uint8Array(chunk);
    } else {
      // 只有在必要时才创建新缓冲区
      const next = new Uint8Array(prev.length + chunk.length);
      next.set(prev);
      next.set(chunk, prev.length);
      binaryBufRef.current = next;
    }
  }, []);

  // 处理传感器二进制缓冲区：查找帧头，提取PKT01/PKT02
  const processSensorBuffer = useCallback(() => {
    let buf = binaryBufRef.current;

    while (buf.length >= FRAME_HEADER_LEN + 1) {
      // 查找帧头
      const headerPos = findFrameHeader(buf, 0);

      if (headerPos === -1) {
        // 没有找到帧头，清空缓冲区以防止无限堆积
        // 只保留最后3字节以防帧头被分割
        if (buf.length > 1024) {
          // 如果缓冲区过大，只保留最后的数据
          binaryBufRef.current = buf.slice(Math.max(0, buf.length - 512));
        } else {
          binaryBufRef.current = buf.slice(Math.max(0, buf.length - (FRAME_HEADER_LEN - 1)));
        }
        return;
      }

      if (headerPos > 0) {
        // 丢弃帧头之前的无效数据
        buf = buf.slice(headerPos);
      }

      // 检查包类型字节
      if (buf.length < FRAME_HEADER_LEN + 1) {
        // 还没有包类型字节，等待更多数据
        binaryBufRef.current = buf;
        return;
      }

      const pktType = buf[FRAME_HEADER_LEN];

      if (pktType === PKT01_TYPE) {
        // PKT01：帧头(4B) + 包号(1B) + 设备类型(1B) + 128字节数据 = 134字节
        const minLen = FRAME_HEADER_LEN + PKT_HEADER_OVERHEAD + PKT01_DATA_LEN;
        if (buf.length < minLen) {
          // 数据不完整，等待更多
          binaryBufRef.current = buf;
          return;
        }

        // 解析设备类型字节（帧头4B + 包号1B = 第5字节，索引5）
        const deviceId = buf[FRAME_HEADER_LEN + 1];
        if (deviceId !== lastDeviceIdRef.current && onDeviceTypeRef.current) {
          const deviceType = DEVICE_TYPE_MAP[deviceId] ?? `DEV_${deviceId.toString(16).toUpperCase().padStart(2, '0')}`;
          lastDeviceIdRef.current = deviceId;
          onDeviceTypeRef.current(deviceType, deviceId);
        }

        // 跳过帧头(4B) + 包号(1B) + 设备类型(1B)，提取128字节数据
        const dataStart = FRAME_HEADER_LEN + PKT_HEADER_OVERHEAD;
        const pkt01Data = buf.slice(dataStart, dataStart + PKT01_DATA_LEN);
        pkt01DataRef.current = new Uint8Array(pkt01Data);

        // 尝试拼合
        processSensorPackets();

        // 移动到下一帧
        buf = buf.slice(minLen);
      } else if (pktType === PKT02_TYPE) {
        // PKT02：帧头(4B) + 包号(1B) + 设备类型(1B) + 144字节数据 = 150字节
        const minLen = FRAME_HEADER_LEN + PKT_HEADER_OVERHEAD + PKT02_DATA_LEN;
        if (buf.length < minLen) {
          // 数据不完整，等待更多
          binaryBufRef.current = buf;
          return;
        }

        // 跳过帧头(4B) + 包号(1B) + 设备类型(1B)，提取144字节数据
        const dataStart = FRAME_HEADER_LEN + PKT_HEADER_OVERHEAD;
        const pkt02Data = buf.slice(dataStart, dataStart + PKT02_DATA_LEN);
        pkt02DataRef.current = new Uint8Array(pkt02Data);

        // 尝试拼合
        processSensorPackets();

        // 移动到下一帧
        buf = buf.slice(minLen);
      } else {
        // 未知包类型，跳过这个字节继续查找
        buf = buf.slice(1);
      }
    }

    binaryBufRef.current = buf;
  }, [processSensorPackets]);

  // 读取循环（二进制模式）
  const startReadLoop = useCallback(async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    readLoopRef.current = true;
    binaryBufRef.current = new Uint8Array(0);
    forceBinaryBufRef.current = new Uint8Array(0);
    textBufRef.current = '';
    pkt01DataRef.current = null;
    pkt02DataRef.current = null;

    try {
      while (readLoopRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

        if (role === 'force') {
          // 力学仪器：CL2 二进制协议解析（与 v1.3.1 SerialDriver.parseBuffer 完全一致）
          // 帧格式：0x23 + 4字节float32小端 + 0x0A
          const prev = forceBinaryBufRef.current;
          if (prev.length === 0) {
            forceBinaryBufRef.current = new Uint8Array(value);
          } else {
            const next = new Uint8Array(prev.length + value.length);
            next.set(prev);
            next.set(value, prev.length);
            forceBinaryBufRef.current = next;
          }
          parseForceBinaryBuffer();
        } else {
          // 传感器：二进制帧解析
          appendBinary(value);
          processSensorBuffer();
        }
      }
    } catch (err) {
      console.error('Read loop error:', err);
    }
  }, [role, parseForceBinaryBuffer, appendBinary, processSensorBuffer]);

  // CL2-500N-MH01 压力计协议命令
  const CL2_CMD_CONNECT = new Uint8Array([0x23, 0x50, 0x00, 0x0A]);
  const CL2_CMD_START   = new Uint8Array([0x23, 0x51, 0x00, 0x0A]);
  const CL2_CMD_STOP    = new Uint8Array([0x23, 0x52, 0x00, 0x0A]);

  // 当前串口写入器（用于发送初始化命令）
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);

  const connect = useCallback(async (baudRate: number): Promise<boolean> => {
    if (!isWebSerialSupported()) {
      setState(prev => ({
        ...prev,
        status: 'error',
        errorMsg: 'Web Serial API not supported',
      }));
      return false;
    }

    setState(prev => ({ ...prev, status: 'connecting', errorMsg: null }));

    try {
      const port = await navigator.serial.requestPort();
      portRef.current = port;

      await port.open({ baudRate });

      const portInfo = `${port.getInfo().usbProductId ?? 'Unknown'}`;

      // force role：先获取 writer，发送 CL2 初始化命令，再获取 reader
      // （顺序很重要：必须在 getReader() 之前调用 getWriter()，否则 writable 流被锁定）
      if (role === 'force' && port.writable) {
        const writer = port.writable.getWriter();
        writerRef.current = writer;
        try {
          // 发送连接命令
          await writer.write(CL2_CMD_CONNECT);
          // 等待 500ms，等待压力计响应
          await new Promise(resolve => setTimeout(resolve, 500));
          // 发送开始采集命令
          await writer.write(CL2_CMD_START);
        } catch (cmdErr) {
          console.warn('[useSerialPort] CL2 初始化命令发送失败:', cmdErr);
        }
      }

      const reader = port.readable?.getReader();
      if (!reader) throw new Error('Failed to get reader');
      readerRef.current = reader;

      setState(prev => ({
        ...prev,
        status: 'connected',
        portInfo,
        baudRate,
        bytesReceived: 0,
      }));

      // 启动状态更新定时器：每500ms将累计的字节数和最新数据刷入 React State
      if (stateUpdateTimerRef.current) clearInterval(stateUpdateTimerRef.current);
      stateUpdateTimerRef.current = setInterval(() => {
        if (pendingBytesRef.current > 0 || pendingLastDataRef.current) {
          setState(prev => ({
            ...prev,
            bytesReceived: prev.bytesReceived + pendingBytesRef.current,
            lastData: pendingLastDataRef.current || prev.lastData,
          }));
          pendingBytesRef.current = 0;
        }
      }, 500);

      startReadLoop(reader);
      return true;
    } catch (err: any) {
      const errorMsg = err?.message ?? 'Unknown error';
      setState(prev => ({
        ...prev,
        status: 'error',
        errorMsg,
      }));
      return false;
    }
  }, [role, startReadLoop]);

  const disconnect = useCallback(async () => {
    readLoopRef.current = false;
    lastDeviceIdRef.current = null; // 重置设备类型缓存
    
    // 清理状态更新定时器
    if (stateUpdateTimerRef.current) {
      clearInterval(stateUpdateTimerRef.current);
      stateUpdateTimerRef.current = null;
    }

    // force role：断开前发送 CL2 停止采集命令
    if (role === 'force' && writerRef.current) {
      try {
        await writerRef.current.write(new Uint8Array([0x23, 0x52, 0x00, 0x0A]));
      } catch (e) {
        // 忽略错误，继续断开
      }
      try {
        await writerRef.current.close();
      } catch (e) { /* ignore */ }
      writerRef.current = null;
    }

    if (readerRef.current) {
      try {
        await readerRef.current.cancel();
      } catch (err) {
        console.error('Cancel reader error:', err);
      }
      readerRef.current = null;
    }

    if (portRef.current) {
      try {
        await portRef.current.close();
      } catch (err) {
        console.error('Close port error:', err);
      }
      portRef.current = null;
    }

    setState(prev => ({
      ...prev,
      status: 'disconnected',
      portInfo: null,
      bytesReceived: 0,
      lastData: null,
    }));
  }, [role]);

  /**
   * 向串口发送命令（如 CL2 压力计归零指令）
   */
  const sendCommand = useCallback(async (data: Uint8Array): Promise<boolean> => {
    if (!writerRef.current) {
      console.warn('[useSerialPort] sendCommand: writer 不可用');
      return false;
    }
    try {
      await writerRef.current.write(data);
      return true;
    } catch (err) {
      console.error('[useSerialPort] sendCommand 失败:', err);
      return false;
    }
  }, []);

  return {
    state,
    connect,
    disconnect,
    sendCommand,
  };
}
