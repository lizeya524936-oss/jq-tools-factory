/**
 * Serial Driver Service - 使用 Web Serial API 实现串口通信
 * 支持 CL2 测力仪的新协议
 * 
 * 连接配置：
 * - 波特率: 19200
 * - 字节位: 8
 * - 校验位: N (无)
 * - 停止位: 1
 * 
 * 命令定义:
 * - 连接: 0x23 0x50 0x00 0x0A
 * - 重置: 0x23 0x55 0x00 0x0A
 * - 开始采集: 0x23 0x51 0x00 0x0A
 * - 停止采集: 0x23 0x52 0x00 0x0A
 * 
 * 数据格式: 0x23 + 4字节浮点数(小端) + 0x0A
 */

export interface SerialPortOptions {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: 'none' | 'even' | 'odd';
  flowControl?: 'none' | 'hardware';
}

export interface PressureData {
  value: number;
  timestamp: number;
  unit: 'N';
}

export class SerialDriver {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private isConnected = false;
  private buffer = new Uint8Array(0);
  private onDataCallback: ((data: PressureData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private onStatusCallback: ((status: string) => void) | null = null;
  private readingThread: Promise<void> | null = null;
  private shouldStop = false;
  private latestPressureValue: number | null = null;
  
  // 全局统计数据（组件卸载后仍持久保存）
  private globalDataPointCount: number = 0;
  private globalCollectionStartTime: number | null = null;

  // CL2 协议命令
  private readonly CMD_CONNECT = new Uint8Array([0x23, 0x50, 0x00, 0x0A]);
  private readonly CMD_RESET = new Uint8Array([0x23, 0x55, 0x00, 0x0A]);
  private readonly CMD_START = new Uint8Array([0x23, 0x51, 0x00, 0x0A]);
  private readonly CMD_STOP = new Uint8Array([0x23, 0x52, 0x00, 0x0A]);

  /**
   * 检查浏览器是否支持 Web Serial API
   */
  static isSupported(): boolean {
    return 'serial' in navigator;
  }

  /**
   * 连接到串口设备
   */
  async connect(options: SerialPortOptions = { baudRate: 19200 }): Promise<boolean> {
    try {
      if (!SerialDriver.isSupported()) {
        throw new Error('浏览器不支持 Web Serial API');
      }

      // 打开端口选择对话框
      this.port = await navigator.serial.requestPort();
      this.onStatus('已选择串口设备');

      // 打开串口连接
      await this.port.open({
        baudRate: options.baudRate,
        dataBits: (options.dataBits || 8) as 8 | 7,
        stopBits: (options.stopBits || 1) as 1 | 2,
        parity: options.parity || 'none',
        flowControl: options.flowControl || 'none',
      });

      this.isConnected = true;
      this.shouldStop = false;
      // 重置全局统计数据（新连接时从零开始计数）
      this.globalDataPointCount = 0;
      this.globalCollectionStartTime = null;
      this.onStatus(`串口已连接 (波特率: ${options.baudRate})`);

      // 获取读写器
      if (!this.port) throw new Error('串口未初始化');
      this.reader = this.port.readable!.getReader();
      this.writer = this.port.writable!.getWriter();

      // 发送连接命令
      await this.sendCommand(this.CMD_CONNECT);
      this.onStatus('已发送连接命令');

      // 等待一下
      await new Promise(resolve => setTimeout(resolve, 500));

      // 发送开始采集命令
      await this.sendCommand(this.CMD_START);
      this.onStatus('已发送开始采集命令');

      // 启动读取线程
      this.startReading();

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.onError(`连接失败: ${message}`);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * 断开串口连接
   */
  async disconnect(): Promise<void> {
    try {
      this.shouldStop = true;

      // 发送停止采集命令
      if (this.writer) {
        try {
          await this.sendCommand(this.CMD_STOP);
        } catch (e) {
          // 忽略错误
        }
      }

      // 等待读取线程结束
      if (this.readingThread) {
        await this.readingThread;
      }

      // 释放读写器
      if (this.reader) {
        await this.reader.cancel();
        this.reader = null;
      }

      if (this.writer) {
        await this.writer.close();
        this.writer = null;
      }

      // 关闭端口
      if (this.port) {
        await this.port.close();
        this.port = null;
      }

      this.isConnected = false;
      this.onStatus('串口已断开连接');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.onError(`断开连接失败: ${message}`);
    }
  }

  /**
   * 重置/归零
   */
  async reset(): Promise<void> {
    try {
      if (!this.isConnected) {
        throw new Error('串口未连接');
      }
      await this.sendCommand(this.CMD_RESET);
      this.onStatus('已发送重置命令');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.onError(`重置失败: ${message}`);
    }
  }

  /**
   * 发送命令到串口
   */
  private async sendCommand(cmd: Uint8Array): Promise<void> {
    if (!this.writer) {
      throw new Error('串口写入器未初始化');
    }

    await this.writer.write(cmd);
  }

  /**
   * 启动读取线程
   */
  private startReading(): void {
    this.readingThread = this.readLoop();
  }

  /**
   * 读取循环
   */
  private async readLoop(): Promise<void> {
    try {
      if (!this.reader) return;

      while (!this.shouldStop && this.isConnected) {
        const { value, done } = await this.reader.read();

        if (done) {
          this.onStatus('串口连接已关闭');
          this.isConnected = false;
          break;
        }

        if (value) {
          // 将新数据添加到缓冲区
          const newBuffer = new Uint8Array(this.buffer.length + value.length);
          newBuffer.set(this.buffer);
          newBuffer.set(value, this.buffer.length);
          this.buffer = newBuffer;

          // 解析缓冲区中的数据
          this.parseBuffer();
        }
      }
    } catch (error) {
      if (!this.shouldStop) {
        const message = error instanceof Error ? error.message : String(error);
        this.onError(`读取错误: ${message}`);
      }
      this.isConnected = false;
    }
  }

  /**
   * 解析缓冲区中的压力数据
   * 格式: 0x23 + 4字节浮点数(小端) + 0x0A (总6字节)
   */
  private parseBuffer(): void {
    while (this.buffer.length >= 6) {
      // 查找帧头 0x23
      const startIndex = this.buffer.indexOf(0x23);
      
      if (startIndex === -1) {
        // 没有找到帧头，清空缓冲区
        this.buffer = new Uint8Array(0);
        break;
      }

      if (startIndex > 0) {
        // 移除帧头前的数据
        this.buffer = this.buffer.slice(startIndex);
      }

      // 检查是否有完整的帧
      if (this.buffer.length < 6) {
        break;
      }

      // 检查帧尾 0x0A
      if (this.buffer[5] !== 0x0A) {
        // 帧尾不正确，移除这个字节并继续
        this.buffer = this.buffer.slice(1);
        continue;
      }

      // 提取 4 字节数据
      const dataBytes = this.buffer.slice(1, 5);
      
      try {
        // 使用小端解析为 32 位浮点数
        const dataView = new DataView(dataBytes.buffer, dataBytes.byteOffset, 4);
        const value = dataView.getFloat32(0, true); // true 表示小端

        if (!isNaN(value)) {
          const data: PressureData = {
            value,
            timestamp: Date.now(),
            unit: 'N',
          };

          this.onData(data);
        }
      } catch (error) {
        console.error(`解析错误: ${Array.from(dataBytes).map(b => '0x' + b.toString(16).toUpperCase()).join(' ')}`);
      }

      // 移除已处理的帧
      this.buffer = this.buffer.slice(6);
    }
  }

  /**
   * 注册数据回调
   */
  onData(data: PressureData): void {
    // 保存最新的压力值
    this.latestPressureValue = data.value;
    // 同步更新全局统计（组件卸载后仍持久保存）
    this.globalDataPointCount += 1;
    if (this.globalCollectionStartTime === null) {
      this.globalCollectionStartTime = Date.now();
    }
    if (this.onDataCallback) {
      this.onDataCallback(data);
    }
  }

  /**
   * 注册错误回调
   */
  onError(message: string): void {
    console.error(`[SerialDriver] ${message}`);
    if (this.onErrorCallback) {
      this.onErrorCallback(message);
    }
  }

  /**
   * 注册状态回调
   */
  onStatus(message: string): void {
    console.log(`[SerialDriver] ${message}`);
    if (this.onStatusCallback) {
      this.onStatusCallback(message);
    }
  }

  /**
   * 设置数据回调
   */
  setDataCallback(callback: (data: PressureData) => void): void {
    this.onDataCallback = callback;
  }

  /**
   * 设置错误回调
   */
  setErrorCallback(callback: (error: string) => void): void {
    this.onErrorCallback = callback;
  }

  /**
   * 设置状态回调
   */
  setStatusCallback(callback: (status: string) => void): void {
    this.onStatusCallback = callback;
  }

  /**
   * 获取最新的压力值
   */
  getLatestPressure(): number | null {
    return this.latestPressureValue;
  }

  /**
   * 获取连接状态
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * 获取全局数据点计数（组件卸载后仍持久）
   */
  getGlobalDataPointCount(): number {
    return this.globalDataPointCount;
  }

  /**
   * 获取全局采集开始时间（组件卸载后仍持久）
   */
  getGlobalCollectionStartTime(): number | null {
    return this.globalCollectionStartTime;
  }

  /**
   * 重置全局统计数据
   */
  resetGlobalStats(): void {
    this.globalDataPointCount = 0;
    this.globalCollectionStartTime = Date.now();
  }
}

// 全局单例
let serialDriverInstance: SerialDriver | null = null;

export function getSerialDriver(): SerialDriver {
  if (!serialDriverInstance) {
    serialDriverInstance = new SerialDriver();
  }
  return serialDriverInstance;
}
