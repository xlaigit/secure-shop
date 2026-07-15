#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CMA BST 台风最佳路径数据集解析
==============================
解析CMABSTdata/CH*.txt 77年数据（1949-2025），
清洗后输出为统一CSV格式，与现有训练集兼容。

用法：
    python parse_cma_bst.py

输出：
    D:/肖宇帆/HTML项目/typhoon_cma_full.csv
"""

import os, re, sys, warnings, numpy as np, pandas as pd
from datetime import datetime, timedelta
warnings.filterwarnings('ignore')

# 路径
DATA_DIR = os.path.join('D:/肖宇帆/HTML项目/CMABSTdata')
OUTPUT_PATH = os.path.join('D:/肖宇帆/HTML项目/typhoon_cma_full.csv')

# 强度等级映射
INTENSITY_MAP = {
    0: 'UNKNOWN',
    1: 'TD',       # 热带低压
    2: 'TS',       # 热带风暴
    3: 'STS',      # 强热带风暴
    4: 'TY',       # 台风
    5: 'STY',      # 强台风
    6: 'SuperTY',  # 超强台风
    9: 'EX'        # 温带气旋
}


# 全局台风计数器，确保storm_id唯一
_GLOBAL_STORM_COUNTER = [0]  # 使用list以便在嵌套函数中修改


def parse_bst_file(filepath, year):
    """解析单个CMABST文件，返回台风记录列表
    year: 从文件名提取的年份（如 1949）
    """
    global _GLOBAL_STORM_COUNTER
    storms = []
    current_storm = None
    current_records = []

    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # 检查是否为头部行（以66666开头）
        if line.startswith('66666'):
            # 保存上一个台风
            if current_storm and len(current_records) >= 4:
                current_storm['records'] = current_records
                storms.append(current_storm)

            # 解析头部
            parts = line.split()
            if len(parts) < 8:
                continue

            storm_id_str = parts[1]  # 如 "2501" 或 "0000"
            storm_name = parts[7].strip()  # 如 "WUTIP" 或 "Carmen"

            # 使用全局计数器生成唯一storm_id，避免"0000"导致合并
            _GLOBAL_STORM_COUNTER[0] += 1
            seq = _GLOBAL_STORM_COUNTER[0]
            storm_id = f'{year}{seq:04d}'

            current_storm = {
                'storm_id': storm_id,
                'year': year,
                'name': storm_name,
                'seq': seq
            }
            current_records = []

        else:
            # 数据行
            if current_storm is None:
                continue

            # 格式: YYYYMMDDHH II LAT LON PRES WND
            # 可能有多余的空格，用正则解析
            parts = line.split()
            if len(parts) < 6:
                continue

            try:
                dt_str = parts[0]  # YYYYMMDDHH
                grade = int(parts[1])
                lat_raw = int(parts[2])  # 例如 154 = 15.4°N
                lon_raw = int(parts[3])  # 例如 1143 = 114.3°E
                pressure = int(parts[4])
                wind = int(parts[5]) if parts[5] else 0
            except (ValueError, IndexError):
                continue

            # 解析经纬度
            lat = lat_raw / 10.0
            lon = lon_raw / 10.0

            # 解析时间
            try:
                ts = datetime.strptime(dt_str, '%Y%m%d%H')
            except:
                continue

            # ========== 数据清洗 ==========
            # 过滤异常值
            if lat < 0 or lat > 50 or lon < 100 or lon > 180:
                continue
            if pressure < 850 or pressure > 1050:
                continue
            if wind < 0 or wind > 110:
                continue

            current_records.append({
                'storm_id': current_storm['storm_id'],
                'year': current_storm['year'],
                'name': current_storm['name'],
                'step': len(current_records),
                'iso_time': ts.strftime('%Y-%m-%d %H:%M:%S'),
                'lat': lat,
                'lon': lon,
                'wind_ms': wind,
                'pressure': pressure,
                'intensity': INTENSITY_MAP.get(grade, 'UNKNOWN'),
                'grade': grade
            })

    # 最后一个台风
    if current_storm and len(current_records) >= 4:
        current_storm['records'] = current_records
        storms.append(current_storm)

    return storms


def compute_deltas(df):
    """计算台风轨迹的增量特征（dlon, dlat, dwind, dpressure）"""
    df['dlon'] = np.nan
    df['dlat'] = np.nan
    df['dwind'] = np.nan
    df['dpressure'] = np.nan

    for storm_id, group in df.groupby('storm_id'):
        group = group.sort_values('step')
        indices = group.index

        for i in range(1, len(indices)):
            prev = df.loc[indices[i - 1]]
            curr = df.loc[indices[i]]

            df.loc[indices[i], 'dlon'] = curr['lon'] - prev['lon']
            df.loc[indices[i], 'dlat'] = curr['lat'] - prev['lat']
            df.loc[indices[i], 'dwind'] = curr['wind_ms'] - prev['wind_ms']
            df.loc[indices[i], 'dpressure'] = curr['pressure'] - prev['pressure']

    # 第一条记录没有增量，用第二条的增量填充或0
    df = df.fillna({'dlon': 0, 'dlat': 0, 'dwind': 0, 'dpressure': 0})
    return df


def main():
    print('=' * 60)
    print('CMA BST 台风数据集解析')
    print('=' * 60)

    if not os.path.exists(DATA_DIR):
        print(f'[错误] 数据目录不存在: {DATA_DIR}')
        return False

    # 获取所有年份文件
    files = sorted([f for f in os.listdir(DATA_DIR)
                    if f.startswith('CH') and f.endswith('.txt')])
    print(f'找到 {len(files)} 个年份文件: {files[0]} ~ {files[-1]}')

    # 解析所有文件
    all_storms = []
    total_records = 0
    skipped_storms = 0

    for fname in files:
        filepath = os.path.join(DATA_DIR, fname)
        year = int(fname[2:6])  # 从文件名提取年份如 "CH1949BST.txt" → 1949
        storms = parse_bst_file(filepath, year)

        for s in storms:
            n_records = len(s['records'])
            if n_records >= 4:
                all_storms.append(s)
                total_records += n_records
            else:
                skipped_storms += 1

        if len(storms) > 0:
            n = sum(1 for s in storms if len(s['records']) >= 4)
            total_recs = sum(len(s["records"]) for s in storms if len(s["records"]) >= 4)
            print(f'  {year}: {n} 个台风, {total_recs} 条记录')

    print(f'\n总计: {len(all_storms)} 个台风, {total_records} 条记录')
    print(f'跳过: {skipped_storms} 个台风（记录<4条）')

    # 转换为DataFrame
    records = []
    for s in all_storms:
        for r in s['records']:
            records.append(r)

    df = pd.DataFrame(records)
    print(f'DataFrame: {len(df)} 行, 列: {list(df.columns)}')

    # 计算增量
    df = compute_deltas(df)

    # 统计信息
    print(f'\n数据统计:')
    print(f'  年份范围: {df["year"].min()}-{df["year"].max()}')
    print(f'  经度范围: {df["lon"].min():.1f}-{df["lon"].max():.1f}°E')
    print(f'  纬度范围: {df["lat"].min():.1f}-{df["lat"].max():.1f}°N')
    print(f'  风速范围: {df["wind_ms"].min():.0f}-{df["wind_ms"].max():.0f} m/s')
    print(f'  气压范围: {df["pressure"].min():.0f}-{df["pressure"].max():.0f} hPa')
    print(f'  强度分布:')
    print(df['intensity'].value_counts().to_string())

    # 保存
    df.to_csv(OUTPUT_PATH, index=False)
    print(f'\n保存至: {OUTPUT_PATH}')
    print(f'文件大小: {os.path.getsize(OUTPUT_PATH)/1e6:.1f}MB')
    print('=' * 60)
    return True


if __name__ == '__main__':
    main()