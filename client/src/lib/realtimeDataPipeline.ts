/**
 * RealtimeDataPipeline - 实时数据流处理管道
 * 
 * 设计原则：
 * 1. 完全避免 React State 驱动的高频更新
 * 2. 使用 Ref 和回调直接处理数据流
 * 3. 只在必要时（如数据采集、导出）才访问数据
 * 4. 支持多个订阅者，但不阻塞数据流
 * 
 * 数据流：
 * 串口 → useSerialPort → RealtimeDataPipeline → 订阅者（采集、显示、导出）
 */

export interface DataSnapshot {
  timestamp: number;
  forceN: number | null;
  sensorMatrix: number[][] | null;
  adcValues: number[] | null;
}

export interface DataSubscriber {
  onData: (snapshot: DataSnapshot) => void;
}

class RealtimeDataPipeline {
  private currentData: DataSnapshot = {
    timestamp: 0,
    forceN: null,
    sensorMatrix: null,
    adcValues: null,
  };

  private subscribers: Set<DataSubscriber> = new Set();
  private lastUpdateTime: number = 0;
  private updateCount: number = 0;

  /**
   * 更新压力数据
   * 直接更新，不触发 React 重新渲染
   */
  updateForceData(forceN: number): void {
    this.currentData.forceN = forceN;
    this.currentData.timestamp = Date.now();
    this.notifySubscribers();
  }

  /**
   * 更新传感器矩阵数据
   * 直接更新，不触发 React 重新渲染
   */
  updateSensorData(matrix: number[][]): void {
    this.currentData.sensorMatrix = matrix;
    this.currentData.adcValues = matrix.flat();
    this.currentData.timestamp = Date.now();
    this.updateCount++;
    this.notifySubscribers();
  }

  /**
   * 更新传感器 ADC 数据（一维数组）
   */
  updateAdcData(adcValues: number[]): void {
    this.currentData.adcValues = adcValues;
    this.currentData.timestamp = Date.now();
    this.updateCount++;
    this.notifySubscribers();
  }

  /**
   * 获取当前数据快照（不复制，直接返回引用）
   * 调用者不应修改返回的对象
   */
  getCurrentSnapshot(): DataSnapshot {
    return this.currentData;
  }

  /**
   * 获取最新的压力值
   */
  getLatestForce(): number | null {
    return this.currentData.forceN;
  }

  /**
   * 获取最新的 ADC 值
   */
  getLatestAdcValues(): number[] | null {
    return this.currentData.adcValues;
  }

  /**
   * 获取最新的传感器矩阵
   */
  getLatestSensorMatrix(): number[][] | null {
    return this.currentData.sensorMatrix;
  }

  /**
   * 订阅数据更新
   * 返回取消订阅函数
   */
  subscribe(subscriber: DataSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /**
   * 通知所有订阅者
   * 使用 try-catch 防止单个订阅者的错误影响其他订阅者
   */
  private notifySubscribers(): void {
    const snapshot = { ...this.currentData };
    this.subscribers.forEach(subscriber => {
      try {
        subscriber.onData(snapshot);
      } catch (error) {
        console.error('DataPipeline subscriber error:', error);
      }
    });
  }

  /**
   * 获取性能统计信息
   */
  getStats(): {
    updateCount: number;
    lastUpdateTime: number;
    subscriberCount: number;
  } {
    return {
      updateCount: this.updateCount,
      lastUpdateTime: this.lastUpdateTime,
      subscriberCount: this.subscribers.size,
    };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.updateCount = 0;
    this.lastUpdateTime = 0;
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    this.currentData = {
      timestamp: 0,
      forceN: null,
      sensorMatrix: null,
      adcValues: null,
    };
    this.subscribers.clear();
  }
}

// 全局单例
let pipelineInstance: RealtimeDataPipeline | null = null;

export function getRealtimeDataPipeline(): RealtimeDataPipeline {
  if (!pipelineInstance) {
    pipelineInstance = new RealtimeDataPipeline();
  }
  return pipelineInstance;
}
