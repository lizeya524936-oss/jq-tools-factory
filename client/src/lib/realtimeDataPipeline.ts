/**
 * RealtimeDataPipeline - 实时数据流处理管道
 * 
 * 设计原则：
 * 1. 完全避免 React State 驱动的高频更新
 * 2. 使用 Ref 和回调直接处理数据流
 * 3. 只在必要时（如数据采集、导出）才访问数据
 * 4. 支持多个订阅者，但不阻塞数据流
 * 5. v1.8.5: 自适应帧率检测 — 自动统计传感器和压力计的实际发送频率
 * 6. v1.8.8: 帧去重 — updateSensorData 检测数据是否真正变化，避免重复帧通知
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

/**
 * 帧率统计器 — 通过滑动窗口计算实际帧率
 */
class FrameRateTracker {
  private timestamps: number[] = [];
  private windowSize: number; // 滑动窗口大小（帧数）
  private _fps: number = 0;
  private _frameInterval: number = 0; // 帧间隔（ms）
  private lastUpdateTime: number = 0;
  private recalcInterval: number = 500; // 每500ms重新计算一次帧率

  constructor(windowSize: number = 30) {
    this.windowSize = windowSize;
  }

  /** 记录一帧到达 */
  tick(): void {
    const now = performance.now();
    this.timestamps.push(now);

    // 保持窗口大小
    while (this.timestamps.length > this.windowSize) {
      this.timestamps.shift();
    }

    // 每 recalcInterval 重新计算帧率，避免每帧都计算
    if (now - this.lastUpdateTime >= this.recalcInterval) {
      this.recalculate();
      this.lastUpdateTime = now;
    }
  }

  /** 重新计算帧率 */
  private recalculate(): void {
    if (this.timestamps.length < 2) {
      this._fps = 0;
      this._frameInterval = 0;
      return;
    }

    const first = this.timestamps[0];
    const last = this.timestamps[this.timestamps.length - 1];
    const elapsed = last - first; // ms

    if (elapsed <= 0) {
      this._fps = 0;
      this._frameInterval = 0;
      return;
    }

    const frameCount = this.timestamps.length - 1;
    this._fps = Math.round((frameCount / elapsed) * 1000 * 10) / 10; // 保留1位小数
    this._frameInterval = Math.round(elapsed / frameCount); // ms
  }

  /** 获取当前帧率 (Hz) */
  get fps(): number {
    return this._fps;
  }

  /** 获取帧间隔 (ms) */
  get frameInterval(): number {
    return this._frameInterval;
  }

  /** 重置统计 */
  reset(): void {
    this.timestamps = [];
    this._fps = 0;
    this._frameInterval = 0;
    this.lastUpdateTime = 0;
  }
}

class RealtimeDataPipeline {
  private currentData: DataSnapshot = {
    timestamp: 0,
    forceN: null,
    sensorMatrix: null,
    adcValues: null,
  };

  private subscribers: Set<DataSubscriber> = new Set();
  private forceCallbacks: Set<(forceN: number) => void> = new Set();
  private lastUpdateTime: number = 0;
  private updateCount: number = 0;

  // ===== 帧率统计 =====
  private sensorFrameRate = new FrameRateTracker(60);
  private forceFrameRate = new FrameRateTracker(60);

  // ===== 新帧通知（用于自适应采集） =====
  private sensorFrameCallbacks: Set<(snapshot: DataSnapshot) => void> = new Set();
  private forceFrameCallbacks: Set<(forceN: number) => void> = new Set();

  // ===== 传感器帧序号（用于去重） =====
  private sensorFrameSeq: number = 0;

  // ===== 帧去重：上一帧的数据签名 =====
  private lastFrameSignature: string = '';

  // ===== 调试统计 =====
  private debugCallCount: number = 0;
  private debugNewFrameCount: number = 0;
  private debugDupFrameCount: number = 0;
  private debugLastLogTime: number = 0;

