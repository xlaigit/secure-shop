#!/usr/bin/env python3
"""仅重新训练 Model 3 (seed=777)，使用调整后的物理约束参数。保留 Model 1 和 2 不变。"""
import os, warnings
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
warnings.filterwarnings('ignore')
import numpy as np
import pandas as pd
import joblib
import tensorflow as tf
from tensorflow.keras.layers import Input, Dense, BatchNormalization, Dropout, GRU
from tensorflow.keras.models import Model
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau, CSVLogger
from tensorflow.keras.utils import Sequence
from sklearn.preprocessing import StandardScaler

CSV_PATH = "typhoon_train_realtime_ocean.csv"
MODEL_DIR = r"D:/AI_Model/ensemble_ocean_v7_opt"
TIMESTEPS = 6; FEAT_DIM = 14; BATCH_SIZE = 256; EPOCH_MAX = 300; PATIENCE = 40
L2_COEFF = 3e-5; DROPOUT_RATE = 0.30; NOISE_STD = 0.06
W6H=0.35; W12H=0.05; W24H=0.05; W36H=0.20; W72H=0.35
W_MSE=0.65; W_QUANTILE=0.20; W_PHYSICS=0.15; QUANTILE_TAU=0.95
PHYSICS_VWS_PENALTY=0.02; PHYSICS_SST_PENALTY=0.03; PHYSICS_LAT_PENALTY=0.01
FEATURE_COLS = ["lon","lat","wind_ms","pressure","hgt500","u500","v500","ridge_lat","west_extent_588",
                "sst","ohc","vws","wvapor","elevation"]
OCEAN_FEAT_IDX = [9, 10, 11, 12]

def filter_physical_samples(sample_df):
    initial_count = len(sample_df)
    hist_vws = np.array([sample_df[f"hist_vws{t}"].values for t in range(TIMESTEPS)]).max(axis=0)
    hist_sst = np.array([sample_df[f"hist_sst{t}"].values for t in range(TIMESTEPS)]).max(axis=0)
    hist_wind = np.array([sample_df[f"hist_wind_ms{t}"].values for t in range(TIMESTEPS)]).max(axis=0)
    hist_lat = sample_df["last_lat"].values
    t_winds = np.column_stack([sample_df[f"t{t}_wind"].values for t in [6,12,24,36,72]])
    max_t_wind = t_winds.max(axis=1)
    combined = np.ones(initial_count, dtype=bool)
    for cond in [~((hist_vws>15)&(hist_wind>50)), ~((hist_sst<24)&(hist_wind>40)),
                 ~((hist_lat>35)&(hist_wind>30)), ~((hist_sst<22)&(hist_wind>20)),
                 ~((hist_vws>20)&(hist_wind>25)), ~((hist_vws>15)&(max_t_wind>hist_wind+10))]:
        combined = combined & cond
    filtered = sample_df[combined].copy().reset_index(drop=True)
    print(f"数据过滤: {initial_count} → {len(filtered)}")
    return filtered

def compute_sample_weights(sample_df, df_raw):
    weights = []
    for _, r in sample_df.iterrows():
        w = 1.0
        wind_vals = [r.get(f"hist_wind_ms{t}",0) for t in range(TIMESTEPS)]
        max_w = max(wind_vals)
        if max_w >= 60: w += 3.0
        elif max_w >= 45: w += 1.5
        if r.get("t12_wind",0) - r.get("last_wind_ms",0) > 8: w += 2.0
        hv = max([r.get(f"hist_vws{t}",0) for t in range(TIMESTEPS)])
        if hv > 15: w += 0.5
        weights.append(w)
    weights = np.array(weights)
    wm = weights.mean()
    if wm > 0: weights /= wm
    return np.clip(weights, 0.3, 6.0)

def smooth_ocean_features(seq_2d):
    seq = seq_2d.copy()
    for idx in OCEAN_FEAT_IDX:
        col = seq[:, idx]; sm = np.copy(col)
        for i in range(3):
            sm[i] = np.mean([col[max(0,i-1)], col[i], col[min(len(col)-1,i+1)]])
        seq[:, idx] = sm
    return seq

