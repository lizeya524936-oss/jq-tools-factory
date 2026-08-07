/**
 * clients.ts — 客户账号配置
 *
 * 每个客户对应一个 SensorProduct.label 的白名单，
 * 登录后在传感器产品下拉菜单中只显示匹配的条目。
 */

export interface ClientAccount {
  id: string;
  name: string;
  /** 登录用户名 */
  username: string;
  /** 登录密码 */
  password: string;
  /** 允许显示的传感器产品 label（与 SENSOR_PRODUCTS[].label 精确匹配） */
  allowedProducts: string[];
}

export const CLIENTS: ClientAccount[] = [
  {
    id: 'jq',
    name: 'JQ 工业',
    username: 'jq',
    password: 'jq2026',
    allowedProducts: [
      '16×16 触觉传感器',
      '32×32 高密度传感器',
    ],
  },
  {
    id: 'haocun',
    name: '灏存科技',
    username: 'haocun',
    password: 'hc2026',
    allowedProducts: [
      '灏存科技定制',
    ],
  },
  {
    id: 'jizhi',
    name: '极智动量',
    username: 'jizhi',
    password: 'jz2026',
    allowedProducts: [
      '极智动量小黑采集板',
    ],
  },
  {
    id: 'lingxin',
    name: '灵心巧手',
    username: 'lingxin',
    password: 'lx2026',
    allowedProducts: [
      '灵心巧手 16×16',
    ],
  },
  {
    id: 'xingchen',
    name: '星尘科技',
    username: 'xingchen',
    password: 'xc2026',
    allowedProducts: [
      '星尘科技 20×14',
    ],
  },
];

/** 根据用户名和密码验证客户 */
export function authenticateClient(username: string, password: string): ClientAccount | null {
  const c = CLIENTS.find(c => c.username === username && c.password === password);
  return c ?? null;
}

/** 根据客户 ID 查找客户 */
export function getClient(id: string): ClientAccount | undefined {
  return CLIENTS.find(c => c.id === id);
}
