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
        background: 'var(--jk-s2)',
        border: `1px solid ${
          !result ? 'var(--jk-line-2)'
          : result.passed === true ? 'color-mix(in srgb, var(--jk-ok) 40%, transparent)'
          : result.passed === false ? 'color-mix(in srgb, var(--jk-danger) 40%, transparent)'
          : 'var(--jk-line-2)'
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
                style={{ borderColor: 'var(--jk-primary)', borderTopColor: 'transparent' }}
              />
            ) : !result || result.passed === null ? (
              <AlertCircle size={14} style={{ color: 'var(--jk-text-mid)' }} />
            ) : result.passed ? (
              <CheckCircle size={14} style={{ color: 'var(--jk-ok)' }} />
            ) : (
              <XCircle size={14} style={{ color: 'var(--jk-danger)' }} />
            )}
            <span className="text-xs font-medium" style={{ color: 'var(--jk-ink)' }}>
              {title}
            </span>
          </div>
          {description && (
            <p className="text-xs mb-2" style={{ color: 'var(--jk-text-body)' }}>
              {description}
            </p>
          )}
          {result && result.passed !== null && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono" style={{ color: 'var(--jk-text-body)' }}>
                  最大偏差
                </span>
                <span
                  className="text-xs font-mono font-medium"
                  style={{
                    color: result.passed ? 'var(--jk-ok)' : 'var(--jk-danger)',
                  }}
                >
                  {maxError.toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono" style={{ color: 'var(--jk-text-body)' }}>
                  判定阈值
                </span>
                <span className="text-xs font-mono" style={{ color: 'var(--jk-text-high)' }}>
                  ±{threshold}%
                </span>
              </div>
              {/* 偏差进度条 */}
              <div className="mt-2">
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ background: 'var(--jk-s4)' }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (maxError / (threshold * 2)) * 100)}%`,
                      background: result.passed
                        ? 'var(--jk-ok)'
                        : 'var(--jk-danger)',
                    }}
                  />
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-xs font-mono" style={{ fontSize: '9px', color: 'var(--jk-text-low)' }}>0%</span>
                  <span className="text-xs font-mono" style={{ fontSize: '9px', color: 'var(--jk-text-low)' }}>
                    阈值 {threshold}%
                  </span>
                </div>
              </div>
              {/* 详情列表 */}
              {result.details && result.details.length > 0 && (
                <div
                  className="mt-1 p-1.5 rounded space-y-0.5"
                  style={{ background: 'var(--jk-sunken)' }}
                >
                  {result.details.map((d, i) => (
                    <div key={i} className="text-xs font-mono" style={{ color: 'var(--jk-text-body)', fontSize: '10px' }}>
                      {d}
                    </div>
                  ))}
                </div>
              )}
              {/* 结论 */}
              <div
                className="text-xs font-mono mt-1 p-1.5 rounded"
                style={{
                  background: result.passed ? 'color-mix(in srgb, var(--jk-ok) 8%, transparent)' : 'color-mix(in srgb, var(--jk-danger) 8%, transparent)',
                  color: result.passed ? 'var(--jk-ok)' : 'var(--jk-danger)',
                  fontSize: '10px',
                }}
              >
                {result.message}
              </div>
            </div>
          )}
          {(!result || result.passed === null) && !isRunning && (
            <div className="text-xs font-mono" style={{ color: 'var(--jk-text-dim)' }}>
              等待检测...
            </div>
          )}
          {isRunning && (
            <div className="text-xs font-mono" style={{ color: 'var(--jk-primary)' }}>
              正在采集数据...
            </div>
          )}
        </div>
        {result && result.passed !== null && (
          <div
            className="px-2 py-1 rounded text-xs font-mono font-medium flex-shrink-0"
            style={{
              background: result.passed
                ? 'color-mix(in srgb, var(--jk-ok) 12%, transparent)'
                : 'color-mix(in srgb, var(--jk-danger) 12%, transparent)',
              color: result.passed ? 'var(--jk-ok)' : 'var(--jk-danger)',
              border: `1px solid ${result.passed ? 'color-mix(in srgb, var(--jk-ok) 30%, transparent)' : 'color-mix(in srgb, var(--jk-danger) 30%, transparent)'}`,
            }}
          >
            {result.passed ? 'PASS' : 'FAIL'}
          </div>
        )}
      </div>
    </div>
  );
}
