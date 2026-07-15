#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
台风路径AI预测推理引擎（v2版本）
================================
支持：
  - v1模型：原始GRU（4特征 × 4步，输出[dlon,dlat,dwind]）
  - v2模型：增强GRU（9特征 × 4步，含副高+注意力+引导气流头）
  - 物理约束推理规则：强制抑制不合理折返路径

运行方式：
  python predict.py --model v1 --lat 20 --lon 115 --wind 40 --pressure 970
  python predict.py --model v2 --lat 20 --lon 115 --wind 40 --pressure 970 \\
                    --hgt500 5880 --u500 -6 --v500 2 --ridge_lat 22 --west_extent 120

数据来源：浙江省水利厅实时台风API / 硬编码回退
"""

import os, sys, json, warnings, math, numpy as np
warnings.filterwarnings('ignore')

# ============ 路径配置 ============
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = 'D:/AI_Model'

# v1 模型路径
V1_MODEL_PATH = os.path.join(MODEL_DIR, 'july_track_model.h5')
V1_SCALER_PATH = os.path.join(MODEL_DIR, 'track_scaler.pkl')

# v2 模型路径
V2_MODEL_PATH = os.path.join(MODEL_DIR, 'july_track_model_v2.h5')
V2_SCALER_PATH = os.path.join(MODEL_DIR, 'track_scaler_v2.pkl')

# v5 72h多步高精度模型路径
V5_MODEL_PATH = os.path.join(MODEL_DIR, 'july_track_model_v5_72h.h5')
V5_SCALER_PATH = os.path.join(MODEL_DIR, 'track_scaler_v5_72h.pkl')

# v6 海洋特征模型路径（13维，含SST/OHC/VWS/水汽）
V6_MODEL_DIR = r'D:/AI_Model/ensemble_ocean'
V6_BEST_MODEL_PATH = r'D:/AI_Model/ocean_best_model.h5'
V6_SCALER_PATH = r'D:/AI_Model/track_scaler_ocean.pkl'
V6_FEATURES = ['lon', 'lat', 'wind_ms', 'pressure',
               'hgt500', 'u500', 'v500', 'ridge_lat', 'west_extent_588',
               'sst', 'ohc', 'vws', 'wvapor']
V6_TIMESTEPS = 6

# v7 真实海洋数据集成模型路径（3个GRU模型，真实NCEP/NCAR数据训练）
V7_MODEL_DIR = r'D:/AI_Model/ensemble_ocean_v2'
V7_SCALER_PATH = r'D:/AI_Model/track_scaler_ocean_v2.pkl'
V7_FEATURES = V6_FEATURES  # 13维特征相同
V7_TIMESTEPS = 6

# v7_opt 优化版真实海洋数据集成模型（含地形高程，14维）
V7_OPT_MODEL_DIR = r'D:/AI_Model/ensemble_ocean_v7_opt'
V7_OPT_SCALER_PATH = r'D:/AI_Model/track_scaler_ocean_v7_opt.pkl'
V7_OPT_FEATURES = ['lon', 'lat', 'wind_ms', 'pressure',
                   'hgt500', 'u500', 'v500', 'ridge_lat', 'west_extent_588',
                   'sst', 'ohc', 'vws', 'wvapor', 'elevation']
V7_OPT_TIMESTEPS = 6


# 特征定义
V1_FEATURES = ['lon', 'lat', 'wind', 'pressure']
V2_FEATURES = ['lon', 'lat', 'wind', 'pressure',
               'hgt500', 'u500', 'v500', 'ridge_lat', 'west_extent_588']

TIMESTEPS = 4
OUTPUT_DIM = 3  # dlon, dlat, dwind
OUTPUT_DIM_V5 = 4  # dlon, dlat, dwind, dpressure


def log(msg):
    print(f"[预测] {msg}")


def robust_ensemble_mean(preds):
    """
    对集成模型预测结果进行鲁棒平均，自动剔除异常值。
    
    策略：对每个输出维度独立使用MAD（中位数绝对偏差）检测异常值，
    剔除异常后取剩余值的平均。如果剩余不足2个，取中位数。
    
    Args:
        preds: list of numpy arrays, 每个形状 (1, 4) 
               对应 [dlon, dlat, dwind, dpressure]
    
    Returns:
        numpy array shape (1, 4), 剔除异常值后的平均
    """
    arr = np.array([p.flatten() if p.ndim > 1 else p for p in preds])
    n = arr.shape[0]
    n_dims = arr.shape[1] if arr.ndim > 1 else 1
    
    if n <= 2:
        # 不足3个模型，直接取平均（无异常可剔除）
        return np.mean(arr, axis=0, keepdims=True) if arr.ndim > 1 else np.mean(arr)
    
    if n_dims == 1:
        # 一维情况
        median = np.median(arr)
        abs_dev = np.abs(arr - median)
        mad = np.median(abs_dev)
        if mad > 0:
            good = abs_dev <= 2.0 * mad
        else:
            # MAD=0：至少两个值相同，保留最接近中位数的两个
            sorted_idx = np.argsort(abs_dev)
            good = np.zeros(n, dtype=bool)
            good[sorted_idx[:2]] = True
        good_vals = arr[good]
        return np.mean(good_vals) if len(good_vals) >= 2 else np.median(arr)
    
    # 多维情况：每个维度独立检测
    result = np.zeros(n_dims)
    for j in range(n_dims):
        vals = arr[:, j]
        median = np.median(vals)
        abs_dev = np.abs(vals - median)
        mad = np.median(abs_dev)
        
        if mad > 0:
            # 超过 2*MAD 视为异常值
            good = abs_dev <= 2.0 * mad
        else:
            # MAD=0：至少两个值相同，保留最接近中位数的两个
            sorted_idx = np.argsort(abs_dev)
            good = np.zeros(n, dtype=bool)
            good[sorted_idx[:2]] = True
        
        good_vals = vals[good]
        if len(good_vals) >= 2:
            result[j] = np.mean(good_vals)
        elif len(good_vals) == 1:
            result[j] = good_vals[0]
        else:
            result[j] = median  # 退回到中位数
    
    return result.reshape(1, -1)


# ============================================================
# 模型加载
# ============================================================

def load_model_v1():
    """加载v1原始模型"""
    import keras
    if not os.path.exists(V1_MODEL_PATH):
        raise FileNotFoundError(f"v1模型不存在: {V1_MODEL_PATH}")
    model = keras.models.load_model(V1_MODEL_PATH, compile=False)
    log(f"v1模型加载成功: {V1_MODEL_PATH}")
    return model


def load_model_v2():
    """加载v2增强模型"""
    import keras
    if not os.path.exists(V2_MODEL_PATH):
        log(f"v2模型不存在: {V2_MODEL_PATH}，降级使用v1")
        return None
    model = keras.models.load_model(V2_MODEL_PATH, compile=False)
    log(f"v2模型加载成功: {V2_MODEL_PATH}")
    return model


def load_scaler_v1():
    """加载v1标准化器"""
    import joblib
    scaler = joblib.load(V1_SCALER_PATH)
    if isinstance(scaler, dict):
        return scaler.get('scaler_x'), scaler.get('scaler_y')
    return scaler, scaler  # 兼容旧格式


def load_scaler_v2():
    """加载v2标准化器"""
    import joblib
    data = joblib.load(V2_SCALER_PATH)
    return data['scaler_x'], data['scaler_y'], data


def load_model_v5():
    """加载v5 72h高精度模型（单步推理模型，4维输出）"""
    import keras
    if not os.path.exists(V5_MODEL_PATH):
        log(f"v5模型不存在: {V5_MODEL_PATH}，降级使用v2")
        return None
    model = keras.models.load_model(V5_MODEL_PATH, compile=False)
    log(f"v5模型加载成功: {V5_MODEL_PATH}")
    return model


def load_scaler_v5():
    """加载v5标准化器"""
    import joblib
    data = joblib.load(V5_SCALER_PATH)
    return data['scaler_x'], data['scaler_y']


# ============================================================
# 物理约束推理规则（核心修正）
# ============================================================

def check_steering_flow(u500, v500, ridge_lat, west_extent):
    """
    判定当前副高引导气流状态。
    
    返回:
      str: 'east_ridge' (东侧完整副高), 'west_ridge' (副高偏西), 'weak' (副高弱)
    """
    if ridge_lat > 20 and u500 < 0 and west_extent < 130:
        return 'east_ridge'  # 副高完整东侧盘踞，引导偏西
    elif ridge_lat > 25 and west_extent < 120:
        return 'strong_east_ridge'  # 副高强盛，引导强烈偏西
    elif ridge_lat < 15 or u500 >= 0:
        return 'weak'  # 副高弱或无引导
    else:
        return 'transition'  # 过渡状态


def physics_constrained_predict(dlon_pred, dlat_pred, dwind_pred,
                                 steer_state, lat, lon, subhigh_params):
    """
    物理约束推理修正。
    
    核心规则：
      1. 副高完整东侧盘踞（east_ridge）：
         - 台风必须向西/西北移动（dlon < 0）
         - 禁止向东移动（dlon > 0 时强制修正为向西）
         - 禁止折返（已在陆地上向西移动后又转向东）
      
      2. 副高强盛（strong_east_ridge）：
         - 更严格的向西约束
         - 禁止向北分量过大（dlat > 1.0 时削减）
         - 引导气流贡献占主导（dlon/dlat 由 u500/v500 主导）
      
      3. 副高弱（weak）：
         - 不施加约束，让模型自由预测
    
    参数:
      dlon_pred, dlat_pred, dwind_pred: 模型原始预测增量
      steer_state: 引导气流状态
      lat, lon: 当前经纬度
      subhigh_params: 副高参数 {u500, v500, ridge_lat, west_extent, hgt500}
    
    返回:
      (dlon_corrected, dlat_corrected, dwind_corrected, correction_applied)
    """
    dlon, dlat = dlon_pred, dlat_pred
    correction = False
    reason = '无修正'

    u500 = subhigh_params.get('u500', 0)
    v500 = subhigh_params.get('v500', 0)
    ridge_lat = subhigh_params.get('ridge_lat', 0)

    if steer_state == 'strong_east_ridge' or steer_state == 'east_ridge':
        # ========== 规则1：强制向西移动 ==========
        if dlon > 0:
            # 完全反转方向，改为向西
            dlon = -abs(dlon_pred) * 0.5  # 强制向西，减半幅度
            correction = True
            reason = f'禁止向东: dlon={dlon_pred:.3f}→{dlon:.3f}'

        # ========== 规则2：引导气流主导 ==========
        # 如果副高强盛，引导气流的贡献应占主导
        steer_speed = math.sqrt(u500**2 + v500**2)
        if steer_speed > 4 and steer_state == 'strong_east_ridge':
            # 引导气流方向（风向：气象学方向，0°=北风，90°=东风）
            # 转换为移动方向
            steer_dir = math.atan2(-u500, -v500)  # 风矢量转移动方向
            # 约束：预测的移动方向与引导方向偏差不超过30°
            pred_dir = math.atan2(dlat, dlon)
            angle_diff = abs(pred_dir - steer_dir)
            if angle_diff > math.pi / 6:  # 30°以上偏差
                # 将预测方向拉向引导方向
                mix_ratio = 0.4  # 40% 引导 + 60% 预测
                corrected_dir = pred_dir + mix_ratio * (steer_dir - pred_dir)
                dlon = math.cos(corrected_dir) * math.sqrt(dlon**2 + dlat**2)
                dlat = math.sin(corrected_dir) * math.sqrt(dlon**2 + dlat**2)
                correction = True
                reason += f'; 方向修正: {math.degrees(pred_dir):.0f}°→{math.degrees(corrected_dir):.0f}°'

        # ========== 规则3：禁止海南折返 ==========
        # 如果台风在海南岛附近（18-21°N, 108-112°E）
        # 且副高完整东侧盘踞，禁止折返出海
        if 18 <= lat <= 21 and 108 <= lon <= 112 and dlon > 0:
            dlon = -abs(dlon) * 0.8  # 强制向西
            dlat = max(0, dlat) * 0.3  # 禁止向北
            correction = True
            reason += '; 海南折返禁止'

    elif steer_state == 'transition':
        # 过渡状态：温和约束
        if dlon > 0.5 and ridge_lat > 18:
            dlon *= 0.5
            correction = True
            reason = f'温和约束: 削减向东分量'

    return dlon, dlat, dwind_pred, correction, reason


# ============================================================
# 核心预测函数
# ============================================================

def predict_trajectory_v1(model, scaler, history, steps=60, start_time=None):
    """
    使用v1模型推演台风路径。
    
    参数:
      history: 4步历史轨迹 [[lon,lat,wind,pressure], ...]
      steps: 推演步数（每步6小时）
      start_time: 起始时间
    
    返回:
      trajectory: [{step, lat, lon, windSpeed, pressure, ...}, ...]
    """
    import joblib
    from sklearn.preprocessing import MinMaxScaler

    # 标准化器
    if isinstance(scaler, (list, tuple)):
        scaler_x, scaler_y = scaler[0], scaler[1]
    elif isinstance(scaler, dict):
        scaler_x = scaler.get('scaler_x')
        scaler_y = scaler.get('scaler_y')
    else:
        # 兼容旧版：单个scaler用于x和y
        scaler_x = scaler_y = scaler

    # 准备输入序列
    seq = np.array(history[-TIMESTEPS:], dtype=np.float64)
    trajectory = []
    lon, lat = seq[-1][0], seq[-1][1]
    current_wind = seq[-1][2]
    current_pressure = seq[-1][3]

    # 副高参数（v1模型作为常量）
    default_subhigh = {'hgt500': 5840, 'u500': -4, 'v500': 1.5,
                       'ridge_lat': 22, 'west_extent_588': 125}

    for step in range(steps):
        try:
            # 标准化输入
            seq_flat = seq.reshape(1, -1)
            seq_scaled = scaler_x.transform(seq_flat).reshape(1, TIMESTEPS, -1)

            # 预测增量
            pred = model.predict(seq_scaled, verbose=0)
            if isinstance(pred, list):
                pred = pred[0]  # 多输出模型取第一个
            delta = scaler_y.inverse_transform(pred)[0]

            dlon, dlat, dwind = delta[0], delta[1], delta[2]

            # 物理约束修正
            steer_state = 'east_ridge'  # 默认假设副高东侧
            dlon, dlat, dwind, corr, reason = physics_constrained_predict(
                dlon, dlat, dwind, steer_state, lat, lon, default_subhigh)

            # 更新位置
            lat += dlat
            lon += dlon
            current_wind += dwind
            current_wind = max(10, min(85, current_wind))
            current_pressure = max(910, 1013 - 143 * math.pow(min(current_wind, 85) / 85, 1.5))

            # 保存
            t = int((step + 1) * 6)
            trajectory.append({
                'step': step + 1,
                'lat': round(lat, 2),
                'lon': round(lon, 2),
                'windSpeed': round(current_wind, 1),
                'pressure': round(current_pressure, 1),
                'correction': reason if corr else ''
            })

            # 更新序列
            seq = np.vstack([seq[1:], [[lon, lat, current_wind, current_pressure]]])

            # 停止条件
            if current_wind < 10:
                break

        except Exception as e:
            log(f"预测步骤 {step} 失败: {e}")
            break

    return trajectory


def predict_trajectory_v2(model, scaler_data, history, steps=60,
                           subhigh_params=None, start_time=None):
    """
    使用v2增强模型推演台风路径（含副高特征+物理约束）。
    
    参数:
      history: 4步历史轨迹 [[lon,lat,wind,pressure], ...]
      steps: 推演步数
      subhigh_params: 副高参数 {hgt500, u500, v500, ridge_lat, west_extent》
      start_time: 起始时间，用于匹配副高数据
    
    返回:
      trajectory: [{step, lat, lon, windSpeed, pressure, ...}, ...]
    """
    scaler_x = scaler_data['scaler_x']
    scaler_y = scaler_data['scaler_y']
    feature_cols = scaler_data.get('feature_cols', V2_FEATURES)

    # 默认副高参数
    if subhigh_params is None:
        subhigh_params = {'hgt500': 5840, 'u500': -4, 'v500': 1.5,
                          'ridge_lat': 22, 'west_extent_588': 125}

    def build_full_seq(history_seq, subhigh):
        """构建完整9维特征序列"""
        full = np.zeros((TIMESTEPS, 9))
        for i, (lon, lat, wind, pressure) in enumerate(history_seq):
            full[i, 0] = lon
            full[i, 1] = lat
            full[i, 2] = wind
            full[i, 3] = pressure
            full[i, 4] = subhigh.get('hgt500', 5840)
            full[i, 5] = subhigh.get('u500', -4)
            full[i, 6] = subhigh.get('v500', 1.5)
            full[i, 7] = subhigh.get('ridge_lat', 22)
            full[i, 8] = subhigh.get('west_extent_588', 125)
        return full

    # 准备初始序列
    seq = build_full_seq(history[-TIMESTEPS:], subhigh_params)
    trajectory = []
    lon, lat = seq[-1, 0], seq[-1, 1]
    current_wind = seq[-1, 2]
    current_pressure = seq[-1, 3]

    # 副高引导气流状态
    steer_state = check_steering_flow(
        subhigh_params.get('u500', 0),
        subhigh_params.get('v500', 0),
        subhigh_params.get('ridge_lat', 0),
        subhigh_params.get('west_extent_588', 200)
    )
    log(f"副高状态: {steer_state} | "
        f"脊线={subhigh_params.get('ridge_lat',0)}°N "
        f"u500={subhigh_params.get('u500',0)}m/s "
        f"5880西伸={subhigh_params.get('west_extent_588',200)}°E")

    for step in range(steps):
        try:
            # 标准化输入（每个时间步独立标准化，再恢复时序形状）
            seq_2d = seq.reshape(-1, 9)  # (4, 9) -> (4, 9)
            seq_scaled = scaler_x.transform(seq_2d).reshape(1, TIMESTEPS, 9)

            # 预测
            pred = model.predict(seq_scaled, verbose=0)
            if isinstance(pred, list):
                pred = pred[0]  # 取主输出
            delta = scaler_y.inverse_transform(pred)[0]

            dlon, dlat, dwind = delta[0], delta[1], delta[2]

            # ========== 物理约束修正（核心） ==========
            dlon, dlat, dwind, corr, reason = physics_constrained_predict(
                dlon, dlat, dwind, steer_state, lat, lon, subhigh_params)

            # 更新位置
            lat += dlat
            lon += dlon
            current_wind += dwind
            current_wind = max(8, min(85, current_wind))
            current_pressure = max(910, 1013 - 143 * math.pow(min(current_wind, 85) / 85, 1.5))

            # 保存
            trajectory.append({
                'step': step + 1,
                'lat': round(lat, 2),
                'lon': round(lon, 2),
                'windSpeed': round(current_wind, 1),
                'pressure': round(current_pressure, 1),
                'correction': reason if corr else ''
            })

            # 更新序列
            new_row = [lon, lat, current_wind, current_pressure,
                       subhigh_params.get('hgt500', 5840),
                       subhigh_params.get('u500', -4),
                       subhigh_params.get('v500', 1.5),
                       subhigh_params.get('ridge_lat', 22),
                       subhigh_params.get('west_extent_588', 125)]
            seq = np.vstack([seq[1:], [new_row]])

            # 停止条件
            if current_wind < 10:
                break

        except Exception as e:
            log(f"预测步骤 {step} 失败: {e}")
            break

    return trajectory


# ============================================================
# v5 72h高精度模型推理（4维输出：直接预测气压）
# ============================================================

def predict_trajectory_v5(model, scaler_x, scaler_y, history, steps=60,
                           subhigh_params=None, start_time=None):
    """
    使用v5 72h高精度模型推演台风路径。
    v5模型输出4维：[dlon, dlat, dwind, dpressure]，气压直接预测而非推算。
    
    参数:
      model: v5模型（单步推理模型）
      scaler_x, scaler_y: StandardScaler标准化器
      history: 4步历史轨迹 [[lon,lat,wind,pressure], ...]
      steps: 推演步数（每步6小时）
      subhigh_params: 副高参数 {hgt500, u500, v500, ridge_lat, west_extent}
      start_time: 起始时间
    """
    if subhigh_params is None:
        subhigh_params = {'hgt500': 5840, 'u500': -4, 'v500': 1.5,
                          'ridge_lat': 22, 'west_extent_588': 125}

    # 构建完整9维特征序列
    seq = np.zeros((TIMESTEPS, 9), dtype=np.float64)
    for i, (lon, lat, wind, pressure) in enumerate(history[-TIMESTEPS:]):
        seq[i, 0] = lon
        seq[i, 1] = lat
        seq[i, 2] = wind
        seq[i, 3] = pressure
        seq[i, 4] = subhigh_params.get('hgt500', 5840)
        seq[i, 5] = subhigh_params.get('u500', -4)
        seq[i, 6] = subhigh_params.get('v500', 1.5)
        seq[i, 7] = subhigh_params.get('ridge_lat', 22)
        seq[i, 8] = subhigh_params.get('west_extent_588', 125)

    trajectory = []
    lon, lat = seq[-1, 0], seq[-1, 1]
    current_wind = seq[-1, 2]
    current_pressure = seq[-1, 3]

    # 副高引导气流状态
    steer_state = check_steering_flow(
        subhigh_params.get('u500', 0),
        subhigh_params.get('v500', 0),
        subhigh_params.get('ridge_lat', 0),
        subhigh_params.get('west_extent_588', 200)
    )

    for step in range(steps):
        try:
            # 标准化输入
            seq_2d = seq.reshape(-1, 9)
            seq_scaled = scaler_x.transform(seq_2d).reshape(1, TIMESTEPS, 9)

            # 预测（v5模型单输出，4维：[dlon, dlat, dwind, dpressure]）
            pred = model.predict(seq_scaled, verbose=0)
            if isinstance(pred, list):
                pred = pred[0]
            delta = scaler_y.inverse_transform(pred)[0]

            dlon, dlat, dwind, dpressure = delta[0], delta[1], delta[2], delta[3]

            # 物理约束修正
            dlon, dlat, dwind, corr, reason = physics_constrained_predict(
                dlon, dlat, dwind, steer_state, lat, lon, subhigh_params)

            # 更新位置和强度（气压直接预测）
            lat += dlat
            lon += dlon
            current_wind += dwind
            current_wind = max(8, min(85, current_wind))
            # v5直接预测气压增量，比从风速推算更精确
            current_pressure = max(880, min(1020, current_pressure + dpressure))
            # 气压与风速的物理一致性校验
            expected_pressure = 1013 - 143 * math.pow(min(current_wind, 85) / 85, 1.5)
            if abs(current_pressure - expected_pressure) > 20:
                current_pressure = 0.7 * current_pressure + 0.3 * expected_pressure

            # 保存
            trajectory.append({
                'step': step + 1,
                'lat': round(lat, 2),
                'lon': round(lon, 2),
                'windSpeed': round(current_wind, 1),
                'pressure': round(current_pressure, 1),
                'correction': reason if corr else ''
            })

            # 更新序列
            new_row = [lon, lat, current_wind, current_pressure,
                       subhigh_params.get('hgt500', 5840),
                       subhigh_params.get('u500', -4),
                       subhigh_params.get('v500', 1.5),
                       subhigh_params.get('ridge_lat', 22),
                       subhigh_params.get('west_extent_588', 125)]
            seq = np.vstack([seq[1:], [new_row]])

            # 停止条件
            if current_wind < 10:
                break

        except Exception as e:
            log(f"v5预测步骤 {step} 失败: {e}")
            break

    return trajectory



def load_model_v6():
    """加载v6海洋特征模型"""
    import keras
    if not os.path.exists(V6_BEST_MODEL_PATH):
        # 尝试加载集成模型
        if os.path.exists(V6_MODEL_DIR):
            files = [f for f in os.listdir(V6_MODEL_DIR) if f.endswith('.h5')]
            if files:
                models = []
                for f in files:
                    p = os.path.join(V6_MODEL_DIR, f)
                    models.append(keras.models.load_model(p, compile=False))
                log(f"v6集成模型加载成功: {len(models)}个模型平均")
                return models, 'ensemble'
        log("v6模型不存在")
        return None, None
    model = keras.models.load_model(V6_BEST_MODEL_PATH, compile=False)
    log(f"v6最佳模型加载成功: {V6_BEST_MODEL_PATH}")
    return model, 'single'

def load_scaler_v6():
    """加载v6标准化器"""
    import joblib
    data = joblib.load(V6_SCALER_PATH)
    return data['scaler_x'], data['scaler_y']

def load_model_v7():
    """加载v7真实海洋数据集成模型（3个GRU模型，取平均）"""
    import keras
    if not os.path.exists(V7_MODEL_DIR):
        log(f"v7模型目录不存在: {V7_MODEL_DIR}")
        return None, None
    files = sorted([f for f in os.listdir(V7_MODEL_DIR) if f.endswith('.h5')])
    if not files:
        log("v7模型目录中没有.h5文件")
        return None, None
    models = []
    for f in files:
        p = os.path.join(V7_MODEL_DIR, f)
        models.append(keras.models.load_model(p, compile=False))
    log(f"v7集成模型加载成功: {len(models)}个模型 ({', '.join(files)})")
    return models, 'ensemble'

def load_scaler_v7():
    """加载v7标准化器"""
    import joblib
    data = joblib.load(V7_SCALER_PATH)
    return data['scaler_x'], data['scaler_y']

def load_model_v7_opt():
    """加载v7_opt优化版集成模型（加权采样+平滑+混合损失训练）"""
    import keras
    if not os.path.exists(V7_OPT_MODEL_DIR):
        log(f"v7_opt模型目录不存在: {V7_OPT_MODEL_DIR}")
        return None, None
    files = sorted([f for f in os.listdir(V7_OPT_MODEL_DIR) if f.endswith('.h5')])
    if not files:
        log("v7_opt模型目录中没有.h5文件")
        return None, None
    models = []
    for f in files:
        p = os.path.join(V7_OPT_MODEL_DIR, f)
        models.append(keras.models.load_model(p, compile=False))
    log(f"v7_opt集成模型加载成功: {len(models)}个模型 ({', '.join(files)})")
    return models, 'ensemble_opt'

def load_scaler_v7_opt():
    """加载v7_opt标准化器"""
    import joblib
    data = joblib.load(V7_OPT_SCALER_PATH)
    return data['scaler_x'], data['scaler_y']

# ============================================================
# 推理双分支融合 - 根据台风类型动态选择预测策略
# ============================================================

def detect_typhoon_type(history, subhigh_params, ocean_params):
    """
    检测台风类型，判断是否属于极端/突变台风。
    
    返回:
      'extreme': 超强/突变台风，应使用v7真实场模型
      'regular': 常规平稳台风，可融合v6气候态压误差
    """
    # 提取历史信息
    winds = [h[2] for h in history[-6:]]  # 最近6步风速
    max_wind = max(winds)
    wind_change = max(winds) - min(winds)
    
    vws = ocean_params.get('vws', 10)
    sst = ocean_params.get('sst', 28)
    
    # 极端判断条件
    is_super = max_wind >= 50        # 超强台风
    is_rapid = wind_change >= 15     # 快速增强
    is_high_vws = vws >= 20          # 垂直风切变剧烈
    is_warm_sst = sst >= 29.5        # 极高海温
    
    extreme_score = sum([is_super, is_rapid, is_high_vws, is_warm_sst])
    
    if extreme_score >= 2:
        return 'extreme'
    return 'regular'


# ============================================================
# 地形摩擦系数 - 台风过境削弱
# ============================================================

# 地形摩擦区域定义 (lon_min, lon_max, lat_min, lat_max, 摩擦系数, 名称)
# 摩擦系数: 0.0=无地形, 1.0=完全阻挡
TERRAIN_REGIONS = [
    # === 台湾中央山脉（最强削弱） ===
    (119.8, 122.2, 21.8, 25.5, 0.55, '台湾中央山脉'),
    # === 吕宋岛菲律宾 ===
    (119.5, 122.5, 14.0, 19.5, 0.40, '吕宋岛'),
    # === 中国沿海山地 ===
    (117.5, 121.0, 23.5, 28.0, 0.35, '福建沿海'),
    (119.0, 123.0, 27.5, 31.0, 0.30, '浙江沿海'),
    (110.0, 117.5, 20.0, 25.0, 0.25, '广东沿海'),
    # === 朝鲜半岛 ===
    (124.0, 129.5, 33.5, 39.0, 0.30, '朝鲜半岛'),
    # === 日本 ===
    (129.0, 141.0, 30.0, 40.0, 0.35, '日本本州'),
    # === 海南岛 ===
    (108.5, 111.5, 18.0, 20.5, 0.25, '海南岛'),
]

def get_terrain_friction(lon, lat):
    """
    获取指定位置的地形摩擦系数。
    返回 (摩擦系数, 区域名称)
    - 摩擦系数: 0.0=无地形(海洋), 越大表示地形越复杂、削弱越强
    - 名称: 地形区域名称
    """
    for lon_min, lon_max, lat_min, lat_max, friction, name in TERRAIN_REGIONS:
        if lon_min <= lon <= lon_max and lat_min <= lat <= lat_max:
            return friction, name
    return 0.0, '海洋'


# ============================================================
# 物理约束后处理 - 确保预测符合气象规律
# ============================================================

def apply_physics_constraints(delta, lon, lat, current_wind, current_pressure,
                               vws, sst, step_idx):
    """
    对模型预测的增量(delta)施加物理约束，确保预测结果符合气象规律。
    
    约束规则：(原有10条 + 地形约束)
    11. 地形摩擦：台湾中央山脉、沿海山地等区域削弱风速，提升气压
    12. 过山路径：穿越台湾中央山脉时，路径偏移修正
    """
    delta = delta.copy()
    
    # 当前VWS和SST
    vws = float(vws) if vws is not None else 10
    sst = float(sst) if sst is not None else 28
    
    # 当前纬度
    current_lat = float(lat)
    
    # ====== 1. VWS 约束 (同前) ======
    if vws > 20:
        delta[0, 2] = min(delta[0, 2], -2.0)
        delta[1, 2] = min(delta[1, 2], -1.5)
        delta[2, 2] = min(delta[2, 2], -1.0)
        delta[0, 3] = max(delta[0, 3], 3.0)
        delta[1, 3] = max(delta[1, 3], 2.0)
    elif vws > 15:
        delta[0, 2] = min(delta[0, 2], 0)
        delta[1, 2] = min(delta[1, 2], 0.5)
        delta[0, 3] = max(delta[0, 3], 0)
    elif vws > 12:
        delta[0, 2] = min(delta[0, 2], 1.0)
        delta[1, 2] = min(delta[1, 2], 2.0)
    
    # ====== 2. SST 约束 (同前) ======
    if sst < 22:
        delta[0, 2] = min(delta[0, 2], -5.0)
        delta[1, 2] = min(delta[1, 2], -4.0)
        delta[0, 3] = max(delta[0, 3], 5.0)
    elif sst < 24:
        delta[0, 2] = min(delta[0, 2], -3.0)
        delta[1, 2] = min(delta[1, 2], -2.0)
        delta[0, 3] = max(delta[0, 3], 3.0)
    elif sst < 26:
        delta[0, 2] = min(delta[0, 2], 0)
        delta[0, 3] = max(delta[0, 3], 0)
    
    # ====== 3. 高VWS + 冷水叠加效应 (同前) ======
    if vws > 10 and sst < 27:
        weakening_factor = 1.0 + (vws - 10) * 0.15 + (27 - sst) * 0.2
        delta[0, 2] = min(delta[0, 2], -2.0 * weakening_factor)
        delta[0, 3] = max(delta[0, 3], 2.0 * weakening_factor)
    
    # ====== 4. 纬度约束 (同前) ======
    if current_lat > 40:
        max_wind = 17
        if current_wind > max_wind:
            delta[0, 2] = min(delta[0, 2], max_wind - current_wind)
        delta[1, 2] = min(delta[1, 2], -1.0)
    elif current_lat > 35:
        max_wind = 25
        if current_wind > max_wind:
            delta[0, 2] = min(delta[0, 2], max_wind - current_wind)
        delta[0, 2] = min(delta[0, 2], -1.0)
        delta[0, 3] = max(delta[0, 3], 2.0)
    elif current_lat > 30:
        delta[0, 2] = delta[0, 2] * 0.5
        delta[0, 3] = delta[0, 3] * 1.5
    
    # ====== 5. 路径北跳约束 (同前) ======
    if delta[0, 1] > 3.0:
        delta[0, 1] = 3.0
    if delta[1, 1] > 4.0:
        delta[1, 1] = 4.0
    if vws > 15 and sst < 26:
        delta[0, 1] = min(delta[0, 1], 1.5)
        delta[1, 1] = min(delta[1, 1], 2.5)
    new_lat = current_lat + delta[0, 1]
    if new_lat > 50:
        delta[0, 1] = 50 - current_lat
    
    # ====== 6. 地形摩擦约束 ======
    terrain_friction, terrain_name = get_terrain_friction(lon, lat)
    if terrain_friction > 0:
        # 地形摩擦系数越大，风速削弱越强
        wind_reduction = delta[0, 2] - terrain_friction * 15.0  # 6h风速大幅削减
        delta[0, 2] = min(delta[0, 2], wind_reduction)
        delta[1, 2] = min(delta[1, 2], wind_reduction * 0.7)   # 12h也受影响
        
        # 气压相应升高（台风结构被破坏）
        pressure_increase = terrain_friction * 8.0
        delta[0, 3] = max(delta[0, 3], pressure_increase)
        delta[1, 3] = max(delta[1, 3], pressure_increase * 0.6)
        
        # 台湾中央山脉的特殊处理：更剧烈的削弱
        if '台湾' in terrain_name:
            # 中央山脉主峰近4000m，台风过境时中心结构被严重破坏
            delta[0, 2] = min(delta[0, 2], -terrain_friction * 25.0)
            delta[0, 3] = max(delta[0, 3], terrain_friction * 12.0)
            # 路径偏移：过山后中心可能向南或北跳
            if delta[0, 1] > 0:
                # 过山后路径可能偏南（地形阻隔）
                delta[0, 1] = delta[0, 1] * 0.6
    
    # ====== 7. 过山后地形持续影响 ======
    # 即使离开地形区域，之前的地形影响会持续几步
    if hasattr(apply_physics_constraints, 'last_terrain') and apply_physics_constraints.last_terrain > 0:
        decay = max(0, 1.0 - step_idx * 0.15)  # 逐步衰减
        delta[0, 2] = min(delta[0, 2], -apply_physics_constraints.last_terrain * 5.0 * decay)
        apply_physics_constraints.last_terrain *= decay
        if apply_physics_constraints.last_terrain < 0.01:
            apply_physics_constraints.last_terrain = 0
    
    # 记录当前地形摩擦（用于后续步骤的持续影响）
    if terrain_friction > 0:
        apply_physics_constraints.last_terrain = terrain_friction
    
    return delta

# 初始化地形持续影响变量
apply_physics_constraints.last_terrain = 0.0


def predict_trajectory_v7_opt(models_v7_opt, scaler_x, scaler_y, history, steps=60,
                               subhigh_params=None, ocean_params=None, start_time=None):
    """
    使用v7_opt优化版模型推演台风路径。
    内置双分支融合：检测台风类型后动态选择预测策略。
    
    常规台风 → 融合v6气候态特征压制误差
    极端台风 → 完全使用v7真实场模型输出
    """
    # 检测台风类型
    typhoon_type = detect_typhoon_type(history, subhigh_params or {}, ocean_params or {})
    log(f"台风类型检测: {typhoon_type} (max_wind={max([h[2] for h in history[-6:]])}, "
         f"vws={ocean_params.get('vws', 'N/A')})")
    
    # 尝试加载v6模型用于融合
    v6_models = None
    if typhoon_type == 'regular':
        v6_models, _ = load_model_v6()
        if v6_models is not None:
            try:
                v6_sx, v6_sy = load_scaler_v6()
            except:
                v6_models = None
    
    if subhigh_params is None:
        subhigh_params = {'hgt500': 5840, 'u500': -4, 'v500': 1.5,
                          'ridge_lat': 22, 'west_extent_588': 125}
    if ocean_params is None:
        ocean_params = {'sst': 28.5, 'ohc': 60, 'vws': 10, 'wvapor': 18}

    # 构建初始14维序列（含地形高程）
    seq = np.zeros((V7_OPT_TIMESTEPS, len(V7_OPT_FEATURES)), dtype=np.float64)
    for i, (lon, lat, wind, pressure) in enumerate(history[-V7_OPT_TIMESTEPS:]):
        # 从地形网格查询高程
        from terrain_utils import get_elevation as _get_elev
        terrain_elev = _get_elev(lon, lat)
        seq[i, 0] = lon
        seq[i, 1] = lat
        seq[i, 2] = wind
        seq[i, 3] = pressure
        seq[i, 4] = subhigh_params.get('hgt500', 5840)
        seq[i, 5] = subhigh_params.get('u500', -4)
        seq[i, 6] = subhigh_params.get('v500', 1.5)
        seq[i, 7] = subhigh_params.get('ridge_lat', 22)
        seq[i, 8] = subhigh_params.get('west_extent_588', 125)
        seq[i, 9] = ocean_params.get('sst', 28.5)
        seq[i, 10] = ocean_params.get('ohc', 60)
        seq[i, 11] = ocean_params.get('vws', 10)
        seq[i, 12] = ocean_params.get('wvapor', 18)
        seq[i, 13] = terrain_elev  # 地形高程

    trajectory = []
    lon, lat = seq[-1, 0], seq[-1, 1]
    current_wind = seq[-1, 2]
    current_pressure = seq[-1, 3]

    for step in range(0, steps, 6):
        try:
            seq_2d = seq.reshape(-1, len(V7_OPT_FEATURES))
            seq_sc = scaler_x.transform(seq_2d).reshape(1, V7_OPT_TIMESTEPS, len(V7_OPT_FEATURES))

            # v7_opt 模型预测
            preds = [m.predict(seq_sc, verbose=0) for m in models_v7_opt]
            pred_v7 = robust_ensemble_mean(preds)
            if isinstance(pred_v7, list):
                pred_v7 = pred_v7[0]
            delta_v7 = scaler_y.inverse_transform(pred_v7.reshape(-1, 4))

            # 如果是常规台风，融合v6气候态预测
            if typhoon_type == 'regular' and v6_models is not None:
                # 构建v6的9维序列（不含海洋特征）
                seq_v6 = np.zeros((6, 9), dtype=np.float64)
                for i in range(6):
                    seq_v6[i, 0] = seq[i, 0]  # lon
                    seq_v6[i, 1] = seq[i, 1]  # lat
                    seq_v6[i, 2] = seq[i, 2]  # wind
                    seq_v6[i, 3] = seq[i, 3]  # pressure
                    seq_v6[i, 4] = seq[i, 4]  # hgt500
                    seq_v6[i, 5] = seq[i, 5]  # u500
                    seq_v6[i, 6] = seq[i, 6]  # v500
                    seq_v6[i, 7] = seq[i, 7]  # ridge_lat
                    seq_v6[i, 8] = seq[i, 8]  # west_extent
                seq_v6_sc = v6_sx.transform(seq_v6.reshape(-1, 9)).reshape(1, 6, 9)
                preds_v6 = [m.predict(seq_v6_sc, verbose=0) for m in v6_models]
                pred_v6 = robust_ensemble_mean(preds_v6)
                if isinstance(pred_v6, list):
                    pred_v6 = pred_v6[0]
                delta_v6 = v6_sy.inverse_transform(pred_v6.reshape(-1, 4))
                
                # 融合：v7 占70%，v6 占30%
                delta = 0.7 * delta_v7 + 0.3 * delta_v6
                model_tag = 'v7_opt_fusion'
            else:
                delta = delta_v7
                model_tag = 'v7_opt_extreme'

            # ====== 物理约束后处理 ======
            current_vws = seq[-1, 11] if len(seq) > 0 else ocean_params.get('vws', 10)
            current_sst = seq[-1, 9] if len(seq) > 0 else ocean_params.get('sst', 28)
            delta = apply_physics_constraints(delta, lon, lat, current_wind, current_pressure,
                                               current_vws, current_sst, step // 6)

            time_targets = [6, 12, 24, 36, 72]
            for idx, t_hours in enumerate(time_targets):
                if step + t_hours > steps:
                    break
                pred_lon = lon + delta[idx, 0]
                pred_lat = lat + delta[idx, 1]
                pred_wind = max(8, min(85, current_wind + delta[idx, 2]))
                pred_pressure = current_pressure + delta[idx, 3]
                pred_pressure = max(880, min(1020, pred_pressure))

                trajectory.append({
                    'step': step + t_hours,
                    'lat': round(float(pred_lat), 2),
                    'lon': round(float(pred_lon), 2),
                    'windSpeed': round(float(pred_wind), 1),
                    'pressure': round(float(pred_pressure), 1),
                    'model': model_tag
                })

            lon += delta[0, 0]
            lat += delta[0, 1]
            current_wind = max(8, min(85, current_wind + delta[0, 2]))
            current_pressure += delta[0, 3]
            current_pressure = max(880, min(1020, current_pressure))

            new_row = [lon, lat, current_wind, current_pressure,
                       subhigh_params.get('hgt500', 5840),
                       subhigh_params.get('u500', -4),
                       subhigh_params.get('v500', 1.5),
                       subhigh_params.get('ridge_lat', 22),
                       subhigh_params.get('west_extent_588', 125),
                       ocean_params.get('sst', 28.5),
                       ocean_params.get('ohc', 60),
                       ocean_params.get('vws', 10),
                       ocean_params.get('wvapor', 18),
                       _get_elev(lon, lat)]  # 地形高程
            seq = np.vstack([seq[1:], [new_row]])

            if current_wind < 10:
                break

        except Exception as e:
            log(f"v7_opt预测步骤 {step} 失败: {e}")
            break

    return trajectory


def predict_trajectory_v6(model_or_list, scaler_x, scaler_y, history, steps=60,
                           subhigh_params=None, ocean_params=None, start_time=None):
    """
    使用v6海洋特征模型推演台风路径。
    13维输入：[lon,lat,wind,pressure,hgt500,u500,v500,ridge_lat,west_extent,sst,ohc,vws,wvapor]
    6时步，多头输出（6h,12h,24h,36h,72h）
    """
    import tensorflow as tf
    is_ensemble = isinstance(model_or_list, list)
    models = model_or_list if is_ensemble else [model_or_list]

    if subhigh_params is None:
        subhigh_params = {'hgt500': 5840, 'u500': -4, 'v500': 1.5,
                          'ridge_lat': 22, 'west_extent_588': 125}
    if ocean_params is None:
        ocean_params = {'sst': 28.5, 'ohc': 60, 'vws': 10, 'wvapor': 18}

    # 构建初始13维序列
    seq = np.zeros((V6_TIMESTEPS, len(V6_FEATURES)), dtype=np.float64)
    for i, (lon, lat, wind, pressure) in enumerate(history[-V6_TIMESTEPS:]):
        seq[i, 0] = lon
        seq[i, 1] = lat
        seq[i, 2] = wind
        seq[i, 3] = pressure
        seq[i, 4] = subhigh_params.get('hgt500', 5840)
        seq[i, 5] = subhigh_params.get('u500', -4)
        seq[i, 6] = subhigh_params.get('v500', 1.5)
        seq[i, 7] = subhigh_params.get('ridge_lat', 22)
        seq[i, 8] = subhigh_params.get('west_extent_588', 125)
        seq[i, 9] = ocean_params.get('sst', 28.5)
        seq[i, 10] = ocean_params.get('ohc', 60)
        seq[i, 11] = ocean_params.get('vws', 10)
        seq[i, 12] = ocean_params.get('wvapor', 18)

    # 从初始位置计算目标位置
    trajectory = []
    lon, lat = seq[-1, 0], seq[-1, 1]
    current_wind = seq[-1, 2]
    current_pressure = seq[-1, 3]

    # 每个时步直接预测6h,12h,24h,36h,72h的增量
    for step in range(0, steps, 6):
        try:
            seq_2d = seq.reshape(-1, len(V6_FEATURES))
            seq_sc = scaler_x.transform(seq_2d).reshape(1, V6_TIMESTEPS, len(V6_FEATURES))

            # 集成模型平均
            preds = [m.predict(seq_sc, verbose=0) for m in models]
            pred = robust_ensemble_mean(preds)
            if isinstance(pred, list):
                pred = pred[0]

            delta = scaler_y.inverse_transform(pred.reshape(-1, 4))

            # 各时步预测
            time_targets = [6, 12, 24, 36, 72]
            for idx, t_hours in enumerate(time_targets):
                if step + t_hours > steps:
                    break
                pred_lon = lon + delta[idx, 0]
                pred_lat = lat + delta[idx, 1]
                pred_wind = max(8, min(85, current_wind + delta[idx, 2]))
                pred_pressure = current_pressure + delta[idx, 3]
                pred_pressure = max(880, min(1020, pred_pressure))

                trajectory.append({
                    'step': step + t_hours,
                    'lat': round(float(pred_lat), 2),
                    'lon': round(float(pred_lon), 2),
                    'windSpeed': round(float(pred_wind), 1),
                    'pressure': round(float(pred_pressure), 1),
                    'model': 'v6_ocean'
                })

            # 使用6h预测更新位置，继续滚动预测
            lon += delta[0, 0]
            lat += delta[0, 1]
            current_wind = max(8, min(85, current_wind + delta[0, 2]))
            current_pressure += delta[0, 3]
            current_pressure = max(880, min(1020, current_pressure))

            # 更新序列
            new_row = [lon, lat, current_wind, current_pressure,
                       subhigh_params.get('hgt500', 5840),
                       subhigh_params.get('u500', -4),
                       subhigh_params.get('v500', 1.5),
                       subhigh_params.get('ridge_lat', 22),
                       subhigh_params.get('west_extent_588', 125),
                       ocean_params.get('sst', 28.5),
                       ocean_params.get('ohc', 60),
                       ocean_params.get('vws', 10),
                       ocean_params.get('wvapor', 18)]
            seq = np.vstack([seq[1:], [new_row]])

            if current_wind < 10:
                break

        except Exception as e:
            log(f"v6预测步骤 {step} 失败: {e}")
            break

    return trajectory


# ============================================================
# v7 真实海洋数据集成模型推理（3模型平均，13维真实NCEP/NCAR数据）
# ============================================================

def predict_trajectory_v7(models, scaler_x, scaler_y, history, steps=60,
                           subhigh_params=None, ocean_params=None, start_time=None):
    """
    使用v7真实海洋数据集成模型（3个GRU模型平均）推演台风路径。
    13维输入，6时步，多头输出（6h,12h,24h,36h,72h），3模型取平均。
    
    参数:
      models: 3个GRU模型列表
      scaler_x, scaler_y: StandardScaler标准化器
      history: 6步历史轨迹 [[lon,lat,wind,pressure], ...]
      steps: 推演步数（每步6小时）
      subhigh_params: 副高参数 {hgt500, u500, v500, ridge_lat, west_extent}
      ocean_params: 海洋参数 {sst, ohc, vws, wvapor}
      start_time: 起始时间
    
    返回:
      trajectory: [{step, lat, lon, windSpeed, pressure, ...}, ...]
    """
    if subhigh_params is None:
        subhigh_params = {'hgt500': 5840, 'u500': -4, 'v500': 1.5,
                          'ridge_lat': 22, 'west_extent_588': 125}
    if ocean_params is None:
        ocean_params = {'sst': 28.5, 'ohc': 60, 'vws': 10, 'wvapor': 18}

    # 构建初始13维序列
    seq = np.zeros((V7_TIMESTEPS, len(V7_FEATURES)), dtype=np.float64)
    for i, (lon, lat, wind, pressure) in enumerate(history[-V7_TIMESTEPS:]):
        seq[i, 0] = lon
        seq[i, 1] = lat
        seq[i, 2] = wind
        seq[i, 3] = pressure
        seq[i, 4] = subhigh_params.get('hgt500', 5840)
        seq[i, 5] = subhigh_params.get('u500', -4)
        seq[i, 6] = subhigh_params.get('v500', 1.5)
        seq[i, 7] = subhigh_params.get('ridge_lat', 22)
        seq[i, 8] = subhigh_params.get('west_extent_588', 125)
        seq[i, 9] = ocean_params.get('sst', 28.5)
        seq[i, 10] = ocean_params.get('ohc', 60)
        seq[i, 11] = ocean_params.get('vws', 10)
        seq[i, 12] = ocean_params.get('wvapor', 18)

    trajectory = []
    lon, lat = seq[-1, 0], seq[-1, 1]
    current_wind = seq[-1, 2]
    current_pressure = seq[-1, 3]

    # 每个时步直接预测6h,12h,24h,36h,72h的增量
    for step in range(0, steps, 6):
        try:
            seq_2d = seq.reshape(-1, len(V7_FEATURES))
            seq_sc = scaler_x.transform(seq_2d).reshape(1, V7_TIMESTEPS, len(V7_FEATURES))

            # ========== 三模型共同预测，取平均值 ==========
            preds = [m.predict(seq_sc, verbose=0) for m in models]
            pred = robust_ensemble_mean(preds)  # 3模型平均
            if isinstance(pred, list):
                pred = pred[0]

            delta = scaler_y.inverse_transform(pred.reshape(-1, 4))

            # ====== 物理约束后处理 ======
            current_vws = seq[-1, 11] if len(seq) > 0 else ocean_params.get('vws', 10)
            current_sst = seq[-1, 9] if len(seq) > 0 else ocean_params.get('sst', 28)
            delta = apply_physics_constraints(delta, lon, lat, current_wind, current_pressure,
                                               current_vws, current_sst, step // 6)

            # 各时步预测
            time_targets = [6, 12, 24, 36, 72]
            for idx, t_hours in enumerate(time_targets):
                if step + t_hours > steps:
                    break
                pred_lon = lon + delta[idx, 0]
                pred_lat = lat + delta[idx, 1]
                pred_wind = max(8, min(85, current_wind + delta[idx, 2]))
                pred_pressure = current_pressure + delta[idx, 3]
                pred_pressure = max(880, min(1020, pred_pressure))

                trajectory.append({
                    'step': step + t_hours,
                    'lat': round(float(pred_lat), 2),
                    'lon': round(float(pred_lon), 2),
                    'windSpeed': round(float(pred_wind), 1),
                    'pressure': round(float(pred_pressure), 1),
                    'model': 'v7_ocean_real'
                })

            # 使用6h预测更新位置，继续滚动预测
            lon += delta[0, 0]
            lat += delta[0, 1]
            current_wind = max(8, min(85, current_wind + delta[0, 2]))
            current_pressure += delta[0, 3]
            current_pressure = max(880, min(1020, current_pressure))

            # 更新序列
            new_row = [lon, lat, current_wind, current_pressure,
                       subhigh_params.get('hgt500', 5840),
                       subhigh_params.get('u500', -4),
                       subhigh_params.get('v500', 1.5),
                       subhigh_params.get('ridge_lat', 22),
                       subhigh_params.get('west_extent_588', 125),
                       ocean_params.get('sst', 28.5),
                       ocean_params.get('ohc', 60),
                       ocean_params.get('vws', 10),
                       ocean_params.get('wvapor', 18)]
            seq = np.vstack([seq[1:], [new_row]])

            if current_wind < 10:
                break

        except Exception as e:
            log(f"v7预测步骤 {step} 失败: {e}")
            break

    return trajectory


# ============================================================
# 主入口
# ============================================================

def main():
    import argparse
    parser = argparse.ArgumentParser(description='台风路径AI预测')
    parser.add_argument('--model', choices=['v1', 'v2', 'v5', 'v6', 'v7', 'v7_opt'], default='v7_opt', help='模型版本')
    parser.add_argument('--lat', type=float, default=None, help='当前纬度')
    parser.add_argument('--lon', type=float, default=None, help='当前经度')
    parser.add_argument('--wind', type=float, default=None, help='当前风速(m/s)')
    parser.add_argument('--pressure', type=float, default=None, help='当前气压(hPa)')
    parser.add_argument('--steps', type=int, default=60, help='预测步数')
    parser.add_argument('--hgt500', type=float, default=5840, help='500hPa位势高度')
    parser.add_argument('--u500', type=float, default=-4, help='500hPa u风分量')
    parser.add_argument('--v500', type=float, default=1.5, help='500hPa v风分量')
    parser.add_argument('--ridge_lat', type=float, default=22, help='副高脊线纬度')
    parser.add_argument('--west_extent', type=float, default=125, help='5880线西伸经度')
    # 支持JSON字符串参数（兼容app.js调用）
    parser.add_argument('json_args', nargs='?', help='JSON格式参数')

    args = parser.parse_args()

    # 解析JSON参数模式（app.js传入）
    if args.json_args:
        try:
            data = json.loads(args.json_args)
            lat = data.get('lat', args.lat)
            lon = data.get('lon', args.lon)
            wind = data.get('wind', args.wind)
            pressure = data.get('pressure', args.pressure)
            steps = data.get('steps', args.steps)
            model_v = data.get('model', args.model)
            subhigh = {
                'hgt500': data.get('hgt500', args.hgt500),
                'u500': data.get('u500', args.u500),
                'v500': data.get('v500', args.v500),
                'ridge_lat': data.get('ridge_lat', args.ridge_lat),
                'west_extent_588': data.get('west_extent', args.west_extent)
            }
        except (json.JSONDecodeError, TypeError):
            return {'success': False, 'error': 'JSON参数解析失败'}
    else:
        lat = args.lat
        lon = args.lon
        wind = args.wind
        pressure = args.pressure
        steps = args.steps
        model_v = args.model
        subhigh = {
            'hgt500': args.hgt500,
            'u500': args.u500,
            'v500': args.v500,
            'ridge_lat': args.ridge_lat,
            'west_extent_588': args.west_extent
        }

    if lat is None or lon is None:
        return {'success': False, 'error': '缺少位置参数'}

    # 构建历史序列（v1/v2/v5用4步，v6/v7/v7_opt用6步）
    use_ocean = model_v in ('v6', 'v7', 'v7_opt')
    ocean_timesteps = V6_TIMESTEPS if use_ocean else TIMESTEPS
    history = [[lon, lat, wind, pressure]] * ocean_timesteps

    log(f"模型: {model_v}")
    log(f"当前位置: {lat}°N, {lon}°E, {wind}m/s, {pressure}hPa")
    log(f"副高: 脊线{subhigh['ridge_lat']}°N, u500={subhigh['u500']}m/s, "
         f"5880西伸至{subhigh['west_extent_588']}°E")

    # 提取海洋参数（用于v6/v7/v7_opt）
    ocean_params = {}
    if args.json_args:
        ocean_params = {
            'sst': data.get('sst', 28.5),
            'ohc': data.get('ohc', 60),
            'vws': data.get('vws', 10),
            'wvapor': data.get('wvapor', 18)
        }
    else:
        ocean_params = {'sst': 28.5, 'ohc': 60, 'vws': 10, 'wvapor': 18}

    # ========== v7_opt 优化版真实海洋数据集成模型（优先使用） ==========
    if model_v == 'v7_opt':
        models, model_type = load_model_v7_opt()
        if models is not None:
            sx, sy = load_scaler_v7_opt()
            traj = predict_trajectory_v7_opt(models, sx, sy, history, steps, subhigh, ocean_params)
            data_source = f'AI模型预测（GRU+v7_opt优化版{model_type}，双分支融合）'
        else:
            log("v7_opt模型不可用，降级到v7")
            model_v = 'v7'

    # ========== v7 真实海洋数据集成模型 ==========
    if model_v == 'v7':
        models, model_type = load_model_v7()
        if models is not None:
            sx, sy = load_scaler_v7()
            traj = predict_trajectory_v7(models, sx, sy, history, steps, subhigh, ocean_params)
            data_source = f'AI模型预测（GRU+v7真实海洋数据{model_type}，3模型平均）'
        else:
            log("v7模型不可用，降级到v6")
            model_v = 'v6'

    # ========== v6海洋特征模型 ==========
    if model_v == 'v6':
        model_or_list, model_type = load_model_v6()
        if model_or_list is not None:
            sx, sy = load_scaler_v6()
            traj = predict_trajectory_v6(model_or_list, sx, sy, history, steps, subhigh, ocean_params)
            data_source = f'AI模型预测（GRU+v6海洋特征{model_type}）'
        else:
            log("v6模型不可用，降级到v5")
            model_v = 'v5'

    # ========== v5 72h高精度模型 ==========
    use_v5 = (model_v == 'v5' and os.path.exists(V5_MODEL_PATH))
    use_v2 = (model_v == 'v2' and os.path.exists(V2_MODEL_PATH))
    if use_v5:
        model = load_model_v5()
        sx, sy = load_scaler_v5()
        traj = predict_trajectory_v5(model, sx, sy, history, steps, subhigh)
        data_source = 'AI模型预测（GRU+v5 72h高精度）'
    elif use_v2:
        model = load_model_v2()
        _, _, scaler_data = load_scaler_v2()
        traj = predict_trajectory_v2(model, scaler_data, history, steps, subhigh)
        data_source = 'AI模型预测（GRU+副高v2）'
    else:
        model = load_model_v1()
        scaler = load_scaler_v1()
        traj = predict_trajectory_v1(model, scaler, history, steps)
        data_source = 'AI模型预测（GRU v1）'

    # 输出结果
    output = {
        'success': True,
        'input': {
            'lat': lat, 'lon': lon, 'wind': wind, 'pressure': pressure,
            'subhigh': subhigh
        },
        'trajectory': traj,
        'total_steps': len(traj),
        'dataSource': data_source,
        'landfall': next((t for t in traj if t['lat'] < 25 and 108 < t['lon'] < 118), None)
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))
    return output


if __name__ == '__main__':
    main()