  /**
   * 计算矩阵数据的快速签名（用于帧去重）
   * 使用采样策略：取矩阵的4个角 + 中心 + 对角线上的若干点，避免全量比较
   */
  private computeFrameSignature(matrix: number[][]): string {
    if (!matrix || matrix.length === 0) return '';
    const rows = matrix.length;
    const cols = matrix[0]?.length || 0;
    if (cols === 0) return '';

    // 采样关键位置的值（快速但足够区分不同帧）
    const samples: number[] = [];
    // 四角
    samples.push(matrix[0][0]);
    samples.push(matrix[0][cols - 1]);
    samples.push(matrix[rows - 1][0]);
    samples.push(matrix[rows - 1][cols - 1]);
    // 中心
    const midR = Math.floor(rows / 2);
    const midC = Math.floor(cols / 2);
    samples.push(matrix[midR][midC]);
    // 对角线采样（每隔几行取一个）
    const step = Math.max(1, Math.floor(rows / 8));
    for (let i = 0; i < rows; i += step) {
      const c = Math.floor((i / rows) * cols);
      samples.push(matrix[i][c]);
    }
    // 额外：第一行和最后一行的求和（捕捉整体变化）
    let sum0 = 0, sumN = 0;
    for (let c = 0; c < cols; c++) {
      sum0 += matrix[0][c];
      sumN += matrix[rows - 1][c];
    }
    samples.push(sum0, sumN);

    return samples.join(',');
  }

  /**
   * 更新压力数据
   * 直接更新，不触发 React 重新渲染
   */
  updateForceData(forceN: number): void {
    this.currentData.forceN = forceN;
    this.currentData.timestamp = Date.now();
    this.updateCount++;
    this.forceFrameRate.tick();

    // 直接通知专用的 force 回调（零开销，不创建 snapshot 对象）
    this.forceCallbacks.forEach(cb => {
      try {
        cb(forceN);
      } catch (error) {
        console.error('Force callback error:', error);
      }
    });

    // 通知新帧回调（自适应采集用）
    this.forceFrameCallbacks.forEach(cb => {
      try {
        cb(forceN);
      } catch (error) {
        console.error('Force frame callback error:', error);
      }
    });

    this.notifySubscribers();
  }

  /**
   * 更新传感器矩阵数据
   * 直接更新，不触发 React 重新渲染
   * 
   * v1.8.8: 添加帧去重 — 如果数据与上一帧完全相同，则跳过帧通知
   * 这确保 subscribeSensorFrame 只在真正有新数据时触发
   */
  updateSensorData(matrix: number[][]): void {
    // ===== 帧去重：检测数据是否真正变化 =====
    const signature = this.computeFrameSignature(matrix);
    const isNewFrame = signature !== this.lastFrameSignature;

    // 始终更新数据（UI 需要最新数据）
    this.currentData.sensorMatrix = matrix;
    this.currentData.adcValues = matrix.flat();
    this.currentData.timestamp = Date.now();
    this.updateCount++;

    // 调试统计
    this.debugCallCount++;
    if (isNewFrame) {
      this.debugNewFrameCount++;
    } else {
      this.debugDupFrameCount++;
    }

    const now = performance.now();
    if (now - this.debugLastLogTime >= 2000) {
      console.log(
        `[Pipeline] updateSensorData: ${this.debugCallCount}calls/2s, ` +
        `新帧: ${this.debugNewFrameCount}, 重复帧: ${this.debugDupFrameCount}, ` +
        `sensorFrameCallbacks: ${this.sensorFrameCallbacks.size}, ` +
        `fps: ${this.sensorFrameRate.fps}`
      );
      this.debugCallCount = 0;
      this.debugNewFrameCount = 0;
      this.debugDupFrameCount = 0;
      this.debugLastLogTime = now;
    }

    // ===== 只有新帧才触发帧率统计和帧通知 =====
    if (isNewFrame) {
      this.lastFrameSignature = signature;
      this.sensorFrameSeq++;
      this.sensorFrameRate.tick();

      // 通知新帧回调（自适应采集用）
      const snapshot = { ...this.currentData };
      this.sensorFrameCallbacks.forEach(cb => {
        try {
          cb(snapshot);
        } catch (error) {
          console.error('Sensor frame callback error:', error);
        }
      });
    }

    // 通用订阅者始终通知（用于 UI 更新等）
    this.notifySubscribers();
  }

