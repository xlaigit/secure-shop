#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V5 Ensemble Ocean - 海洋特征增强版
===================================
训练3个GRU模型（不同随机种子），取平均预测
特征：原始9维 + SST/OHC/VWS/水汽 = 13维，6时步
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
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau
from tensorflow.keras.utils import Sequence
from sklearn.preprocessing import StandardScaler

# ===================== 配置 =====================
CSV_PATH = "typhoon_train_realtime_ocean.csv"
MODEL_DIR = r"D:/AI_Model/ensemble_ocean_v2"
SCALER_SAVE = r"D:/AI_Model/track_scaler_ocean_v2.pkl"
TIMESTEPS = 6
FEAT_DIM = 13
BATCH_SIZE = 256
EPOCH_MAX = 300
PATIENCE = 40
L2_COEFF = 3e-5
DROPOUT_RATE = 0.30
NOISE_STD = 0.06

W6H = 0.35; W12H = 0.05; W24H = 0.05; W36H = 0.20; W72H = 0.35

FEATURE_COLS = [
    "lon", "lat", "wind_ms", "pressure",
    "hgt500", "u500", "v500", "ridge_lat", "west_extent_588",
    "sst", "ohc", "vws", "wvapor"
]

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

class MultiHeadLoss(tf.keras.losses.Loss):
    def __init__(self, w6=W6H, w12=W12H, w24=W24H, w36=W36H, w72=W72H, **kwargs):
        super().__init__(**kwargs)
        self.w6=w6; self.w12=w12; self.w24=w24; self.w36=w36; self.w72=w72
    def call(self, y_true, y_pred):
        gt6=y_true[:,0:4]; gt12=y_true[:,4:8]; gt24=y_true[:,8:12]; gt36=y_true[:,12:16]; gt72=y_true[:,16:20]
        pr6=y_pred[:,0:4]; pr12=y_pred[:,4:8]; pr24=y_pred[:,8:12]; pr36=y_pred[:,12:16]; pr72=y_pred[:,16:20]
        l6=tf.reduce_mean(tf.square(pr6-gt6)); l12=tf.reduce_mean(tf.square(pr12-gt12))
        l24=tf.reduce_mean(tf.square(pr24-gt24)); l36=tf.reduce_mean(tf.square(pr36-gt36)); l72=tf.reduce_mean(tf.square(pr72-gt72))
        return self.w6*l6+self.w12*l12+self.w24*l24+self.w36*l36+self.w72*l72
    def get_config(self):
        return {"w6":self.w6,"w12":self.w12,"w24":self.w24,"w36":self.w36,"w72":self.w72}

# ===================== 构建GRU模型（13维输入） =====================
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
    model.compile(optimizer=Adam(learning_rate=3e-4, clipnorm=1.0), loss=MultiHeadLoss(), metrics=["mae"])
    return model

# ===================== 数据生成器（13维） =====================
class MultiHeadGen(Sequence):
    def __init__(self, df, scaler_x, scaler_y, bs, augment=False):
        self.df = df.reset_index(drop=True)
        self.sx = scaler_x; self.sy = scaler_y
        self.bs = bs; self.idx = list(range(len(self.df)))
        self.augment = augment

    def __len__(self):
        return int(np.ceil(len(self.idx) / self.bs))

    def __getitem__(self, i):
        slc = self.idx[i*self.bs:(i+1)*self.bs]
        batch = self.df.iloc[slc]
        X, Y = [], []
        for _, r in batch.iterrows():
            seq_raw = np.array([r[f"hist_{f}{t}"] for t in range(TIMESTEPS) for f in FEATURE_COLS]).reshape(TIMESTEPS, FEAT_DIM)
            seq_sc = self.sx.transform(seq_raw.reshape(-1, FEAT_DIM)).reshape(TIMESTEPS, FEAT_DIM)
            inc6=np.array([r["t6_lon"]-r["hist_lon3"],r["t6_lat"]-r["hist_lat3"],r["t6_wind"]-r["hist_wind_ms3"],r["t6_press"]-r["hist_pressure3"]])
            inc12=np.array([r["t12_lon"]-r["hist_lon3"],r["t12_lat"]-r["hist_lat3"],r["t12_wind"]-r["hist_wind_ms3"],r["t12_press"]-r["hist_pressure3"]])
            inc24=np.array([r["t24_lon"]-r["hist_lon3"],r["t24_lat"]-r["hist_lat3"],r["t24_wind"]-r["hist_wind_ms3"],r["t24_pressure"]-r["hist_pressure3"]])
            inc36=np.array([r["t36_lon"]-r["hist_lon3"],r["t36_lat"]-r["hist_lat3"],r["t36_wind"]-r["hist_wind_ms3"],r["t36_pressure"]-r["hist_pressure3"]])
            inc72=np.array([r["t72_lon"]-r["hist_lon3"],r["t72_lat"]-r["hist_lat3"],r["t72_wind"]-r["hist_wind_ms3"],r["t72_pressure"]-r["hist_pressure3"]])
            all_inc = np.stack([inc6, inc12, inc24, inc36, inc72])
            flat_scaled = self.sy.transform(all_inc.reshape(-1, 4)).flatten()
            if self.augment:
                seq_sc += np.random.normal(0, NOISE_STD, seq_sc.shape)
            X.append(seq_sc); Y.append(flat_scaled)
        return np.array(X), np.array(Y)

