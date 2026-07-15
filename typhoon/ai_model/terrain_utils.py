#!/usr/bin/env python3
"""
地形工具模块 - 用于台风模型训练和预测
提供地形高程插值、摩擦系数计算等功能
"""

import os, sys
import numpy as np

# 地形数据路径
TERRAIN_DIR = r'D:/AI_Model/terrain'
ELEV_PATH = os.path.join(TERRAIN_DIR, 'etopo1_nwpac.npy')
META_PATH = os.path.join(TERRAIN_DIR, 'etopo1_meta.npy')

# 全局缓存
_elev_grid = None
_lons = None
_lats = None

def load_terrain():
    """加载地形网格"""
    global _elev_grid, _lons, _lats
    if _elev_grid is not None:
        return _lons, _lats, _elev_grid
    
    if not os.path.exists(ELEV_PATH):
        raise FileNotFoundError(f"地形数据不存在: {ELEV_PATH}")
    
    _elev_grid = np.load(ELEV_PATH)
    meta = np.load(META_PATH, allow_pickle=True).item()
    _lons = meta['lons']
    _lats = meta['lats']
    
    print(f"[Terrain] 加载地形网格: {_elev_grid.shape} ({_lons[0]:.2f}~{_lons[-1]:.2f}°E, {_lats[0]:.2f}~{_lats[-1]:.2f}°N)")
    return _lons, _lats, _elev_grid


def get_elevation(lon, lat):
    """
    获取指定经纬度的高程值（米）。
    使用双线性插值，支持批量查询。
    
    参数:
      lon: 经度 float 或 numpy array
      lat: 纬度 float 或 numpy array
    
    返回: 高程值（米），正数=陆地，负数=海洋
    """
    lons, lats, elev = load_terrain()
    
    single = np.isscalar(lon)
    if single:
        lon = np.array([lon])
        lat = np.array([lat])
    
    # 越界处理
    lon = np.clip(lon, lons[0], lons[-1])
    lat = np.clip(lat, lats[0], lats[-1])
    
    # 找最近网格索引
    ilon = np.searchsorted(lons, lon) - 1
    ilat = np.searchsorted(lats, lat) - 1
    ilon = np.clip(ilon, 0, len(lons) - 2)
    ilat = np.clip(ilat, 0, len(lats) - 2)
    
    # 双线性插值权重
    wlon = (lon - lons[ilon]) / (lons[ilon + 1] - lons[ilon] + 1e-10)
    wlat = (lat - lats[ilat]) / (lats[ilat + 1] - lats[ilat] + 1e-10)
    
    # 四个角的高程
    e00 = elev[ilat, ilon]
    e10 = elev[ilat, ilon + 1]
    e01 = elev[ilat + 1, ilon]
    e11 = elev[ilat + 1, ilon + 1]
    
    # 双线性插值
    e0 = e00 * (1 - wlon) + e10 * wlon
    e1 = e01 * (1 - wlon) + e11 * wlon
    result = e0 * (1 - wlat) + e1 * wlat
    
    if single:
        return float(result[0])
    return result


def get_terrain_friction(elevation):
    """
    根据高程计算地形摩擦系数。
    用于台风过境时风速削弱。
    
    摩擦系数: 0.0=无地形(海洋), 越大越强
    """
    if elevation <= 0:
        return 0.0  # 海洋无摩擦
    
    # 低矮丘陵
    if elevation < 200:
        return 0.15
    # 中等地形
    elif elevation < 500:
        return 0.25
    # 山地
    elif elevation < 1000:
        return 0.35
    # 高山
    elif elevation < 2000:
        return 0.45
    # 极高山区
    else:
        return 0.55


def get_terrain_name(elevation, lon, lat):
    """获取地形区域名称"""
    if elevation <= 0:
        return '海洋'
    
    # 台湾中央山脉
    if 119.8 <= lon <= 122.2 and 21.8 <= lat <= 25.5:
        return '台湾中央山脉'
    
    # 主要地形区域
    regions = [
        (119.5, 122.5, 14.0, 19.5, '吕宋岛'),
        (117.5, 121.0, 23.5, 28.0, '福建沿海'),
        (119.0, 123.0, 27.5, 31.0, '浙江沿海'),
        (110.0, 117.5, 20.0, 25.0, '广东沿海'),
        (124.0, 129.5, 33.5, 39.0, '朝鲜半岛'),
        (129.0, 141.0, 30.0, 40.0, '日本'),
        (108.5, 111.5, 18.0, 20.5, '海南岛'),
        (122.0, 129.0, 24.0, 30.0, '琉球群岛'),
        (120.0, 126.0, 9.0, 14.0, '菲律宾'),
        (100.0, 106.0, 0.0, 8.0, '马来群岛'),
        (106.0, 110.0, 10.0, 23.0, '越南沿海'),
    ]
    
    for lon_min, lon_max, lat_min, lat_max, name in regions:
        if lon_min <= lon <= lon_max and lat_min <= lat <= lat_max:
            return name
    
    return '陆地'


def get_elevation_for_df(df, lon_col='lon', lat_col='lat'):
    """
    为DataFrame批量添加高程列。
    返回: 高程数组
    """
    lons = df[lon_col].values
    lats = df[lat_col].values
    return get_elevation(lons, lats)


if __name__ == '__main__':
    # 测试
    print("地形工具模块测试\n")
    
    test_points = [
        (121.5, 24.0, '台湾中央山脉'),
        (121.0, 15.0, '吕宋岛'),
        (119.5, 26.0, '福建沿海'),
        (121.0, 29.0, '浙江沿海'),
        (114.0, 23.0, '广东沿海'),
        (127.0, 36.0, '朝鲜半岛'),
        (135.0, 35.0, '日本本州'),
        (128.0, 27.0, '琉球群岛'),
        (110.0, 19.0, '海南岛'),
        (125.0, 12.0, '菲律宾'),
        (130.0, 20.0, '太平洋（海洋）'),
    ]
    
    print("位置\t\t高程(m)\t摩擦系数\t区域")
    print("-" * 60)
    for lon, lat, name in test_points:
        elev = get_elevation(lon, lat)
        friction = get_terrain_friction(elev)
        region = get_terrain_name(elev, lon, lat)
        print(f"{name}\t{elev:.0f}\t{friction:.2f}\t\t{region}")