/**
 * 传感器数据流架构 V2 - 高效实时数据处理
 * 
 * 设计原则：
 * 1. 单一数据源 - 所有数据都来自 processSensorPackets 中的 fullData
 * 2. 零延迟 - 使用 Ref 而不是 State，避免 React 重新渲染
 * 3. 高效同步 - 矩阵和 ADC 值从同一个 fullData 派生，保证同步
 * 4. 实时采集 - 采集时直接读取最新的 Ref 数据
 */

export interface SensorDataSnapshot {
  timestamp: number;
  matrix: number[][] | null;
  adcValues: number[] | null;
  rawBytes: Uint8Array | null;
}

class SensorDataStreamV2 {
  private currentSnapshot: SensorDataSnapshot = {
    timestamp: Date.now(),
    matrix: null,
    adcValues: null,
    rawBytes: null,
  };

  private subscribers: Set<(snapshot: SensorDataSnapshot) => void> = new Set();

  /**
   * 更新传感器数据（从 processSensorPackets 调用）
   * 这是唯一的数据更新入口，确保所有数据来自同一个源
   */
  updateSensorData(matrix: number[][], adcValues: number[], rawBytes: Uint8Array) {
    this.currentSnapshot = {
      timestamp: Date.now(),
      matrix,
      adcValues,
      rawBytes,
    };

    // 通知所有订阅者
    this.subscribers.forEach(callback => {
      try {
        callback(this.currentSnapshot);
      } catch (error) {
        console.error('Sensor data subscriber error:', error);
      }
    });
  }

  /**
   * 获取当前快照（采集时使用）
   */
  getCurrentSnapshot(): SensorDataSnapshot {
    return {
      ...this.currentSnapshot,
      // 深拷贝数组，避免外部修改
      matrix: this.currentSnapshot.matrix ? this.currentSnapshot.matrix.map(row => [...row]) : null,
      adcValues: this.currentSnapshot.adcValues ? [...this.currentSnapshot.adcValues] : null,
      rawBytes: this.currentSnapshot.rawBytes ? new Uint8Array(this.currentSnapshot.rawBytes) : null,
    };
  }

  /**
   * 订阅数据更新（用于实时显示）
   */
  subscribe(callback: (snapshot: SensorDataSnapshot) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * 获取最新的 ADC 值（采集时直接使用，零延迟）
   */
  getLatestAdcValues(): number[] | null {
    return this.currentSnapshot.adcValues;
  }

  /**
   * 获取最新的矩阵（采集时直接使用，零延迟）
   */
  getLatestMatrix(): number[][] | null {
    return this.currentSnapshot.matrix;
  }
}

// 全局单例
let instance: SensorDataStreamV2 | null = null;

export function getSensorDataStreamV2(): SensorDataStreamV2 {
  if (!instance) {
    instance = new SensorDataStreamV2();
  }
  return instance;
}