class PhysicsHybridLoss(tf.keras.losses.Loss):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.w6=W6H; self.w12=W12H; self.w24=W24H; self.w36=W36H; self.w72=W72H
    def call(self, y_true, y_pred):
        vws=y_true[:,20]; sst=y_true[:,21]; lat=y_true[:,22]; cur_wind=y_true[:,23]
        gt6=y_true[:,0:4]; gt12=y_true[:,4:8]; gt24=y_true[:,8:12]; gt36=y_true[:,12:16]; gt72=y_true[:,16:20]
        pr6=y_pred[:,0:4]; pr12=y_pred[:,4:8]; pr24=y_pred[:,8:12]; pr36=y_pred[:,12:16]; pr72=y_pred[:,16:20]
        err6=pr6-gt6; err12=pr12-gt12; err24=pr24-gt24; err36=pr36-gt36; err72=pr72-gt72
        mse = (W6H*tf.reduce_mean(tf.square(err6)) + W12H*tf.reduce_mean(tf.square(err12)) +
               W24H*tf.reduce_mean(tf.square(err24)) + W36H*tf.reduce_mean(tf.square(err36)) +
               W72H*tf.reduce_mean(tf.square(err72)))
        err72n = tf.sqrt(tf.reduce_sum(tf.square(err72), axis=1))
        q = tf.constant(QUANTILE_TAU, dtype=tf.float32)
        quantile = tf.reduce_mean(tf.maximum(q*err72n, (q-1)*err72n))
        dw = tf.stack([pr6[:,2],pr12[:,2],pr24[:,2],pr36[:,2],pr72[:,2]], axis=1)
        pw = cur_wind[:,tf.newaxis] + dw
        hw = tf.constant([W6H,W12H,W24H,W36H,W72H])
        phys = 0.0
        vws_ex = tf.maximum(vws-12,0); wg = tf.maximum(dw,0)
        phys += tf.reduce_mean(vws_ex[:,tf.newaxis]*wg*hw)*PHYSICS_VWS_PENALTY
        vs = tf.cast(vws>20,tf.float32); sw = tf.maximum(pw-25,0)
        phys += tf.reduce_mean(vs[:,tf.newaxis]*sw*hw)*PHYSICS_VWS_PENALTY*2
        sd = tf.maximum(26-sst,0)
        phys += tf.reduce_mean(sd[:,tf.newaxis]*wg*hw)*PHYSICS_SST_PENALTY
        sc = tf.cast(sst<24,tf.float32); aw = tf.maximum(dw+1,0)
        phys += tf.reduce_mean(sc[:,tf.newaxis]*aw*hw)*PHYSICS_SST_PENALTY*2
        le = tf.maximum(lat-30,0)
        phys += tf.reduce_mean(le[:,tf.newaxis]*wg*hw)*PHYSICS_LAT_PENALTY
        lh = tf.cast(lat>35,tf.float32)
        phys += tf.reduce_mean(lh[:,tf.newaxis]*sw*hw)*PHYSICS_LAT_PENALTY*2
        return W_MSE*mse + W_QUANTILE*quantile + W_PHYSICS*phys

