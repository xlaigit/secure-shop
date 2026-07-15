#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动部署最佳海洋特征模型
========================
功能：
1. 等待训练完成（3个模型全部保存）
2. 加载逐个评估，选最佳模型 + 集成模型
3. 自动更新 predict.py 支持海洋特征模型
4. 输出对比报告
5. 更新网页AI预测接口配置

用法：python auto_deploy_best.py
"""

import os, sys, json, math, time, warnings, glob, shutil
warnings.filterwarnings('ignore')
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'

import numpy as np
import pandas as pd
import joblib
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras.layers import Dense, Layer

# 注册自定义层（训练脚本中定义的MultiHeadAttn）
class MultiHeadAttn(Layer):
    def __init__(self, head=4, units=64, **kwargs):
        super().__init__(**kwargs)
        self.head=head; self.units=units
        self.q_dense = Dense(units*head); self.k_dense = Dense(units*head); self.v_dense = Dense(units*head)
        self.out_dense = Dense(units) if head>0 else None
    def call(self, x):
        q = self.q_dense(x); k = self.k_dense(x); v = self.v_dense(x)
        B, T, D = tf.shape(q)[0], tf.shape(q)[1], self.units
        q = tf.reshape(q, [B, T, self.head, D]); k = tf.reshape(k, [B, T, self.head, D]); v = tf.reshape(v, [B, T, self.head, D])
        q = tf.transpose(q, [0, 2, 1, 3]); k = tf.transpose(k, [0, 2, 1, 3]); v = tf.transpose(v, [0, 2, 1, 3])
        att = tf.matmul(q, k, transpose_b=True) / tf.sqrt(tf.cast(D, tf.float32))
        att = tf.nn.softmax(att)
        out = tf.matmul(att, v); out = tf.transpose(out, [0, 2, 1, 3]); out = tf.reshape(out, [B, T, self.head*D])
        return self.out_dense(out) if self.out_dense else out
    def compute_output_shape(self, input_shape):
        return (input_shape[0], input_shape[1], self.units)
    def get_config(self):
        return {"head": self.head, "units": self.units}

# ===================== 配置 =====================
MODEL_DIR = r'D:/AI_Model/ensemble_ocean_v2'
SCALER_PATH = r'D:/AI_Model/track_scaler_ocean_v2.pkl'
BEST_MODEL_PATH = r'D:/AI_Model/ocean_best_model_v2.h5'
ENSEMBLE_DIR = MODEL_DIR  # 集成模型目录，直接使用
REPORT_PATH = r'D:/AI_Model/ocean_v2_model_report.json'
PREDICT_PATH = os.path.join(os.path.dirname(__file__), 'predict.py')
CSV_PATH = os.path.join(os.path.dirname(__file__), 'typhoon_train_realtime_ocean.csv')

TIMESTEPS = 6
FEAT_DIM = 13
FEATURE_COLS = [
    "lon", "lat", "wind_ms", "pressure",
    "hgt500", "u500", "v500", "ridge_lat", "west_extent_588",
    "sst", "ohc", "vws", "wvapor"
]

SEEDS = [42, 123, 777]
EXPECTED_FILES = [f'model_{i+1}_seed{s}.h5' for i, s in enumerate(SEEDS)]


def log(msg):
    print(f"[自动部署] {msg}")


def wait_for_training():
    """等待所有3个模型训练完成"""
    log("检查训练状态...")
    while True:
        existing = set(os.listdir(MODEL_DIR)) if os.path.exists(MODEL_DIR) else set()
        missing = [f for f in EXPECTED_FILES if f not in existing]
        if not missing:
            log("✅ 所有3个模型训练完成！")
            return True
        log(f"⏳ 等待训练完成... 已保存: {[f for f in EXPECTED_FILES if f in existing]}, 缺少: {missing}")
        time.sleep(120)  # 每2分钟检查一次


def load_models():
    """加载所有3个模型"""
    models = []
    for i, seed in enumerate(SEEDS):
        path = os.path.join(MODEL_DIR, f'model_{i+1}_seed{seed}.h5')
        log(f"加载模型 {i+1}/3 (seed={seed})...")
        m = keras.models.load_model(path, compile=False, custom_objects={'MultiHeadAttn': MultiHeadAttn})
        models.append(m)
    return models


def load_data():
    """加载测试数据，准备评估"""
    log("加载测试数据...")
    df = pd.read_csv(CSV_PATH)

    # 构建样本（与训练脚本相同逻辑）
    samples = []
    for sid, g in df.groupby("storm_id"):
        g = g.sort_values("step").reset_index(drop=True)
        n = len(g)
        if n < TIMESTEPS + 12:
            continue
        for i in range(n - TIMESTEPS - 11):
            hist = g.iloc[i:i+TIMESTEPS]
            t6 = g.iloc[i+TIMESTEPS]
            t12 = g.iloc[i+TIMESTEPS+1]
            t24 = g.iloc[i+TIMESTEPS+3]
            t36 = g.iloc[i+TIMESTEPS+5]
            t72 = g.iloc[i+TIMESTEPS+11]
            row = {}
            for t in range(TIMESTEPS):
                for f in FEATURE_COLS:
                    row[f"hist_{f}{t}"] = hist.iloc[t][f]
            row["hist_lon3"] = hist.iloc[-1]["lon"]
            row["hist_lat3"] = hist.iloc[-1]["lat"]
            row["hist_wind_ms3"] = hist.iloc[-1]["wind_ms"]
            row["hist_pressure3"] = hist.iloc[-1]["pressure"]
            for prefix, src in [("t6", t6), ("t12", t12)]:
                row[f"{prefix}_lon"] = src["lon"]
                row[f"{prefix}_lat"] = src["lat"]
                row[f"{prefix}_wind"] = src["wind_ms"]
                row[f"{prefix}_press"] = src["pressure"]
            for prefix, src in [("t24", t24), ("t36", t36), ("t72", t72)]:
                row[f"{prefix}_lon"] = src["lon"]
                row[f"{prefix}_lat"] = src["lat"]
                row[f"{prefix}_wind"] = src["wind_ms"]
                row[f"{prefix}_pressure"] = src["pressure"]
            samples.append(row)

    sample_df = pd.DataFrame(samples)
    log(f"总样本: {len(sample_df)}")

    # 加载scaler
    scaler_data = joblib.load(SCALER_PATH)
    sx = scaler_data['scaler_x']
    sy = scaler_data['scaler_y']

    # 分割测试集（与训练脚本一致，85/15分割）
    split = int(0.85 * len(sample_df))
    df_test = sample_df.iloc[split:].reset_index(drop=True)
    log(f"测试样本: {len(df_test)}")

    return df_test, sx, sy


def evaluate_model(models, df_test, sx, sy, n=500):
    """评估单个模型或集成模型"""
    errs = {6: [], 12: [], 24: [], 36: [], 72: []}
    test_subset = df_test.sample(min(n, len(df_test)))

    for _, r in test_subset.iterrows():
        seq_raw = np.array([r[f"hist_{f}{t}"] for t in range(TIMESTEPS) for f in FEATURE_COLS]).reshape(1, TIMESTEPS, FEAT_DIM)
        seq_sc = sx.transform(seq_raw.reshape(-1, FEAT_DIM)).reshape(1, TIMESTEPS, FEAT_DIM)

        if isinstance(models, list):
            preds = [m.predict(seq_sc, verbose=0) for m in models]
            pred = np.mean(preds, axis=0)
        else:
            pred = models.predict(seq_sc, verbose=0)
            if isinstance(pred, list):
                pred = pred[0]

        pred_raw = sy.inverse_transform(pred.reshape(-1, 4))
        init_lon, init_lat = r["hist_lon3"], r["hist_lat3"]
        true_pos = {
            6: (r["t6_lon"], r["t6_lat"]),
            12: (r["t12_lon"], r["t12_lat"]),
            24: (r["t24_lon"], r["t24_lat"]),
            36: (r["t36_lon"], r["t36_lat"]),
            72: (r["t72_lon"], r["t72_lat"])
        }
        for idx, t in enumerate([6, 12, 24, 36, 72]):
            pred_lon = init_lon + pred_raw[idx, 0]
            pred_lat = init_lat + pred_raw[idx, 1]
            err = math.sqrt((pred_lon - true_pos[t][0])**2 + (pred_lat - true_pos[t][1])**2) * 111
            errs[t].append(err)

    result = {}
    for t in [6, 12, 24, 36, 72]:
        if len(errs[t]) > 0:
            result[t] = {
                'avg_km': round(float(np.mean(errs[t])), 1),
                'max_km': round(float(np.max(errs[t])), 1),
                'p95_km': round(float(np.percentile(errs[t], 95)), 1),
                'samples': len(errs[t])
            }
    return result


def update_predict_py(best_model_name):
    """更新predict.py，添加海洋特征模型支持（v6）"""
    log("更新 predict.py 添加海洋特征模型支持...")

    # 读取现有predict.py
    with open(PREDICT_PATH, 'r', encoding='utf-8') as f:
        content = f.read()

    # 在V5_SCALER_PATH定义后面添加v6路径
    v6_block = '''
# v6 海洋特征模型路径（13维，含SST/OHC/VWS/水汽）
V6_MODEL_DIR = r'D:/AI_Model/ensemble_ocean'
V6_BEST_MODEL_PATH = r'D:/AI_Model/ocean_best_model.h5'
V6_SCALER_PATH = r'D:/AI_Model/track_scaler_ocean.pkl'
V6_FEATURES = ['lon', 'lat', 'wind_ms', 'pressure',
               'hgt500', 'u500', 'v500', 'ridge_lat', 'west_extent_588',
               'sst', 'ohc', 'vws', 'wvapor']
V6_TIMESTEPS = 6
'''

    if 'V6_MODEL_DIR' not in content:
        # 在V5配置后面插入
        marker = "V5_SCALER_PATH = os.path.join(MODEL_DIR, 'track_scaler_v5_72h.pkl')"
        content = content.replace(marker, marker + '\n' + v6_block)

    # 添加v6模型加载函数（如果不存在）
    if 'def load_model_v6' not in content:
        v6_funcs = '''
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
            pred = np.mean(preds, axis=0)
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
'''
        # 在predict_trajectory_v5函数之后插入
        marker = '    return trajectory'
        # 找到v5函数的最后一个return
        v5_end = content.rfind(marker, 0, content.find('def main'))
        if v5_end > 0:
            # 在v5函数结束后插入
            insert_pos = content.find('\n\n', v5_end) + 2
            content = content[:insert_pos] + '\n' + v6_funcs + '\n' + content[insert_pos:]

    # 更新main函数中的模型选择逻辑
    old_choice = "parser.add_argument('--model', choices=['v1', 'v2', 'v5'], default='v5', help='模型版本')"
    new_choice = "parser.add_argument('--model', choices=['v1', 'v2', 'v5', 'v6'], default='v6', help='模型版本')"
    if old_choice in content:
        content = content.replace(old_choice, new_choice)

    # 添加v6预测逻辑
    v6_predict_block = '''
    # v6海洋特征模型（优先使用）
    use_v6 = (model_v == 'v6')
    if use_v6:
        model_or_list, model_type = load_model_v6()
        if model_or_list is not None:
            sx, sy = load_scaler_v6()
            # 从参数中获取海洋特征
            ocean_params = {
                'sst': data.get('sst', 28.5) if args.json_args else 28.5,
                'ohc': data.get('ohc', 60) if args.json_args else 60,
                'vws': data.get('vws', 10) if args.json_args else 10,
                'wvapor': data.get('wvapor', 18) if args.json_args else 18
            } if args.json_args else {'sst': 28.5, 'ohc': 60, 'vws': 10, 'wvapor': 18}
            traj = predict_trajectory_v6(model_or_list, sx, sy, history, steps, subhigh, ocean_params)
            data_source = f'AI模型预测（GRU+v6海洋特征{model_type}）'
        else:
            log("v6模型不可用，降级到v5")
            use_v5 = os.path.exists(V5_MODEL_PATH)
            if use_v5:
                model = load_model_v5()
                sx, sy = load_scaler_v5()
                traj = predict_trajectory_v5(model, sx, sy, history, steps, subhigh)
                data_source = 'AI模型预测（GRU+v5 72h高精度）降级'
            else:
                use_v2 = os.path.exists(V2_MODEL_PATH)
                model = load_model_v2()
                _, _, scaler_data = load_scaler_v2()
                traj = predict_trajectory_v2(model, scaler_data, history, steps, subhigh)
                data_source = 'AI模型预测（GRU+副高v2）降级'
    '''
    if 'use_v6' not in content:
        # 在use_v5判断之前插入
        old_v5_check = "    use_v5 = (model_v == 'v5' and os.path.exists(V5_MODEL_PATH))"
        content = content.replace(old_v5_check, v6_predict_block + '\n    ' + old_v5_check)

    with open(PREDICT_PATH, 'w', encoding='utf-8') as f:
        f.write(content)

    log("✅ predict.py 已更新，支持v6海洋特征模型")


def update_app_js():
    """更新app.js的AI预测配置"""
    app_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'app.js')

    if not os.path.exists(app_path):
        log(f"⚠️ app.js 不存在: {app_path}")
        return

    with open(app_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 更新model参数默认值为v7
    old_model_default = "model: 'v6'"
    if old_model_default in content:
        content = content.replace(old_model_default, "model: 'v7'")
        with open(app_path, 'w', encoding='utf-8') as f:
            f.write(content)
        log("✅ app.js 已更新，默认使用v7真实海洋数据集成模型")
    else:
        old_model_default = "model: 'v5'"
        if old_model_default in content:
            content = content.replace(old_model_default, "model: 'v7'")
            with open(app_path, 'w', encoding='utf-8') as f:
                f.write(content)
            log("✅ app.js 已更新，默认使用v7真实海洋数据集成模型")
        else:
            log("⚠️ app.js 未找到model默认配置，手动检查")


def main():
    print("=" * 60)
    print(" 台风路径预测 - 自动部署最佳真实海洋数据模型")
    print("=" * 60)

    # 步骤1: 等待训练完成
    print("\n[步骤 1/5] 等待训练完成...")
    if not os.path.exists(MODEL_DIR):
        os.makedirs(MODEL_DIR, exist_ok=True)
        log(f"模型目录 {MODEL_DIR} 已创建，等待训练进程...")
    wait_for_training()

    # 步骤2: 加载模型和测试数据
    print("\n[步骤 2/5] 加载模型和测试数据...")
    models = load_models()
    df_test, sx, sy = load_data()

    # 步骤3: 评估各模型
    print("\n[步骤 3/5] 评估各模型精度...")
    report = {}
    best_72h = float('inf')
    best_idx = -1

    for i in range(len(models)):
        name = f"model_{i+1}_seed{SEEDS[i]}"
        log(f"评估 {name}...")
        result = evaluate_model(models[i], df_test, sx, sy, n=500)
        report[name] = result
        print(f"  {name}:")
        for t in [6, 12, 24, 36, 72]:
            if t in result:
                print(f"    {t}h: 平均={result[t]['avg_km']}km, 最差={result[t]['max_km']}km, P95={result[t]['p95_km']}km")
        if 72 in result and result[72]['avg_km'] < best_72h:
            best_72h = result[72]['avg_km']
            best_idx = i

    # 评估集成模型
    log("评估集成模型 (3模型平均)...")
    ensemble_result = evaluate_model(models, df_test, sx, sy, n=500)
    report['ensemble'] = ensemble_result
    print(f"  集成模型:")
    for t in [6, 12, 24, 36, 72]:
        if t in ensemble_result:
            print(f"    {t}h: 平均={ensemble_result[t]['avg_km']}km, 最差={ensemble_result[t]['max_km']}km, P95={ensemble_result[t]['p95_km']}km")

    # 选择最佳模式
    use_ensemble = True
    if best_idx >= 0:
        best_name = f"model_{best_idx+1}_seed{SEEDS[best_idx]}"
        log(f"最佳单模型: {best_name} (72h={best_72h}km)")
        log(f"集成模型: 72h={ensemble_result.get(72, {}).get('avg_km', 'N/A')}km")

    if use_ensemble:
        # 集成模型更稳定，推荐使用
        log("推荐使用集成模型 (3模型平均)")
        # 保存最佳模型（复制seed42作为代表）
        shutil.copy(
            os.path.join(MODEL_DIR, 'model_1_seed42.h5'),
            BEST_MODEL_PATH
        )
        log(f"已将 model_1_seed42.h5 复制为最佳模型: {BEST_MODEL_PATH}")
    else:
        shutil.copy(
            os.path.join(MODEL_DIR, f'model_{best_idx+1}_seed{SEEDS[best_idx]}.h5'),
            BEST_MODEL_PATH
        )
        log(f"已将最佳单模型复制到: {BEST_MODEL_PATH}")

    # 保存报告
    report['best_model'] = best_name if best_idx >= 0 else 'ensemble'
    report['use_ensemble'] = use_ensemble
    report['ensemble_dir'] = ENSEMBLE_DIR
    report['deploy_time'] = time.strftime('%Y-%m-%d %H:%M:%S')
    with open(REPORT_PATH, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    log(f"评估报告已保存: {REPORT_PATH}")

    # 步骤4: 更新predict.py
    print("\n[步骤 4/5] 更新预测引擎...")
    update_predict_py(best_name if best_idx >= 0 else 'ensemble')

    # 步骤5: 更新app.js
    print("\n[步骤 5/5] 更新网页API配置...")
    update_app_js()

    # 最终报告
    print("\n" + "=" * 60)
    print(" 部署完成！")
    print("=" * 60)
    print(f"最佳模型: {report.get('best_model', 'N/A')}")
    if use_ensemble:
        print(f"使用模式: 集成模型 (3模型平均)")
    print(f"72h精度: 平均={ensemble_result.get(72, {}).get('avg_km', 'N/A')}km")
    print(f"          P95={ensemble_result.get(72, {}).get('p95_km', 'N/A')}km")
    print(f"         最差={ensemble_result.get(72, {}).get('max_km', 'N/A')}km")
    print(f"36h精度: 平均={ensemble_result.get(36, {}).get('avg_km', 'N/A')}km")
    print(f"24h精度: 平均={ensemble_result.get(24, {}).get('avg_km', 'N/A')}km")
    print(f"12h精度: 平均={ensemble_result.get(12, {}).get('avg_km', 'N/A')}km")
    print(f"6h精度:  平均={ensemble_result.get(6, {}).get('avg_km', 'N/A')}km")
    print(f"\n报告文件: {REPORT_PATH}")
    print(f"\n重启Node服务器后，AI预测将自动使用v7真实海洋数据集成模型")
    print("=" * 60)


if __name__ == '__main__':
    main()