import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { CartesianGrid, Legend, ResponsiveContainer, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';

interface NumericAxis {
  dataKey: string;
  name: string;
  label: string;
  color: string;
  domain?: ComponentProps<typeof XAxis>['domain'];
  allowDataOverflow?: boolean;
  tickFormatter?: (value: number) => string;
  ticks?: number[];
}

interface ForceScatterPlotProps {
  x: NumericAxis;
  y: NumericAxis;
  tooltip: ComponentProps<typeof Tooltip>['content'];
  legend: ReactElement;
  children: ReactNode;
}

const fontFamily = "'IBM Plex Mono', monospace";
const ticks = { fill: 'var(--jk-text-mid)', fontSize: 10, fontFamily };
const axisLine = { stroke: 'var(--jk-line-3)' };

export function ForceScatterPlot({ x, y, tooltip, legend, children }: ForceScatterPlotProps) {
  return <ResponsiveContainer width="100%" height="100%">
    <ScatterChart margin={{ top: 5, right: 15, left: 5, bottom: 5 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--jk-line-1)" strokeOpacity={0.6} />
      <XAxis dataKey={x.dataKey} name={x.name} type="number" domain={x.domain}
        tick={ticks} axisLine={axisLine} tickLine={axisLine} tickFormatter={x.tickFormatter}
        allowDataOverflow={x.allowDataOverflow} ticks={x.ticks}
        label={{ value: x.label, position: 'insideBottom', offset: -5, fill: x.color, fontSize: 10, fontFamily }} />
      <YAxis dataKey={y.dataKey} name={y.name} type="number" domain={y.domain}
        tick={ticks} axisLine={axisLine} tickLine={axisLine} tickFormatter={y.tickFormatter}
        allowDataOverflow={y.allowDataOverflow} ticks={y.ticks}
        label={{ value: y.label, angle: -90, position: 'insideLeft', fill: y.color, fontSize: 10, fontFamily }} />
      <ZAxis range={[15, 15]} />
      <Tooltip content={tooltip} />
      <Legend content={legend} />
      {children}
    </ScatterChart>
  </ResponsiveContainer>;
}
