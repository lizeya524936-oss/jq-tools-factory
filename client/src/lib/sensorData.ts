/**
 * sensorData.ts - 传感器数据工具函数
 * 支持最大64×64传感器矩阵，横纵点阵1-64可设置
 * 压阻原理，ADC数值输出
 */

export interface SensorPoint {
  id: string;
  row: number;
  col: number;
  label: string;
  selected: boolean;
  adcValue: number;
  active: boolean;
}

export interface DataRecord {
  id: string;
  timestamp: number;
  time: string;
  pressure: number;        // 力学数据，单位N
  adcValues: number[];     // 各传感器点ADC数值
  adcSum: number;          // ADC数值求和（十进制）
  adcSumHex: string;       // ADC数值求和（十六进制）
  testMode: 'consistency' | 'repeatability' | 'durability';
  sampleIndex: number;
  productIndex?: number;   // 所属产品批次编号（一致性检测用）
  cycleIndex?: number;     // 采样周期编号（重复性检测用）
}

export interface TestResult {
  passed: boolean | null;
  message: string;
  details: string[];
  maxError?: number;
  threshold?: number;
}

export interface MatrixConfig {
  rows: number;   // 1-64
  cols: number;   // 1-64
}

// 生成传感器矩阵（支持1-64×1-64）
export function generateSensorMatrix(rows: number = 8, cols: number = 8): SensorPoint[] {
  const r = Math.min(64, Math.max(1, rows));
  const c = Math.min(64, Math.max(1, cols));
  const sensors: SensorPoint[] = [];
  for (let row = 0; row < r; row++) {
    for (let col = 0; col < c; col++) {
      sensors.push({
        id: `s_${row}_${col}`,
        row,
        col,
        label: `R${row + 1}C${col + 1}`,
        selected: false,
        adcValue: 0,  // 初始为0，由串口数据实时更新（0~255）
        active: true,
      });
    }
  }
  return sensors;
}

// 生成单条模拟数据记录
function generateRecord(
  selectedSensors: SensorPoint[],
  basePressure: number,
  noise: number = 0.05,
  testMode: DataRecord['testMode'],
  sampleIndex: number,
  productIndex?: number,
  cycleIndex?: number
): DataRecord {
  const pressure = parseFloat((basePressure * (1 + (Math.random() - 0.5) * noise * 2)).toFixed(2));
  // 如果传感器有实际ADC值（0~255）则加噪声，否则生成模拟值
  const adcValues = selectedSensors.map(s => {
    const base = s.adcValue > 0 ? s.adcValue : Math.floor(80 + Math.random() * 120);
    return Math.min(255, Math.max(0, Math.floor(base * (1 + (Math.random() - 0.5) * noise * 2))));
  });
  const adcSum = adcValues.reduce((a, b) => a + b, 0);
  const now = new Date();
  return {
    id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: now.getTime(),
    time: now.toISOString().replace('T', ' ').slice(0, 23),
    pressure,
    adcValues,
    adcSum,
    adcSumHex: adcSum.toString(16).toUpperCase(),
    testMode,
    sampleIndex,
    productIndex,
    cycleIndex,
  };
}

// 生成一致性检测数据（多个产品，每个产品多次采样）
export function generateConsistencyData(
  selectedSensors: SensorPoint[],
  productCount: number,
  samplesPerProduct: number,
  forceMin: number,
  forceMax: number
): DataRecord[] {
  const records: DataRecord[] = [];
  for (let p = 0; p < productCount; p++) {
    const productBias = 0.95 + Math.random() * 0.1;
    for (let s = 0; s < samplesPerProduct; s++) {
      const t = s / (samplesPerProduct - 1);
      const basePressure = forceMin + (forceMax - forceMin) * t;
      const r = generateRecord(
        selectedSensors.map(sensor => ({
          ...sensor,
          adcValue: Math.floor(sensor.adcValue * productBias),
        })),
        basePressure,
        0.04,
        'consistency',
        p * samplesPerProduct + s,
        p,
        s
      );
      records.push(r);
    }
  }
  return records;
}

