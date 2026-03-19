/**
 * useSerialPort - Web Serial API 串口连接管理 Hook
 * 支持力学仪器（CL2-500N-MH01）和传感器产品各自独立的串口连接
 *
 * 传感器数据帧格式（双包协议 - 16×16产品）：
 *   帧头：AA 55 03 99（4字节固定分隔符）
 *   PKT01：帧头 + 0x01(包号) + 0x01~0x05(设备类型) + 128字节（传感器第1~128点）
 *   PKT02：帧头 + 0x02(包号) + 0x01~0x05(设备类型) + 144字节（传感器第129~256点 + 16字节陀螺仪）
 *   设备类型：0x01=LH(Left Hand), 0x02=RH(Right Hand), 0x03=LF(Left Foot), 0x04=RF(Right Foot), 0x05=WB(Whole Body)
 *   矩阵：256字节 → 16×16，按行优先排列
 *
 * 传感器数据帧格式（单帧协议 - 32×32高密度产品 JQGY-YL-09）：
 *   帧头：AA 55 03 99（4字节固定分隔符）
 *   数据域：1024字节（32×32=1024个ADC值，每字节0~255）
 *   总帧长：1028字节（4字节帧头 + 1024字节数据域）
 *   波特率：1,000,000 bps
 *   采样频率：100Hz
 *   矩阵映射：数据域字节按特定映射表重排到32×32矩阵
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
  /** 传感器协议模式：'16x16'双包协议(default) / '32x32'单帧协议 */
  sensorProtocol?: SensorProtocol;
}

const DEFAULT_BAUD_FORCE = 19200;
const DEFAULT_BAUD_SENSOR = 921600; // 与硬件一致

// 帧头字节序列：AA 55 03 99
const FRAME_HEADER = new Uint8Array([0xAA, 0x55, 0x03, 0x99]);
const FRAME_HEADER_LEN = FRAME_HEADER.length;

// 双包协议常量（16×16产品）
const PKT01_TYPE = 0x01;
const PKT02_TYPE = 0x02;
const PKT01_DATA_LEN = 128;
const PKT02_DATA_LEN = 144; // 128字节传感器 + 16字节陀螺仪
const SENSOR_TOTAL_16 = 256; // 16×16总传感器点数
const DEVICE_TYPE_LEN = 1; // 设备类型字节长度（0x01~0x05）
// 帧结构：帧头(4B) + 包号(1B) + 设备类型(1B) + 数据(128B/144B)
const PKT_HEADER_OVERHEAD = 1 + DEVICE_TYPE_LEN; // 包号 + 设备类型 = 2字节

// 单帧协议常量（32×32高密度产品 JQGY-YL-09）
const SENSOR_TOTAL_32 = 1024; // 32×32总传感器点数
const FRAME_32X32_DATA_LEN = 1024; // 数据域长度
const FRAME_32X32_TOTAL_LEN = FRAME_HEADER_LEN + FRAME_32X32_DATA_LEN; // 帧头(4B) + 数据域(1024B) = 1028B

/**
 * 32×32矩阵映射表（1-based索引 → 0-based索引）
 * 数据域1024字节按此映射表重排到32行×32列矩阵
 * 来源：JQGY-YL-09产品规格书
 */
