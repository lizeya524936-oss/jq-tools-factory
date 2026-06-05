"""
hill_fit_offline.py — Hill 方程拟合离线工具 v1.0
=================================================
与网页前端 client/src/lib/hillFit.ts 算法逐行对应，保证离线/在线结果完全一致。

核心算法：
  1. Hill 方程正向: ADC = a * P^n / (b^n + P^n)
  2. Hill 方程反向: P = b * (ADC / (a - ADC))^(1/n)
  3. 双曲线方程: ADC = a * P / (b + P)  （Hill n=1 特例）
  4. Levenberg-Marquardt 非线性最小二乘拟合
  5. 一致性分析：各文件独立拟合 + 全局拟合 + CV 分析 + 残差统计

用法：
  python hill_fit_offline.py file1.csv file2.csv ... [--output result.json] [--plot] [--max-pressure 100]

依赖：numpy, matplotlib (可选，仅 --plot 时需要)
"""

import sys
import json
import math
import os
import argparse
from typing import Optional

import numpy as np

# ─── 常量 ────────────────────────────────────────────────────────────────────

# 对应 hillFit.ts: CV_THRESHOLDS
CV_THRESHOLDS = {
    "excellent": 3,   # ≤ 3%: 优秀
    "pass": 5,        # 3%-5%: 合格
    "warning": 8,     # 5%-8%: 警告
    # > 8%: 不合格
}

# 对应 hillFit.ts: SERIES_COLORS
SERIES_COLORS = [
    "oklch(0.70 0.18 200)",
    "oklch(0.72 0.20 145)",
    "oklch(0.70 0.20 55)",
    "oklch(0.70 0.18 330)",
    "oklch(0.65 0.18 280)",
    "oklch(0.75 0.15 80)",
    "oklch(0.68 0.20 170)",
    "oklch(0.70 0.22 25)",
    "oklch(0.72 0.15 230)",
    "oklch(0.68 0.18 120)",
]
# Matplotlib fallback colors
MPL_COLORS = [
    "#4A9BD9", "#55B87A", "#E8923F", "#D94E8A",
    "#8B5FBF", "#C4A43E", "#3DB8B0", "#E05555",
    "#5B9BD5", "#6AAF6A",
]


# ═══════════════════════════════════════════════════════════════════════════════
# 第 1 部分: Hill 方程核心函数（逐行对应 hillFit.ts）
# ═══════════════════════════════════════════════════════════════════════════════

def hill_func(x: float, a: float, b: float, n: float) -> float:
    """
    Hill 方程: ADC = a * P^n / (b^n + P^n)
    对应 hillFit.ts: hillFunc(x, a, b, n)
    """
    xn = math.pow(abs(x), n)
    bn = math.pow(abs(b), n)
    return a * xn / (bn + xn + 1e-12)


def hill_func_array(xs, a, b, n):
    """批量计算，对应 hillFit.ts: hillFuncArray"""
    return [hill_func(x, a, b, n) for x in xs]


def hyperbolic_func(x: float, a: float, b: float) -> float:
    """
    双曲线方程: ADC = a * P / (b + P)  等价于 Hill n=1
    对应 hillFit.ts: hyperbolicFunc(x, a, b)
    """
    return a * x / (b + x + 1e-12)


def inverse_hill(y: float, a: float, b: float, n: float, p_max: float = 100.0) -> dict:
    """
    Hill 反向: P = b * (ADC / (a - ADC))^(1/n)
    对应 hillFit.ts: inverseHill(y, a, b, n, pMax)
    """
    if y <= 0:
        return {"adcValue": y, "pressure": None, "status": "zero"}
    if y >= a:
        return {"adcValue": y, "pressure": None, "status": "saturated"}
    x = b * math.pow(y / (a - y), 1.0 / n)
    if x > p_max + 0.01:
        return {"adcValue": y, "pressure": x, "status": "out_of_range"}
    return {"adcValue": y, "pressure": x, "status": "valid"}


def compute_metrics(y_true, y_pred) -> dict:
    """
    计算 RMSE 和 R²
    对应 hillFit.ts: computeMetrics(yTrue, yPred)
    """
    n = len(y_true)
    if n == 0:
        return {"rmse": 0, "r2": 0}

    mean_y = np.mean(y_true)
    ss_res = np.sum((np.array(y_true) - np.array(y_pred)) ** 2)
    ss_tot = np.sum((np.array(y_true) - mean_y) ** 2)

    rmse = math.sqrt(ss_res / n)
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0
    return {"rmse": rmse, "r2": r2}


def solve_linear(A, b):
    """
    高斯消元法求解线性方程组 Ax = b
    对应 hillFit.ts: solveLinear(A, b)

    返回解向量或 None（矩阵奇异时）
    """
    n = len(b)
    # 增广矩阵
    aug = [row[:] + [b[i]] for i, row in enumerate(A)]

    for col in range(n):
        # 部分主元选择
        max_row = col
        max_val = abs(aug[col][col])
        for row in range(col + 1, n):
            if abs(aug[row][col]) > max_val:
                max_val = abs(aug[row][col])
                max_row = row

        if max_val < 1e-20:
            return None

        aug[col], aug[max_row] = aug[max_row], aug[col]

        # 消元
        for row in range(col + 1, n):
            factor = aug[row][col] / aug[col][col]
            for j in range(col, n + 1):
                aug[row][j] -= factor * aug[col][j]

    # 回代
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = aug[i][n]
        for j in range(i + 1, n):
            x[i] -= aug[i][j] * x[j]
        x[i] /= aug[i][i]

    return x


def levenberg_marquardt(xs, ys, model, initial_params, bounds, max_iter=5000, tol=1e-10):
    """
    简化版 Levenberg-Marquardt 算法
    对应 hillFit.ts: levenbergMarquardt(xs, ys, model, initialParams, bounds, maxIter, tol)

    Args:
        xs: 自变量数组
        ys: 因变量数组
        model: 模型函数 f(x, params) -> float
        initial_params: 初始参数
        bounds: {"lower": [...], "upper": [...]}
        max_iter: 最大迭代次数
        tol: 收敛容差

    Returns:
        拟合参数列表
    """
    N = len(xs)
    P = len(initial_params)
    params = list(initial_params)
    lam = 0.001
    lambda_up = 10
    lambda_down = 0.1

    def residuals(p):
        return [ys[i] - model(xs[i], p) for i in range(N)]

    def total_error(p):
        r = residuals(p)
        return sum(v * v for v in r)

    def clamp(p):
        return [max(bounds["lower"][i], min(bounds["upper"][i], p[i])) for i in range(P)]

    def jacobian(p):
        eps = 1e-8
        J = []
        for i in range(N):
            row = []
            for j in range(P):
                p_plus = list(p)
                p_plus[j] += eps
                p_minus = list(p)
                p_minus[j] -= eps
                row.append((model(xs[i], p_plus) - model(xs[i], p_minus)) / (2 * eps))
            J.append(row)
        return J

    current_error = total_error(params)

    for _ in range(max_iter):
        r = residuals(params)
        J = jacobian(params)

        # J^T * J
        JtJ = [[0.0] * P for _ in range(P)]
        for i in range(P):
            for j in range(P):
                s = 0.0
                for k in range(N):
                    s += J[k][i] * J[k][j]
                JtJ[i][j] = s

        # J^T * r
        JtR = [0.0] * P
        for i in range(P):
            s = 0.0
            for k in range(N):
                s += J[k][i] * r[k]
            JtR[i] = s

        # (J^T*J + lambda*diag(J^T*J)) * delta = J^T * r
        A_aug = [row[:] for row in JtJ]
        for i in range(P):
            A_aug[i][i] += lam * (JtJ[i][i] + 1e-10)

        delta = solve_linear(A_aug, JtR)
        if delta is None:
            lam *= lambda_up
            continue

        new_params = clamp([params[i] + delta[i] for i in range(P)])
        new_error = total_error(new_params)

        if new_error < current_error:
            params = new_params
            current_error = new_error
            lam *= lambda_down

            # 收敛检查
            max_delta = max(abs(d) for d in delta)
            if max_delta < tol:
                break
        else:
            lam *= lambda_up

        if lam > 1e16:
            break

    return params


def downsample_for_fit(ps, vs, max_points=500):
    """
    对大数据集进行降采样，保留曲线特征同时减少计算量
    策略：按压力值均匀分桶，每个桶取中位数
    对应 hillFit.ts: downsampleForFit(ps, vs, maxPoints)
    """
    if len(ps) <= max_points:
        return ps, vs

    # 按压力值排序
    indices = sorted(range(len(ps)), key=lambda i: ps[i])
    sorted_ps = [ps[i] for i in indices]
    sorted_vs = [vs[i] for i in indices]

    bucket_size = max(1, math.ceil(len(sorted_ps) / max_points))
    sampled_ps = []
    sampled_vs = []

    i = 0
    while i < len(sorted_ps):
        end = min(i + bucket_size, len(sorted_ps))
        mid = (i + end) // 2
        sampled_ps.append(sorted_ps[mid])
        sampled_vs.append(sorted_vs[mid])
        i += bucket_size

    return sampled_ps, sampled_vs