def build_model(seed=777):
    tf.random.set_seed(seed); np.random.seed(seed)
    inp = Input(shape=(TIMESTEPS,FEAT_DIM))
    g1 = GRU(512,return_sequences=True,kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(inp)
    g1 = BatchNormalization()(g1); g1 = Dropout(DROPOUT_RATE)(g1)
    g2 = GRU(256,return_sequences=True,kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(g1)
    g2 = BatchNormalization()(g2); g2 = Dropout(DROPOUT_RATE)(g2)
    g3 = GRU(128,kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(g2)
    g3 = BatchNormalization()(g3); g3 = Dropout(DROPOUT_RATE)(g3)
    d1 = Dense(128,activation='relu',kernel_regularizer=tf.keras.regularizers.L2(L2_COEFF))(g3)
    d1 = BatchNormalization()(d1); d1 = Dropout(DROPOUT_RATE)(d1)
    out = Dense(20,activation='linear')(d1)
    model = Model(inp, out)
    model.compile(optimizer=Adam(learning_rate=3e-4,clipnorm=1.0), loss=PhysicsHybridLoss())
    return model

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
            inc24 = np.array([r["t24_lon"]-llon, r["t24_lat"]-llat, r["t24_wind"]-lwind, r["t24_press"]-lpress])
            inc36 = np.array([r["t36_lon"]-llon, r["t36_lat"]-llat, r["t36_wind"]-lwind, r["t36_press"]-lpress])
            inc72 = np.array([r["t72_lon"]-llon, r["t72_lat"]-llat, r["t72_wind"]-lwind, r["t72_press"]-lpress])
            all_inc = np.stack([inc6, inc12, inc24, inc36, inc72])
            flat_scaled = self.sy.transform(all_inc.reshape(-1, 4)).flatten()
            physics_info = np.array([r["last_vws"], r["last_sst"], r["last_lat"], r["last_wind_ms"]], dtype=np.float64)
            flat_scaled = np.concatenate([flat_scaled, physics_info])
            if self.augment:
                seq_sc += np.random.normal(0, NOISE_STD, seq_sc.shape)
            X.append(seq_sc); Y.append(flat_scaled)
            if self.weights is not None:
                W.append(self.weights[r.name])
        if self.weights is not None:
            return np.array(X), np.array(Y), np.array(W)
        return np.array(X), np.array(Y)

# ====== 主流程 ======
print("="*50)
print("仅训练 Model 3 (seed=777) - 保留 Model 1/2")
print("="*50)

# 检查是否已存在
model3_path = os.path.join(MODEL_DIR, "model_3_seed777.h5")
if os.path.exists(model3_path):
    print(f"Model 3 已存在，将覆盖: {model3_path}")

# 加载数据
print("\n加载数据...")
df = pd.read_csv(CSV_PATH)
print(f"原始数据: {len(df)} 行")

# 预计算滑动窗口样本
feat_cols = FEATURE_COLS; n_feat = len(feat_cols)
storm_groups = []
for sid, g in df.groupby("storm_id"):
    g = g.sort_values("step").reset_index(drop=True)
    if len(g) >= 18: storm_groups.append(g)

total_samples = sum(len(g) - 17 for g in storm_groups)
print(f"预计样本数: {total_samples}")

hist_arr = np.zeros((total_samples, TIMESTEPS, n_feat), dtype=np.float32)
t_arr = np.zeros((total_samples, 5, 4), dtype=np.float32)
last_pos = np.zeros((total_samples, 4), dtype=np.float32)
last_vws = np.zeros(total_samples, dtype=np.float32)
last_sst = np.zeros(total_samples, dtype=np.float32)

idx = 0
for g in storm_groups:
    n = len(g); vals = g[feat_cols].values
    lons=vals[:,0]; lats=vals[:,1]; winds=vals[:,2]; pressures=vals[:,3]
    vws=vals[:,11]; sst=vals[:,9]
    for i in range(n-17):
        hist_arr[idx]=vals[i:i+TIMESTEPS]
        last_pos[idx]=[lons[i+5],lats[i+5],winds[i+5],pressures[i+5]]
        last_vws[idx]=vws[i+5]; last_sst[idx]=sst[i+5]
        t_arr[idx]=[[lons[i+6],lats[i+6],winds[i+6],pressures[i+6]],
                     [lons[i+7],lats[i+7],winds[i+7],pressures[i+7]],
                     [lons[i+9],lats[i+9],winds[i+9],pressures[i+9]],
                     [lons[i+11],lats[i+11],winds[i+11],pressures[i+11]],
                     [lons[i+17],lats[i+17],winds[i+17],pressures[i+17]]]
        idx += 1

col_names = []
for t in range(TIMESTEPS):
    for f in feat_cols: col_names.append(f"hist_{f}{t}")
col_names += ["last_lon","last_lat","last_wind_ms","last_pressure","last_vws","last_sst"]
col_names += ["t6_lon","t6_lat","t6_wind","t6_press","t12_lon","t12_lat","t12_wind","t12_press"]
col_names += ["t24_lon","t24_lat","t24_wind","t24_press","t36_lon","t36_lat","t36_wind","t36_press"]
col_names += ["t72_lon","t72_lat","t72_wind","t72_press"]

data = np.column_stack([hist_arr.reshape(total_samples,-1), last_pos, last_vws.reshape(-1,1), last_sst.reshape(-1,1), t_arr.reshape(total_samples,-1)])
sample_df = pd.DataFrame(data, columns=col_names)
for c in col_names: sample_df[c] = sample_df[c].astype(np.float32)
print(f"原始样本: {len(sample_df)}")

# 过滤
sample_df = filter_physical_samples(sample_df)

# 标准化（与原版保持一致：sx fit 14维单步，sy fit 4维6h增量）
print("标准化...")
sx = StandardScaler(); sy = StandardScaler()
sx.fit(sample_df[[f"hist_{f}0" for f in FEATURE_COLS]].values)
all_incs = []
for _, r in sample_df.iterrows():
    inc6 = np.array([r["t6_lon"]-r["last_lon"],r["t6_lat"]-r["last_lat"],r["t6_wind"]-r["last_wind_ms"],r["t6_press"]-r["last_pressure"]])
    all_incs.append(inc6)
sy.fit(np.array(all_incs))

# 权重
print("计算权重...")
sample_weights = compute_sample_weights(sample_df, df)
print(f"权重范围: {sample_weights.min():.2f} ~ {sample_weights.max():.2f}")

split = int(0.85 * len(sample_df))
df_train = sample_df.iloc[:split].copy(); df_test = sample_df.iloc[split:].copy()
train_weights = sample_weights[:split]
print(f"训练: {len(df_train)} 测试: {len(df_test)}")

# 构建Model 3
print("\n构建 Model 3 (seed=777)...")
model = build_model(seed=777)
model.summary()

gen_train = MultiHeadGenOpt(df_train, sx, sy, BATCH_SIZE, sample_weights=train_weights, augment=True, smooth=True)
gen_test = MultiHeadGenOpt(df_test, sx, sy, BATCH_SIZE, smooth=True)

cb_early = EarlyStopping(monitor="val_loss", patience=PATIENCE, restore_best_weights=True, verbose=1)
cb_lr = ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=15, min_lr=1e-7, verbose=1)
cb_csv = CSVLogger(os.path.join(MODEL_DIR, "training_log_seed777.csv"), append=True)

print("\n开始训练 Model 3...")
history = model.fit(gen_train, validation_data=gen_test, epochs=EPOCH_MAX,
                    callbacks=[cb_early, cb_lr, cb_csv], verbose=1)

model.save(model3_path)
print(f"\n✅ Model 3 已保存: {model3_path}")
print(f"最佳 val_loss: {min(history.history['val_loss']):.4f}")
print("完成!")