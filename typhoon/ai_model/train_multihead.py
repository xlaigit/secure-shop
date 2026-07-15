#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V4 直接多步预测模型（多头输出，无误差累积）
========================================
核心思想：
  - 共享GRU编码器，5个独立输出头
  - 每个头直接预测该时段的累积增量（不依赖前一步预测）
  - 完全消除滚动误差累积

输出：
  - 6h: 头1 → [dlon, dlat, dwind, dpressure]（累积增量）
  - 12h: 头2 → 同上
  - 24h: 头3 → 同上
  - 36h: 头4 → 同上
  - 72h: 头5 → 同上

损失权重：
  - 6h: 0.45, 12h: 0.10, 24h: 0.05, 36h: 0.20, 72h: 0.20

预计时间（CPU）：
  - 每个epoch ~20秒
  - 100 epoch × 20s ≈ 33分钟
"""

import os, sys, math, warnings
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
import joblib
import tensorflow as tf
from tensorflow.keras.layers import Input, GRU, Dense, BatchNormalization, Dropout, Layer, Concatenate
from tensorflow.keras.models import Model
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau
from tensorflow.keras.utils import Sequence
from sklearn.preprocessing import StandardScaler

# ===================== 配置 =====================
CSV_PATH = "typhoon_train_with_subhigh.csv"
MODEL_SAVE = r"D:/AI_Model/july_track_model_v5_72h.h5"
SCALER_SAVE = r"D:/AI_Model/track_scaler_v5_72h.pkl"
TIMESTEPS = 6
FEAT_DIM = 9
BATCH_SIZE = 256
EPOCH_MAX = 300
PATIENCE = 45
L2_COEFF = 5e-5
DROPOUT_RATE = 0.35
NOISE_STD = 0.05  # 输入高斯噪声标准差（数据增强）

# 损失权重（72h权重大幅提升以优先优化长时精度）
W6H  = 0.35
W12H = 0.06
W24H = 0.04
W36H = 0.20
W72H = 0.35

FEATURE_COLS = [
    "lon", "lat", "wind_ms", "pressure",
    "hgt500", "u500", "v500", "ridge_lat", "west_extent_588"
]

# ===================== 多头注意力（复用） =====================
class MultiHeadAttn(Layer):
    def __init__(self, head=4, units=48, **kwargs):
        super().__init__(**kwargs)
        self.head = head; self.units = units
    def build(self, input_shape):
        self.wq = Dense(self.units * self.head); self.wk = Dense(self.units * self.head)
        self.wv = Dense(self.units * self.head); self.out = Dense(self.units)
    def call(self, x):
        b, t = tf.shape(x)[0], tf.shape(x)[1]
        q = tf.reshape(self.wq(x), (b, t, self.head, self.units))
        k = tf.reshape(self.wk(x), (b, t, self.head, self.units))
        v = tf.reshape(self.wv(x), (b, t, self.head, self.units))
        q = tf.transpose(q, [0, 2, 1, 3]); k = tf.transpose(k, [0, 2, 1, 3]); v = tf.transpose(v, [0, 2, 1, 3])
        attn_score = tf.nn.softmax(tf.matmul(q, tf.transpose(k, [0, 1, 3, 2])) / math.sqrt(self.units))
        attn_out = tf.matmul(attn_score, v)
        attn_out = tf.transpose(attn_out, [0, 2, 1, 3])
        attn_out = tf.reshape(attn_out, (b, t, self.head * self.units))
        return self.out(attn_out)
    def get_config(self):
        return {"head": self.head, "units": self.units}

# ===================== 多时段加权损失 =====================
class MultiHeadLoss(tf.keras.losses.Loss):
    def __init__(self, w6=W6H, w12=W12H, w24=W24H, w36=W36H, w72=W72H, **kwargs):
        super().__init__(**kwargs)
        self.w6=w6; self.w12=w12; self.w24=w24; self.w36=w36; self.w72=w72

    def call(self, y_true, y_pred):
        # y_true: [batch, 20] = 5个时段的累积增量真值（标准化后）
        # y_pred: [batch, 20] = 5个时段的预测值
        gt6 = y_true[:, 0:4]; gt12 = y_true[:, 4:8]; gt24 = y_true[:, 8:12]; gt36 = y_true[:, 12:16]; gt72 = y_true[:, 16:20]
        pr6 = y_pred[:, 0:4]; pr12 = y_pred[:, 4:8]; pr24 = y_pred[:, 8:12]; pr36 = y_pred[:, 12:16]; pr72 = y_pred[:, 16:20]
        l6  = tf.reduce_mean(tf.square(pr6 - gt6))
        l12 = tf.reduce_mean(tf.square(pr12 - gt12))
        l24 = tf.reduce_mean(tf.square(pr24 - gt24))
        l36 = tf.reduce_mean(tf.square(pr36 - gt36))
        l72 = tf.reduce_mean(tf.square(pr72 - gt72))
        return self.w6*l6 + self.w12*l12 + self.w24*l24 + self.w36*l36 + self.w72*l72

    def get_config(self):
        return {"w6":self.w6,"w12":self.w12,"w24":self.w24,"w36":self.w36,"w72":self.w72}

# ===================== 数据生成器（直接多步） =====================
class MultiHeadGen(Sequence):
    def __init__(self, df, scaler_x, scaler_y, bs, add_noise=False):
        self.df = df.reset_index(drop=True)
        self.sx = scaler_x; self.sy = scaler_y
        self.bs = bs; self.idx = list(range(len(self.df)))
        self.add_noise = add_noise

    def __len__(self):
        return int(np.ceil(len(self.idx) / self.bs))

    def __getitem__(self, i):
        slc = self.idx[i*self.bs:(i+1)*self.bs]
        batch = self.df.iloc[slc]
        X, Y = [], []
        last_idx = TIMESTEPS - 1
        for _, r in batch.iterrows():
            seq_raw = np.array([r[f"hist_{f}{t}"] for t in range(TIMESTEPS) for f in FEATURE_COLS]).reshape(TIMESTEPS, FEAT_DIM)
            seq_sc = self.sx.transform(seq_raw.reshape(-1, FEAT_DIM)).reshape(TIMESTEPS, FEAT_DIM)
            # 数据增强：训练时加高斯噪声
            if self.add_noise:
                seq_sc += np.random.normal(0, NOISE_STD, seq_sc.shape)
            X.append(seq_sc)
            # 累积增量真值（从当前时刻到各时段）
            inc6  = np.array([r["t6_lon"]-r["hist_lon3"], r["t6_lat"]-r["hist_lat3"], r["t6_wind"]-r["hist_wind_ms3"], r["t6_press"]-r["hist_pressure3"]])
            inc12 = np.array([r["t12_lon"]-r["hist_lon3"], r["t12_lat"]-r["hist_lat3"], r["t12_wind"]-r["hist_wind_ms3"], r["t12_press"]-r["hist_pressure3"]])
            inc24 = np.array([r["t24_lon"]-r["hist_lon3"], r["t24_lat"]-r["hist_lat3"], r["t24_wind"]-r["hist_wind_ms3"], r["t24_pressure"]-r["hist_pressure3"]])
            inc36 = np.array([r["t36_lon"]-r["hist_lon3"], r["t36_lat"]-r["hist_lat3"], r["t36_wind"]-r["hist_wind_ms3"], r["t36_pressure"]-r["hist_pressure3"]])
            inc72 = np.array([r["t72_lon"]-r["hist_lon3"], r["t72_lat"]-r["hist_lat3"], r["t72_wind"]-r["hist_wind_ms3"], r["t72_pressure"]-r["hist_pressure3"]])
            all_inc = np.stack([inc6, inc12, inc24, inc36, inc72])  # [5, 4]
            flat_scaled = self.sy.transform(all_inc.reshape(-1, 4)).flatten()  # 20维
            Y.append(flat_scaled)
        return np.array(X), np.array(Y)

# ===================== 构建模型（多头直接输出） =====================
def build_multihead_model():
    inp = Input(shape=(TIMESTEPS, FEAT_DIM))
    # 共享编码器（增强容量）
    g1 = GRU(512, return_sequences=True, kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(inp)
    b1 = BatchNormalization()(g1)
    d1 = Dropout(DROPOUT_RATE)(b1)
    attn = MultiHeadAttn(head=4, units=80)(d1)
    g2 = GRU(256, return_sequences=True, kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(attn)
    b2 = BatchNormalization()(g2)
    d2 = Dropout(DROPOUT_RATE)(b2)
    g3 = GRU(128, return_sequences=False, kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(d2)
    b3 = BatchNormalization()(g3)
    d3 = Dropout(DROPOUT_RATE)(b3)

    # 共享特征层（增强）
    shared = Dense(384, activation="relu", kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(d3)
    shared = Dropout(0.25)(shared)

    # 5个独立输出头，每个输出4维 [dlon, dlat, dwind, dpressure]
    h6  = Dense(128, activation="relu", kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(shared)
    h12 = Dense(128, activation="relu", kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(shared)
    h24 = Dense(128, activation="relu", kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(shared)
    h36 = Dense(128, activation="relu", kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(shared)
    h72 = Dense(192, activation="relu", kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(shared)
    h72 = Dropout(0.15)(h72)
    h72 = Dense(128, activation="relu", kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(h72)

    o6  = Dense(4, name="out_6h")(h6)
    o12 = Dense(4, name="out_12h")(h12)
    o24 = Dense(4, name="out_24h")(h24)
    o36 = Dense(4, name="out_36h")(h36)
    o72 = Dense(4, name="out_72h")(h72)

    # 拼接成 [batch, 20]
    out = Concatenate()([o6, o12, o24, o36, o72])
    model = Model(inp, out, name="multihead_direct")

    # 使用Adam（带梯度裁剪，学习率稍低更稳定）
    opt = Adam(learning_rate=3e-4, clipnorm=1.0)
    model.compile(optimizer=opt, loss=MultiHeadLoss(), metrics=["mae"])
    return model

# ===================== 评估72h精度 =====================
def evaluate_model(model, scaler_x, scaler_y, test_df, n=300):
    """评估直接多步预测的精度"""
    errs = {6:[], 12:[], 24:[], 36:[], 72:[]}
    test_subset = test_df.sample(min(n, len(test_df)))
    for _, r in test_subset.iterrows():
        seq_raw = np.array([r[f"hist_{f}{t}"] for t in range(TIMESTEPS) for f in FEATURE_COLS]).reshape(1, TIMESTEPS, FEAT_DIM)
        seq_sc = scaler_x.transform(seq_raw.reshape(-1, FEAT_DIM)).reshape(1, TIMESTEPS, FEAT_DIM)
        pred = model.predict(seq_sc, verbose=0)
        pred_raw = scaler_y.inverse_transform(pred.reshape(-1, 4))  # [5, 4]
        # 各时段累积增量
        true_pos = {
            6:  (r["t6_lon"], r["t6_lat"]),
            12: (r["t12_lon"], r["t12_lat"]),
            24: (r["t24_lon"], r["t24_lat"]),
            36: (r["t36_lon"], r["t36_lat"]),
            72: (r["t72_lon"], r["t72_lat"]),
        }
        init_lon, init_lat = r["hist_lon3"], r["hist_lat3"]
        for idx, t in enumerate([6, 12, 24, 36, 72]):
            pred_lon = init_lon + pred_raw[idx, 0]
            pred_lat = init_lat + pred_raw[idx, 1]
            true_lon, true_lat = true_pos[t]
            err = math.sqrt((pred_lon - true_lon)**2 + (pred_lat - true_lat)**2) * 111
            errs[t].append(err)

    print("\n========== 直接多步预测精度 ==========")
    for t in [6, 12, 24, 36, 72]:
        if len(errs[t]) > 0:
            p95 = np.percentile(errs[t], 95)
            print(f"{t}h: 平均={np.mean(errs[t]):.1f}km, 最差={np.max(errs[t]):.1f}km, P95={p95:.1f}km, 样本={len(errs[t])}")
    print("======================================")
    return errs

# ===================== 主流程 =====================
if __name__ == "__main__":
    print("=" * 60)
    print("[V4 直接多步预测] 多头输出，无误差累积")
    print("=" * 60)

    # 1. 加载数据
    print("\n加载数据...")
    df = pd.read_csv(CSV_PATH)
    samples = []
    for sid, g in df.groupby("storm_id"):
        g = g.sort_values("step").reset_index(drop=True)
        n = len(g)
        if n < TIMESTEPS + 12: continue
        for i in range(n - TIMESTEPS - 11):
            hist = g.iloc[i:i+TIMESTEPS]; curr = g.iloc[i+TIMESTEPS-1]
            t6=g.iloc[i+TIMESTEPS]; t12=g.iloc[i+TIMESTEPS+1]; t24=g.iloc[i+TIMESTEPS+3]; t36=g.iloc[i+TIMESTEPS+5]; t72=g.iloc[i+TIMESTEPS+11]
            row = {}
            for t in range(TIMESTEPS):
                for f in FEATURE_COLS: row[f"hist_{f}{t}"] = hist.iloc[t][f]
            last_idx = TIMESTEPS - 1
            row["hist_lon3"] = hist.iloc[-1]["lon"]; row["hist_lat3"] = hist.iloc[-1]["lat"]
            row["hist_wind_ms3"] = hist.iloc[-1]["wind_ms"]; row["hist_pressure3"] = hist.iloc[-1]["pressure"]
            for prefix, src in [("t6",t6),("t12",t12)]:
                row[f"{prefix}_lon"]=src["lon"]; row[f"{prefix}_lat"]=src["lat"]
                row[f"{prefix}_wind"]=src["wind_ms"]; row[f"{prefix}_press"]=src["pressure"]
            for prefix, src in [("t24",t24),("t36",t36),("t72",t72)]:
                row[f"{prefix}_lon"]=src["lon"]; row[f"{prefix}_lat"]=src["lat"]
                row[f"{prefix}_wind"]=src["wind_ms"]; row[f"{prefix}_pressure"]=src["pressure"]
            samples.append(row)

    sample_df = pd.DataFrame(samples)
    print(f"总样本: {len(sample_df)}")

    # 归一化
    sx = StandardScaler()
    sy = StandardScaler()
    single_step_cols = [f"hist_{f}0" for f in FEATURE_COLS]
    sx.fit(sample_df[single_step_cols].values)
    # 拟合增量（5个时段 × 4维 = 20维，但用4维scaler即可）
    all_incs = []
    for _, r in sample_df.iterrows():
        inc6 = np.array([r["t6_lon"]-r["hist_lon3"], r["t6_lat"]-r["hist_lat3"], r["t6_wind"]-r["hist_wind_ms3"], r["t6_press"]-r["hist_pressure3"]])
        all_incs.append(inc6)
    sy.fit(np.array(all_incs))

    split = int(0.85 * len(sample_df))
    df_train = sample_df.iloc[:split]
    df_test = sample_df.iloc[split:]
    gen_train = MultiHeadGen(df_train, sx, sy, BATCH_SIZE, add_noise=True)
    gen_test = MultiHeadGen(df_test, sx, sy, BATCH_SIZE)
    print(f"训练: {len(df_train)} 测试: {len(df_test)}")

    # 2. 构建模型
    print("\n构建多头直接预测模型...")
    model = build_multihead_model()
    model.summary()

    # 3. 训练
    cb_early = EarlyStopping(monitor="val_loss", patience=PATIENCE, restore_best_weights=True, verbose=1)
    cb_lr = ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=12, min_lr=1e-7, verbose=1)

    print("\n开始训练（无误差累积，直接多步预测！）...")
    history = model.fit(
        gen_train, validation_data=gen_test,
        epochs=EPOCH_MAX, callbacks=[cb_early, cb_lr], verbose=1
    )

    # 4. 保存
    joblib.dump({"scaler_x": sx, "scaler_y": sy}, SCALER_SAVE)
    model.save(MODEL_SAVE)
    print(f"\n模型已保存: {MODEL_SAVE}")

    # 5. 评估
    print("\n评估各时段精度...")
    evaluate_model(model, sx, sy, df_test, n=300)
    print("\n训练完成！")