  /**
   * 更新传感器 ADC 数据（一维数组）
   * 注意：此方法只更新 adcValues，不触发帧通知和帧率统计
   * 因为 updateSensorData() 已经处理了帧通知，避免每帧重复通知2次
   */
  updateAdcData(adcValues: number[]): void {
    this.currentData.adcValues = adcValues;
    this.currentData.timestamp = Date.now();
    // 不递增 sensorFrameSeq、不 tick 帧率、不通知 sensorFrameCallbacks
    // 因为 updateSensorData() 已经做了这些操作
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
   * 获取传感器帧序号（用于去重判断）
   */
  getSensorFrameSeq(): number {
    return this.sensorFrameSeq;
  }

  // ===== 帧率查询接口 =====

  /** 获取传感器帧率 (Hz) */
  getSensorFps(): number {
    return this.sensorFrameRate.fps;
  }

  /** 获取传感器帧间隔 (ms) */
  getSensorFrameInterval(): number {
    return this.sensorFrameRate.frameInterval;
  }

  /** 获取压力计帧率 (Hz) */
  getForceFps(): number {
    return this.forceFrameRate.fps;
  }

  /** 获取压力计帧间隔 (ms) */
  getForceFrameInterval(): number {
    return this.forceFrameRate.frameInterval;
  }

  // ===== 订阅接口 =====

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
   * 订阅压力数据更新（专用通道，仅在 updateForceData 时触发）
   * 回调直接接收 forceN 数值，零开销，不创建 snapshot 对象
   * 返回取消订阅函数
   */
  subscribeForce(callback: (forceN: number) => void): () => void {
    this.forceCallbacks.add(callback);
    return () => {
      this.forceCallbacks.delete(callback);
    };
  }

  /**
   * 订阅传感器新帧到达（自适应采集用）
   * 每当传感器有新帧数据时触发，频率等于传感器实际发送频率
   * v1.8.8: 只有数据真正变化时才触发（帧去重）
   * 返回取消订阅函数
   */
  subscribeSensorFrame(callback: (snapshot: DataSnapshot) => void): () => void {
    this.sensorFrameCallbacks.add(callback);
    return () => {
      this.sensorFrameCallbacks.delete(callback);
    };
  }

  /**
   * 订阅压力计新帧到达（自适应采集用）
   * 每当压力计有新数据时触发
   * 返回取消订阅函数
   */
  subscribeForceFrame(callback: (forceN: number) => void): () => void {
    this.forceFrameCallbacks.add(callback);
    return () => {
      this.forceFrameCallbacks.delete(callback);
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
    sensorFps: number;
    forceFps: number;
    sensorFrameInterval: number;
    forceFrameInterval: number;
  } {
    return {
      updateCount: this.updateCount,
      lastUpdateTime: this.lastUpdateTime,
      subscriberCount: this.subscribers.size,
      sensorFps: this.sensorFrameRate.fps,
      forceFps: this.forceFrameRate.fps,
      sensorFrameInterval: this.sensorFrameRate.frameInterval,
      forceFrameInterval: this.forceFrameRate.frameInterval,
    };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.updateCount = 0;
    this.lastUpdateTime = 0;
    this.sensorFrameRate.reset();
    this.forceFrameRate.reset();
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
    this.sensorFrameCallbacks.clear();
    this.forceFrameCallbacks.clear();
    this.sensorFrameRate.reset();
    this.forceFrameRate.reset();
    this.sensorFrameSeq = 0;
    this.lastFrameSignature = '';
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
