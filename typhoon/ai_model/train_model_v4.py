#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V4 台风路径72h高精度模型 - 多步滚动微调版
========================================
策略：
  1. 第一阶段：快速单步训练（~20 epoch），让模型学会基本增量预测
  2. 第二阶段：套上12步滚动层，多时段加权损失微调（~30 epoch）
  3. 目标：72h最差误差 ≤ 159km（追平ECMWF水平）

运行方式：
    python train_model_v4.py

预计时间（CPU）：
  - 单步阶段：20 epoch × 20s ≈ 7分钟
  - 多步阶段：30 epoch × 5min ≈ 2.5小时
  - 总计约 3 小时
"""

import os, sys, warnings, math
import numpy as np
import pandas as pd
import joblib
import tensorflow as tf
from tensorflow.keras.layers import Input, GRU, Dense, BatchNormalization, Dropout, Layer
from tensorflow.keras.models import Model, load_model
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau, ModelCheckpoint
from tensorflow.keras.utils import Sequence
warnings.filterwarnings('ignore')

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

# ===================== 全局配置 =====================
CSV_PATH = "typhoon_train_with_subhigh.csv"
MODEL_SAVE = r"D:/AI_Model/july_track_model_v5_72h.h5"
SCALER_SAVE = r"D:/AI_Model/track_scaler_v5_72h.pkl"
CHECKPOINT_PATH = r"D:/AI_Model/v4_single_step_ckpt.h5"

TIMESTEPS = 4
FEAT_DIM = 9
BATCH_SIZE = 256
EPOCH_PHASE1 = 25       # 单步训练
EPOCH_PHASE2 = 40       # 多步滚动微调
PATIENCE_PHASE1 = 8
PATIENCE_PHASE2 = 12
L2_COEFF = 3e-5
DROPOUT_RATE = 0.2
PRED_STEPS = 12

# 多步损失权重：6h权重最大，72h也有权重
W6H  = 0.40
W12H = 0.25
W24H = 0.15
W36H = 0.12
W72H = 0.08

FEATURE_COLS = [
    "lon", "lat", "wind_ms", "pressure",
    "hgt500", "u500", "v500", "ridge_lat", "west_extent_588"
]
TARGET_COLS = ["dlon", "dlat", "dwind", "dpressure"]

# ===================== 多头注意力 =====================
class MultiHeadAttn(Layer):
    def __init__(self, head=4, units=48, **kwargs):
        super().__init__(**kwargs)
        self.head = head
        self.units = units

    def build(self, input_shape):
        self.wq = Dense(self.units * self.head)
        self.wk = Dense(self.units * self.head)
        self.wv = Dense(self.units * self.head)
        self.out = Dense(self.units)

    def call(self, x):
        b, t = tf.shape(x)[0], tf.shape(x)[1]
        q = tf.reshape(self.wq(x), (b, t, self.head, self.units))
        k = tf.reshape(self.wk(x), (b, t, self.head, self.units))
        v = tf.reshape(self.wv(x), (b, t, self.head, self.units))
        q = tf.transpose(q, [0, 2, 1, 3])
        k = tf.transpose(k, [0, 2, 1, 3])
        v = tf.transpose(v, [0, 2, 1, 3])
        attn_score = tf.nn.softmax(tf.matmul(q, tf.transpose(k, [0, 1, 3, 2])) / math.sqrt(self.units))
        attn_out = tf.matmul(attn_score, v)
        attn_out = tf.transpose(attn_out, [0, 2, 1, 3])
        attn_out = tf.reshape(attn_out, (b, t, self.head * self.units))
        return self.out(attn_out)

    def compute_output_shape(self, input_shape):
        return (input_shape[0], input_shape[1], self.units)

    def get_config(self):
        cfg = super().get_config()
        cfg.update({"head": self.head, "units": self.units})
        return cfg

# ===================== 多步滚动递推层 =====================
class RollMultiStepLayer(Layer):
    def __init__(self, pred_steps=12, **kwargs):
        super().__init__(**kwargs)
        self.pred_steps = pred_steps
        self.core_model = None

    def set_core_model(self, model):
        self.core_model = model
        self._track_trackable(model, "core_model")

    def call(self, seq_input):
        hist = seq_input
        pred_record = []
        pred_record.append(hist[:, -1, :4])
        for _ in range(self.pred_steps):
            inc_main = self.core_model(hist)
            last_frame = hist[:, -1, :]
            new_lon = last_frame[:, 0] + inc_main[:, 0]
            new_lat = last_frame[:, 1] + inc_main[:, 1]
            new_wind = last_frame[:, 2] + inc_main[:, 2]
            new_press = last_frame[:, 3] + inc_main[:, 3]
            new_rest = last_frame[:, 4:]
            new_frame = tf.concat([
                tf.expand_dims(new_lon, -1), tf.expand_dims(new_lat, -1),
                tf.expand_dims(new_wind, -1), tf.expand_dims(new_press, -1), new_rest
            ], axis=-1)
            hist = tf.concat([hist[:, 1:, :], tf.expand_dims(new_frame, axis=1)], axis=1)
            pred_record.append(tf.stack([new_lon, new_lat, new_wind, new_press], axis=-1))
        out_6h  = pred_record[1]
        out_12h = pred_record[2]
        out_24h = pred_record[4]
        out_36h = pred_record[6]
        out_72h = pred_record[12]
        all_out = tf.concat([
            tf.expand_dims(out_6h, 1), tf.expand_dims(out_12h, 1),
            tf.expand_dims(out_24h, 1), tf.expand_dims(out_36h, 1),
            tf.expand_dims(out_72h, 1)
        ], axis=1)
        return all_out

    def compute_output_shape(self, input_shape):
        return (input_shape[0], 5, 4)

    def get_config(self):
        cfg = super().get_config()
        cfg.update({"pred_steps": self.pred_steps})
        return cfg

# ===================== 多时段加权损失 =====================
class MultiTimeWeightLoss(tf.keras.losses.Loss):
    def __init__(self, w6=W6H, w12=W12H, w24=W24H, w36=W36H, w72=W72H, **kwargs):
        super().__init__(**kwargs)
        self.w6 = w6; self.w12 = w12; self.w24 = w24; self.w36 = w36; self.w72 = w72

    def call(self, y_true, y_pred_all):
        y6_gt  = y_true[:, 4:8]; y12_gt = y_true[:, 8:12]
        y24_gt = y_true[:, 12:16]; y36_gt = y_true[:, 16:20]; y72_gt = y_true[:, 20:24]
        y6_pred  = y_pred_all[:, 0, :]; y12_pred = y_pred_all[:, 1, :]
        y24_pred = y_pred_all[:, 2, :]; y36_pred = y_pred_all[:, 3, :]; y72_pred = y_pred_all[:, 4, :]
        weight = tf.ones_like(y_true[:, 0])
        weight = tf.where(y_true[:, 0] > 0.8, 2.2, weight)
        weight = tf.where(tf.abs(y_true[:, 2]) > 10, 2.0, weight)
        w_exp = tf.expand_dims(weight, -1)
        loss6  = tf.reduce_mean(tf.square(y6_pred - y6_gt) * w_exp)
        loss12 = tf.reduce_mean(tf.square(y12_pred - y12_gt) * w_exp)
        loss24 = tf.reduce_mean(tf.square(y24_pred - y24_gt) * w_exp)
        loss36 = tf.reduce_mean(tf.square(y36_pred - y36_gt) * w_exp)
        loss72 = tf.reduce_mean(tf.square(y72_pred - y72_gt) * w_exp)
        return self.w6*loss6 + self.w12*loss12 + self.w24*loss24 + self.w36*loss36 + self.w72*loss72

    def get_config(self):
        return {"w6":self.w6,"w12":self.w12,"w24":self.w24,"w36":self.w36,"w72":self.w72}

# ===================== 单步数据生成器 =====================
class SingleStepGen(Sequence):
    def __init__(self, df, scaler_x, scaler_y, bs):
        self.df = df.reset_index(drop=True)
        self.sx = scaler_x; self.sy = scaler_y
        self.bs = bs; self.idx = list(range(len(self.df)))

    def __len__(self):
        return int(np.ceil(len(self.idx) / self.bs))

    def __getitem__(self, i):
        slc = self.idx[i*self.bs:(i+1)*self.bs]
        batch = self.df.iloc[slc]
        X, Y = [], []
        for _, r in batch.iterrows():
            seq_raw = np.array([r[f"hist_{f}{t}"] for t in range(TIMESTEPS) for f in FEATURE_COLS]).reshape(TIMESTEPS, FEAT_DIM)
            X.append(self.sx.transform(seq_raw.reshape(-1, FEAT_DIM)).reshape(TIMESTEPS, FEAT_DIM))
            Y.append(np.array([r[c] for c in TARGET_COLS]))
        return np.array(X), np.array(Y)

# ===================== 多步数据生成器 =====================
class MultiStepGen(Sequence):
    def __init__(self, df, scaler_x, scaler_y, bs):
        self.df = df.reset_index(drop=True)
        self.sx = scaler_x; self.sy = scaler_y
        self.bs = bs; self.idx = list(range(len(self.df)))

    def __len__(self):
        return int(np.ceil(len(self.idx) / self.bs))

    def __getitem__(self, i):
        slc = self.idx[i*self.bs:(i+1)*self.bs]
        batch = self.df.iloc[slc]
        X, Y = [], []
        for _, r in batch.iterrows():
            seq_raw = np.array([r[f"hist_{f}{t}"] for t in range(TIMESTEPS) for f in FEATURE_COLS]).reshape(TIMESTEPS, FEAT_DIM)
            X.append(self.sx.transform(seq_raw.reshape(-1, FEAT_DIM)).reshape(TIMESTEPS, FEAT_DIM))
            y_inc = np.array([r[c] for c in TARGET_COLS])
            y6  = np.array([r["t6_lon"], r["t6_lat"], r["t6_wind"], r["t6_press"]])
            y12 = np.array([r["t12_lon"], r["t12_lat"], r["t12_wind"], r["t12_press"]])
            y24 = np.array([r["t24_lon"], r["t24_lat"], r["t24_wind"], r["t24_pressure"]])
            y36 = np.array([r["t36_lon"], r["t36_lat"], r["t36_wind"], r["t36_pressure"]])
            y72 = np.array([r["t72_lon"], r["t72_lat"], r["t72_wind"], r["t72_pressure"]])
            Y.append(np.concatenate([y_inc, y6, y12, y24, y36, y72]))
        return np.array(X), np.array(Y)

# ===================== 构建核心模型（单步） =====================
def build_core_model():
    inp = Input(shape=(TIMESTEPS, FEAT_DIM))
    g1 = GRU(192, return_sequences=True, kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(inp)
    b1 = BatchNormalization()(g1)
    d1 = Dropout(DROPOUT_RATE)(b1)
    attn = MultiHeadAttn()(d1)
    g2 = GRU(128, return_sequences=True, kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(attn)
    b2 = BatchNormalization()(g2)
    d2 = Dropout(DROPOUT_RATE)(b2)
    g3 = GRU(64, return_sequences=False, kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(d2)
    b3 = BatchNormalization()(g3)
    d3 = Dropout(DROPOUT_RATE)(b3)
    dense = Dense(64, activation="relu")(d3)
    out = Dense(4, name="main_inc")(dense)
    model = Model(inp, out, name="core_step_model")
    return model

# ===================== 构建多步滚动模型 =====================
def build_roll_model(core_model):
    inp = Input(shape=(TIMESTEPS, FEAT_DIM))
    roll_layer = RollMultiStepLayer(pred_steps=PRED_STEPS, name="roll_multi_step")
    roll_layer.set_core_model(core_model)
    pred_multi = roll_layer(inp)
    model = Model(inputs=inp, outputs=pred_multi, name="v5_roll_model")
    model.compile(optimizer=Adam(learning_rate=2e-4, clipnorm=1.0), loss=MultiTimeWeightLoss())
    return model

# ===================== 数据预处理（含多步真值） =====================
def preprocess_data():
    df = pd.read_csv(CSV_PATH)
    samples = []
    for sid, g in df.groupby("storm_id"):
        g = g.sort_values("step").reset_index(drop=True)
        n = len(g)
        # 单步样本
        if n >= TIMESTEPS + 1:
            for i in range(n - TIMESTEPS):
                hist = g.iloc[i:i+TIMESTEPS]
                curr = g.iloc[i+TIMESTEPS-1]
                row = {}
                for t in range(TIMESTEPS):
                    r_t = hist.iloc[t]
                    for f in FEATURE_COLS:
                        row[f"hist_{f}{t}"] = r_t[f]
                for c in TARGET_COLS:
                    row[c] = curr[c]
                row["lat"] = curr["lat"]
                row["ridge_lat"] = curr["ridge_lat"]
                row["dwind"] = curr["dwind"]
                # 多步真值（仅当有足够长度）
                if n >= i + TIMESTEPS + 12:
                    t6  = g.iloc[i+TIMESTEPS]
                    t12 = g.iloc[i+TIMESTEPS+1]
                    t24 = g.iloc[i+TIMESTEPS+3]
                    t36 = g.iloc[i+TIMESTEPS+5]
                    t72 = g.iloc[i+TIMESTEPS+11]
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
                    row["_has_multi"] = True
                else:
                    row["_has_multi"] = False
                samples.append(row)

    sample_df = pd.DataFrame(samples)
    print(f"[V4] 总单步样本: {len(sample_df)}")
    has_multi = sample_df[sample_df["_has_multi"] == True]
    print(f"[V4] 多步样本(72h可用): {len(has_multi)}")

    from sklearn.preprocessing import StandardScaler
    sx = StandardScaler()
    sy = StandardScaler()
    single_step_cols = [f"hist_{f}0" for f in FEATURE_COLS]
    sx.fit(sample_df[single_step_cols].values)
    sy.fit(sample_df[TARGET_COLS].values)

    split = int(0.85 * len(sample_df))
    df_train = sample_df.iloc[:split]
    df_test = sample_df.iloc[split:]

    # 单步生成器
    gen1_train = SingleStepGen(df_train, sx, sy, BATCH_SIZE)
    gen1_test = SingleStepGen(df_test, sx, sy, BATCH_SIZE)

    # 多步生成器（仅含72h可用样本）
    df_train_multi = df_train[df_train["_has_multi"] == True]
    df_test_multi = df_test[df_test["_has_multi"] == True]
    gen2_train = MultiStepGen(df_train_multi, sx, sy, BATCH_SIZE)
    gen2_test = MultiStepGen(df_test_multi, sx, sy, BATCH_SIZE)

    joblib.dump({"scaler_x": sx, "scaler_y": sy}, SCALER_SAVE)
    print(f"[V4] 训练集: {len(df_train)}单步/{len(df_train_multi)}多步  测试集: {len(df_test)}单步/{len(df_test_multi)}多步")
    return gen1_train, gen1_test, gen2_train, gen2_test, sx, sy

# ===================== 评估72h精度 =====================
def evaluate_72h(core_model, scaler_x, scaler_y, test_df, n_samples=200):
    """评估多步滚动72h误差"""
    from sklearn.preprocessing import StandardScaler
    test_subset = test_df[test_df["_has_multi"] == True].sample(min(n_samples, len(test_df[test_df["_has_multi"] == True])))
    err_6h, err_12h, err_24h, err_36h, err_72h = [], [], [], [], []

    for _, r in test_subset.iterrows():
        seq_raw = np.array([r[f"hist_{f}{t}"] for t in range(TIMESTEPS) for f in FEATURE_COLS]).reshape(1, TIMESTEPS, FEAT_DIM)
        seq_sc = scaler_x.transform(seq_raw.reshape(-1, FEAT_DIM)).reshape(1, TIMESTEPS, FEAT_DIM)

        # 多步滚动
        seq = seq_sc.copy()
        for step in range(PRED_STEPS):
            inc = core_model.predict(seq, verbose=0)
            inc_raw = scaler_y.inverse_transform(inc)[0]
            last = seq[0, -1, :]
            new_vals = np.array([last[0] + inc_raw[0], last[1] + inc_raw[1], last[2] + inc_raw[2], last[3] + inc_raw[3]])
            new_frame = np.concatenate([new_vals, last[4:]])
            seq = np.concatenate([seq[:, 1:, :], new_frame.reshape(1, 1, -1)], axis=1)

            if step == 0:
                dlon_pred, dlat_pred = inc_raw[0], inc_raw[1]
                dlon_gt = r["t6_lon"] - r["hist_lon3"]  # 真值增量
                dlat_gt = r["t6_lat"] - r["hist_lat3"]
                err_6h.append(math.sqrt((dlon_pred - dlon_gt)**2 + (dlat_pred - dlat_gt)**2) * 111)
            elif step == 1:
                err_12h.append(math.sqrt((inc_raw[0] - (r["t12_lon"] - r["hist_lon3"]))**2 + (inc_raw[1] - (r["t12_lat"] - r["hist_lat3"]))**2) * 111)
            elif step == 3:
                err_24h.append(math.sqrt((inc_raw[0] - (r["t24_lon"] - r["hist_lon3"]))**2 + (inc_raw[1] - (r["t24_lat"] - r["hist_lat3"]))**2) * 111)
            elif step == 5:
                err_36h.append(math.sqrt((inc_raw[0] - (r["t36_lon"] - r["hist_lon3"]))**2 + (inc_raw[1] - (r["t36_lat"] - r["hist_lat3"]))**2) * 111)
            elif step == 11:
                err_72h.append(math.sqrt((inc_raw[0] - (r["t72_lon"] - r["hist_lon3"]))**2 + (inc_raw[1] - (r["t72_lat"] - r["hist_lat3"]))**2) * 111)

    print(f"\n========== 72h滚动精度评估 ==========")
    print(f"6h 平均误差: {np.mean(err_6h):.1f} km (最差: {np.max(err_6h):.1f} km)")
    print(f"12h平均误差: {np.mean(err_12h):.1f} km (最差: {np.max(err_12h):.1f} km)")
    print(f"24h平均误差: {np.mean(err_24h):.1f} km (最差: {np.max(err_24h):.1f} km)")
    print(f"36h平均误差: {np.mean(err_36h):.1f} km (最差: {np.max(err_36h):.1f} km)")
    print(f"72h平均误差: {np.mean(err_72h):.1f} km (最差: {np.max(err_72h):.1f} km)")
    print(f"=====================================")
    return err_72h

# ===================== 训练入口 =====================
if __name__ == "__main__":
    print("=" * 60)
    print("[V4 两阶段训练] 72h高精度台风预测模型")
    print("=" * 60)

    # 1. 加载数据
    print("\n[阶段0] 加载数据...")
    gen1_train, gen1_test, gen2_train, gen2_test, sx, sy = preprocess_data()

    # ========== 阶段1: 单步训练 ==========
    print("\n" + "=" * 60)
    print("[阶段1] 单步快速训练 (目标: 让模型学会单步增量预测)")
    print("=" * 60)
    core_model = build_core_model()
    core_model.compile(optimizer=Adam(learning_rate=1e-3, clipnorm=1.0), loss="mse", metrics=["mae"])
    core_model.summary()

    cb1_early = EarlyStopping(monitor="val_loss", patience=PATIENCE_PHASE1, restore_best_weights=True, verbose=1)
    cb1_lr = ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=4, min_lr=5e-7, verbose=1)
    cb1_ckpt = ModelCheckpoint(CHECKPOINT_PATH, monitor="val_loss", save_best_only=True, verbose=1)

    core_model.fit(
        gen1_train, validation_data=gen1_test,
        epochs=EPOCH_PHASE1, callbacks=[cb1_early, cb1_lr, cb1_ckpt], verbose=1
    )

    # 加载最佳权重
    if os.path.exists(CHECKPOINT_PATH):
        core_model.load_weights(CHECKPOINT_PATH)
        print("[阶段1] 已加载最佳单步权重")

    # 单步评估
    loss1, mae1 = core_model.evaluate(gen1_test, verbose=0)
    print(f"[阶段1] 单步验证 loss={loss1:.6f}, mae={mae1:.6f}")
    print(f"        估计6h位置误差 ≈ {mae1 * 0.85 * 111:.1f} km")

    # ========== 阶段2: 多步滚动微调 ==========
    print("\n" + "=" * 60)
    print("[阶段2] 多步滚动微调 (目标: 优化72h精度)")
    print("=" * 60)

    # 构建多步模型
    roll_model = build_roll_model(core_model)
    roll_model.summary()

    cb2_early = EarlyStopping(monitor="val_loss", patience=PATIENCE_PHASE2, restore_best_weights=True, verbose=1)
    cb2_lr = ReduceLROnPlateau(monitor="val_loss", factor=0.4, patience=5, min_lr=1e-7, verbose=1)

    roll_model.fit(
        gen2_train, validation_data=gen2_test,
        epochs=EPOCH_PHASE2, callbacks=[cb2_early, cb2_lr], verbose=1
    )

    # 保存推理模型（核心模型）
    core_model.save(MODEL_SAVE)
    print(f"\n[V4] 模型已保存: {MODEL_SAVE}")

    # 评估72h精度
    print("\n[评估] 计算72h滚动精度...")
    df_all = pd.concat([g.df for g in [gen1_train, gen1_test]]).drop_duplicates()
    # 取测试集的多步样本
    samples_df = pd.DataFrame()
    import gc
    err_72h_list = evaluate_72h(core_model, sx, sy, df_all[df_all["_has_multi"] == True].sample(min(500, len(df_all[df_all["_has_multi"] == True]))))

    if len(err_72h_list) > 0:
        avg_72h = np.mean(err_72h_list)
        max_72h = np.max(err_72h_list)
        print(f"\n===== 最终结果 =====")
        print(f"72h平均误差: {avg_72h:.1f} km")
        print(f"72h最差误差: {max_72h:.1f} km")
        if max_72h <= 159:
            print("达成目标: 72h最差误差 ≤ 159km ✅")
        else:
            print(f"72h最差误差 {max_72h:.1f}km > 159km，还需继续训练")
    print("\nV4训练完成！")