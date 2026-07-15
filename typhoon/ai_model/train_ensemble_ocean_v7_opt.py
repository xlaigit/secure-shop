#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V7 Optimized Ensemble Ocean - 物理约束版
=============================================
优化策略：
1. 数据过滤：剔除物理上不合理的样本（高VWS+强台风、冷水+强台风等）
2. 分层加权采样：常规台风压低权重，极端台风拉高权重
3. 输入特征在线平滑：3步滑动平均降噪
4. 物理约束损失：MSE + 分位数损失 + 物理违规惩罚
5. 推理双分支融合（在predict.py中实现）

训练3个GRU模型（不同随机种子），取平均预测
14维特征（含地形高程），6时步，5头输出（6h/12h/24h/36h/72h）
"""

import os, sys, math, warnings
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
import joblib
import tensorflow as tf
from tensorflow.keras.layers import (Input, Dense, BatchNormalization, Dropout, Layer, Concatenate, GRU)
from tensorflow.keras.models import Model
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau, CSVLogger, ModelCheckpoint
from tensorflow.keras.utils import Sequence
from sklearn.preprocessing import StandardScaler

# ===================== 配置 =====================
CSV_PATH = "typhoon_train_realtime_ocean.csv"
MODEL_DIR = r"D:/AI_Model/ensemble_ocean_v7_opt"
SCALER_SAVE = r"D:/AI_Model/track_scaler_ocean_v7_opt.pkl"
TIMESTEPS = 6
FEAT_DIM = 14
BATCH_SIZE = 256
EPOCH_MAX = 300
PATIENCE = 40
L2_COEFF = 3e-5
DROPOUT_RATE = 0.30
NOISE_STD = 0.06

# 时间头权重
W6H = 0.35; W12H = 0.05; W24H = 0.05; W36H = 0.20; W72H = 0.35

# 混合损失权重（调整：增加MSE权重，降低物理约束权重防止loss爆炸）
W_MSE = 0.65      # MSE占比
W_QUANTILE = 0.20 # 分位数损失占比
W_PHYSICS = 0.15  # 物理约束损失占比
QUANTILE_TAU = 0.95

# 物理约束惩罚系数（调整：降低惩罚系数防止loss爆炸）
PHYSICS_VWS_PENALTY = 0.02    # 每1m/s VWS超标的惩罚
PHYSICS_SST_PENALTY = 0.03    # 每1°C SST不足的惩罚
PHYSICS_LAT_PENALTY = 0.01    # 每1°纬度超标的惩罚

FEATURE_COLS = [
    "lon", "lat", "wind_ms", "pressure",
    "hgt500", "u500", "v500", "ridge_lat", "west_extent_588",
    "sst", "ohc", "vws", "wvapor", "elevation"
]

OCEAN_FEAT_IDX = [9, 10, 11, 12]  # sst, ohc, vws, wvapor

# ===================== 数据过滤 =====================
def filter_physical_samples(sample_df):
    """
    过滤物理上不合理的训练样本。
    保留合理样本，剔除以下情况：
    - 高VWS(>15) + 强台风(>50m/s)：极高风切变下不可能维持超强台风
    - 冷水(SST<24) + 强台风(>40m/s)：冷水中台风会快速减弱
    - 高纬度(>35°N) + 台风强度(>30m/s)：高纬度不能维持台风
    - 极冷水(SST<22) + 任何台风(>20m/s)：极冷水快速消散
    - 高VWS(>20) + 任何台风(>25m/s)：极高VWS撕裂台风
    """
    initial_count = len(sample_df)
    
    # 提取每个样本的当前VWS、SST、风速、纬度
    hist_vws = np.array([sample_df[f"hist_vws{t}"].values for t in range(TIMESTEPS)]).max(axis=0)
    hist_sst = np.array([sample_df[f"hist_sst{t}"].values for t in range(TIMESTEPS)]).max(axis=0)
    hist_wind = np.array([sample_df[f"hist_wind_ms{t}"].values for t in range(TIMESTEPS)]).max(axis=0)
    hist_lat = sample_df["last_lat"].values
    
    # 目标时段最大风速（检验未来是否也物理不合理）
    t_winds = np.column_stack([
        sample_df["t6_wind"].values,
        sample_df["t12_wind"].values,
        sample_df["t24_wind"].values,
        sample_df["t36_wind"].values,
        sample_df["t72_wind"].values
    ])
    max_t_wind = t_winds.max(axis=1)
    
    masks = []
    # 规则1: VWS > 15 且 风速 > 50 → 不合理
    mask1 = ~((hist_vws > 15) & (hist_wind > 50))
    masks.append(('VWS>15 + 风速>50', (~mask1).sum(), mask1))
    
    # 规则2: SST < 24 且 风速 > 40 → 不合理
    mask2 = ~((hist_sst < 24) & (hist_wind > 40))
    masks.append(('SST<24 + 风速>40', (~mask2).sum(), mask2))
    
    # 规则3: 纬度 > 35 且 风速 > 30 → 不合理
    mask3 = ~((hist_lat > 35) & (hist_wind > 30))
    masks.append(('纬度>35 + 风速>30', (~mask3).sum(), mask3))
    
    # 规则4: SST < 22 且 风速 > 20 → 不合理
    mask4 = ~((hist_sst < 22) & (hist_wind > 20))
    masks.append(('SST<22 + 风速>20', (~mask4).sum(), mask4))
    
    # 规则5: VWS > 20 且 风速 > 25 → 不合理
    mask5 = ~((hist_vws > 20) & (hist_wind > 25))
    masks.append(('VWS>20 + 风速>25', (~mask5).sum(), mask5))
    
    # 规则6: 目标时段同样不合理（未来超高VWS下还增强）
    mask6 = ~((hist_vws > 15) & (max_t_wind > hist_wind + 10))
    masks.append(('VWS>15 + 未来增强>10', (~mask6).sum(), mask6))
    
    print("\n数据过滤统计:")
    for name, count, _ in masks:
        print(f"  {name}: 剔除 {count} 个样本 ({count/initial_count*100:.1f}%)")
    
    # 合并所有过滤条件
    combined = np.ones(initial_count, dtype=bool)
    for _, _, m in masks:
        combined = combined & m
    
    filtered = sample_df[combined].copy().reset_index(drop=True)
    print(f"\n  总样本: {initial_count} → 过滤后: {len(filtered)} (剔除 {initial_count-len(filtered)} 个, {(initial_count-len(filtered))/initial_count*100:.1f}%)")
    return filtered


# ===================== 样本权重计算 =====================
def compute_sample_weights(sample_df, df_raw):
    """计算分层权重（同之前版本）"""
    weights = []
    for _, r in sample_df.iterrows():
        w = 1.0
        
        # 1. 强度因子
        wind_vals = [r.get(f"hist_wind_ms{t}", 0) for t in range(TIMESTEPS)]
        max_hist_wind = max(wind_vals)
        if max_hist_wind >= 60:
            w += 3.0
        elif max_hist_wind >= 45:
            w += 1.5
        elif max_hist_wind >= 30:
            w += 0.5
        
        # 2. VWS因子
        vws_vals = [r.get(f"hist_vws{t}", 0) for t in range(TIMESTEPS)]
        max_vws_hist = max(vws_vals)
        if max_vws_hist >= 25:
            w += 2.0
        elif max_vws_hist >= 15:
            w += 1.0
        
        # 3. 路径急转因子
        lons = [r.get(f"hist_lon{t}", 0) for t in range(TIMESTEPS)]
        lats = [r.get(f"hist_lat{t}", 0) for t in range(TIMESTEPS)]
        angles = []
        for j in range(1, TIMESTEPS):
            dl = lons[j] - lons[j-1]
            da = lats[j] - lats[j-1]
            if abs(dl) > 0.01 or abs(da) > 0.01:
                angles.append(math.atan2(da, dl))
        sharp_count = 0
        for j in range(1, len(angles)):
            diff = abs(angles[j] - angles[j-1])
            if diff > math.pi/4:
                sharp_count += 1
        w += sharp_count * 1.0

        # 4. 目标时段突变因子
        t_winds = [
            r.get("t6_wind", 0), r.get("t12_wind", 0),
            r.get("t24_wind", 0), r.get("t36_wind", 0),
            r.get("t72_wind", 0)
        ]
        wind_change = max(t_winds) - min(t_winds)
        if wind_change >= 30:
            w += 2.0
        elif wind_change >= 15:
            w += 1.0

        w = max(0.3, min(6.0, w))
        weights.append(w)
    
    return np.array(weights, dtype=np.float32)


# ===================== 在线特征平滑 =====================
def smooth_ocean_features(seq):
    smoothed = seq.copy()
    for idx in OCEAN_FEAT_IDX:
        col = seq[:, idx]
        kernel = np.array([0.25, 0.5, 0.25])
        padded = np.pad(col, (1, 1), 'edge')
        smoothed[:, idx] = np.convolve(padded, kernel, 'valid')
    return smoothed


# ===================== 多头注意力层 =====================
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


# ===================== 物理约束损失函数 =====================
class PhysicsHybridLoss(tf.keras.losses.Loss):
    """
    混合损失 = w_mse * MSE + w_quantile * QuantileLoss + w_physics * PhysicsPenalty
    
    PhysicsPenalty: 惩罚模型预测的物理违规行为
    - 高VWS下预测风速增强 → 惩罚
    - 冷水区预测风速增强 → 惩罚
    - 高纬度预测维持台风强度 → 惩罚
    
    额外信息通过 y_true 末尾4列传入: [vws, sst, lat, current_wind]
    """
    def __init__(self, w6=W6H, w12=W12H, w24=W24H, w36=W36H, w72=W72H,
                 w_mse=W_MSE, w_quantile=W_QUANTILE, w_physics=W_PHYSICS,
                 tau=QUANTILE_TAU, **kwargs):
        super().__init__(**kwargs)
        self.w6=w6; self.w12=w12; self.w24=w24; self.w36=w36; self.w72=w72
        self.w_mse=w_mse; self.w_quantile=w_quantile; self.w_physics=w_physics
        self.tau=tau

    def call(self, y_true, y_pred):
        # 提取物理信息（最后4列）
        vws = y_true[:, 20]       # 当前VWS
        sst = y_true[:, 21]       # 当前SST
        lat = y_true[:, 22]       # 当前纬度
        cur_wind = y_true[:, 23]  # 当前风速
        
        # 提取预测目标（前20列：5头×4输出）
        gt6=y_true[:,0:4]; gt12=y_true[:,4:8]; gt24=y_true[:,8:12]; gt36=y_true[:,12:16]; gt72=y_true[:,16:20]
        pr6=y_pred[:,0:4]; pr12=y_pred[:,4:8]; pr24=y_pred[:,8:12]; pr36=y_pred[:,12:16]; pr72=y_pred[:,16:20]

        # 各时步误差
        err6 = pr6 - gt6; err12 = pr12 - gt12; err24 = pr24 - gt24
        err36 = pr36 - gt36; err72 = pr72 - gt72

        # 加权MSE
        mse = (self.w6 * tf.reduce_mean(tf.square(err6)) +
               self.w12 * tf.reduce_mean(tf.square(err12)) +
               self.w24 * tf.reduce_mean(tf.square(err24)) +
               self.w36 * tf.reduce_mean(tf.square(err36)) +
               self.w72 * tf.reduce_mean(tf.square(err72)))

        # 分位数损失
        err72_norm = tf.sqrt(tf.reduce_sum(tf.square(err72), axis=1))
        tau = tf.constant(self.tau, dtype=tf.float32)
        quantile_loss = tf.reduce_mean(tf.maximum(tau * err72_norm, (tau - 1) * err72_norm))

        # ====== 物理约束惩罚 ======
        # 预测的风速增量（delta[2] for each head）
        pred_wind_deltas = tf.stack([
            pr6[:, 2], pr12[:, 2], pr24[:, 2], pr36[:, 2], pr72[:, 2]
        ], axis=1)  # (batch, 5)
        
        # 预测的未来风速 = 当前风速 + 增量
        pred_winds = cur_wind[:, tf.newaxis] + pred_wind_deltas  # (batch, 5)
        
        # 每个时步的权重
        head_weights = tf.constant([self.w6, self.w12, self.w24, self.w36, self.w72])
        
        physics_penalty = 0.0
        
        # 1. VWS惩罚：VWS > 12 且预测风速增强
        vws_excess = tf.maximum(vws - 12.0, 0.0)
        wind_gain = tf.maximum(pred_wind_deltas, 0.0)  # 只惩罚增强
        vws_penalty = vws_excess[:, tf.newaxis] * wind_gain * head_weights
        physics_penalty += tf.reduce_mean(vws_penalty) * PHYSICS_VWS_PENALTY
        
        # 2. VWS > 20 的严重惩罚（不管是否增强，只要维持强风就惩罚）
        vws_severe = tf.cast(vws > 20.0, tf.float32)
        strong_wind = tf.maximum(pred_winds - 25.0, 0.0)
        severe_penalty = vws_severe[:, tf.newaxis] * strong_wind * head_weights
        physics_penalty += tf.reduce_mean(severe_penalty) * PHYSICS_VWS_PENALTY * 2
        
        # 3. SST惩罚：SST < 26 且预测风速增强
        sst_deficit = tf.maximum(26.0 - sst, 0.0)
        sst_penalty = sst_deficit[:, tf.newaxis] * wind_gain * head_weights
        physics_penalty += tf.reduce_mean(sst_penalty) * PHYSICS_SST_PENALTY
        
        # 4. SST < 24 的严重惩罚
        sst_cold = tf.cast(sst < 24.0, tf.float32)
        any_wind_maintain = tf.maximum(pred_wind_deltas + 1.0, 0.0)  # 不减弱就算违规
        cold_penalty = sst_cold[:, tf.newaxis] * any_wind_maintain * head_weights
        physics_penalty += tf.reduce_mean(cold_penalty) * PHYSICS_SST_PENALTY * 2
        
        # 5. 纬度惩罚：纬度 > 30 且预测风速增强
        lat_excess = tf.maximum(lat - 30.0, 0.0)
        lat_penalty = lat_excess[:, tf.newaxis] * wind_gain * head_weights
        physics_penalty += tf.reduce_mean(lat_penalty) * PHYSICS_LAT_PENALTY
        
        # 6. 纬度 > 35 维持台风强度
        lat_high = tf.cast(lat > 35.0, tf.float32)
        high_wind = tf.maximum(pred_winds - 25.0, 0.0)
        high_lat_penalty = lat_high[:, tf.newaxis] * high_wind * head_weights
        physics_penalty += tf.reduce_mean(high_lat_penalty) * PHYSICS_LAT_PENALTY * 2

        return self.w_mse * mse + self.w_quantile * quantile_loss + self.w_physics * physics_penalty

    def get_config(self):
        return {"w6":self.w6,"w12":self.w12,"w24":self.w24,"w36":self.w36,"w72":self.w72,
                "w_mse":self.w_mse,"w_quantile":self.w_quantile,"w_physics":self.w_physics,
                "tau":self.tau}


# ===================== 构建GRU模型 =====================
def build_gru_model(seed=42):
    tf.random.set_seed(seed)
    np.random.seed(seed)
    inp = Input(shape=(TIMESTEPS, FEAT_DIM))
    g1 = GRU(512, return_sequences=True, kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(inp)
    b1 = BatchNormalization()(g1); d1 = Dropout(DROPOUT_RATE)(b1)
    attn = MultiHeadAttn(head=4, units=80)(d1)
    g2 = GRU(256, return_sequences=True, kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(attn)
    b2 = BatchNormalization()(g2); d2 = Dropout(DROPOUT_RATE)(b2)
    g3 = GRU(128, return_sequences=False, kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(d2)
    b3 = BatchNormalization()(g3); d3 = Dropout(DROPOUT_RATE)(b3)
    shared = Dense(384, activation="relu")(d3); shared = Dropout(0.2)(shared)
    h6=Dense(128,activation="relu")(shared); h12=Dense(128,activation="relu")(shared)
    h24=Dense(128,activation="relu")(shared); h36=Dense(128,activation="relu")(shared)
    h72=Dense(192,activation="relu")(shared); h72=Dropout(0.15)(h72); h72=Dense(128,activation="relu")(h72)
    o6=Dense(4,name="out_6h")(h6); o12=Dense(4,name="out_12h")(h12)
    o24=Dense(4,name="out_24h")(h24); o36=Dense(4,name="out_36h")(h36); o72=Dense(4,name="out_72h")(h72)
    out = Concatenate()([o6,o12,o24,o36,o72])
    model = Model(inp, out)
    model.compile(optimizer=Adam(learning_rate=3e-4, clipnorm=1.0), loss=PhysicsHybridLoss())
    return model


# ===================== 数据生成器 =====================
class MultiHeadGenOpt(Sequence):
    def __init__(self, df, scaler_x, scaler_y, bs, sample_weights=None, augment=False, smooth=True):
        self.df = df.reset_index(drop=True)
        self.sx = scaler_x; self.sy = scaler_y
        self.bs = bs; self.idx = list(range(len(self.df)))
        self.weights = sample_weights
        self.augment = augment
        self.smooth = smooth

    def __len__(self):
        return int(np.ceil(len(self.idx) / self.bs))

    def __getitem__(self, i):
        slc = self.idx[i*self.bs:(i+1)*self.bs]
        batch = self.df.iloc[slc]
        X, Y, W = [], [], []
        for _, r in batch.iterrows():
            seq_raw = np.array([r[f"hist_{f}{t}"] for t in range(TIMESTEPS) for f in FEATURE_COLS]).reshape(TIMESTEPS, FEAT_DIM)
            
            if self.smooth:
                seq_raw = smooth_ocean_features(seq_raw)
            
            seq_sc = self.sx.transform(seq_raw.reshape(-1, FEAT_DIM)).reshape(TIMESTEPS, FEAT_DIM)
            llon, llat, lwind, lpress = r["last_lon"], r["last_lat"], r["last_wind_ms"], r["last_pressure"]
            inc6 = np.array([r["t6_lon"]-llon, r["t6_lat"]-llat, r["t6_wind"]-lwind, r["t6_press"]-lpress])
            inc12 = np.array([r["t12_lon"]-llon, r["t12_lat"]-llat, r["t12_wind"]-lwind, r["t12_press"]-lpress])
            inc24 = np.array([r["t24_lon"]-llon, r["t24_lat"]-llat, r["t24_wind"]-lwind, r["t24_pressure"]-lpress])
            inc36 = np.array([r["t36_lon"]-llon, r["t36_lat"]-llat, r["t36_wind"]-lwind, r["t36_pressure"]-lpress])
            inc72 = np.array([r["t72_lon"]-llon, r["t72_lat"]-llat, r["t72_wind"]-lwind, r["t72_pressure"]-lpress])
            all_inc = np.stack([inc6, inc12, inc24, inc36, inc72])
            flat_scaled = self.sy.transform(all_inc.reshape(-1, 4)).flatten()
            
            # 追加物理信息到y_true: [vws, sst, lat, current_wind]
            physics_info = np.array([
                r["last_vws"],          # 当前VWS
                r["last_sst"],          # 当前SST
                r["last_lat"],          # 当前纬度
                r["last_wind_ms"]       # 当前风速
            ], dtype=np.float64)
            flat_scaled = np.concatenate([flat_scaled, physics_info])
            
            if self.augment:
                seq_sc += np.random.normal(0, NOISE_STD, seq_sc.shape)
            X.append(seq_sc); Y.append(flat_scaled)
            if self.weights is not None:
                W.append(self.weights[r.name])
        if self.weights is not None:
            return np.array(X), np.array(Y), np.array(W)
        return np.array(X), np.array(Y)


# ===================== 评估 =====================
def evaluate_ensemble(models, scaler_x, scaler_y, test_df, n=300, smooth=True):
    errs = {6:[], 12:[], 24:[], 36:[], 72:[]}
    test_subset = test_df.sample(min(n, len(test_df)))
    for _, r in test_subset.iterrows():
        seq_raw = np.array([r[f"hist_{f}{t}"] for t in range(TIMESTEPS) for f in FEATURE_COLS]).reshape(1, TIMESTEPS, FEAT_DIM)
        if smooth:
            seq_raw = smooth_ocean_features(seq_raw[0]).reshape(1, TIMESTEPS, FEAT_DIM)
        seq_sc = scaler_x.transform(seq_raw.reshape(-1, FEAT_DIM)).reshape(1, TIMESTEPS, FEAT_DIM)
        preds = [m.predict(seq_sc, verbose=0) for m in models]
        pred = np.mean(preds, axis=0)
        pred_raw = scaler_y.inverse_transform(pred.reshape(-1, 4))
        init_lon, init_lat = r["last_lon"], r["last_lat"]
        true_pos = {6:(r["t6_lon"],r["t6_lat"]),12:(r["t12_lon"],r["t12_lat"]),24:(r["t24_lon"],r["t24_lat"]),36:(r["t36_lon"],r["t36_lat"]),72:(r["t72_lon"],r["t72_lat"])}
        for idx, t in enumerate([6,12,24,36,72]):
            pred_lon = init_lon + pred_raw[idx, 0]; pred_lat = init_lat + pred_raw[idx, 1]
            err = math.sqrt((pred_lon - true_pos[t][0])**2 + (pred_lat - true_pos[t][1])**2) * 111
            errs[t].append(err)
    print("\n========== 集成预测精度 ==========")
    for t in [6,12,24,36,72]:
        if len(errs[t]) > 0:
            p95 = np.percentile(errs[t], 95)
            print(f"{t}h: 平均={np.mean(errs[t]):.1f}km, 最差={np.max(errs[t]):.1f}km, P95={p95:.1f}km, 样本={len(errs[t])}")
    print("===================================")
    return errs


# ===================== 主流程 =====================
if __name__ == "__main__":
    print("=" * 70)
    print("[V7 Physics-Constrained] 真实数据优化版 - 数据过滤+物理约束损失")
    print("=" * 70)

    print("\n加载数据...")
    df = pd.read_csv(CSV_PATH)
    sys.stdout.flush()
    
    # 预计算所有滑动窗口样本（向量化，避免Python循环构建字典）
    feat_cols = FEATURE_COLS
    n_feat = len(feat_cols)
    storm_groups = []
    for sid, g in df.groupby("storm_id"):
        g = g.sort_values("step").reset_index(drop=True)
        n = len(g)
        if n >= 18:  # TIMESTEPS + 12
            storm_groups.append(g)
    
    total_samples = sum(len(g) - 17 for g in storm_groups)
    print(f"预计样本数: {total_samples}")
    sys.stdout.flush()
    
    # 预分配numpy数组
    hist_arr = np.zeros((total_samples, TIMESTEPS, n_feat), dtype=np.float32)
    t_arr = np.zeros((total_samples, 5, 4), dtype=np.float32)  # 5个目标时步 × 4个变量(lon,lat,wind,press)
    last_pos = np.zeros((total_samples, 4), dtype=np.float32)  # last lon, lat, wind, pressure
    last_vws = np.zeros(total_samples, dtype=np.float32)
    last_sst = np.zeros(total_samples, dtype=np.float32)
    
    idx = 0
    for g in storm_groups:
        n = len(g)
        vals = g[feat_cols].values  # (n, n_feat)
        lons = vals[:, 0]
        lats = vals[:, 1]
        winds = vals[:, 2]
        pressures = vals[:, 3]
        vws = vals[:, 11]
        sst = vals[:, 9]
        
        for i in range(n - 17):
            # 6步历史
            hist_arr[idx] = vals[i:i+TIMESTEPS]
            # 最后位置
            last_pos[idx] = [lons[i+5], lats[i+5], winds[i+5], pressures[i+5]]
            last_vws[idx] = vws[i+5]
            last_sst[idx] = sst[i+5]
            # 5个目标时步
            t_arr[idx] = [
                [lons[i+6], lats[i+6], winds[i+6], pressures[i+6]],
                [lons[i+7], lats[i+7], winds[i+7], pressures[i+7]],
                [lons[i+9], lats[i+9], winds[i+9], pressures[i+9]],
                [lons[i+11], lats[i+11], winds[i+11], pressures[i+11]],
                [lons[i+17], lats[i+17], winds[i+17], pressures[i+17]],
            ]
            idx += 1
    
    # 构建DataFrame
    col_names = []
    for t in range(TIMESTEPS):
        for f in feat_cols:
            col_names.append(f"hist_{f}{t}")
    col_names += ["last_lon","last_lat","last_wind_ms","last_pressure","last_vws","last_sst"]
    col_names += ["t6_lon","t6_lat","t6_wind","t6_press","t12_lon","t12_lat","t12_wind","t12_press"]
    col_names += ["t24_lon","t24_lat","t24_wind","t24_pressure","t36_lon","t36_lat","t36_wind","t36_pressure"]
    col_names += ["t72_lon","t72_lat","t72_wind","t72_pressure"]
    
    data = np.column_stack([
        hist_arr.reshape(total_samples, -1),
        last_pos,
        last_vws.reshape(-1, 1),
        last_sst.reshape(-1, 1),
        t_arr.reshape(total_samples, -1),
    ])
    
    sample_df = pd.DataFrame(data, columns=col_names)
    # 确保列类型正确
    for c in col_names:
        sample_df[c] = sample_df[c].astype(np.float32)
    
    print(f"原始样本: {len(sample_df)}")
    sys.stdout.flush()

    # ========== 数据过滤 ==========
    sample_df = filter_physical_samples(sample_df)

    # ========== 标准化 ==========
    sx = StandardScaler(); sy = StandardScaler()
    single_step_cols = [f"hist_{f}0" for f in FEATURE_COLS]
    sx.fit(sample_df[single_step_cols].values)
    all_incs = []
    for _, r in sample_df.iterrows():
        inc6 = np.array([r["t6_lon"]-r["last_lon"],r["t6_lat"]-r["last_lat"],r["t6_wind"]-r["last_wind_ms"],r["t6_press"]-r["last_pressure"]])
        all_incs.append(inc6)
    sy.fit(np.array(all_incs))

    # ========== 计算分层权重 ==========
    print("\n计算分层样本权重...")
    sample_weights = compute_sample_weights(sample_df, df)
    print(f"  权重范围: {sample_weights.min():.2f} ~ {sample_weights.max():.2f}")
    print(f"  权重均值: {sample_weights.mean():.2f}")

    split = int(0.85 * len(sample_df))
    df_train = sample_df.iloc[:split].copy()
    df_test = sample_df.iloc[split:].copy()
    train_weights = sample_weights[:split]
    gen_test = MultiHeadGenOpt(df_test, sx, sy, BATCH_SIZE, smooth=True)
    print(f"训练: {len(df_train)} 测试: {len(df_test)}")

    seeds = [42, 123, 777]
    models = []
    os.makedirs(MODEL_DIR, exist_ok=True)

    for idx, seed in enumerate(seeds):
        print(f"\n{'='*40}")
        print(f"训练模型 {idx+1}/3 (seed={seed})")
        print(f"{'='*40}")
        tf.keras.backend.clear_session()
        model = build_gru_model(seed=seed)
        gen_train = MultiHeadGenOpt(df_train, sx, sy, BATCH_SIZE,
                                     sample_weights=train_weights,
                                     augment=True, smooth=True)
        cb_early = EarlyStopping(monitor="val_loss", patience=PATIENCE, restore_best_weights=True, verbose=1)
        cb_lr = ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=15, min_lr=1e-7, verbose=1)
        cb_csv = CSVLogger(f"{MODEL_DIR}/training_log_seed{seed}.csv", append=True)
        model.fit(gen_train, validation_data=gen_test, epochs=EPOCH_MAX,
                  callbacks=[cb_early, cb_lr, cb_csv], verbose=1)
        model_path = f"{MODEL_DIR}/model_{idx+1}_seed{seed}.h5"
        model.save(model_path)
        models.append(model)
        print(f"模型 {idx+1} 已保存: {model_path}")

    joblib.dump({"scaler_x": sx, "scaler_y": sy}, SCALER_SAVE)
    print(f"\nScaler已保存: {SCALER_SAVE}")

    print("\n" + "="*60)
    print("评估单个模型性能...")
    print("="*60)
    for i, m in enumerate(models):
        print(f"\n模型 {i+1}:")
        evaluate_ensemble([m], sx, sy, df_test, n=300, smooth=True)

    print("\n" + "="*60)
    print("集成模型 (3模型平均, 物理约束版v7):")
    print("="*60)
    evaluate_ensemble(models, sx, sy, df_test, n=300, smooth=True)
    print("\n训练完成！")