const MATRIX_32X32_MAP: number[][] = [
  /* Row  0 */ [480,481,482,483,484,485,486,487,488,489,490,491,492,493,494,495,496,497,498,499,500,501,502,503,504,505,506,507,508,509,510,511],
  /* Row  1 */ [512,513,514,515,516,517,518,519,520,521,522,523,524,525,526,527,528,529,530,531,532,533,534,535,536,537,538,539,540,541,542,543],
  /* Row  2 */ [544,545,546,547,548,549,550,551,552,553,554,555,556,557,558,559,560,561,562,563,564,565,566,567,568,569,570,571,572,573,574,575],
  /* Row  3 */ [576,577,578,579,580,581,582,583,584,585,586,587,588,589,590,591,592,593,594,595,596,597,598,599,600,601,602,603,604,605,606,607],
  /* Row  4 */ [608,609,610,611,612,613,614,615,616,617,618,619,620,621,622,623,624,625,626,627,628,629,630,631,632,633,634,635,636,637,638,639],
  /* Row  5 */ [640,641,642,643,644,645,646,647,648,649,650,651,652,653,654,655,656,657,658,659,660,661,662,663,664,665,666,667,668,669,670,671],
  /* Row  6 */ [672,673,674,675,676,677,678,679,680,681,682,683,684,685,686,687,688,689,690,691,692,693,694,695,696,697,698,699,700,701,702,703],
  /* Row  7 */ [704,705,706,707,708,709,710,711,712,713,714,715,716,717,718,719,720,721,722,723,724,725,726,727,728,729,730,731,732,733,734,735],
  /* Row  8 */ [736,737,738,739,740,741,742,743,744,745,746,747,748,749,750,751,752,753,754,755,756,757,758,759,760,761,762,763,764,765,766,767],
  /* Row  9 */ [768,769,770,771,772,773,774,775,776,777,778,779,780,781,782,783,784,785,786,787,788,789,790,791,792,793,794,795,796,797,798,799],
  /* Row 10 */ [800,801,802,803,804,805,806,807,808,809,810,811,812,813,814,815,816,817,818,819,820,821,822,823,824,825,826,827,828,829,830,831],
  /* Row 11 */ [832,833,834,835,836,837,838,839,840,841,842,843,844,845,846,847,848,849,850,851,852,853,854,855,856,857,858,859,860,861,862,863],
  /* Row 12 */ [864,865,866,867,868,869,870,871,872,873,874,875,876,877,878,879,880,881,882,883,884,885,886,887,888,889,890,891,892,893,894,895],
  /* Row 13 */ [896,897,898,899,900,901,902,903,904,905,906,907,908,909,910,911,912,913,914,915,916,917,918,919,920,921,922,923,924,925,926,927],
  /* Row 14 */ [928,929,930,931,932,933,934,935,936,937,938,939,940,941,942,943,944,945,946,947,948,949,950,951,952,953,954,955,956,957,958,959],
  /* Row 15 */ [960,961,962,963,964,965,966,967,968,969,970,971,972,973,974,975,976,977,978,979,980,981,982,983,984,985,986,987,988,989,990,991],
  /* Row 16 */ [448,449,450,451,452,453,454,455,456,457,458,459,460,461,462,463,464,465,466,467,468,469,470,471,472,473,474,475,476,477,478,479],
  /* Row 17 */ [416,417,418,419,420,421,422,423,424,425,426,427,428,429,430,431,432,433,434,435,436,437,438,439,440,441,442,443,444,445,446,447],
  /* Row 18 */ [384,385,386,387,388,389,390,391,392,393,394,395,396,397,398,399,400,401,402,403,404,405,406,407,408,409,410,411,412,413,414,415],
  /* Row 19 */ [352,353,354,355,356,357,358,359,360,361,362,363,364,365,366,367,368,369,370,371,372,373,374,375,376,377,378,379,380,381,382,383],
  /* Row 20 */ [320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,338,339,340,341,342,343,344,345,346,347,348,349,350,351],
  /* Row 21 */ [288,289,290,291,292,293,294,295,296,297,298,299,300,301,302,303,304,305,306,307,308,309,310,311,312,313,314,315,316,317,318,319],
  /* Row 22 */ [256,257,258,259,260,261,262,263,264,265,266,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,282,283,284,285,286,287],
  /* Row 23 */ [224,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,243,244,245,246,247,248,249,250,251,252,253,254,255],
  /* Row 24 */ [192,193,194,195,196,197,198,199,200,201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,218,219,220,221,222,223],
  /* Row 25 */ [160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191],
  /* Row 26 */ [128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,158,159],
  /* Row 27 */ [96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127],
  /* Row 28 */ [64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95],
  /* Row 29 */ [32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63],
  /* Row 30 */ [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31],
  /* Row 31 */ [992,993,994,995,996,997,998,999,1000,1001,1002,1003,1004,1005,1006,1007,1008,1009,1010,1011,1012,1013,1014,1015,1016,1017,1018,1019,1020,1021,1022,1023],
];

/** 使用映射表将1024字节数据域重排为32×32矩阵 */
function buildMatrix32x32(data: Uint8Array): number[][] {
  const matrix: number[][] = [];
  for (let r = 0; r < 32; r++) {
    const row: number[] = [];
    for (let c = 0; c < 32; c++) {
      const dataIndex = MATRIX_32X32_MAP[r][c];
      row.push(dataIndex < data.length ? data[dataIndex] : 0);
    }
    matrix.push(row);
  }
  return matrix;
}

