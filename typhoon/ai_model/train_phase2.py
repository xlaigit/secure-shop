#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V4 阶段2 - 多步滚动微调（修正版）
================================
核心修复：
  1. 滚动累积在标准化空间进行，loss尺度合理（0.01~1.0）
  2. 低学习率（5e-5）+ 强梯度裁剪（clipnorm=0.5）
  3. 高dropout（0.35）防止过拟合
  4. EarlyStopping patience=5，最多15 epoch

用法：
  python train_phase2.py

预计时间：~15 epoch × 1.5min ≈ 25分钟
"""

import os, sys, math, warnings
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
import joblib
import tensorflow as tf
from tensorflow.keras.layers import Input, GRU, Dense, BatchNormalization, Dropout, Layer
from tensorflow.keras.models import Model, load_model
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau
from tensorflow.keras.utils import Sequence, custom_object_scope

# ===================== 配置 =====================
CSV_PATH = "typhoon_train_with_subhigh.csv"
CKPT_PATH = r"D:/AI_Model/v4_single_step_ckpt.h5"
MODEL_SAVE = r"D:/AI_Model/july_track_model_v5_72h.h5"
SCALER_PATH = r"D:/AI_Model/track_scaler_v5_72h.pkl"
TIMESTEPS = 4
FEAT_DIM = 9
BATCH_SIZE = 256
EPOCH_MAX = 15
PATIENCE = 5
DROPOUT_RATE = 0.35
L2_COEFF = 5e-5
PRED_STEPS = 12
LR = 5e-5

FEATURE_COLS = [
    "lon", "lat", "wind_ms", "pressure",
    "hgt500", "u500", "v500", "ridge_lat", "west_extent_588"
]
TARGET_COLS = ["dlon", "dlat", "dwind", "dpressure"]

# ===================== 自定义层 =====================
class MultiHeadAttn(Layer):
    def __init__(self, head=4, units=48, **kwargs):
        super().__init__(**kwargs)
        self.head = head; self.units = units
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
        q = tf.transpose(q, [0, 2, 1, 3]); k = tf.transpose(k, [0, 2, 1, 3]); v = tf.transpose(v, [0, 2, 1, 3])
        attn_score = tf.nn.softmax(tf.matmul(q, tf.transpose(k, [0, 1, 3, 2])) / math.sqrt(self.units))
        attn_out = tf.matmul(attn_score, v)
        attn_out = tf.transpose(attn_out, [0, 2, 1, 3])
        attn_out = tf.reshape(attn_out, (b, t, self.head * self.units))
        return self.out(attn_out)
    def get_config(self):
        return {"head": self.head, "units": self.units}

class RollLayerStd(Layer):
    """标准化空间滚动递推层 - 输出也是标准化增量"""
    def __init__(self, pred_steps=12, **kwargs):
        super().__init__(**kwargs)
        self.pred_steps = pred_steps
        self.core_model = None

    def set_core_model(self, model):
        self.core_model = model
        self._track_trackable(model, "core_model")

    def call(self, seq_input):
        hist = seq_input
        # 收集各步的标准化增量 [dlon, dlat, dwind, dpressure]
        all_incs = []
        for _ in range(self.pred_steps):
            inc = self.core_model(hist)  # [batch, 4] 标准化增量
            all_incs.append(tf.expand_dims(inc, 1))
            # 更新历史: 在标准化空间累积
            last_frame = hist[:, -1, :]
            new_frame = tf.concat([
                last_frame[:, :4] + inc,  # 标准化增量累积
                last_frame[:, 4:]          # 副高特征不变
            ], axis=-1)
            hist = tf.concat([hist[:, 1:, :], tf.expand_dims(new_frame, axis=1)], axis=1)

        all_incs = tf.concat(all_incs, axis=1)  # [batch, 12, 4]
        # 取 6h(0), 12h(1), 24h(3), 36h(5), 72h(11)
        out_6h  = all_incs[:, 0,  :]  # 第1步增量
        out_12h = all_incs[:, 1,  :]  # 第2步增量
        out_24h = all_incs[:, 3,  :]  # 第4步增量
        out_36h = all_incs[:, 5,  :]  # 第6步增量
        out_72h = all_incs[:, 11, :]  # 第12步增量
        return tf.concat([
            tf.expand_dims(out_6h, 1), tf.expand_dims(out_12h, 1),
            tf.expand_dims(out_24h, 1), tf.expand_dims(out_36h, 1),
            tf.expand_dims(out_72h, 1)
        ], axis=1)  # [batch, 5, 4]

    def compute_output_shape(self, input_shape):
        return (input_shape[0], 5, 4)

    def get_config(self):
        return {"pred_steps": self.pred_steps}

# ===================== 多步损失（标准化空间） =====================
class RollStdLoss(tf.keras.losses.Loss):
    """在标准化空间计算多步增量MSE，避免原始尺度爆炸"""
    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def call(self, y_true, y_pred):
        # y_true: [batch, 20] = 5个时段的标准化增量真值
        # y_pred: [batch, 5, 4] = 预测的标准化增量
        y6_gt  = y_true[:, 0:4]; y12_gt = y_true[:, 4:8]
        y24_gt = y_true[:, 8:12]; y36_gt = y_true[:, 12:16]; y72_gt = y_true[:, 16:20]
        y6_pred  = y_pred[:, 0, :]; y12_pred = y_pred[:, 1, :]
        y24_pred = y_pred[:, 2, :]; y36_pred = y_pred[:, 3, :]; y72_pred = y_pred[:, 4, :]
        # 简单加权
        loss6  = tf.reduce_mean(tf.square(y6_pred - y6_gt))
        loss12 = tf.reduce_mean(tf.square(y12_pred - y12_gt))
        loss24 = tf.reduce_mean(tf.square(y24_pred - y24_gt))
        loss36 = tf.reduce_mean(tf.square(y36_pred - y36_gt))
        loss72 = tf.reduce_mean(tf.square(y72_pred - y72_gt))
        return 0.40*loss6 + 0.25*loss12 + 0.15*loss24 + 0.12*loss36 + 0.08*loss72

    def get_config(self):
        return {}

# ===================== 多步数据生成器（标准化增量） =====================
class RollStdGen(Sequence):
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
            # 各时段的增量真值（标准化后）
            # 6h增量 = t6 - curr
            inc6 = np.array([r["t6_lon"] - r["hist_lon3"], r["t6_lat"] - r["hist_lat3"],
                             r["t6_wind"] - r["hist_wind_ms3"], r["t6_press"] - r["hist_pressure3"]])
            inc12 = np.array([r["t12_lon"] - r["hist_lon3"], r["t12_lat"] - r["hist_lat3"],
                              r["t12_wind"] - r["hist_wind_ms3"], r["t12_press"] - r["hist_pressure3"]])
            inc24 = np.array([r["t24_lon"] - r["hist_lon3"], r["t24_lat"] - r["hist_lat3"],
                              r["t24_wind"] - r["hist_wind_ms3"], r["t24_pressure"] - r["hist_pressure3"]])
            inc36 = np.array([r["t36_lon"] - r["hist_lon3"], r["t36_lat"] - r["hist_lat3"],
                              r["t36_wind"] - r["hist_wind_ms3"], r["t36_pressure"] - r["hist_pressure3"]])
            inc72 = np.array([r["t72_lon"] - r["hist_lon3"], r["t72_lat"] - r["hist_lat3"],
                              r["t72_wind"] - r["hist_wind_ms3"], r["t72_pressure"] - r["hist_pressure3"]])
            # 标准化所有增量
            all_inc = np.stack([inc6, inc12, inc24, inc36, inc72])
            # 用sy.transform标准化每个4维向量
            flat = all_inc.reshape(-1, 4)  # [5, 4]
            flat_scaled = self.sy.transform(flat)  # [5, 4]
            Y.append(flat_scaled.flatten())  # 20维
        return np.array(X), np.array(Y)

# ===================== 评估72h精度 =====================
def evaluate_72h(model, scaler_x, scaler_y, test_df, n=300):
    errs = {6:[], 12:[], 24:[], 36:[], 72:[]}
    test_subset = test_df.sample(min(n, len(test_df)))
    for _, r in test_subset.iterrows():
        seq_raw = np.array([r[f"hist_{f}{t}"] for t in range(TIMESTEPS) for f in FEATURE_COLS]).reshape(1, TIMESTEPS, FEAT_DIM)
        seq_sc = scaler_x.transform(seq_raw.reshape(-1, FEAT_DIM)).reshape(1, TIMESTEPS, FEAT_DIM)
        seq = seq_sc.copy()
        for step in range(PRED_STEPS):
            inc = model.predict(seq, verbose=0)
            inc_raw = scaler_y.inverse_transform(inc)[0]
            last = seq[0, -1, :]
            new_vals = np.array([last[0] + inc_raw[0], last[1] + inc_raw[1], last[2] + inc_raw[2], last[3] + inc_raw[3]])
            new_frame = np.concatenate([new_vals, last[4:]])
            seq = np.concatenate([seq[:, 1:, :], new_frame.reshape(1, 1, -1)], axis=1)
            if step == 0:
                dlon_gt = r["t6_lon"] - r["hist_lon3"]; dlat_gt = r["t6_lat"] - r["hist_lat3"]
                errs[6].append(math.sqrt((inc_raw[0]-dlon_gt)**2 + (inc_raw[1]-dlat_gt)**2)*111)
            elif step == 1:
                errs[12].append(math.sqrt(inc_raw[0]**2 + inc_raw[1]**2)*111)
            elif step == 3:
                errs[24].append(math.sqrt(inc_raw[0]**2 + inc_raw[1]**2)*111)
            elif step == 5:
                errs[36].append(math.sqrt(inc_raw[0]**2 + inc_raw[1]**2)*111)
            elif step == 11:
                errs[72].append(math.sqrt(inc_raw[0]**2 + inc_raw[1]**2)*111)
    print("\n========== 72h滚动精度评估 ==========")
    for t in [6, 12, 24, 36, 72]:
        if len(errs[t]) > 0:
            print(f"{t}h: 平均={np.mean(errs[t]):.1f}km, 最差={np.max(errs[t]):.1f}km, 样本={len(errs[t])}")
    print("=====================================")
    return errs

# ===================== 主流程 =====================
if __name__ == "__main__":
    print("=" * 60)
    print("[V4 阶段2] 多步滚动微调（修正版 - 标准化空间）")
    print("=" * 60)

    # 1. 加载数据
    print("\n加载数据...")
    df = pd.read_csv(CSV_PATH)
    scaler_data = joblib.load(SCALER_PATH)
    sx, sy = scaler_data["scaler_x"], scaler_data["scaler_y"]

    # 构建多步样本
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
                r_t = hist.iloc[t]
                for f in FEATURE_COLS: row[f"hist_{f}{t}"] = r_t[f]
            for prefix, src in [("t6",t6),("t12",t12)]:
                row[f"{prefix}_lon"]=src["lon"]; row[f"{prefix}_lat"]=src["lat"]; row[f"{prefix}_wind"]=src["wind_ms"]; row[f"{prefix}_press"]=src["pressure"]
            for prefix, src in [("t24",t24),("t36",t36),("t72",t72)]:
                row[f"{prefix}_lon"]=src["lon"]; row[f"{prefix}_lat"]=src["lat"]; row[f"{prefix}_wind"]=src["wind_ms"]; row[f"{prefix}_pressure"]=src["pressure"]
            for c in TARGET_COLS: row[c] = curr[c]
            samples.append(row)

    sample_df = pd.DataFrame(samples)
    print(f"多步可用样本: {len(sample_df)}")
    split = int(0.85 * len(sample_df))
    df_train = sample_df.iloc[:split]
    df_test = sample_df.iloc[split:]
    gen_train = RollStdGen(df_train, sx, sy, BATCH_SIZE)
    gen_test = RollStdGen(df_test, sx, sy, BATCH_SIZE)
    print(f"训练: {len(df_train)} 测试: {len(df_test)}")

    # 2. 加载单步checkpoint
    print("\n加载单步checkpoint...")
    with custom_object_scope({"MultiHeadAttn": MultiHeadAttn}):
        core_model = load_model(CKPT_PATH, compile=False)
    print(f"核心模型加载成功, 参数量: {core_model.count_params()}")

    # 3. 构建多步滚动模型（标准化空间）
    print("\n构建多步滚动模型...")
    inp = Input(shape=(TIMESTEPS, FEAT_DIM))
    roll_layer = RollLayerStd(pred_steps=PRED_STEPS, name="roll_std")
    roll_layer.set_core_model(core_model)
    pred_multi = roll_layer(inp)
    roll_model = Model(inputs=inp, outputs=pred_multi, name="roll_std_model")
    roll_model.compile(
        optimizer=Adam(learning_rate=LR, clipnorm=0.5),
        loss=RollStdLoss()
    )
    roll_model.summary()

    # 4. 训练
    print("\n开始多步滚动微调（低学习率5e-5，强正则化）...")
    cb_early = EarlyStopping(monitor="val_loss", patience=PATIENCE, restore_best_weights=True, verbose=1)
    cb_lr = ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=3, min_lr=1e-6, verbose=1)

    history = roll_model.fit(
        gen_train, validation_data=gen_test,
        epochs=EPOCH_MAX, callbacks=[cb_early, cb_lr], verbose=1
    )

    # 5. 保存
    core_model.save(MODEL_SAVE)
    print(f"\n模型已保存: {MODEL_SAVE}")

    # 6. 评估
    print("\n评估72h精度...")
    evaluate_72h(core_model, sx, sy, df_test, n=300)
    print("\nV4阶段2训练完成！")