// 生成重复性检测数据（间隔采样）
export function generateRepeatabilityData(
  selectedSensors: SensorPoint[],
  repeatCount: number,
  intervalMinutes: number,
  basePressure: number
): DataRecord[] {
  const records: DataRecord[] = [];
  const baseTime = Date.now() - repeatCount * intervalMinutes * 60 * 1000;
  for (let i = 0; i < repeatCount; i++) {
    const drift = 1 + (Math.random() - 0.5) * 0.06;
    const r = generateRecord(
      selectedSensors.map(s => ({ ...s, adcValue: Math.floor(s.adcValue * drift) })),
      basePressure,
      0.03,
      'repeatability',
      i,
      undefined,
      i
    );
    r.timestamp = baseTime + i * intervalMinutes * 60 * 1000;
    r.time = new Date(r.timestamp).toISOString().replace('T', ' ').slice(0, 23);
    records.push(r);
  }
  return records;
}

// 生成耐久性检测数据（大量循环，ADC逐渐衰减）
export function generateDurabilityData(
  selectedSensors: SensorPoint[],
  totalCycles: number,
  sampleInterval: number = 100
): DataRecord[] {
  const records: DataRecord[] = [];
  const sampleCount = Math.min(200, Math.floor(totalCycles / sampleInterval));
  for (let i = 0; i <= sampleCount; i++) {
    const progress = i / sampleCount;
    const degradation = 1 - progress * 0.08 + (Math.random() - 0.5) * 0.02;
    const r = generateRecord(
      selectedSensors.map(s => ({ ...s, adcValue: Math.floor(s.adcValue * degradation) })),
      25 + Math.random() * 5,
      0.03,
      'durability',
      i,
      undefined,
      i * sampleInterval
    );
    records.push(r);
  }
  return records;
}

// 一致性评估
export function evaluateConsistency(
  records: DataRecord[],
  productCount: number,
  forceMin: number,
  forceMax: number,
  threshold: number,
  checkPoints: number = 5
): TestResult {
  if (records.length === 0) {
    return { passed: null, message: '暂无数据', details: [] };
  }

  const groups: Record<number, DataRecord[]> = {};
  records.forEach(r => {
    const idx = r.productIndex ?? 0;
    if (!groups[idx]) groups[idx] = [];
    groups[idx].push(r);
  });

  const pts = Math.max(2, checkPoints);
  const step = (forceMax - forceMin) / (pts - 1);
  const targetPressures = Array.from({ length: pts }, (_, i) => forceMin + i * step);

  const errors: number[] = [];
  const details: string[] = [];

  targetPressures.forEach(targetP => {
    const adcSumsAtPoint: number[] = [];
    Object.values(groups).forEach(groupRecords => {
      const closest = groupRecords.reduce((a, b) =>
        Math.abs(a.pressure - targetP) < Math.abs(b.pressure - targetP) ? a : b
      );
      adcSumsAtPoint.push(closest.adcSum);
    });

    if (adcSumsAtPoint.length > 1) {
      const mean = adcSumsAtPoint.reduce((a, b) => a + b, 0) / adcSumsAtPoint.length;
      const maxDev = Math.max(...adcSumsAtPoint.map(v => Math.abs(v - mean) / mean * 100));
      errors.push(maxDev);
      const status = maxDev <= threshold ? '✓' : '✗';
      details.push(`${status} ${targetP.toFixed(1)}N: 最大偏差 ${maxDev.toFixed(2)}% (阈值±${threshold}%)`);
    }
  });

  const maxError = errors.length > 0 ? Math.max(...errors) : 0;
  const passed = maxError <= threshold;

  return {
    passed,
    message: passed
      ? `一致性检测通过 — 最大偏差 ${maxError.toFixed(2)}%，在±${threshold}%范围内`
      : `一致性检测未通过 — 最大偏差 ${maxError.toFixed(2)}%，超出±${threshold}%`,
    details,
    maxError,
    threshold,
  };
}