/** 传感器协议模式 */
export type SensorProtocol = '16x16' | '32x32';

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
    sensorProtocol = '16x16',
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

  // 传感器协议模式（通过ref保持最新值）
  const sensorProtocolRef = useRef(sensorProtocol);
  sensorProtocolRef.current = sensorProtocol;

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
    const fullData = new Uint8Array(SENSOR_TOTAL_16);
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
    pendingBytesRef.current += SENSOR_TOTAL_16;
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

  /**
   * 处理 32×32 单帧协议数据
   * 帧格式：帧头(4B) + 1024字节数据域 = 1028B
   */
  const process32x32Frame = useCallback((data: Uint8Array) => {
    // 使用映射表构建 32×32 矩阵
    const matrix = buildMatrix32x32(data);
    const adcValues = matrix.flat();

    // 触发设备类型回调：32×32产品无设备类型字节，使用固定标识 'HD'
    if (lastDeviceIdRef.current !== 0xFF && onDeviceTypeRef.current) {
      lastDeviceIdRef.current = 0xFF;
      onDeviceTypeRef.current('HD', 0xFF); // HD = High Density
    }

    // 使用新的数据流架构
    getSensorDataStreamV2().updateSensorData(matrix, adcValues, data);

    // 触发回调
    if (onSensorMatrixRef.current) {
      onSensorMatrixRef.current(matrix, 32, 32);
    }

    if (onSensorDataRef.current) {
      onSensorDataRef.current(adcValues);
    }

    if (onDataRef.current) {
      const hexStr = Array.from(data.slice(0, 32))
        .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
        .join(' ') + '...';
      onDataRef.current(hexStr);
    }

    // 性能优化
    pendingBytesRef.current += SENSOR_TOTAL_32;
    pendingLastDataRef.current = `32x32[1024B] ${Array.from(data.slice(0, 8)).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}...`;
  }, []);

  // 处理传感器二进制缓冲区：根据协议模式解析帧数据
  const processSensorBuffer = useCallback(() => {
    let buf = binaryBufRef.current;
    const protocol = sensorProtocolRef.current;

    while (buf.length >= FRAME_HEADER_LEN + 1) {
      // 查找帧头
      const headerPos = findFrameHeader(buf, 0);

      if (headerPos === -1) {
        // 没有找到帧头，清空缓冲区以防止无限堆积
        if (buf.length > 2048) {
          binaryBufRef.current = buf.slice(Math.max(0, buf.length - 1028));
        } else {
          binaryBufRef.current = buf.slice(Math.max(0, buf.length - (FRAME_HEADER_LEN - 1)));
        }
        return;
      }

      if (headerPos > 0) {
        buf = buf.slice(headerPos);
      }

      if (protocol === '32x32') {
        // ===== 32×32 单帧协议 =====
        // 帧格式：帧头(4B) + 1024字节数据域
        if (buf.length < FRAME_32X32_TOTAL_LEN) {
          // 数据不完整，等待更多
          binaryBufRef.current = buf;
          return;
        }

        // 提取 1024 字节数据域
        const frameData = buf.slice(FRAME_HEADER_LEN, FRAME_HEADER_LEN + FRAME_32X32_DATA_LEN);
        process32x32Frame(new Uint8Array(frameData));

        // 移动到下一帧
        buf = buf.slice(FRAME_32X32_TOTAL_LEN);
      } else {
        // ===== 16×16 双包协议 =====
        if (buf.length < FRAME_HEADER_LEN + 1) {
          binaryBufRef.current = buf;
          return;
        }

        const pktType = buf[FRAME_HEADER_LEN];

        if (pktType === PKT01_TYPE) {
          const minLen = FRAME_HEADER_LEN + PKT_HEADER_OVERHEAD + PKT01_DATA_LEN;
          if (buf.length < minLen) {
            binaryBufRef.current = buf;
            return;
          }

          const deviceId = buf[FRAME_HEADER_LEN + 1];
          if (deviceId !== lastDeviceIdRef.current && onDeviceTypeRef.current) {
            const deviceType = DEVICE_TYPE_MAP[deviceId] ?? `DEV_${deviceId.toString(16).toUpperCase().padStart(2, '0')}`;
            lastDeviceIdRef.current = deviceId;
            onDeviceTypeRef.current(deviceType, deviceId);
          }

          const dataStart = FRAME_HEADER_LEN + PKT_HEADER_OVERHEAD;
          const pkt01Data = buf.slice(dataStart, dataStart + PKT01_DATA_LEN);
          pkt01DataRef.current = new Uint8Array(pkt01Data);

          processSensorPackets();
          buf = buf.slice(minLen);
        } else if (pktType === PKT02_TYPE) {
          const minLen = FRAME_HEADER_LEN + PKT_HEADER_OVERHEAD + PKT02_DATA_LEN;
          if (buf.length < minLen) {
            binaryBufRef.current = buf;
            return;
          }

          const dataStart = FRAME_HEADER_LEN + PKT_HEADER_OVERHEAD;
          const pkt02Data = buf.slice(dataStart, dataStart + PKT02_DATA_LEN);
          pkt02DataRef.current = new Uint8Array(pkt02Data);

          processSensorPackets();
          buf = buf.slice(minLen);
        } else {
          buf = buf.slice(1);
        }
      }
    }

    binaryBufRef.current = buf;
  }, [processSensorPackets, process32x32Frame]);

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

  const connect = useCallback(async (baudRate: number, skipInit?: boolean): Promise<boolean> => {
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
        if (!skipInit) {
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
