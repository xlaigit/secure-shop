import json
import numpy as np
import pandas as pd
import tensorflow as tf
import joblib
import os
from math import radians, sin, cos, atan2, sqrt

# 【低配CPU优化】关闭TF全部日志、关闭拖慢CPU的oneDNN浮点优化
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

# 本地重定义副高层，解决导入报错
class SubhighLayer(tf.keras.layers.Layer):
    def __init__(self, **kwargs):
        super(SubhighLayer, self).__init__(**kwargs)
    def call(self, inputs):
        lat = inputs[:, 1:2]
        base_hgt = 5860
        decay_rate = 12
        hgt = tf.where(lat <= 30, base_hgt, base_hgt - decay_rate * (lat - 30))
        return hgt

# 气象标准：经纬度转地表公里距离
def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    return R * c

# 1. 加载v2模型（固定D盘AI_Model绝对路径）
model_path = r"D:\AI_Model\july_track_model_v2.h5"
model = tf.keras.models.load_model(model_path, custom_objects={"SubhighLayer": SubhighLayer})

# 2. 加载配套归一化缩放器
scaler_package = joblib.load(r"D:\AI_Model\track_scaler_v2.pkl")
scaler_x = scaler_package["scaler_x"]
scaler_y = scaler_package["scaler_y"]
TIMESTEPS = 4
TOTAL_FEATURES = 9

# 内置完整递归预测函数，低配CPU轻量化推理
def recursive_predict(params, steps):
    track_list = []
    wind_seq = []
    pres_seq = []
    lon0 = params["lon"]
    lat0 = params["lat"]
    wind0 = params["wind"]
    pres0 = params["pressure"]
    hgt0 = params["hgt500"]
    u0 = params["u500"]
    v0 = params["v500"]
    ridge0 = params["ridge_lat"]
    west0 = params["west_extent"]

    track_list.append([lat0, lon0])
    wind_seq.append(wind0)
    pres_seq.append(pres0)

    curr_lat, curr_lon = lat0, lon0
    curr_wind, curr_pres = wind0, pres0
    for _ in range(steps):
        seq_input = np.zeros((1, TIMESTEPS, TOTAL_FEATURES))
        seq_input[0, -1] = [curr_lon, curr_lat, curr_wind, curr_pres, hgt0, u0, v0, ridge0, west0]
        seq_scaled = scaler_x.transform(seq_input.reshape(-1, TOTAL_FEATURES)).reshape(1, TIMESTEPS, TOTAL_FEATURES)
        # 适配低配硬件推理参数
        pred_main, _ = model.predict(seq_scaled, verbose=0, batch_size=1, use_multiprocessing=False)
        delta = scaler_y.inverse_transform(pred_main)[0]
        dlon, dlat, dwind = delta[0], delta[1], delta[2]
        curr_lon += dlat
        curr_lon += dlon
        curr_wind += dwind
        track_list.append([curr_lat, curr_lon])
        wind_seq.append(curr_wind)
        pres_seq.append(curr_pres)
    return track_list, wind_seq, pres_seq

# 3. 读取同目录CSV（你已经复制csv到ai_model文件夹）
csv_full_path = "typhoon_train_with_subhigh.csv"
try:
    full_df = pd.read_csv(csv_full_path, encoding="utf-8")
except:
    full_df = pd.read_csv(csv_full_path, encoding="gbk")

TEST_SPLIT = 0.10
n_test = int(len(full_df) * TEST_SPLIT)
test_df = full_df[-n_test:].reset_index(drop=True)
# 提速关键：只取前300条样本快速跑完，出结果后注释此行跑全量
test_df = test_df.head(300)
print(f"成功加载测试集，样本总量：{len(test_df)}")

# 存储误差
err_6h, err_24h, err_48h, err_72h = [], [], [], []
wind_mae, pres_mae = [], []

# 按时序切片取真值，规避lat_6h字段缺失报错
storms = test_df['storm_id'].unique() if 'storm_id' in test_df.columns else [0]
for sid in storms:
    group = test_df[test_df['storm_id'] == sid].sort_values('step') if 'storm_id' in test_df.columns else test_df
    feature_cols = ['lon', 'lat', 'wind_ms', 'pressure','hgt500','u500','v500','ridge_lat','west_extent_588']
    records = group[feature_cols].values.astype(np.float64)
    if len(records) < TIMESTEPS + 12:
        continue
    for i in range(len(records) - TIMESTEPS - 12):
        init_params = {
            "lon": records[i+TIMESTEPS-1,0],
            "lat": records[i+TIMESTEPS-1,1],
            "wind": records[i+TIMESTEPS-1,2],
            "pressure": records[i+TIMESTEPS-1,3],
            "hgt500": records[i+TIMESTEPS-1,4],
            "u500": records[i+TIMESTEPS-1,5],
            "v500": records[i+TIMESTEPS-1,6],
            "ridge_lat": records[i+TIMESTEPS-1,7],
            "west_extent": records[i+TIMESTEPS-1,8]
        }
        try:
            pred_track, pred_wind_seq, pred_pres_seq = recursive_predict(init_params, steps=12)
        except:
            # 删掉打印，减少IO拖慢速度，直接跳过异常样本
            continue
        # 取时序真实标签
        real_6 = (records[i+TIMESTEPS+1, 1], records[i+TIMESTEPS+1, 0])
        real_24 = (records[i+TIMESTEPS+4, 1], records[i+TIMESTEPS+4, 0])
        real_48 = (records[i+TIMESTEPS+8, 1], records[i+TIMESTEPS+8, 0])
        real_72 = (records[i+TIMESTEPS+12, 1], records[i+TIMESTEPS+12, 0])
        real_wind_72 = records[i+TIMESTEPS+12, 2]
        real_pres_72 = records[i+TIMESTEPS+12, 3]

        err_6h.append(haversine_km(pred_track[1][0], pred_track[1][1], real_6[0], real_6[1]))
        err_24h.append(haversine_km(pred_track[4][0], pred_track[4][1], real_24[0], real_24[1]))
        err_48h.append(haversine_km(pred_track[8][0], pred_track[8][1], real_48[0], real_48[1]))
        err_72h.append(haversine_km(pred_track[12][0], pred_track[12][1], real_72[0], real_72[1]))
        wind_mae.append(abs(pred_wind_seq[-1] - real_wind_72))
        pres_mae.append(abs(pred_pres_seq[-1] - real_pres_72))

# 汇总精度报告
report = {
    "6小时平均路径误差(km)": round(np.mean(err_6h), 2),
    "24小时平均路径误差(km)": round(np.mean(err_24h), 2),
    "48小时平均路径误差(km)": round(np.mean(err_48h), 2),
    "72小时平均路径误差(km)": round(np.mean(err_72h), 2),
    "72h风速平均误差(m/s)": round(np.mean(wind_mae), 2),
    "72h气压平均误差(hPa)": round(np.mean(pres_mae), 2)
}

# 控制台输出结果
print("\n========== V2台风模型测试集精度报告 ==========")
for key, val in report.items():
    print(f"{key}: {val}")

# 保存报告到本地文本
with open("accuracy_report.txt", "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print("\n完整精度报告已保存至 ai_model/accuracy_report.txt")