# ===================== 评估 =====================
def evaluate_ensemble(models, scaler_x, scaler_y, test_df, n=300):
    errs = {6:[], 12:[], 24:[], 36:[], 72:[]}
    test_subset = test_df.sample(min(n, len(test_df)))
    for _, r in test_subset.iterrows():
        seq_raw = np.array([r[f"hist_{f}{t}"] for t in range(TIMESTEPS) for f in FEATURE_COLS]).reshape(1, TIMESTEPS, FEAT_DIM)
        seq_sc = scaler_x.transform(seq_raw.reshape(-1, FEAT_DIM)).reshape(1, TIMESTEPS, FEAT_DIM)
        preds = [m.predict(seq_sc, verbose=0) for m in models]
        pred = np.mean(preds, axis=0)
        pred_raw = scaler_y.inverse_transform(pred.reshape(-1, 4))
        init_lon, init_lat = r["hist_lon3"], r["hist_lat3"]
        true_pos = {6:(r["t6_lon"],r["t6_lat"]),12:(r["t12_lon"],r["t12_lat"]),24:(r["t24_lon"],r["t24_lat"]),36:(r["t36_lon"],r["t36_lat"]),72:(r["t72_lon"],r["t72_lat"])}
        for idx, t in enumerate([6,12,24,36,72]):
            pred_lon = init_lon + pred_raw[idx, 0]; pred_lat = init_lat + pred_raw[idx, 1]
            err = math.sqrt((pred_lon - true_pos[t][0])**2 + (pred_lat - true_pos[t][1])**2) * 111
            errs[t].append(err)
    print("\n========== Ocean Ensemble 集成预测精度 ==========")
    for t in [6,12,24,36,72]:
        if len(errs[t]) > 0:
            p95 = np.percentile(errs[t], 95)
            print(f"{t}h: 平均={np.mean(errs[t]):.1f}km, 最差={np.max(errs[t]):.1f}km, P95={p95:.1f}km, 样本={len(errs[t])}")
    print("================================================")
    return errs

# ===================== 主流程 =====================
if __name__ == "__main__":
    print("=" * 60)
    print("[V5 Ocean Ensemble] 13维特征（含SST/OHC/VWS/水汽）")
    print("=" * 60)

    print("\n加载数据...")
    df = pd.read_csv(CSV_PATH)
    samples = []
    for sid, g in df.groupby("storm_id"):
        g = g.sort_values("step").reset_index(drop=True)
        n = len(g)
        if n < TIMESTEPS + 12: continue
        for i in range(n - TIMESTEPS - 11):
            hist = g.iloc[i:i+TIMESTEPS]
            t6=g.iloc[i+TIMESTEPS]; t12=g.iloc[i+TIMESTEPS+1]; t24=g.iloc[i+TIMESTEPS+3]; t36=g.iloc[i+TIMESTEPS+5]; t72=g.iloc[i+TIMESTEPS+11]
            row = {}
            for t in range(TIMESTEPS):
                for f in FEATURE_COLS: row[f"hist_{f}{t}"] = hist.iloc[t][f]
            row["hist_lon3"]=hist.iloc[-1]["lon"]; row["hist_lat3"]=hist.iloc[-1]["lat"]
            row["hist_wind_ms3"]=hist.iloc[-1]["wind_ms"]; row["hist_pressure3"]=hist.iloc[-1]["pressure"]
            for prefix,src in [("t6",t6),("t12",t12)]:
                row[f"{prefix}_lon"]=src["lon"]; row[f"{prefix}_lat"]=src["lat"]; row[f"{prefix}_wind"]=src["wind_ms"]; row[f"{prefix}_press"]=src["pressure"]
            for prefix,src in [("t24",t24),("t36",t36),("t72",t72)]:
                row[f"{prefix}_lon"]=src["lon"]; row[f"{prefix}_lat"]=src["lat"]; row[f"{prefix}_wind"]=src["wind_ms"]; row[f"{prefix}_pressure"]=src["pressure"]
            samples.append(row)

    sample_df = pd.DataFrame(samples)
    print(f"总样本: {len(sample_df)} (13维特征)")

    sx = StandardScaler(); sy = StandardScaler()
    single_step_cols = [f"hist_{f}0" for f in FEATURE_COLS]
    sx.fit(sample_df[single_step_cols].values)
    all_incs = []
    for _, r in sample_df.iterrows():
        inc6 = np.array([r["t6_lon"]-r["hist_lon3"],r["t6_lat"]-r["hist_lat3"],r["t6_wind"]-r["hist_wind_ms3"],r["t6_press"]-r["hist_pressure3"]])
        all_incs.append(inc6)
    sy.fit(np.array(all_incs))

    split = int(0.85 * len(sample_df))
    df_train = sample_df.iloc[:split]; df_test = sample_df.iloc[split:]
    gen_test = MultiHeadGen(df_test, sx, sy, BATCH_SIZE)
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
        gen_train = MultiHeadGen(df_train, sx, sy, BATCH_SIZE, augment=True)
        cb_early = EarlyStopping(monitor="val_loss", patience=PATIENCE, restore_best_weights=True, verbose=1)
        cb_lr = ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=12, min_lr=1e-7, verbose=1)
        model.fit(gen_train, validation_data=gen_test, epochs=EPOCH_MAX, callbacks=[cb_early, cb_lr], verbose=1)
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
        evaluate_ensemble([m], sx, sy, df_test, n=300)

    print("\n" + "="*60)
    print("集成模型 (3模型平均, 13维海洋特征):")
    print("="*60)
    evaluate_ensemble(models, sx, sy, df_test, n=300)
    print("\n训练完成！")