import { CURVE_MAX_N, massToForce, MAX_WEIGHT_G, validateWeightPlan, WEIGHT_STEPS } from './calibration';

export function parseWeightDraft(draft: readonly string[]): number[] {
  return validateWeightPlan(draft.map(value => value.trim() === '' ? NaN : Number(value)));
}

export default function WeightPlanEditor({ plan, draft, onChange, onApply, disabled, hasMeasurements }: {
  plan: number[];
  draft: string[];
  onChange: (draft: string[]) => void;
  onApply: () => void;
  disabled: boolean;
  hasMeasurements: boolean;
}) {
  const dirty = draft.some((value, index) => value.trim() === '' || Number(value) !== plan[index]);
  let error: string | null = null;
  try { parseWeightDraft(draft); }
  catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  return <form className="weight-plan-editor" aria-label="六档重量设置" noValidate onSubmit={event => { event.preventDefault(); if (!disabled && dirty && !error) onApply(); }}>
    <div className="weight-plan-heading"><strong>自定义六档重量</strong><span>单位：g</span></div>
    <p>填写每一档放置的砝码总质量。首档固定为 0 g 零点，其余五档从小到大排列。</p>
    <div className="weight-plan-fields">{draft.map((value, index) => {
      const mass = value.trim() ? Number(value) : NaN;
      const force = Number.isFinite(mass) && mass >= 0 ? massToForce(mass) : null;
      return <label key={index}><span>第 {index + 1} 档{index === 0 ? ' · 零点' : ''}</span><input aria-label={`第${index + 1}档重量（g）`} type="number" min="0" max={MAX_WEIGHT_G} step="any" inputMode="decimal" value={value} disabled={disabled || index === 0} onChange={event => onChange(draft.map((old, position) => position === index ? event.target.value : old))} /><small>{force === null ? '— N' : `${force.toFixed(4)} N`}</small></label>;
    })}</div>
    <p className="weight-plan-limit">当前工具用于 0–{CURVE_MAX_N} N，最高档不超过约 {MAX_WEIGHT_G.toFixed(2)} g；支持小数重量。</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {dirty && <p className="weight-plan-pending" role="status">修改尚未应用，请先应用或取消修改，再开始采集。{hasMeasurements && '应用新方案会清空本轮测点和拟合结果，请先导出需要保留的数据。'}</p>}
    <div className="weight-plan-actions"><button type="submit" className="button small primary" disabled={disabled || !dirty || !!error}>{hasMeasurements ? '应用并清空本轮数据' : '应用重量设置'}</button>{dirty && <button type="button" className="text-button" disabled={disabled} onClick={() => onChange(plan.map(String))}>取消修改</button>}<button type="button" className="text-button" disabled={disabled} onClick={() => onChange(WEIGHT_STEPS.map(String))}>填入默认重量</button></div>
    <p className="weight-plan-current">当前方案：{plan.join(' / ')} g</p>
  </form>;
}