# ═══════════════════════════════════════════════════════════════════════════════
# 第 2 部分: Hill 拟合入口（逐行对应 hillFit.ts）
# ═══════════════════════════════════════════════════════════════════════════════

def fit_hill(pressures, adc_values):
    """
    对压力-ADC 数据进行 Hill 方程拟合

    拟合策略（与 TS 版一致）：
    1. 完整 3 参数拟合 (a, b, n)
    2. 若 R² < 0.9 → 降级为双曲线拟合 (n=1)
    3. 取 R² 更高的结果

    对应 hillFit.ts: fitHill(pressures, adcValues)
    """
    if len(pressures) < 3 or len(adc_values) < 3:
        return None
    if len(pressures) != len(adc_values):
        return None

    # 过滤无效数据
    valid_pairs = []
    for p, v in zip(pressures, adc_values):
        if math.isfinite(p) and math.isfinite(v) and p >= 0:
            valid_pairs.append((p, v))

    if len(valid_pairs) < 3:
        return None

    raw_ps = [d[0] for d in valid_pairs]
    raw_vs = [d[1] for d in valid_pairs]

    # 降采样：用于 LM 拟合，减少计算量
    fit_ps, fit_vs = downsample_for_fit(raw_ps, raw_vs, 500)

    # 拟合用降采样数据，评估用全量数据
    ps = fit_ps
    vs = fit_vs
    eval_ps = raw_ps
    eval_vs = raw_vs

    # 初始估计
    max_v = max(vs)
    sorted_ps = sorted(ps)
    median_p = sorted_ps[len(sorted_ps) // 2]
    a0 = max_v * 1.1
    b0 = max(0.5, median_p)
    n0 = 0.9

    # 策略 1: 完整 3 参数 Hill 拟合
    hill_result = None
    try:
        def hill_model(x, params):
            return hill_func(x, params[0], params[1], params[2])

        hill_params = levenberg_marquardt(
            ps, vs, hill_model,
            [a0, b0, n0],
            {"lower": [0, 0.1, 0.1], "upper": [max_v * 5, 500, 5.0]},
            5000,
        )
        a, b, n = hill_params
        # 用全量数据评估拟合质量
        predicted = [hill_func(p, a, b, n) for p in eval_ps]
        metrics = compute_metrics(eval_vs, predicted)
        hill_result = {"a": a, "b": b, "n": n, "rmse": metrics["rmse"], "r2": metrics["r2"], "method": "hill"}
    except Exception:
        pass

    # 策略 2: 双曲线拟合 (n=1)
    hyp_result = None
    try:
        def hyp_model(x, params):
            return hyperbolic_func(x, params[0], params[1])

        hyp_params = levenberg_marquardt(
            ps, vs, hyp_model,
            [a0, b0],
            {"lower": [0, 0.1], "upper": [max_v * 5, 500]},
            3000,
        )
        a, b = hyp_params
        # 用全量数据评估拟合质量
        predicted = [hyperbolic_func(p, a, b) for p in eval_ps]
        metrics = compute_metrics(eval_vs, predicted)
        hyp_result = {"a": a, "b": b, "n": 1.0, "rmse": metrics["rmse"], "r2": metrics["r2"], "method": "hyperbolic"}
    except Exception:
        pass

    # 选择最优结果
    if hill_result and hyp_result:
        return hill_result if hill_result["r2"] >= hyp_result["r2"] else hyp_result
    if hill_result:
        return hill_result
    if hyp_result:
        return hyp_result

    # 兆底：使用初始估计
    predicted = [hill_func(p, a0, b0, 1.0) for p in eval_ps]
    metrics = compute_metrics(eval_vs, predicted)
    return {"a": a0, "b": b0, "n": 1.0, "rmse": metrics["rmse"], "r2": metrics["r2"], "method": "fallback"}


def fit_inverse_hill(adc_values, pressures):
    """
    对 ADC-压力 数据进行 Inverse Hill 拟合
    P = K * (ADC/(Vmax-ADC))^(1/n)

    对应 hillFit.ts: fitInverseHill(adcValues, pressures)
    """
    if len(adc_values) < 3 or len(pressures) < 3:
        return None
    if len(adc_values) != len(pressures):
        return None

    def inv_hill_func(x, Vmax, K, n):
        ratio = x / (Vmax - x + 1e-12)
        if ratio <= 0:
            return 0.0
        return K * math.pow(ratio, 1.0 / n)

    valid_pairs = []
    for x, y in zip(adc_values, pressures):
        if math.isfinite(x) and math.isfinite(y) and x > 0 and y >= 0:
            valid_pairs.append((x, y))

    if len(valid_pairs) < 3:
        return None

    raw_xs = [d[0] for d in valid_pairs]
    raw_ys = [d[1] for d in valid_pairs]

    # 降采样
    fit_xs, fit_ys = downsample_for_fit(raw_xs, raw_ys, 500)

    xs = fit_xs
    ys = fit_ys
    eval_xs = raw_xs
    eval_ys = raw_ys

    max_x = max(xs)
    sorted_xs = sorted(xs)
    median_x = sorted_xs[len(sorted_xs) // 2]

    # 策略 1: 完整 3 参数逆 Hill 拟合
    best_result = None
    try:
        def inv_model(x, params):
            return inv_hill_func(x, params[0], params[1], params[2])

        fit_params = levenberg_marquardt(
            xs, ys, inv_model,
            [max_x * 1.1, max(0.5, median_x * 0.5), 0.9],
            {"lower": [max_x * 0.9, 0.5, 0.3], "upper": [max_x * 3.0, 200, 8]},
            5000,
        )
        Vmax, K, n = fit_params
        predicted = [inv_hill_func(x, Vmax, K, n) for x in eval_xs]
        metrics = compute_metrics(eval_ys, predicted)
        best_result = {"Vmax": Vmax, "K": K, "n": n, "rmse": metrics["rmse"], "r2": metrics["r2"], "method": "inv_hill"}
    except Exception:
        pass

    # 策略 2: n=1 降级
    n1_result = None
    try:
        def n1_model(x, params):
            return inv_hill_func(x, params[0], params[1], 1.0)

        fit_params = levenberg_marquardt(
            xs, ys, n1_model,
            [max_x * 1.1, max(0.5, median_x * 0.5)],
            {"lower": [max_x * 0.9, 0.5], "upper": [max_x * 3.0, 200]},
            3000,
        )
        Vmax, K = fit_params
        predicted = [inv_hill_func(x, Vmax, K, 1.0) for x in eval_xs]
        metrics = compute_metrics(eval_ys, predicted)
        n1_result = {"Vmax": Vmax, "K": K, "n": 1.0, "rmse": metrics["rmse"], "r2": metrics["r2"], "method": "inv_hill_n1"}
    except Exception:
        pass

    if best_result and n1_result:
        return best_result if best_result["r2"] >= n1_result["r2"] else n1_result
    if best_result:
        return best_result
    if n1_result:
        return n1_result

    # Fallback
    predicted = [inv_hill_func(x, max_x * 1.1, median_x * 0.5, 1.0) for x in eval_xs]
    metrics = compute_metrics(eval_ys, predicted)
    return {"Vmax": max_x * 1.1, "K": median_x * 0.5, "n": 1.0, "rmse": metrics["rmse"], "r2": metrics["r2"], "method": "fallback"}


# ═══════════════════════════════════════════════════════════════════════════════
# 第 3 部分: 格式化函数（对应 hillFit.ts）
# ═══════════════════════════════════════════════════════════════════════════════

def format_hill_equation(fit: dict) -> str:
    """对应 hillFit.ts: formatHillEquation(fit)"""
    a, b, n = fit["a"], fit["b"], fit["n"]
    return f"ADC = {a:.2f} × P^{n:.4f} / ({b:.2f}^{n:.4f} + P^{n:.4f})"


def format_inverse_equation(fit: dict) -> str:
    """对应 hillFit.ts: formatInverseEquation(fit)"""
    a, b, n = fit["a"], fit["b"], fit["n"]
    return f"P = {b:.2f} × (ADC / ({a:.2f} - ADC))^(1/{n:.4f})"


def format_inv_hill_equation(fit: dict) -> str:
    """对应 hillFit.ts: formatInvHillEquation(fit)"""
    return f"P = {fit['K']:.2f} × (ADC / ({fit['Vmax']:.1f} - ADC))^(1/{fit['n']:.4f})"


def generate_fit_curve(fit: dict, p_min=0.0, p_max=100.0, num_points=200) -> list:
    """对应 hillFit.ts: generateFitCurve(fit, pMin, pMax, numPoints)"""
    points = []
    step = (p_max - p_min) / (num_points - 1)
    for i in range(num_points):
        p = p_min + step * i
        adc = hill_func(p, fit["a"], fit["b"], fit["n"])
        points.append({"pressure": p, "adcSum": adc})
    return points


# ═══════════════════════════════════════════════════════════════════════════════
# 第 4 部分: CV 分析辅助函数（对应 ConsistencyAnalysis.tsx）
# ═══════════════════════════════════════════════════════════════════════════════

def generate_pressure_points(max_pressure: float) -> list:
    """
    根据最大压力值动态生成关键压力点
    对应 ConsistencyAnalysis.tsx: generatePressurePoints(maxPressure)
    """
    if max_pressure <= 0:
        return []

    if max_pressure <= 20:
        count = 4
    elif max_pressure <= 50:
        count = 5
    elif max_pressure <= 100:
        count = 7
    elif max_pressure <= 200:
        count = 8
    elif max_pressure <= 500:
        count = 10
    else:
        count = 12

    points = []
    step = max_pressure / count

    for i in range(1, count + 1):
        val = step * i
        if val >= 100:
            val = round(val / 10) * 10
        elif val >= 10:
            val = round(val / 5) * 5
        elif val >= 1:
            val = round(val)
        else:
            val = round(val * 10) / 10

        if val > 0 and val <= max_pressure and val not in points:
            points.append(val)

    last_val = round(max_pressure * 10) / 10
    if last_val > 0 and last_val not in points:
        points.append(last_val)

    return sorted(points)


def get_cv_color(cv: float) -> str:
    """对应 ConsistencyAnalysis.tsx: getCVColor(cv)"""
    if cv <= CV_THRESHOLDS["excellent"]:
        return "green"
    if cv <= CV_THRESHOLDS["pass"]:
        return "yellow"
    if cv <= CV_THRESHOLDS["warning"]:
        return "orange"
    return "red"


def get_cv_label(cv: float) -> str:
    """对应 ConsistencyAnalysis.tsx: getCVLabel(cv)"""
    if cv <= CV_THRESHOLDS["excellent"]:
        return "优秀"
    if cv <= CV_THRESHOLDS["pass"]:
        return "合格"
    if cv <= CV_THRESHOLDS["warning"]:
        return "警告"
    return "不合格"


# ═══════════════════════════════════════════════════════════════════════════════
# 第 5 部分: CSV 解析（对应 ConsistencyPage.tsx: parseCSVText）
# ═══════════════════════════════════════════════════════════════════════════════

def parse_csv_text(text: str) -> list:
    """
    解析 CSV 文本为记录列表 [{pressure, adcSum, ...}, ...]
    对应 ConsistencyPage.tsx: parseCSVText(text)
    """
    # 去除 BOM
    if text.startswith('﻿'):
        text = text[1:]

    lines = text.split('\n')
    lines = [l.strip() for l in lines if l.strip()]
    if len(lines) < 2:
        return []

    header_line = lines[0]
    parsed = []

    is_format_a = '传感器#' in header_line or '压力(N)' in header_line
    is_format_b = 'ADC Value' in header_line or 'ADC Sum' in header_line

    if is_format_a:
        # Format A: time, pressure, sensor1, sensor2, ...
        for i in range(1, len(lines)):
            cols = lines[i].split(',')
            if len(cols) < 2:
                continue
            pressure_val = parse_float(cols[1])
            if math.isnan(pressure_val) and cols[1].strip() == '':
                continue

            adc_vals = []
            for j in range(2, len(cols)):
                v = parse_int(cols[j])
                adc_vals.append(v if v is not None else 0)

            adc_sum = sum(adc_vals)
            parsed.append({
                "pressure": pressure_val if not math.isnan(pressure_val) else 0,
                "adcSum": adc_sum,
                "adcValues": adc_vals,
            })

    elif is_format_b:
        # Format B: quoted complex format
        import re
        for i in range(1, len(lines)):
            line = lines[i]
            match = re.match(r'^([^,]*),([^,]*),"([^"]*)",([^,]*),([^,]*),([^,]*),([^,]*),?(.*)$', line)
            if not match:
                continue
            groups = match.groups()
            pressure_val = parse_float(groups[1])
            adc_vals_str = groups[2]
            adc_sum_str = groups[3]
            adc_vals = [int(v) if v.strip() else 0 for v in adc_vals_str.split(';')]
            adc_sum = int(adc_sum_str) if adc_sum_str else sum(adc_vals)

            parsed.append({
                "pressure": pressure_val if not math.isnan(pressure_val) else 0,
                "adcSum": adc_sum if adc_sum > 0 else sum(adc_vals),
                "adcValues": adc_vals,
            })

    else:
        # Fallback: time, pressure, adc1, adc2, ...
        for i in range(1, len(lines)):
            cols = lines[i].split(',')
            if len(cols) < 2:
                continue
            pressure_val = parse_float(cols[1])

            adc_vals = []
            for j in range(2, len(cols)):
                v = parse_int(cols[j])
                if v is not None:
                    adc_vals.append(v)

            adc_sum = sum(adc_vals)
            parsed.append({
                "pressure": pressure_val if not math.isnan(pressure_val) else 0,
                "adcSum": adc_sum,
                "adcValues": adc_vals,
            })

    # 过滤：只保留压力上升阶段（0→峰值），舍弃下降阶段
    if len(parsed) <= 1:
        return parsed

    peak_idx = 0
    peak_pressure = parsed[0]["pressure"]
    for idx in range(1, len(parsed)):
        if parsed[idx]["pressure"] >= peak_pressure:
            peak_pressure = parsed[idx]["pressure"]
            peak_idx = idx

    return parsed[:peak_idx + 1]


def parse_float(s: str) -> float:
    try:
        return float(s.strip())
    except (ValueError, AttributeError):
        return math.nan


def parse_int(s: str) -> Optional[int]:
    try:
        return int(s.strip())
    except (ValueError, AttributeError):
        return None


def load_csv_file(filepath: str) -> list:
    """加载单个 CSV 文件为记录列表"""
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        text = f.read()
    return parse_csv_text(text)


# ═══════════════════════════════════════════════════════════════════════════════
# 第 6 部分: 一致性分析（对应 ConsistencyAnalysis.tsx: computeAnalysis）
# ═══════════════════════════════════════════════════════════════════════════════

def compute_analysis(all_series: list, pressure_points: list) -> Optional[dict]:
    """
    对应 ConsistencyAnalysis.tsx: computeAnalysis(allSeries, pressurePoints)

    Args:
        all_series: [{"name": "file1.csv", "records": [{pressure, adcSum}, ...]}, ...]
        pressure_points: 关键压力点列表

    Returns:
        分析结果字典或 None
    """
    valid_series = [s for s in all_series if len(s["records"]) >= 5]
    if len(valid_series) < 2:
        return None
    if len(pressure_points) == 0:
        return None

    # 各文件独立 Hill 拟合
    per_file_fits = []
    for series in valid_series:
        pressures = [r["pressure"] for r in series["records"]]
        adc_sums = [r["adcSum"] for r in series["records"]]
        fit = fit_hill(pressures, adc_sums)
        if fit:
            per_file_fits.append({"fileName": series["name"], "fit": fit})

    if len(per_file_fits) < 2:
        return None

    # 全量数据全局拟合
    all_pressures = []
    all_adc_sums = []
    for series in valid_series:
        for r in series["records"]:
            all_pressures.append(r["pressure"])
            all_adc_sums.append(r["adcSum"])
    global_fit = fit_hill(all_pressures, all_adc_sums)

    # 关键压力点 CV 分析
    cv_points = []
    for p in pressure_points:
        values = []
        file_names = []
        for entry in per_file_fits:
            predicted = hill_func(p, entry["fit"]["a"], entry["fit"]["b"], entry["fit"]["n"])
            values.append(predicted)
            file_names.append(entry["fileName"])

        mean_val = np.mean(values)
        variance = np.sum((np.array(values) - mean_val) ** 2) / len(values)
        std_val = math.sqrt(variance)
        cv = (std_val / mean_val) * 100 if mean_val > 0 else 0

        cv_points.append({
            "pressure": p,
            "cv": cv,
            "mean": mean_val,
            "std": std_val,
            "values": values,
            "fileNames": file_names,
        })

    avg_cv = np.mean([cp["cv"] for cp in cv_points])
    cv_score = max(0, min(100, ((CV_THRESHOLDS["warning"] - avg_cv) / (CV_THRESHOLDS["warning"] - CV_THRESHOLDS["excellent"])) * 100))

    # 残差统计
    residual_stats = []
    all_residuals = []

    if global_fit:
        for series in valid_series:
            residuals = []
            pressures_list = []
            for r in series["records"]:
                predicted = hill_func(r["pressure"], global_fit["a"], global_fit["b"], global_fit["n"])
                residual = r["adcSum"] - predicted
                residuals.append(residual)
                pressures_list.append(r["pressure"])
                all_residuals.append(residual)

            mean_r = np.mean(residuals)
            variance_r = np.sum((np.array(residuals) - mean_r) ** 2) / len(residuals)
            std_r = math.sqrt(variance_r)
            max_abs = max(abs(r) for r in residuals)

            residual_stats.append({
                "fileName": series["name"],
                "mean": mean_r,
                "std": std_r,
                "maxAbs": max_abs,
                "residuals": residuals,
                "pressures": pressures_list,
            })

    residual_mean = np.mean(all_residuals) if all_residuals else 0
    residual_variance = np.sum((np.array(all_residuals) - residual_mean) ** 2) / len(all_residuals) if all_residuals else 0
    residual_std = math.sqrt(residual_variance)
    residual_score = max(0, min(100, ((30 - residual_std) / 25) * 100))

    return {
        "cvPoints": cv_points,
        "avgCV": avg_cv,
        "cvScore": cv_score,
        "residualStats": residual_stats,
        "allResiduals": all_residuals,
        "residualMean": residual_mean,
        "residualStd": residual_std,
        "residualScore": residual_score,
        "perFileFits": per_file_fits,
        "globalFit": global_fit,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# 第 7 部分: 输出格式化
# ═══════════════════════════════════════════════════════════════════════════════

def print_results(all_series, analysis, pressure_max, custom_pressure=None):
    """打印分析结果到终端"""
    print("\n" + "=" * 70)
    print("  Hill 方程拟合分析结果")
    print("=" * 70)

    # ── 各文件拟合参数 ──
    print(f"\n{'─' * 60}")
    print(f"  各文件独立 Hill 拟合参数 ({len(analysis['perFileFits'])} 个文件)")
    print(f"{'─' * 60}")
    print(f"  {'文件名':<30s} {'a':>10s} {'b':>8s} {'n':>8s} {'R²':>8s} {'RMSE':>8s} {'方法':>10s}")
    print(f"  {'─' * 30} {'─' * 10} {'─' * 8} {'─' * 8} {'─' * 8} {'─' * 8} {'─' * 10}")

    for entry in analysis["perFileFits"]:
        f = entry["fit"]
        name = entry["fileName"].replace('.csv', '')[:28]
        print(f"  {name:<30s} {f['a']:>10.2f} {f['b']:>8.2f} {f['n']:>8.4f} {f['r2']:>8.4f} {f['rmse']:>8.2f} {f['method']:>10s}")

    # ── 全局拟合 ──
    if analysis["globalFit"]:
        gf = analysis["globalFit"]
        print(f"\n{'─' * 60}")
        print(f"  全局 Hill 拟合 (全部数据合并)")
        print(f"{'─' * 60}")
        print(f"  a = {gf['a']:.4f}  b = {gf['b']:.4f}  n = {gf['n']:.4f}")
        print(f"  R² = {gf['r2']:.6f}  RMSE = {gf['rmse']:.4f}  方法: {gf['method']}")
        print(f"  正向公式: {format_hill_equation(gf)}")
        print(f"  反向公式: {format_inverse_equation(gf)}")

    # ── 自定义压力点 ──
    if custom_pressure is not None:
        p = custom_pressure
        values = []
        for entry in analysis['perFileFits']:
            predicted = hill_func(p, entry['fit']['a'], entry['fit']['b'], entry['fit']['n'])
            values.append(predicted)

        mean_v = np.mean(values) if values else 0
        variance = np.sum((np.array(values) - mean_v) ** 2) / len(values) if values else 0
        std_v = math.sqrt(variance)
        cv = (std_v / mean_v) * 100 if mean_v > 0 else 0

        print(f"\n{'─' * 60}")
        print(f"  自定义压力点 CV 计算 (P = {p} N)")
        print(f"{'─' * 60}")
        print(f"  CV: {cv:.2f}%  均值: {mean_v:.1f}  标准差: {std_v:.2f}  等级: {get_cv_label(cv)}")
        if p > pressure_max:
            print(f"  ⚠ 超出当前分析范围 (0-{pressure_max}N)，结果仅供参考")
        print(f"  各文件预测 ADC 值:")
        for entry, v in zip(analysis['perFileFits'], values):
            name = entry['fileName'].replace('.csv', '')[:30]
            print(f"    {name:<30s} {v:.1f}")

    # ── CV 分析表 ──
    print(f"\n{'─' * 60}")
    print(f"  关键压力点 CV 分析 (0-{pressure_max}N, {len(analysis['cvPoints'])} 个分析点)")
    print(f"{'─' * 60}")
    print(f"  {'压力点':>8s}  {'CV (%)':>8s}  {'均值':>10s}  {'标准差':>8s}  {'等级':>6s}")
    print(f"  {'─' * 8}  {'─' * 8}  {'─' * 10}  {'─' * 8}  {'─' * 6}")

    for cp in analysis["cvPoints"]:
        print(f"  {cp['pressure']:>6.1f}N  {cp['cv']:>7.2f}%  {cp['mean']:>10.1f}  {cp['std']:>8.2f}  {get_cv_label(cp['cv']):>6s}")

    print(f"\n  平均 CV: {analysis['avgCV']:.2f}% ({get_cv_label(analysis['avgCV'])})  CV 评分: {analysis['cvScore']:.0f}")

    # ── 残差统计 ──
    print(f"\n{'─' * 60}")
    print(f"  残差分布统计 (全局拟合回代, n={len(analysis['allResiduals'])})")
    print(f"{'─' * 60}")
    print(f"  均值 μ = {analysis['residualMean']:.2f}  标准差 σ = {analysis['residualStd']:.2f}")
    if analysis["allResiduals"]:
        print(f"  范围: [{min(analysis['allResiduals']):.1f}, {max(analysis['allResiduals']):.1f}]")
    print(f"  残差评分: {analysis['residualScore']:.0f}")

    print(f"\n  {'文件名':<30s} {'均值 μ':>8s} {'σ':>8s} {'max|残差|':>10s}")
    print(f"  {'─' * 30} {'─' * 8} {'─' * 8} {'─' * 10}")
    for rs in analysis["residualStats"]:
        name = rs['fileName'].replace('.csv', '')[:28]
        print(f"  {name:<30s} {rs['mean']:>8.2f} {rs['std']:>8.2f} {rs['maxAbs']:>10.2f}")

    print("\n" + "=" * 70)


def export_json(analysis, pressure_max, output_path: str, custom_pressure=None):
    """导出完整结果为 JSON"""
    export_data = {
        "pressureMax": pressure_max,
        "customPressure": custom_pressure,
        "globalFit": analysis["globalFit"],
        "perFileFits": [
            {
                "fileName": entry["fileName"],
                "a": entry["fit"]["a"],
                "b": entry["fit"]["b"],
                "n": entry["fit"]["n"],
                "r2": entry["fit"]["r2"],
                "rmse": entry["fit"]["rmse"],
                "method": entry["fit"]["method"],
            }
            for entry in analysis["perFileFits"]
        ],
        "cvPoints": [
            {
                "pressure": cp["pressure"],
                "cv": round(cp["cv"], 4),
                "mean": round(cp["mean"], 2),
                "std": round(cp["std"], 4),
                "grade": get_cv_label(cp["cv"]),
            }
            for cp in analysis["cvPoints"]
        ],
        "avgCV": round(analysis["avgCV"], 4),
        "cvScore": round(analysis["cvScore"], 1),
        "residualMean": round(analysis["residualMean"], 4),
        "residualStd": round(analysis["residualStd"], 4),
        "residualScore": round(analysis["residualScore"], 1),
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(export_data, f, ensure_ascii=False, indent=2)
    print(f"\n结果已导出到: {output_path}")


def plot_results(all_series, analysis, pressure_max, output_path=None):
    """生成拟合曲线图和残差直方图"""
    try:
        import matplotlib
        matplotlib.use('TkAgg')
        import matplotlib.pyplot as plt
        from matplotlib.gridspec import GridSpec
    except ImportError:
        print("⚠ matplotlib 未安装，跳过绘图。安装命令: pip install matplotlib")
        return

    # 设置中文字体
    try:
        plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "DejaVu Sans"]
        plt.rcParams["axes.unicode_minus"] = False
    except Exception:
        pass

    fig = plt.figure(figsize=(14, 12))
    gs = GridSpec(3, 2, figure=fig, hspace=0.35, wspace=0.3)

    # 左上：散点数据 + 各文件拟合曲线 + 全局拟合曲线
    ax1 = fig.add_subplot(gs[0, :])
    colors = plt.cm.tab10(np.linspace(0, 1, 10))

    for idx, series in enumerate(all_series):
        ps = [r["pressure"] for r in series["records"]]
        vs = [r["adcSum"] for r in series["records"]]
        name = series["name"].replace('.csv', '')[:20]
        color = MPL_COLORS[idx % len(MPL_COLORS)]
        ax1.scatter(ps, vs, s=8, alpha=0.5, color=color, label=f"{name}")

    # 各文件拟合曲线
    for idx, entry in enumerate(analysis["perFileFits"]):
        f = entry["fit"]
        curve = generate_fit_curve(f, 0, pressure_max, 200)
        cp = [c["pressure"] for c in curve]
        ca = [c["adcSum"] for c in curve]
        color = MPL_COLORS[idx % len(MPL_COLORS)]
        ax1.plot(cp, ca, '--', linewidth=1.5, color=color, alpha=0.7)

    # 全局拟合曲线（粗线）
    if analysis["globalFit"]:
        gf = analysis["globalFit"]
        curve = generate_fit_curve(gf, 0, pressure_max, 200)
        cp = [c["pressure"] for c in curve]
        ca = [c["adcSum"] for c in curve]
        ax1.plot(cp, ca, '-', linewidth=2.5, color='white', alpha=0.9, label='Global Fit')

    ax1.set_xlabel("Pressure (N)", fontsize=10)
    ax1.set_ylabel("ADC Sum", fontsize=10)
    ax1.set_title(f"Hill Fitting — All Files (0-{pressure_max}N)", fontsize=12)
    ax1.legend(loc='upper left', fontsize=7, ncol=3)
    ax1.grid(True, alpha=0.2)

    # 左下：CV 折线图
    ax2 = fig.add_subplot(gs[1, 0])
    cv_pressures = [cp["pressure"] for cp in analysis["cvPoints"]]
    cv_values = [cp["cv"] for cp in analysis["cvPoints"]]
    ax2.plot(cv_pressures, cv_values, 'o-', color='#4A9BD9', linewidth=2, markersize=6)
    ax2.axhline(y=3, color='green', linestyle='--', alpha=0.6, label='Excellent 3%')
    ax2.axhline(y=5, color='orange', linestyle='--', alpha=0.6, label='Pass 5%')
    ax2.axhline(y=8, color='red', linestyle='--', alpha=0.6, label='Warning 8%')
    ax2.set_xlabel("Pressure (N)", fontsize=10)
    ax2.set_ylabel("CV (%)", fontsize=10)
    ax2.set_title(f"CV Analysis (Avg CV: {analysis['avgCV']:.2f}%)", fontsize=12)
    ax2.legend(fontsize=8)
    ax2.grid(True, alpha=0.2)

    # 右下：残差直方图
    ax3 = fig.add_subplot(gs[1, 1])
    if analysis["allResiduals"]:
        n_bins = min(30, len(analysis["allResiduals"]) // 3)
        ax3.hist(analysis["allResiduals"], bins=n_bins, color='#5B9BD5', alpha=0.7, edgecolor='white')
        ax3.axvline(x=analysis["residualMean"], color='orange', linestyle='--', linewidth=1.5,
                    label=f'μ={analysis["residualMean"]:.2f}')
        ax3.axvline(x=analysis["residualMean"] - analysis["residualStd"], color='red', linestyle=':',
                    linewidth=1, alpha=0.5)
        ax3.axvline(x=analysis["residualMean"] + analysis["residualStd"], color='red', linestyle=':',
                    linewidth=1, alpha=0.5, label=f'±σ={analysis["residualStd"]:.2f}')
    ax3.set_xlabel("Residual (ADC)", fontsize=10)
    ax3.set_ylabel("Count", fontsize=10)
    ax3.set_title(f"Residual Distribution (n={len(analysis['allResiduals'])})", fontsize=12)
    ax3.legend(fontsize=8)
    ax3.grid(True, alpha=0.2)

    # 底部：各文件残差对比
    ax4 = fig.add_subplot(gs[2, :])
    file_names = []
    sigmas = []
    max_abs_list = []
    for rs in analysis["residualStats"]:
        file_names.append(rs["fileName"].replace('.csv', '')[:25])
        sigmas.append(rs["std"])
        max_abs_list.append(rs["maxAbs"])

    x_pos = np.arange(len(file_names))
    width = 0.35
    ax4.bar(x_pos - width / 2, sigmas, width, label='σ (Std)', color='#5B9BD5', alpha=0.8)
    ax4.bar(x_pos + width / 2, max_abs_list, width, label='Max |Residual|', color='#E05555', alpha=0.8)
    ax4.set_xticks(x_pos)
    ax4.set_xticklabels(file_names, rotation=45, ha='right', fontsize=8)
    ax4.set_ylabel("ADC", fontsize=10)
    ax4.set_title("Per-File Residual Statistics", fontsize=12)
    ax4.legend(fontsize=10)
    ax4.grid(True, alpha=0.2, axis='y')

    if output_path:
        fig.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='#1a1a2e', edgecolor='none')
        print(f"图表已保存到: {output_path}")

    plt.show()


# ═══════════════════════════════════════════════════════════════════════════════
# 第 8 部分: GUI（CustomTkinter + Matplotlib）
# ═══════════════════════════════════════════════════════════════════════════════

def run_gui():
    """启动图形界面"""
    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox
        import customtkinter as ctk
        import matplotlib
        matplotlib.use("TkAgg")
        import matplotlib.pyplot as plt
        from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg, NavigationToolbar2Tk
        from matplotlib.figure import Figure
    except ImportError as e:
        print(f"错误: GUI 模式需要额外依赖: {e}")
        print("安装命令: pip install customtkinter matplotlib")
        sys.exit(1)

    class HillFitGUI(ctk.CTk):
        """Hill 方程拟合离线分析工具 GUI"""

        VERSION = "v1.0"

        def __init__(self):
            super().__init__()
            self.title(f"Hill 方程拟合分析工具  {self.VERSION}")
            self.geometry("1300x850")
            self.minsize(1000, 600)

            self.loaded_series: list = []  # [{"name": ..., "records": [...]}]
            self.analysis_result: Optional[dict] = None
            self.pressure_max: float = 100.0

            ctk.set_appearance_mode("dark")
            ctk.set_default_color_theme("blue")

            self._build_ui()

        def _build_ui(self):
            # 顶部标题栏
            header = ctk.CTkFrame(self, height=48, corner_radius=0, fg_color="#1a1a2e")
            header.pack(fill="x", side="top")
            ctk.CTkLabel(
                header,
                text=f"⚗  Hill 方程拟合分析工具  {self.VERSION}",
                font=("Microsoft YaHei", 14, "bold"),
                text_color="#4FC3F7",
            ).pack(side="left", padx=20, pady=10)
            ctk.CTkLabel(
                header,
                text="上传 CSV → Hill 拟合 → CV 分析 → 残差统计（算法与网页端一致）",
                font=("Microsoft YaHei", 11),
                text_color="#888",
            ).pack(side="left", padx=10)

            # 主体
            body = ctk.CTkFrame(self, corner_radius=0, fg_color="transparent")
            body.pack(fill="both", expand=True)

            self._build_left_panel(body)
            self._build_right_panel(body)

        # ── 左侧控制面板 ──

        def _build_left_panel(self, parent):
            left = ctk.CTkFrame(parent, width=340, corner_radius=0, fg_color="#16213e")
            left.pack(side="left", fill="y")
            left.pack_propagate(False)

            scroll = ctk.CTkScrollableFrame(left, fg_color="transparent")
            scroll.pack(fill="both", expand=True, padx=10, pady=10)

            # ── 文件上传区 ──
            self._section(scroll, "📁  数据文件")
            self.file_listbox = tk.Listbox(
                scroll, bg="#0a1f3b", fg="#e0e0e0", selectbackground="#2196F3",
                selectforeground="#fff", font=("Microsoft YaHei", 10), height=6,
                relief="flat", bd=0, highlightthickness=2, highlightcolor="#2196F3",
                highlightbackground="#1a3a5c",
            )
            self.file_listbox.pack(fill="x", pady=(0, 6))

            btn_row = ctk.CTkFrame(scroll, fg_color="transparent")
            btn_row.pack(fill="x", pady=(0, 4))
            ctk.CTkButton(btn_row, text="+ 添加文件", command=self._add_files,
                          width=120, height=30).pack(side="left", padx=(0, 4))
            ctk.CTkButton(btn_row, text="清空", command=self._clear_files,
                          width=70, height=30, fg_color="#c0392b",
                          hover_color="#e74c3c").pack(side="left")

            ctk.CTkLabel(
                scroll, text="支持网页端全部 3 种 CSV 格式，自动识别。",
                font=("Microsoft YaHei", 10), text_color="#888", wraplength=300,
            ).pack(anchor="w", pady=(0, 6))

            # ── 数据摘要 ──
            self.summary_frame = ctk.CTkFrame(
                scroll, fg_color="#0f3460", corner_radius=8,
                border_width=1, border_color="#1a5276",
            )
            self.summary_frame.pack(fill="x", pady=(0, 8))
            summary_inner = ctk.CTkFrame(self.summary_frame, fg_color="transparent")
            summary_inner.pack(fill="x", padx=10, pady=8)

            self.summary_label = ctk.CTkLabel(
                summary_inner, text="📊  暂无数据",
                font=("Microsoft YaHei", 11, "bold"), text_color="#888",
            )
            self.summary_label.pack(anchor="w")

            self.sum_file_label = ctk.CTkLabel(
                summary_inner, text="文件: 0  数据行: 0",
                font=("Microsoft YaHei", 10), text_color="#666",
            )
            self.sum_file_label.pack(anchor="w", pady=(4, 0))

            # ── 分析配置 ──
            self._section(scroll, "⚙  分析配置")
            self._label(scroll, "压力范围最大值 (N)")
            self.p_max_var = tk.StringVar(value="100")
            p_row = ctk.CTkFrame(scroll, fg_color="transparent")
            p_row.pack(fill="x", pady=(0, 6))
            self.p_max_entry = ctk.CTkEntry(p_row, textvariable=self.p_max_var, width=80)
            self.p_max_entry.pack(side="left", padx=(0, 8))
            ctk.CTkButton(p_row, text="自动检测", command=self._auto_detect_pmax,
                          width=80, height=28, font=("Microsoft YaHei", 10)).pack(side="left")

            # ── 自定义压力点 ──
            self._label(scroll, "自定义压力点 CV 计算 (N)")
            self.custom_p_var = tk.StringVar(value="")
            ctk.CTkEntry(scroll, textvariable=self.custom_p_var,
                         placeholder_text="输入压力值，如 15").pack(fill="x", pady=(0, 6))

            # ── 执行按钮 ──
            ctk.CTkButton(
                scroll, text="▶  开始拟合分析", command=self._run_analysis,
                height=40, font=("Microsoft YaHei", 12, "bold"),
                fg_color="#1565C0", hover_color="#1976D2",
            ).pack(fill="x", pady=(10, 4))

            # ── 拟合参数展示 ──
            self._section(scroll, "📐  拟合参数")
            self.param_text = tk.Text(
                scroll, height=14, bg="#0f3460", fg="#e0e0e0",
                font=("Consolas", 10), relief="flat", bd=0,
                state="disabled", wrap="none",
            )
            self.param_text.pack(fill="x", pady=(0, 6))

            # ── 导出 ──
            self._section(scroll, "💾  导出结果")
            exp_row = ctk.CTkFrame(scroll, fg_color="transparent")
            exp_row.pack(fill="x")
            ctk.CTkButton(exp_row, text="导出 JSON", command=lambda: self._export_json(),
                          width=110, height=30).pack(side="left", padx=(0, 4))
            ctk.CTkButton(exp_row, text="导出 CSV", command=lambda: self._export_csv(),
                          width=110, height=30).pack(side="left")

            # ── 状态栏 ──
            self.status_var = tk.StringVar(value="就绪 — 请添加 CSV 文件")
            self.status_label = ctk.CTkLabel(
                scroll, textvariable=self.status_var,
                font=("Microsoft YaHei", 10), text_color="#aaa", wraplength=280,
                anchor="w", justify="left",
            )
            self.status_label.pack(anchor="w", pady=(10, 0))

        # ── 右侧图表面板（Tab）──

        def _build_right_panel(self, parent):
            right = ctk.CTkFrame(parent, corner_radius=0, fg_color="#0d1b2a")
            right.pack(side="left", fill="both", expand=True)

            self.tab_view = ctk.CTkTabview(
                right, fg_color="#0d1b2a",
                segmented_button_fg_color="#16213e",
                segmented_button_selected_color="#1565C0",
            )
            self.tab_view.pack(fill="both", expand=True, padx=8, pady=8)

            self.tab_fit = self.tab_view.add("拟合曲线")
            self.tab_cv = self.tab_view.add("CV 分析")
            self.tab_resid = self.tab_view.add("残差分析")

            self.fig_fit, self.canvas_fit = self._make_canvas(self.tab_fit)
            self.fig_cv, self.canvas_cv = self._make_canvas(self.tab_cv)
            self.fig_resid, self.canvas_resid = self._make_canvas(self.tab_resid)

        def _make_canvas(self, parent):
            fig = Figure(figsize=(9, 6), dpi=96, facecolor="#0d1b2a")
            canvas = FigureCanvasTkAgg(fig, master=parent)
            canvas.get_tk_widget().pack(fill="both", expand=True)
            toolbar_frame = tk.Frame(parent, bg="#0d1b2a")
            toolbar_frame.pack(fill="x")
            NavigationToolbar2Tk(canvas, toolbar_frame)
            return fig, canvas

        # ── 辅助方法 ──

        def _section(self, parent, title):
            ctk.CTkLabel(parent, text=title,
                         font=("Microsoft YaHei", 12, "bold"),
                         text_color="#4FC3F7").pack(anchor="w", pady=(12, 2))

        def _label(self, parent, text):
            ctk.CTkLabel(parent, text=text, font=("Microsoft YaHei", 10),
                         text_color="#aaa").pack(anchor="w", pady=(4, 1))

        # ── 文件操作 ──

        def _add_files(self):
            paths = filedialog.askopenfilenames(
                title="选择 CSV 文件",
                filetypes=[("CSV 文件", "*.csv"), ("所有文件", "*.*")],
            )
            for path in paths:
                records = load_csv_file(path)
                if len(records) < 5:
                    messagebox.showwarning("提示",
                                           f"{os.path.basename(path)}: 有效记录不足 5 条")
                    continue
                filename = os.path.basename(path)
                self.loaded_series.append({"name": filename, "records": records, "path": path})
                self.file_listbox.insert(tk.END, f"{filename}  ({len(records)} 条)")
            self._update_summary()

        def _clear_files(self):
            self.loaded_series.clear()
            self.analysis_result = None
            self.file_listbox.delete(0, tk.END)
            self._update_summary()
            self._clear_param_text()
            self._clear_charts()
            self._set_status("就绪 — 请添加 CSV 文件")

        def _update_summary(self):
            n_files = len(self.loaded_series)
            total_rows = sum(len(s["records"]) for s in self.loaded_series)
            self.sum_file_label.configure(text=f"文件: {n_files}  数据行: {total_rows}")
            if n_files >= 2:
                self.summary_label.configure(
                    text=f"📊  已就绪 — {n_files} 个文件",
                    text_color="#4FC3F7",
                )
            elif n_files == 1:
                self.summary_label.configure(
                    text="📊  还需要 1 个文件（至少 2 个）",
                    text_color="#FFB74D",
                )
            else:
                self.summary_label.configure(
                    text="📊  暂无数据", text_color="#888",
                )

        def _auto_detect_pmax(self):
            if not self.loaded_series:
                return
            all_max = []
            for s in self.loaded_series:
                for r in s["records"]:
                    all_max.append(r["pressure"])
            pmax = max(all_max) if all_max else 100
            if pmax <= 20:
                pmax = math.ceil(pmax)
            elif pmax <= 50:
                pmax = math.ceil(pmax / 5) * 5
            elif pmax <= 100:
                pmax = math.ceil(pmax / 10) * 10
            else:
                pmax = math.ceil(pmax / 50) * 50
            self.p_max_var.set(str(pmax))

        # ── 分析执行 ──

        def _run_analysis(self):
            if len(self.loaded_series) < 2:
                messagebox.showwarning("提示", "需要至少 2 个数据文件")
                return

            try:
                self.pressure_max = float(self.p_max_var.get())
            except ValueError:
                self.pressure_max = 100
                self.p_max_var.set("100")

            self._set_status("计算中...", "#FFB74D")
            self.update_idletasks()

            pressure_points = generate_pressure_points(self.pressure_max)
            self.analysis_result = compute_analysis(self.loaded_series, pressure_points)

            if not self.analysis_result:
                messagebox.showerror("错误", "无法完成分析")
                self._set_status("分析失败")
                return

            # 自定义压力点
            custom_p = None
            try:
                cp_str = self.custom_p_var.get().strip()
                if cp_str:
                    custom_p = float(cp_str)
            except ValueError:
                custom_p = None

            self._update_param_text(self.analysis_result, custom_p)
            self._draw_charts(self.analysis_result)
            self._set_status(
                f"✓ 分析完成 — {len(self.analysis_result['perFileFits'])} 个文件拟合成功  |  "
                f"平均 CV: {self.analysis_result['avgCV']:.2f}% ({get_cv_label(self.analysis_result['avgCV'])})",
                "#4FC3F7" if self.analysis_result['avgCV'] <= 5 else "#FFB74D",
            )

        # ── 参数展示 ──

        def _update_param_text(self, analysis, custom_p=None):
            self.param_text.configure(state="normal")
            self.param_text.delete("1.0", tk.END)

            lines = []
            lines.append("═ 各文件独立拟合 ═")
            lines.append(f"{'文件':<24s} {'a':>8s} {'b':>8s} {'n':>8s} {'R²':>8s} {'方法':>10s}")
            lines.append("─" * 70)
            for entry in analysis["perFileFits"]:
                f = entry["fit"]
                name = entry["fileName"].replace('.csv', '')[:22]
                lines.append(f"{name:<24s} {f['a']:>8.1f} {f['b']:>8.1f} {f['n']:>8.4f} {f['r2']:>8.4f} {f['method']:>10s}")

            if analysis["globalFit"]:
                gf = analysis["globalFit"]
                lines.append("")
                lines.append("═ 全局拟合 ═")
                lines.append(f"a={gf['a']:.4f}  b={gf['b']:.4f}  n={gf['n']:.4f}")
                lines.append(f"R²={gf['r2']:.6f}  RMSE={gf['rmse']:.4f}")
                lines.append(f"正向: {format_hill_equation(gf)}")
                lines.append(f"反向: {format_inverse_equation(gf)}")

            if custom_p is not None:
                values = []
                for entry in analysis['perFileFits']:
                    predicted = hill_func(custom_p, entry['fit']['a'], entry['fit']['b'], entry['fit']['n'])
                    values.append(predicted)
                mean_v = np.mean(values) if values else 0
                variance = np.sum((np.array(values) - mean_v) ** 2) / len(values) if values else 0
                std_v = math.sqrt(variance)
                cv = (std_v / mean_v) * 100 if mean_v > 0 else 0
                lines.append("")
                lines.append(f"══ 自定义压力点 P={custom_p}N ══")
                lines.append(f"CV={cv:.2f}%  均值={mean_v:.1f}  标准差={std_v:.2f}  {get_cv_label(cv)}")

            lines.append("")
            lines.append("═ CV 分析 ═")
            lines.append(f"平均 CV: {analysis['avgCV']:.2f}% ({get_cv_label(analysis['avgCV'])})")
            lines.append(f"CV 评分: {analysis['cvScore']:.0f}  残差 σ: {analysis['residualStd']:.2f}")

            self.param_text.insert("1.0", "\n".join(lines))
            self.param_text.configure(state="disabled")

        def _clear_param_text(self):
            self.param_text.configure(state="normal")
            self.param_text.delete("1.0", tk.END)
            self.param_text.configure(state="disabled")

        def _clear_charts(self):
            for fig in [self.fig_fit, self.fig_cv, self.fig_resid]:
                fig.clear()
                fig.canvas.draw_idle()

        # ── 图表绘制 ──

        def _draw_charts(self, analysis):
            self._draw_fit_tab(analysis)
            self._draw_cv_tab(analysis)
            self._draw_resid_tab(analysis)

        def _draw_fit_tab(self, analysis):
            fig = self.fig_fit
            fig.clear()
            ax = fig.add_subplot(111)
            ax.set_facecolor("#0d1b2a")
            fig.patch.set_facecolor("#0d1b2a")

            colors = plt.cm.tab10(np.linspace(0, 1, 10))

            # 散点数据
            for idx, series in enumerate(self.loaded_series):
                ps = [r["pressure"] for r in series["records"]]
                vs = [r["adcSum"] for r in series["records"]]
                name = series["name"].replace('.csv', '')[:18]
                color = MPL_COLORS[idx % len(MPL_COLORS)]
                ax.scatter(ps, vs, s=6, alpha=0.4, color=color, label=name)

            # 各文件拟合曲线
            for idx, entry in enumerate(analysis["perFileFits"]):
                f = entry["fit"]
                curve = generate_fit_curve(f, 0, self.pressure_max, 200)
                cp_arr = [c["pressure"] for c in curve]
                ca_arr = [c["adcSum"] for c in curve]
                color = MPL_COLORS[idx % len(MPL_COLORS)]
                ax.plot(cp_arr, ca_arr, '--', linewidth=1.5, color=color, alpha=0.7)

            # 全局拟合
            if analysis["globalFit"]:
                gf = analysis["globalFit"]
                curve = generate_fit_curve(gf, 0, self.pressure_max, 200)
                cp_arr = [c["pressure"] for c in curve]
                ca_arr = [c["adcSum"] for c in curve]
                ax.plot(cp_arr, ca_arr, '-', linewidth=2.5, color='white', alpha=0.9,
                        label=f'Global: R²={gf["r2"]:.4f}')

            ax.set_xlabel("Pressure (N)", color="#aaa")
            ax.set_ylabel("ADC Sum", color="#aaa")
            ax.set_title(f"Hill Fitting (0-{self.pressure_max}N)", color="#e0e0e0", fontsize=13)
            ax.tick_params(colors="#aaa")
            ax.legend(loc='upper left', fontsize=7, ncol=2, labelcolor="#ccc")
            ax.grid(True, alpha=0.15, color="#aaa")
            ax.spines["bottom"].set_color("#333")
            ax.spines["left"].set_color("#333")
            fig.tight_layout()
            fig.canvas.draw_idle()

        def _draw_cv_tab(self, analysis):
            fig = self.fig_cv
            fig.clear()
            gs = fig.add_gridspec(2, 1, hspace=0.35, height_ratios=[1, 1])
            fig.patch.set_facecolor("#0d1b2a")

            # 上：CV 折线图
            ax1 = fig.add_subplot(gs[0])
            ax1.set_facecolor("#0d1b2a")
            cv_ps = [cp["pressure"] for cp in analysis["cvPoints"]]
            cv_vals = [cp["cv"] for cp in analysis["cvPoints"]]
            ax1.plot(cv_ps, cv_vals, 'o-', color='#4A9BD9', linewidth=2, markersize=7)
            ax1.axhline(y=3, color='#55B87A', linestyle='--', alpha=0.7, label='Excellent 3%')
            ax1.axhline(y=5, color='#E8923F', linestyle='--', alpha=0.7, label='Pass 5%')
            ax1.axhline(y=8, color='#E05555', linestyle='--', alpha=0.7, label='Warning 8%')
            ax1.set_ylabel("CV (%)", color="#aaa")
            ax1.set_title(f"CV Analysis (Avg: {analysis['avgCV']:.2f}%, Score: {analysis['cvScore']:.0f})",
                          color="#e0e0e0", fontsize=13)
            ax1.tick_params(colors="#aaa")
            ax1.legend(fontsize=8, labelcolor="#ccc")
            ax1.grid(True, alpha=0.15, color="#aaa")
            ax1.spines["bottom"].set_color("#333")
            ax1.spines["left"].set_color("#333")

            # 下：散点图 — 各文件在关键压力点的预测 ADC
            ax2 = fig.add_subplot(gs[1])
            ax2.set_facecolor("#0d1b2a")
            for idx, entry in enumerate(analysis["perFileFits"]):
                fit = entry["fit"]
                p_vals = [cp["pressure"] for cp in analysis["cvPoints"]]
                adc_vals = [hill_func(p, fit["a"], fit["b"], fit["n"]) for p in p_vals]
                color = MPL_COLORS[idx % len(MPL_COLORS)]
                ax2.scatter(p_vals, adc_vals, s=25, color=color, alpha=0.8,
                            label=entry["fileName"].replace('.csv', '')[:18])
            ax2.set_xlabel("Pressure (N)", color="#aaa")
            ax2.set_ylabel("Predicted ADC", color="#aaa")
            ax2.set_title("Per-File ADC Predictions at Key Points", color="#e0e0e0", fontsize=13)
            ax2.tick_params(colors="#aaa")
            ax2.legend(fontsize=7, ncol=3, labelcolor="#ccc")
            ax2.grid(True, alpha=0.15, color="#aaa")
            ax2.spines["bottom"].set_color("#333")
            ax2.spines["left"].set_color("#333")

            fig.tight_layout()
            fig.canvas.draw_idle()

        def _draw_resid_tab(self, analysis):
            fig = self.fig_resid
            fig.clear()
            gs_resid = fig.add_gridspec(2, 1, hspace=0.35)
            fig.patch.set_facecolor("#0d1b2a")

            # 上：残差直方图
            ax1 = fig.add_subplot(gs_resid[0])
            ax1.set_facecolor("#0d1b2a")
            if analysis["allResiduals"]:
                n_bins = min(30, max(5, len(analysis["allResiduals"]) // 5))
                ax1.hist(analysis["allResiduals"], bins=n_bins, color='#5B9BD5', alpha=0.7,
                         edgecolor='white', linewidth=0.5)
                ax1.axvline(x=analysis["residualMean"], color='#E8923F', linestyle='--', linewidth=1.5,
                            label=f'μ={analysis["residualMean"]:.2f}')
                ax1.axvline(x=analysis["residualMean"] - analysis["residualStd"], color='#E05555',
                            linestyle=':', linewidth=1, alpha=0.6)
                ax1.axvline(x=analysis["residualMean"] + analysis["residualStd"], color='#E05555',
                            linestyle=':', linewidth=1, alpha=0.6)
            ax1.set_ylabel("Count", color="#aaa")
            ax1.set_title(f"Residuals (σ={analysis['residualStd']:.2f}, n={len(analysis['allResiduals'])})",
                          color="#e0e0e0", fontsize=13)
            ax1.tick_params(colors="#aaa")
            ax1.legend(fontsize=8, labelcolor="#ccc")
            ax1.grid(True, alpha=0.15, color="#aaa")
            ax1.spines["bottom"].set_color("#333")
            ax1.spines["left"].set_color("#333")

            # 下：各文件残差 σ 和 max|残差| 柱状图
            ax2 = fig.add_subplot(gs_resid[1])
            ax2.set_facecolor("#0d1b2a")
            file_names = [rs["fileName"].replace('.csv', '')[:22] for rs in analysis["residualStats"]]
            sigmas = [rs["std"] for rs in analysis["residualStats"]]
            max_abs = [rs["maxAbs"] for rs in analysis["residualStats"]]
            x_pos = np.arange(len(file_names))
            width = 0.35
            ax2.bar(x_pos - width / 2, sigmas, width, label='σ (Std)', color='#5B9BD5', alpha=0.85)
            ax2.bar(x_pos + width / 2, max_abs, width, label='Max |Residual|', color='#E05555', alpha=0.85)
            ax2.set_xticks(x_pos)
            ax2.set_xticklabels(file_names, rotation=45, ha='right', fontsize=8, color="#aaa")
            ax2.set_ylabel("ADC", color="#aaa")
            ax2.set_title("Per-File Residual Statistics", color="#e0e0e0", fontsize=13)
            ax2.tick_params(colors="#aaa")
            ax2.legend(fontsize=9, labelcolor="#ccc")
            ax2.grid(True, alpha=0.15, color="#aaa", axis='y')
            ax2.spines["bottom"].set_color("#333")
            ax2.spines["left"].set_color("#333")

            fig.tight_layout()
            fig.canvas.draw_idle()

        # ── 状态 ──

        def _set_status(self, msg, color="#aaa"):
            self.status_var.set(msg)
            self.status_label.configure(text_color=color)

        # ── 导出 ──

        def _export_json(self):
            if not self.analysis_result:
                messagebox.showwarning("提示", "请先完成分析")
                return
            path = filedialog.asksaveasfilename(
                defaultextension=".json",
                filetypes=[("JSON 文件", "*.json")],
            )
            if path:
                export_json(self.analysis_result, self.pressure_max, path,
                            self._get_custom_p())

        def _export_csv(self):
            if not self.analysis_result:
                messagebox.showwarning("提示", "请先完成分析")
                return
            path = filedialog.asksaveasfilename(
                defaultextension=".csv",
                filetypes=[("CSV 文件", "*.csv")],
            )
            if not path:
                return
            rows = [["文件", "a", "b", "n", "R²", "RMSE", "方法"]]
            for entry in self.analysis_result["perFileFits"]:
                f = entry["fit"]
                rows.append([entry["fileName"], f"{f['a']:.4f}", f"{f['b']:.4f}",
                             f"{f['n']:.4f}", f"{f['r2']:.6f}", f"{f['rmse']:.4f}", f['method']])

            if self.analysis_result["globalFit"]:
                gf = self.analysis_result["globalFit"]
                rows.append([])
                rows.append(["全局拟合", f"{gf['a']:.4f}", f"{gf['b']:.4f}",
                             f"{gf['n']:.4f}", f"{gf['r2']:.6f}", f"{gf['rmse']:.4f}", gf['method']])

            rows.append([])
            rows.append(["压力点", "CV(%)", "均值", "标准差", "等级"])
            for cp in self.analysis_result["cvPoints"]:
                rows.append([f"{cp['pressure']}N", f"{cp['cv']:.2f}%",
                             f"{cp['mean']:.1f}", f"{cp['std']:.2f}", get_cv_label(cp['cv'])])

            import csv as csv_mod
            with open(path, 'w', newline='', encoding='utf-8-sig') as f:
                writer = csv_mod.writer(f)
                writer.writerows(rows)
            self._set_status(f"✓ 已导出 CSV: {os.path.basename(path)}", "#4FC3F7")

        def _get_custom_p(self):
            try:
                cp_str = self.custom_p_var.get().strip()
                if cp_str:
                    return float(cp_str)
            except ValueError:
                pass
            return None

    # 启动 GUI
    app = HillFitGUI()
    app.mainloop()


# ═══════════════════════════════════════════════════════════════════════════════
# 第 9 部分: CLI 入口
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="hill_fit_offline.py — Hill 方程拟合离线工具（与网页端算法一致）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python hill_fit_offline.py file1.csv file2.csv
  python hill_fit_offline.py *.csv --output result.json
  python hill_fit_offline.py *.csv --plot --max-pressure 200
  python hill_fit_offline.py *.csv --custom-pressure 15
        """,
    )
    parser.add_argument("files", nargs="*", help="CSV 文件路径（支持多个文件）")
    parser.add_argument("--output", "-o", default=None, help="JSON 输出文件路径")
    parser.add_argument("--plot", "-p", action="store_true", help="生成 matplotlib 图表")
    parser.add_argument("--max-pressure", "-m", type=float, default=None,
                        help="压力范围最大值 (N)，默认自动检测")
    parser.add_argument("--custom-pressure", "-c", type=float, default=None,
                        help="自定义压力点 (N) 查看 CV 值")
    parser.add_argument("--plot-output", default=None, help="图表输出路径（PNG格式）")
    parser.add_argument("--gui", "-g", action="store_true",
                        help="启动图形界面（需要 customtkinter 和 matplotlib）")

    args = parser.parse_args()

    # GUI 模式
    if args.gui:
        run_gui()
        return

    if not args.files:
        parser.error("请指定 CSV 文件路径，或使用 --gui 启动图形界面")

    # 加载 CSV 文件
    all_series = []
    for filepath in args.files:
        if not os.path.exists(filepath):
            print(f"⚠ 文件不存在: {filepath}")
            continue
        records = load_csv_file(filepath)
        if len(records) < 5:
            print(f"⚠ {filepath}: 有效记录不足 5 条（{len(records)} 条），跳过")
            continue
        filename = os.path.basename(filepath)
        all_series.append({"name": filename, "records": records})
        print(f"✓ {filename}: {len(records)} 条记录")

    if len(all_series) < 2:
        print(f"\n错误: 需要至少 2 个有效数据文件（每个 ≥5 条记录），当前 {len(all_series)} 个")
        sys.exit(1)

    # 确定压力范围
    if args.max_pressure:
        pressure_max = args.max_pressure
    else:
        all_max = []
        for s in all_series:
            for r in s["records"]:
                all_max.append(r["pressure"])
        pressure_max = max(all_max) if all_max else 100
        # 向上取整
        if pressure_max <= 20:
            pressure_max = math.ceil(pressure_max)
        elif pressure_max <= 50:
            pressure_max = math.ceil(pressure_max / 5) * 5
        elif pressure_max <= 100:
            pressure_max = math.ceil(pressure_max / 10) * 10
        else:
            pressure_max = math.ceil(pressure_max / 50) * 50

    print(f"\n压力范围: 0-{pressure_max} N")

    # 生成关键压力点
    pressure_points = generate_pressure_points(pressure_max)
    print(f"关键压力点: {', '.join(f'{p}N' for p in pressure_points)}")

    # 执行分析
    print("\n计算中...")
    analysis = compute_analysis(all_series, pressure_points)

    if not analysis:
        print("错误: 无法完成分析（需要至少 2 个文件各自拟合成功）")
        sys.exit(1)

    # 输出结果
    print_results(all_series, analysis, pressure_max, args.custom_pressure)

    # 导出 JSON
    if args.output:
        export_json(analysis, pressure_max, args.output, args.custom_pressure)

    # 绘图
    if args.plot:
        plot_results(all_series, analysis, pressure_max, args.plot_output)


if __name__ == "__main__":
    main()
