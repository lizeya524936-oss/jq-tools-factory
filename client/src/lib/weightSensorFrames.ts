import { getSensorDataStreamV2 } from './sensorDataStreamV2';

export interface WeightSensorFrame {
  matrix: number[][];
  rows: number;
  cols: number;
  sequence: number;
  receivedAt: number;
  deviceType?: string;
}

/** Subscribe to complete, row-mapped serial frames, including equal consecutive samples. */
export function subscribeWeightSensorFrames(listener: (frame: WeightSensorFrame) => void): () => void {
  return getSensorDataStreamV2().subscribe(({ matrix, sequence, receivedAt }) => {
    if (!matrix?.length || !matrix[0].length) return;
    listener({ matrix, rows: matrix.length, cols: matrix[0].length, sequence, receivedAt });
  });
}
