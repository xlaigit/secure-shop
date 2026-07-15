#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
方案二+三：特征加权训练 + 物理约束损失函数
============================================
改进点：
1. 输入从 [lon,lat,wind,pressure] 扩展到 [lon,lat,wind,pressure,hgt500,u500,v500,ridge_lat,west_extent]
2. 副高特征通过注意力层自动加权（feature-wise attention）
3. 物理约束损失函数：引导气流方向惩罚
4. 辅助损失：引导气流预测头

运行方式：
    python train_model_v2.py

依赖：
    pip install tensorflow pandas numpy scikit-learn joblib
"""

import os, sys, warnings, numpy as np, pandas as pd
warnings.filterwarnings('ignore')

# ============ 配置 ============
CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        '..', '..', 'typhoon_train_with_subhigh.csv')
MODEL_DIR = 'D:/AI_Model'
MODEL_PATH_V2 = os.path.join(MODEL_DIR, 'july_track_model_v2.h5')
SCALER_PATH_V2 = os.path.join(MODEL_DIR, 'track_scaler_v2.pkl')

TIMESTEPS = 4
# 原始特征: [lon, lat, wind, pressure]
# 副高特征: [hgt500, u500, v500, ridge_lat, west_extent_588]
BASE_FEATURES = 4
SUBHIGH_FEATURES = 5
TOTAL_FEATURES = BASE_FEATURES + SUBHIGH_FEATURES  # 9
OUTPUT_FEATURES = 3  # [dlon, dlat, dwind]

EPOCHS = 80
BATCH_SIZE = 128
VALIDATION_SPLIT = 0.15
TEST_SPLIT = 0.10

# 物理约束权重
LAMBDA_PHYSICS = 0.3    # 物理损失权重
LAMBDA_STEER = 0.1      # 辅助引导气流损失权重


def log(msg):
    ts = __import__('datetime').datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


def physics_steering_loss(y_true, y_pred):
    """
    物理约束损失函数（核心）。
    
    原理：
      当副高完整盘踞东侧（ridge_lat > 20°N, west_extent < 125°E, u500 < 0），
      台风移动应服从引导气流方向（偏西/西北），
      若预测的 dlon > 0（向东移动），施加高额惩罚。
    
    输入：
      y_true: [dlon_true, dlat_true, dwind_true] (归一化)
      y_pred: [dlon_pred, dlat_pred, dwind_pred] (归一化)
    
    注意：此函数在训练时被包装，实际输入是模型输出的增量值。
          物理约束的判定需要额外输入副高特征，通过以下方式实现：
    
    实现方式（方案A：在模型内部实现）：
      模型输出层同时输出 [dlon, dlat, dwind] 和副高特征副本，
      在自定义损失中读取副高特征进行判定。
    
    方案B（更简单，推荐）：在数据预处理层完成
      对每条样本，预先计算"是否违反物理规则"的标签，
      违反时放大 dlon > 0 和 dlat > 0 的损失权重。
    """
    # 方案B实现：通过样本权重实现
    # 实际损失函数在 build_model 中实现
    return 0.0  # 占位，实际在模型编译时使用


def build_physics_penalty_mask(df):
    """
    预计算物理规则违反掩码。
    
    对每条样本，判断是否"副高完整东侧盘踞"场景：
    - ridge_lat > 20°N（副高脊线偏北）
    - u500 < 0（东风气流，引导偏西）
    - west_extent_588 < 125°E（5880线西伸至南海）
    
    在此场景下，如果目标的 dlon > 0（向东移动），
    则标记为违反物理规则，在损失计算中加倍惩罚。
    """
    log("预计算物理规则违反掩码...")

    mask = np.zeros(len(df), dtype=np.float32)
    penalty = np.ones(len(df), dtype=np.float32)

    for i, row in df.iterrows():
        # 检查副高特征是否存在
        if pd.isna(row.get('ridge_lat', np.nan)):
            penalty[i] = 1.0
            continue

        # 场景判定：完整东侧副高
        east_ridge = row['ridge_lat'] > 20  # 脊线偏北
        easterly = row.get('u500', 0) < 0   # 东风
        west_extend = row.get('west_extent_588', 200) < 130  # 西伸至南海

        if east_ridge and easterly and west_extend:
            mask[i] = 1  # 标记为副高强场景
            # 如果目标 dlon > 0（向东），惩罚翻倍
            target_dlon = row.get('dlon', 0)
            if target_dlon > 0:
                penalty[i] = 3.0  # 3倍惩罚
            # 如果目标 dlat > 0.5（向北太多），也惩罚
            target_dlat = row.get('dlat', 0)
            if target_dlat > 0.5:
                penalty[i] = max(penalty[i], 2.0)

    log(f"  副高强场景样本: {mask.sum()}/{len(df)} ({mask.mean()*100:.1f}%)")
    log(f"  施加惩罚的样本: {(penalty > 1).sum()}/{len(df)}")
    return penalty


def load_and_prepare_data():
    """加载增强后的数据集，构建时序样本"""
    log("加载增强数据集...")

    if not os.path.exists(CSV_PATH):
        log(f"[错误] 数据集不存在: {CSV_PATH}")
        log("请先运行 augment_with_subhigh.py 或使用原始数据集降级训练")
        return None

    df = pd.read_csv(CSV_PATH)
    log(f"原始数据: {len(df)} 行, 列: {list(df.columns)}")

    # 检查是否有副高特征列
    has_subhigh = all(col in df.columns for col in
                       ['hgt500', 'u500', 'v500', 'ridge_lat', 'west_extent_588'])

    if not has_subhigh:
        log("[警告] 未找到副高特征列，使用原始特征降级训练")
        # 用默认值填充
        df['hgt500'] = 5840
        df['u500'] = -4
        df['v500'] = 1.5
        df['ridge_lat'] = 22
        df['west_extent_588'] = 125

    # 预计算物理惩罚权重
    sample_weights = build_physics_penalty_mask(df)

    # 构建时序样本
    storms = df['storm_id'].unique() if 'storm_id' in df.columns else [0]
    X_samples = []
    y_samples = []
    w_samples = []

    feature_cols = ['lon', 'lat', 'wind_ms', 'pressure',
                    'hgt500', 'u500', 'v500', 'ridge_lat', 'west_extent_588']
    target_cols = ['dlon', 'dlat', 'dwind']

    # 检查目标列是否存在（增量模式）
    has_target = all(col in df.columns for col in target_cols)

    for sid in storms:
        if 'storm_id' in df.columns:
            group = df[df['storm_id'] == sid].sort_values('step')
        else:
            group = df

        records = group[feature_cols].values.astype(np.float64)
        weights = group.index.map(lambda i: sample_weights[i]).values

        if len(records) < TIMESTEPS + 1:
            continue

        for i in range(len(records) - TIMESTEPS):
            x_seq = records[i:i + TIMESTEPS]
            last = records[i + TIMESTEPS - 1]
            next_pt = records[i + TIMESTEPS]

            if has_target:
                delta = group[target_cols].values[i + TIMESTEPS].astype(np.float64)
            else:
                delta = next_pt[:3] - last[:3]

            # 过滤异常增量
            if abs(delta[0]) > 3 or abs(delta[1]) > 3 or abs(delta[2]) > 30:
                continue

            X_samples.append(x_seq)
            y_samples.append(delta)
            w_samples.append(weights[i + TIMESTEPS])

    X = np.array(X_samples, dtype=np.float64)
    y = np.array(y_samples, dtype=np.float64)
    w = np.array(w_samples, dtype=np.float32)

    log(f"样本: {len(X)}, X shape: {X.shape}, y shape: {y.shape}")
    log(f"特征: {feature_cols}")

    # 标准化
    from sklearn.preprocessing import MinMaxScaler
    import joblib

    X_2d = X.reshape(-1, TOTAL_FEATURES)
    scaler_x = MinMaxScaler()
    scaler_x.fit(X_2d)
    X_scaled = scaler_x.transform(X_2d).reshape(X.shape)

    scaler_y = MinMaxScaler()
    scaler_y.fit(y)
    y_scaled = scaler_y.transform(y)

    # 保存标准化器
    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump({
        'scaler_x': scaler_x,
        'scaler_y': scaler_y,
        'feature_cols': feature_cols,
        'total_features': TOTAL_FEATURES,
        'base_features': BASE_FEATURES,
        'subhigh_features': SUBHIGH_FEATURES
    }, SCALER_PATH_V2)

    return X_scaled, y_scaled, w, scaler_x, scaler_y


def build_model_v2():
    """
    构建增强版GRU模型（带特征加权+物理约束）。
    
    架构设计：
    1. 输入层: 9维特征 [lon,lat,wind,pressure, hgt500,u500,v500,ridge_lat,west_extent]
    2. 特征分离: 将副高特征从输入中分离，通过注意力层加权
    3. GRU编码: 3层GRU (128→64→32)
    4. 辅助引导气流头: 从GRU隐含状态预测引导气流方向
    5. 输出层: [dlon, dlat, dwind]
    6. 物理约束损失: 在训练时对违反引导气流的方向施加惩罚
    """
    import keras
    from keras.models import Model
    from keras.layers import (Input, GRU, Dense, Dropout, BatchNormalization,
                               Multiply, Lambda, Concatenate, Reshape)
    from keras.regularizers import l2
    import keras.backend as K

    # 输入
    inputs = Input(shape=(TIMESTEPS, TOTAL_FEATURES), name='main_input')

    # 分离特征：原始特征和副高特征
    # 原始特征: [:, :, :4] = [lon, lat, wind, pressure]
    # 副高特征: [:, :, 4:] = [hgt500, u500, v500, ridge_lat, west_extent]
    base_input = Lambda(lambda x: x[:, :, :4])(inputs)
    subhigh_input = Lambda(lambda x: x[:, :, 4:])(inputs)

    # 副高特征注意力加权
    # 对每个时间步，学习副高特征的权重
    attention = Dense(SUBHIGH_FEATURES, activation='sigmoid',
                      name='subhigh_attention')(subhigh_input)
    subhigh_weighted = Multiply(name='subhigh_weighted')([subhigh_input, attention])

    # 合并特征
    combined = Concatenate(axis=-1, name='feature_fusion')([base_input, subhigh_weighted])

    # GRU编码
    gru1 = GRU(128, return_sequences=True, kernel_regularizer=l2(1e-5),
               name='gru_1')(combined)
    bn1 = BatchNormalization(name='bn_1')(gru1)
    dp1 = Dropout(0.25, name='drop_1')(bn1)

    gru2 = GRU(64, return_sequences=True, kernel_regularizer=l2(1e-5),
               name='gru_2')(dp1)
    bn2 = BatchNormalization(name='bn_2')(gru2)
    dp2 = Dropout(0.25, name='drop_2')(bn2)

    gru3 = GRU(32, return_sequences=False, kernel_regularizer=l2(1e-5),
               name='gru_3')(dp2)
    dp3 = Dropout(0.2, name='drop_3')(gru3)

    # 辅助引导气流预测头（从隐含状态预测引导气流方向）
    steer_head = Dense(16, activation='relu', name='steer_dense')(dp3)
    steer_output = Dense(2, activation='tanh', name='steer_output')(steer_head)

    # 主输出
    dense = Dense(16, activation='relu', name='main_dense')(dp3)
    main_output = Dense(OUTPUT_FEATURES, activation='tanh',
                        name='main_output')(dense)

    # 构建模型
    model = Model(inputs=inputs, outputs=[main_output, steer_output])

    # ============ 自定义物理约束损失函数 ============
    def physics_constrained_loss(y_true, y_pred):
        """
        物理约束损失。
        
        输入:
          y_true: 拼接了惩罚权重的真实值 [dlon, dlat, dwind, penalty]
          y_pred: 预测值 [dlon_pred, dlat_pred, dwind_pred]
        
        注意：由于Keras自定义损失的限制，惩罚权重通过
         sample_weight 机制传递，而不是在损失函数内部。
        """
        # 标准MSE
        mse = K.mean(K.square(y_pred - y_true), axis=-1)
        return mse

    # 使用MSE + 物理约束通过sample_weight实现
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.002),
        loss={
            'main_output': 'mse',
            'steer_output': 'mse'
        },
        loss_weights={
            'main_output': 1.0,
            'steer_output': LAMBDA_STEER
        },
        metrics={'main_output': ['mae']}
    )

    model.summary()
    return model


def train_model_v2():
    """主训练流程"""
    log("=" * 60)
    log("台风路径AI预测模型 v2 - 带副高特征+物理约束")
    log("=" * 60)

    # 加载数据
    result = load_and_prepare_data()
    if result is None:
        return False

    X_scaled, y_scaled, sample_weights, scaler_x, scaler_y = result

    # 划分训练/验证/测试集
    n = len(X_scaled)
    n_test = int(n * TEST_SPLIT)
    n_val = int(n * VALIDATION_SPLIT)
    n_train = n - n_test - n_val

    X_train, y_train = X_scaled[:n_train], y_scaled[:n_train]
    X_val, y_val = X_scaled[n_train:n_train + n_val], y_scaled[n_train:n_train + n_val]
    X_test, y_test = X_scaled[-n_test:], y_scaled[-n_test:]

    w_train = sample_weights[:n_train]
    w_val = sample_weights[n_train:n_train + n_val]
    w_test = sample_weights[-n_test:]

    log(f"训练: {len(X_train)}, 验证: {len(X_val)}, 测试: {len(X_test)}")

    # 构建模型
    model = build_model_v2()

    # 准备辅助引导气流标签
    # 从副高特征中提取引导气流方向作为辅助标签
    # u500, v500 归一化后作为监督信号
    steer_train = X_train[:, -1, BASE_FEATURES:BASE_FEATURES + 2]  # 最后时间步的u500, v500
    steer_val = X_val[:, -1, BASE_FEATURES:BASE_FEATURES + 2]
    steer_test = X_test[:, -1, BASE_FEATURES:BASE_FEATURES + 2]

    # 训练
    import keras
    callbacks = [
        keras.callbacks.EarlyStopping(
            monitor='val_main_output_loss', patience=15,
            restore_best_weights=True, verbose=1),
        keras.callbacks.ReduceLROnPlateau(
            monitor='val_main_output_loss', factor=0.5,
            patience=8, min_lr=1e-6, verbose=1),
    ]

    # 使用sample_weight传递物理约束惩罚
    log("开始训练（物理约束已通过样本权重注入）...")
    history = model.fit(
        X_train,
        {'main_output': y_train, 'steer_output': steer_train},
        validation_data=(X_val, {
            'main_output': y_val, 'steer_output': steer_val
        }),
        sample_weight={
            'main_output': w_train,
            'steer_output': np.ones_like(w_train)
        },
        epochs=EPOCHS, batch_size=BATCH_SIZE,
        callbacks=callbacks, verbose=1
    )

    # 评估
    test_metrics = model.evaluate(X_test, {
        'main_output': y_test, 'steer_output': steer_test
    }, verbose=0, sample_weight={
        'main_output': w_test,
        'steer_output': np.ones_like(w_test)
    })
    log(f"测试损失: {test_metrics[0]:.6f}")

    # 保存模型
    model.save(MODEL_PATH_V2)
    log(f"模型保存: {MODEL_PATH_V2}")
    log(f"标准化器保存: {SCALER_PATH_V2}")

    # 预测测试
    pred = model.predict(X_test[:20], verbose=0)
    pred_delta = scaler_y.inverse_transform(pred[0])
    actual_delta = scaler_y.inverse_transform(y_test[:20])

    for i in range(5):
        err = np.sqrt(pred_delta[i, 0]**2 + pred_delta[i, 1]**2)
        log(f"  样本{i+1}: pred=({pred_delta[i,0]:.2f},{pred_delta[i,1]:.2f}) "
            f"actual=({actual_delta[i,0]:.2f},{actual_delta[i,1]:.2f}) "
            f"err={err:.2f}°")

    log("训练完成!")
    return True


if __name__ == '__main__':
    train_model_v2()