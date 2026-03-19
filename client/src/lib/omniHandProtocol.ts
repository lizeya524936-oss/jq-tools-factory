/**
 * omniHandProtocol - 灵巧手通信协议工具函数
 * 
 * 智元灵巧手串口协议：
 *   帧头: 0xEE 0xAA
 *   设备ID: 2字节 little-endian
 *   数据长度: 1字节 (cmd + data)
 *   命令字: 1字节
 *   数据: N字节
 *   CRC16-CCITT: 2字节 little-endian
 */

export function crc16CCITT(data: Uint8Array): number {
  let crc = 0x0000;
  const poly = 0x1021;
  for (let i = 0; i < data.length; i++) {
    crc ^= (data[i] << 8);
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ poly) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc & 0xFFFF;
}

export function buildPacket(deviceId: number, cmd: number, data: Uint8Array = new Uint8Array(0)): Uint8Array {
  const header = new Uint8Array([0xEE, 0xAA]);
  const idBytes = new Uint8Array(2);
  idBytes[0] = deviceId & 0xFF;
  idBytes[1] = (deviceId >> 8) & 0xFF;
  const dataSegment = new Uint8Array(1 + data.length);
  dataSegment[0] = cmd;
  dataSegment.set(data, 1);
  const dataLength = dataSegment.length;
  const crcInput = new Uint8Array(header.length + idBytes.length + 1 + dataSegment.length);
  let offset = 0;
  crcInput.set(header, offset); offset += header.length;
  crcInput.set(idBytes, offset); offset += idBytes.length;
  crcInput[offset] = dataLength; offset += 1;
  crcInput.set(dataSegment, offset);
  const crc = crc16CCITT(crcInput);
  const crcBytes = new Uint8Array(2);
  crcBytes[0] = crc & 0xFF;
  crcBytes[1] = (crc >> 8) & 0xFF;
  const packet = new Uint8Array(crcInput.length + 2);
  packet.set(crcInput, 0);
  packet.set(crcBytes, crcInput.length);
  return packet;
}

export function buildEnablePacket(deviceId: number): Uint8Array {
  return buildPacket(deviceId, 0x01, new Uint8Array([0x01]));
}

export function buildDisablePacket(deviceId: number): Uint8Array {
  return buildPacket(deviceId, 0x01, new Uint8Array([0x00]));
}

export function buildSetPositionsPacket(deviceId: number, positions: number[]): Uint8Array {
  const data = new Uint8Array(20);
  for (let i = 0; i < 10; i++) {
    const pos = Math.max(0, Math.min(4096, positions[i] || 0));
    data[i * 2] = pos & 0xFF;
    data[i * 2 + 1] = (pos >> 8) & 0xFF;
  }
  return buildPacket(deviceId, 0x08, data);
}

/** 默认设备ID */
export const OMNI_DEVICE_ID = 1;
