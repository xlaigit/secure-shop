#!/usr/bin/env python3
"""添加地形高程到训练CSV"""
import pandas as pd
import numpy as np
from terrain_utils import get_elevation

df = pd.read_csv('typhoon_train_realtime_ocean.csv')
print(f'原始数据: {len(df)} 行')

elev = get_elevation(df['lon'].values, df['lat'].values)
df['elevation'] = np.round(elev, 1).astype(np.float32)

land = (elev > 0).sum()
total = len(df)
print(f'海洋点: {total-land} ({(total-land)/total*100:.1f}%)')
print(f'陆地点: {land} ({land/total*100:.1f}%)')
print(f'高程范围: {elev.min():.0f}m ~ {elev.max():.0f}m')

df.to_csv('typhoon_train_realtime_ocean.csv', index=False)
print(f'已保存，总列数: {len(df.columns)}')
print(f'列名: {list(df.columns)}')
print(f'前5行高程: {df["elevation"].values[:5]}')