// 重复性评估
export function evaluateRepeatability(
  records: DataRecord[],
  threshold: number
): TestResult {
  if (records.length < 2) {
    return { passed: null, message: '数据不足', details: [] };
  }

  const pressures = records.map(r => r.pressure);
  const adcSums = records.map(r => r.adcSum);

  const pressureMean = pressures.reduce((a, b) => a + b, 0) / pressures.length;
  const adcMean = adcSums.reduce((a, b) => a + b, 0) / adcSums.length;

  const pressureMaxErr = Math.max(...pressures.map(v => Math.abs(v - pressureMean) / pressureMean * 100));
  const adcMaxErr = Math.max(...adcSums.map(v => Math.abs(v - adcMean) / adcMean * 100));

  const passed = pressureMaxErr <= threshold && adcMaxErr <= threshold;

  return {
    passed,
    message: passed
      ? `重复性检测通过 — 压力偏差${pressureMaxErr.toFixed(2)}%，ADC偏差${adcMaxErr.toFixed(2)}%`
      : `重复性检测未通过 — 压力偏差${pressureMaxErr.toFixed(2)}%，ADC偏差${adcMaxErr.toFixed(2)}%`,
    details: [
      `压力数据：均值${pressureMean.toFixed(2)}N，最大偏差${pressureMaxErr.toFixed(2)}%（阈值±${threshold}%）`,
      `ADC Sum：均值${Math.round(adcMean)}，最大偏差${adcMaxErr.toFixed(2)}%（阈值±${threshold}%）`,
    ],
    maxError: Math.max(pressureMaxErr, adcMaxErr),
    threshold,
  };
}

// 耐久性评估
export function evaluateDurability(
  records: DataRecord[],
  threshold: number
): TestResult {
  if (records.length < 2) {
    return { passed: null, message: '数据不足', details: [] };
  }

  const first = records.slice(0, Math.ceil(records.length * 0.1));
  const last = records.slice(Math.floor(records.length * 0.9));

  const firstMean = first.reduce((a, r) => a + r.adcSum, 0) / first.length;
  const lastMean = last.reduce((a, r) => a + r.adcSum, 0) / last.length;

  const degradation = Math.abs(lastMean - firstMean) / firstMean * 100;
  const passed = degradation <= threshold;

  const invalidCount = records.filter(r => r.adcSum < firstMean * 0.5).length;

  return {
    passed,
    message: passed
      ? `耐久性检测通过 — ADC衰减${degradation.toFixed(2)}%，在±${threshold}%范围内`
      : `耐久性检测未通过 — ADC衰减${degradation.toFixed(2)}%，超出±${threshold}%`,
    details: [
      `初始ADC Sum均值：${Math.round(firstMean)}`,
      `末期ADC Sum均值：${Math.round(lastMean)}`,
      `总衰减：${degradation.toFixed(2)}%（阈值±${threshold}%）`,
      `异常数据点：${invalidCount} 个`,
    ],
    maxError: degradation,
    threshold,
  };
}

/**
 * 导出CSV
 * 思维导图要求格式：Time, Pressure, ADC Value, ADC Sum
 * 其中 ADC Value 是多个传感点的ADC数值（分号分隔）
 * ADC Sum 是多个传感点的ADC数值求和
 */
export function exportToCSV(records: DataRecord[], filename: string = 'test_data.csv'): void {
  const headers = ['Time', 'Pressure(N)', 'ADC Value', 'ADC Sum', 'ADC Sum(Hex)', 'Test Mode', 'Sample Index', 'Product Index'];
  const rows = records.map(r => [
    r.time,
    r.pressure.toFixed(2),
    `"${r.adcValues.join(';')}"`,  // ADC Value: 多个传感点的ADC数值
    r.adcSum.toString(),            // ADC Sum: 多个传感点的ADC数值求和
    r.adcSumHex,
    r.testMode,
    r.sampleIndex,
    r.productIndex ?? '',
  ]);
  const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// 将ADC Sum转为十六进制字符串
export function toHex(value: number): string {
  return '0x' + value.toString(16).toUpperCase().padStart(8, '0');
}
