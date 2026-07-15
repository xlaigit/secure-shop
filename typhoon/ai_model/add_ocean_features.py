#!/usr/bin/env python3
"""添加海洋特征到台风数据：SST、OHC、垂直风切变、水汽通量"""

import numpy as np
import pandas as pd
from datetime import datetime

CSV_IN = "typhoon_train_with_subhigh.csv"
CSV_OUT = "typhoon_train_with_ocean.csv"

def calc_sst(lat, lon, month):
    """基于气候态月平均海温估算（西北太平洋）"""
    # 基础海温：纬度梯度（热带~28°C，中纬度~10°C）
    abs_lat = abs(lat)
    base = 28.5 - 0.18 * abs_lat
    if base < 5: base = 5
    # 经度修正：西太平洋暖池偏暖
    lon_factor = 0.02 * (lon - 140)
    # 季节修正：北半球8月最暖，2月最冷
    month_angle = 2 * np.pi * (month - 8) / 12
    seasonal = 2.5 * np.cos(month_angle)
    sst = base + lon_factor + seasonal
    # 高纬度限制
    if abs_lat > 35:
        sst = np.clip(sst, 0, 26)
    elif abs_lat > 25:
        sst = np.clip(sst, 15, 29)
    else:
        sst = np.clip(sst, 22, 31)
    return round(sst, 2)

def calc_ohc(sst):
    """从SST估算海洋热含量（单位：kJ/cm²）"""
    if sst >= 26:
        return round(30 + 12 * (sst - 26), 1)
    elif sst >= 22:
        return round(10 + 5 * (sst - 22), 1)
    else:
        return round(max(0, 2 * (sst - 10)), 1)

def calc_vws(u500, v500, wind_ms):
    """估算垂直风切变（200-850hPa近似，单位：m/s）"""
    env_wind = np.sqrt(u500**2 + v500**2)
    # 表面风（用台风风速的0.4倍近似）
    surf_wind = 0.4 * wind_ms
    # 方向假设：环境风与表面风方向相近
    vws = max(0, env_wind - surf_wind * 0.7)
    return round(vws, 2)

def calc_wvapor(sst, pressure):
    """从SST估算低层水汽通量（g/kg）"""
    # 饱和水汽压（Tetens公式）
    es = 6.112 * np.exp(17.67 * sst / (sst + 243.5))
    # 实际水汽压（假定相对湿度80%）
    e = 0.8 * es
    # 混合比（g/kg）
    w = 622 * e / (pressure - e)
    return round(w, 2)

def main():
    print("加载数据...")
    df = pd.read_csv(CSV_IN)
    df['iso_time'] = pd.to_datetime(df['iso_time'])
    print(f"原始数据: {len(df)} 行, {len(df.columns)} 列")

    # 添加海洋特征
    months = df['iso_time'].dt.month
    sst_vals = [calc_sst(row['lat'], row['lon'], row['iso_time'].month)
                for _, row in df.iterrows()]
    df['sst'] = sst_vals
    df['ohc'] = df['sst'].apply(calc_ohc)
    df['vws'] = df.apply(lambda r: calc_vws(r['u500'], r['v500'], r['wind_ms']), axis=1)
    df['wvapor'] = df.apply(lambda r: calc_wvapor(r['sst'], r['pressure']), axis=1)

    print(f"新增特征: SST, OHC, VWS, WVapor")
    print(f"  SST: {df['sst'].min():.1f}~{df['sst'].max():.1f}°C, 平均={df['sst'].mean():.1f}")
    print(f"  OHC: {df['ohc'].min():.1f}~{df['ohc'].max():.1f} kJ/cm²")
    print(f"  VWS: {df['vws'].min():.1f}~{df['vws'].max():.1f} m/s")
    print(f"  WVapor: {df['wvapor'].min():.1f}~{df['wvapor'].max():.1f} g/kg")

    # 保存
    df.to_csv(CSV_OUT, index=False)
    print(f"\n已保存: {CSV_OUT} ({len(df)} 行, {len(df.columns)} 列)")

    # 验证一个台风
    sid = df['storm_id'].iloc[0]
    sample = df[df['storm_id']==sid].head(5)
    print(f"\n验证台风 {sid}:")
    print(sample[['iso_time','lat','lon','sst','ohc','vws','wvapor']].to_string())

if __name__ == '__main__':
    main()