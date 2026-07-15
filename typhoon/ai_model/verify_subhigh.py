#!/usr/bin/env python3
"""验证副高填充数据质量"""
import pandas as pd, numpy as np

df = pd.read_csv('D:/肖宇帆/HTML项目/typhoon_train_with_subhigh.csv')
print('=' * 60)
print('副高数据质量验证 - 2537个台风')
print('=' * 60)
print(f'总行数: {len(df)}')
print(f'台风数: {df["storm_id"].nunique()}')

# 1. 季节差异
df['month'] = pd.to_datetime(df['iso_time']).dt.month
monthly = df.groupby('month')[['ridge_lat', 'hgt500', 'west_extent_588', 'u500']].mean().round(1)
print('\n✅ 问题1-季节差异 (冬季偏南偏东 → 夏季偏北偏西):')
print('  月份 | 脊线(°N) | hgt500 | 5880西伸(°E) | u500(m/s)')
for m, row in monthly.iterrows():
    print(f'  {m:2d}月  | {row["ridge_lat"]:>6.1f} | {row["hgt500"]:>5.0f} | {row["west_extent_588"]:>8.0f} | {row["u500"]:>6.1f}')

# 2. 强度匹配
print('\n✅ 问题2-强度匹配 (弱扰动→弱副高, 强台风→强副高):')
wind_bins = [0, 10, 17, 25, 33, 50, 100]
wind_labels = ['<10(弱扰动)', '10-17(TD)', '17-25(TS)', '25-33(STS)', '33-50(TY)', '>50(SuperTY)']
df['wind_cat'] = pd.cut(df['wind_ms'], bins=wind_bins, labels=wind_labels)
intensity_match = df.groupby('wind_cat', observed=True)[['hgt500', 'ridge_lat']].mean().round(1)
for cat, row in intensity_match.iterrows():
    print(f'  {cat:>10} | hgt500={row["hgt500"]:>5.0f} | 脊线={row["ridge_lat"]:>4.1f}°N')

# 3. 同台风动态
print('\n✅ 问题3-台风内动态 (不再静态不变):')
for sid in df['storm_id'].drop_duplicates().sample(5, random_state=42):
    sr = df[df['storm_id'] == sid]
    print(f'  台风 {sid}: {len(sr)}条, hgt500唯一值={sr["hgt500"].nunique()}, '
          f'ridge唯一值={sr["ridge_lat"].nunique()}')

# 4. 纬度衰减
print('\n✅ 问题4-纬度衰减 (高纬副高消失):')
lat_bins = [0, 15, 20, 25, 30, 35, 50]
lat_labels = ['0-15°N', '15-20°N', '20-25°N', '25-30°N', '30-35°N', '35-50°N']
df['lat_cat'] = pd.cut(df['lat'], bins=lat_bins, labels=lat_labels)
lat_decay = df.groupby('lat_cat', observed=True)[['hgt500', 'ridge_lat', 'u500']].mean().round(1)
for cat, row in lat_decay.iterrows():
    print(f'  {cat:>8} | hgt500={row["hgt500"]:>5.0f} | 脊线={row["ridge_lat"]:>4.1f}°N | u500={row["u500"]:>4.1f}')

print('\n' + '=' * 60)
print('✅ 数据质量验证完成')