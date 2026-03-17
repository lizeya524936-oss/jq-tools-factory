/**
 * TestResultCard - 检测结果评估卡片
 * 显示通过/失败状态、偏差数值、判断详情
 */
import { TestResult } from '@/lib/sensorData';
import { CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface TestResultCardProps {
  result: TestResult | null;
  title: string;
  description?: string;
  isRunning?: boolean;
}

export default function TestResultCard({ result, title, description, isRunning }: TestResultCardProps) {
  const maxError = result?.maxError ?? 0;
  const threshold = result?.threshold ?? 8;

  return (
    <div
      className="rounded p-3"
      style={{
        background: 'oklch(0.17 0.025 265)',
        border: `1px solid ${
          !result ? 'oklch(0.28 0.03 265)'
          : result.passed === true ? 'oklch(0.72 0.20 145 / 0.4)'
          : result.passed === false ? 'oklch(0.65 0.22 25 / 0.4)'
          : 'oklch(0.28 0.03 265)'
        }`,
        transition: 'border-color 0.3s ease',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            {isRunning ? (
              <div
                className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: 'oklch(0.58 0.22 265)', borderTopColor: 'transparent' }}
              />
            ) : !result || result.passed === null ? (
              <AlertCircle size={14} style={{ color: 'oklch(0.50 0.02 240)' }} />
            ) : result.passed ? (
              <CheckCircle size={14} style={{ color: 'oklch(0.72 0.20 145)' }} />
            ) : (
              <XCircle size={14} style={{ color: 'oklch(0.65 0.22 25)' }} />
            )}
            <span className="text-xs font-medium" style={{ color: 'oklch(0.85 0.01 220)' }}>
              {title}
            </span>
          </div>
          {description && (
            <p className="text-xs mb-2" style={{ color: 'oklch(0.55 0.02 240)' }}>
              {description}
            </p>
          )}
          {result && result.passed !== null && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)' }}>
                  最大偏差
                </span>
                <span
                  className="text-xs font-mono font-medium"
                  style={{
                    color: result.passed ? 'oklch(0.72 0.20 145)' : 'oklch(0.65 0.22 25)',
                  }}
                >
                  {maxError.toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)' }}>
                  判定阈值
                </span>
                <span className="text-xs font-mono" style={{ color: 'oklch(0.60 0.02 240)' }}>
                  ±{threshold}%
                </span>
              </div>
              {/* 偏差进度条 */}
              <div className="mt-2">
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ background: 'oklch(0.22 0.03 265)' }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (maxError / (threshold * 2)) * 100)}%`,
                      background: result.passed
                        ? 'oklch(0.72 0.20 145)'
                        : 'oklch(0.65 0.22 25)',
                    }}
                  />
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-xs font-mono" style={{ fontSize: '9px', color: 'oklch(0.45 0.02 240)' }}>0%</span>
                  <span className="text-xs font-mono" style={{ fontSize: '9px', color: 'oklch(0.45 0.02 240)' }}>
                    阈值 {threshold}%
                  </span>
                </div>
              </div>
              {/* 详情列表 */}
              {result.details && result.details.length > 0 && (
                <div
                  className="mt-1 p-1.5 rounded space-y-0.5"
                  style={{ background: 'oklch(0.14 0.02 265)' }}
                >
                  {result.details.map((d, i) => (
                    <div key={i} className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)', fontSize: '10px' }}>
                      {d}
                    </div>
                  ))}
                </div>
              )}
              {/* 结论 */}
              <div
                className="text-xs font-mono mt-1 p-1.5 rounded"
                style={{
                  background: result.passed ? 'oklch(0.72 0.20 145 / 0.08)' : 'oklch(0.65 0.22 25 / 0.08)',
                  color: result.passed ? 'oklch(0.72 0.20 145)' : 'oklch(0.65 0.22 25)',
                  fontSize: '10px',
                }}
              >
                {result.message}
              </div>
            </div>
          )}
          {(!result || result.passed === null) && !isRunning && (
            <div className="text-xs font-mono" style={{ color: 'oklch(0.40 0.02 240)' }}>
              等待检测...
            </div>
          )}
          {isRunning && (
            <div className="text-xs font-mono" style={{ color: 'oklch(0.58 0.22 265)' }}>
              正在采集数据...
            </div>
          )}
        </div>
        {result && result.passed !== null && (
          <div
            className="px-2 py-1 rounded text-xs font-mono font-medium flex-shrink-0"
            style={{
              background: result.passed
                ? 'oklch(0.72 0.20 145 / 0.12)'
                : 'oklch(0.65 0.22 25 / 0.12)',
              color: result.passed ? 'oklch(0.72 0.20 145)' : 'oklch(0.65 0.22 25)',
              border: `1px solid ${result.passed ? 'oklch(0.72 0.20 145 / 0.3)' : 'oklch(0.65 0.22 25 / 0.3)'}`,
            }}
          >
            {result.passed ? 'PASS' : 'FAIL'}
          </div>
        )}
      </div>
    </div>
  );
}
