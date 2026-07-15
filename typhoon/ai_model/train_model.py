#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
台风路径AI预测模型 - 训练脚本 (增量预测模式)
使用 CMA 最佳路径数据集 (1949-2025) 训练 GRU 神经网络
输入: 4个时间步 × [lon, lat, wind, pressure]
输出: [dlon, dlat, dwind] (经纬度/风速的增量变化)
"""

import os, sys, json, warnings, numpy as np, pandas as pd
from sklearn.preprocessing import MinMaxScaler
import joblib

warnings.filterwarnings('ignore')

# ============ 配置 ============
CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'typhoon_train_dataset.csv')
MODEL_DIR = 'D:/AI_Model'
MODEL_PATH = os.path.join(MODEL_DIR, 'july_track_model.h5')
SCALER_PATH = os.path.join(MODEL_DIR, 'track_scaler.pkl')

TIMESTEPS = 4
FEATURES = 4       # [lon, lat, wind, pressure]
OUTPUT_FEATURES = 3 # [dlon, dlat, dwind]
EPOCHS = 60
BATCH_SIZE = 128
VALIDATION_SPLIT = 0.15
TEST_SPLIT = 0.10


def log(msg):
    ts = __import__('datetime').datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


def load_and_prepare_data():
    """
    加载CSV并构建时序样本
    输出: 预测增量变化 (dlon, dlat, dwind)
    """
    log("加载数据集...")
    df = pd.read_csv(CSV_PATH)
    log(f"原始数据: {len(df)} 行")

    storms = df.groupby('storm_id')
    log(f"风暴总数: {len(storms)}")

    X_samples = []
    y_samples = []
    skipped_short = 0

    for sid, group in storms:
        group = group.sort_values('step')
        # 使用原始特征: [lon, lat, wind_ms, pressure]
        records = group[['lon', 'lat', 'wind_ms', 'pressure']].values.astype(np.float64)

        if len(records) < TIMESTEPS + 1:
            skipped_short += 1
            continue

        for i in range(len(records) - TIMESTEPS):
            x_seq = records[i:i + TIMESTEPS]
            last = records[i + TIMESTEPS - 1]  # 最后一个输入
            next_pt = records[i + TIMESTEPS]    # 目标点
            # 增量: dlon, dlat, dwind
            delta = next_pt[:3] - last[:3]

            # 过滤异常增量（数据质量清洗）
            # 6小时间隔最大合理移动: dlon<3°, dlat<3°, dwind<30m/s
            if abs(delta[0]) > 3 or abs(delta[1]) > 3 or abs(delta[2]) > 30:
                continue

            X_samples.append(x_seq)
            y_samples.append(delta)

    if len(X_samples) < 1000:
        log(f"警告: 过滤后样本太少 ({len(X_samples)})，放宽过滤条件")
        # 重新构建不过滤
        X_samples.clear()
        y_samples.clear()
        for sid, group in storms:
            group = group.sort_values('step')
            records = group[['lon', 'lat', 'wind_ms', 'pressure']].values.astype(np.float64)
            if len(records) < TIMESTEPS + 1:
                continue
            for i in range(len(records) - TIMESTEPS):
                x_seq = records[i:i + TIMESTEPS]
                last = records[i + TIMESTEPS - 1]
                next_pt = records[i + TIMESTEPS]
                delta = next_pt[:3] - last[:3]
                if abs(delta[0]) > 5 or abs(delta[1]) > 5:
                    continue
                X_samples.append(x_seq)
                y_samples.append(delta)

    X = np.array(X_samples, dtype=np.float64)
    y = np.array(y_samples, dtype=np.float64)

    log(f"样本: {len(X)}, X shape: {X.shape}, y shape: {y.shape}")
    log(f"跳过短序列: {skipped_short}")

    # 统计分析增量范围
    dlon_r = [y[:, 0].min(), y[:, 0].max()]
    dlat_r = [y[:, 1].min(), y[:, 1].max()]
    dwind_r = [y[:, 2].min(), y[:, 2].max()]
    log(f"增量范围: dlon=[{dlon_r[0]:.2f}, {dlon_r[1]:.2f}], dlat=[{dlat_r[0]:.2f}, {dlat_r[1]:.2f}], dwind=[{dwind_r[0]:.1f}, {dwind_r[1]:.1f}]")

    # 标准化X (4D输入)
    X_2d = X.reshape(-1, FEATURES)
    scaler_x = MinMaxScaler()
    scaler_x.fit(X_2d)
    X_scaled = scaler_x.transform(X_2d).reshape(X.shape)

    # 标准化y (增量)
    scaler_y = MinMaxScaler()
    scaler_y.fit(y)
    y_scaled = scaler_y.transform(y)

    log(f"X标准化: [{scaler_x.data_min_[0]:.1f}, {scaler_x.data_max_[0]:.1f}]...")
    log(f"y标准化: [{scaler_y.data_min_[0]:.4f}, {scaler_y.data_max_[0]:.4f}]...")

    return X_scaled, y_scaled, scaler_x, scaler_y


def build_model():
    import keras
    from keras.models import Sequential
    from keras.layers import GRU, Dense, Dropout, BatchNormalization
    from keras.regularizers import l2

    model = Sequential([
        GRU(128, input_shape=(TIMESTEPS, FEATURES), return_sequences=True,
            kernel_regularizer=l2(1e-5)),
        BatchNormalization(),
        Dropout(0.25),
        GRU(64, return_sequences=True, kernel_regularizer=l2(1e-5)),
        BatchNormalization(),
        Dropout(0.25),
        GRU(32, return_sequences=False, kernel_regularizer=l2(1e-5)),
        Dropout(0.2),
        Dense(16, activation='relu'),
        Dense(OUTPUT_FEATURES, activation='tanh')  # tanh输出在[-1,1]之间
    ])

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.002),
        loss='mse',
        metrics=['mae']
    )
    model.summary()
    return model


def train_model(X_scaled, y_scaled):
    log("构建模型...")
    model = build_model()

    n = len(X_scaled)
    n_test = int(n * TEST_SPLIT)
    n_val = int(n * VALIDATION_SPLIT)
    n_train = n - n_test - n_val

    X_train, y_train = X_scaled[:n_train], y_scaled[:n_train]
    X_val, y_val = X_scaled[n_train:n_train+n_val], y_scaled[n_train:n_train+n_val]
    X_test, y_test = X_scaled[-n_test:], y_scaled[-n_test:]

    log(f"训练: {len(X_train)}, 验证: {len(X_val)}, 测试: {len(X_test)}")

    import keras
    callbacks = [
        keras.callbacks.EarlyStopping(monitor='val_loss', patience=12, restore_best_weights=True, verbose=1),
        keras.callbacks.ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=6, min_lr=1e-6, verbose=1),
    ]

    log("开始训练...")
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=EPOCHS, batch_size=BATCH_SIZE,
        callbacks=callbacks, verbose=1
    )

    test_loss, test_mae = model.evaluate(X_test, y_test, verbose=0)
    log(f"测试损失: {test_loss:.6f}, MAE: {test_mae:.6f}")

    return model, history


def test_delta_predictions(model, scaler_x, scaler_y, X_test, y_test):
    """测试增量预测效果"""
    log("\n增量预测测试 (前10个样本):")
    log("-" * 70)

    pred_scaled = model.predict(X_test[:10], verbose=0)
    pred_delta = scaler_y.inverse_transform(pred_scaled)
    actual_delta = scaler_y.inverse_transform(y_test[:10])

    for i in range(10):
        # 反标准化输入
        last_input = scaler_x.inverse_transform(X_test[i][-1:])[0]
        log(f"样本{i+1}:")
        log(f"  起始: lon={last_input[0]:.1f}, lat={last_input[1]:.1f}, wind={last_input[2]:.1f}, pres={last_input[3]:.0f}")
        log(f"  实际增量: dlon={actual_delta[i,0]:.2f}, dlat={actual_delta[i,1]:.2f}, dwind={actual_delta[i,2]:.1f}")
        log(f"  预测增量: dlon={pred_delta[i,0]:.2f}, dlat={pred_delta[i,1]:.2f}, dwind={pred_delta[i,2]:.1f}")
        err = np.sqrt(pred_delta[i,0]**2 + pred_delta[i,1]**2)
        log(f"  位置误差: {err:.2f}°")


def main():
    os.makedirs(MODEL_DIR, exist_ok=True)

    log("=" * 60)
    log("台风路径AI预测模型 - 增量训练")
    log("数据: CMA最佳路径 (1949-2025)")
    log("=" * 60)

    X_scaled, y_scaled, scaler_x, scaler_y = load_and_prepare_data()
    model, history = train_model(X_scaled, y_scaled)

    # 保存模型和标准化器
    log("\n保存模型...")
    model.save(MODEL_PATH)
    joblib.dump({'scaler_x': scaler_x, 'scaler_y': scaler_y}, SCALER_PATH)

    ms = os.path.getsize(MODEL_PATH) / 1024
    ss = os.path.getsize(SCALER_PATH) / 1024
    log(f"模型: {MODEL_PATH} ({ms:.1f}KB)")
    log(f"标准化器: {SCALER_PATH} ({ss:.1f}KB)")

    # 测试
    test_delta_predictions(model, scaler_x, scaler_y, X_scaled[-1000:], y_scaled[-1000:])

    log(f"\n参数量: {model.count_params()}")
    log("训练完成!")


if __name__ == '__main__':
    main()