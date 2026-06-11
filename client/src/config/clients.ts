/**
 * clients.ts — 客户账号配置
 *
 * 每个客户对应一个 SensorProduct.label 的白名单，
 * 登录后在传感器产品下拉菜单中只显示匹配的条目。
 */

export interface ClientAccount {
  id: string;
  name: string;
  /** 允许显示的传感器产品 label（与 SENSOR_PRODUCTS[].label 精确匹配） */
  allowedProducts: string[];
}

export const CLIENTS: ClientAccount[] = [
  {
    id: 'jq',
    name: 'JQ 工业',
    allowedProducts: [
      '16×16 触觉传感器',
      '32×32 高密度传感器',
    ],
  },
  {
    id: 'haocun',
    name: '灏存科技',
    allowedProducts: [
      '灏存科技定制',
    ],
  },
];

/** 根据客户 ID 查找客户 */
export function getClient(id: string): ClientAccount | undefined {
  return CLIENTS.find(c => c.id === id);
}
