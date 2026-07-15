#!/usr/bin/env python3
"""
GFS 副高数据下载与解析工具
下载 GRIB2 文件，提取 500hPa 位势高度场，
裁剪西北太平洋区域，输出 JSON 到 static/weather/
"""
import os, json, sys, urllib.request, warnings, numpy as np
warnings.filterwarnings('ignore')

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(PROJECT_DIR, 'static', 'weather')
RAW_DIR = os.path.join(PROJECT_DIR, 'raw_grib')
SYNC_FILE = os.path.join(PROJECT_DIR, 'last_sync_time.json')

NWP = {'minLat': 5, 'maxLat': 45, 'minLon': 100, 'maxLon': 160}


def log(msg):
    from datetime import datetime
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


def download_grib2():
    """下载GFS GRIB2分析文件 (1.0度)"""
    url = ('https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/'
           'gfs.20260712/00/atmos/gfs.t00z.pgrb2.1p00.f000')
    os.makedirs(RAW_DIR, exist_ok=True)
    local_path = os.path.join(RAW_DIR, 'gfs.t00z.pgrb2.1p00.f000')

    if os.path.exists(local_path) and os.path.getsize(local_path) > 100000:
        log(f"使用本地缓存: {local_path} ({os.path.getsize(local_path)/1024:.1f}KB)")
        return local_path

    log(f"下载 GFS GRIB2 文件 (1.0度)...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=300) as resp:
        total = int(resp.headers.get('Content-Length', 0))
        downloaded = 0
        with open(local_path, 'wb') as f:
            while True:
                chunk = resp.read(8192)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if total and downloaded % (1024 * 1024) < 8192:
                    pct = downloaded / total * 100
                    log(f"  下载: {downloaded/1024/1024:.1f}MB/{total/1024/1024:.1f}MB ({pct:.1f}%)")

    log(f"下载完成: {os.path.getsize(local_path)/1024/1024:.1f}MB")
    return local_path


def parse_hgt500(grib2_path):
    """解析GRIB2文件，提取500hPa位势高度"""
    log("解析 500hPa 位势高度...")
    import xarray as xr

    # 只读取500hPa的hgtprs
    ds = xr.open_dataset(
        grib2_path,
        engine='cfgrib',
        backend_kwargs={'filter_by_keys': {'typeOfLevel': 'isobaricInhPa', 'level': 500}}
    )

    # 提取数据
    lats = ds.latitude.values
    lons = ds.longitude.values
    hgt = ds.gh.values  # shape: (lat, lon)

    # 提取500hPa风场 (u, v) 用于引导气流计算
    try:
        u_wind = ds.u.values
        v_wind = ds.v.values
        log(f"风场数据: u={u_wind.shape}, v={v_wind.shape}")
    except Exception:
        log("警告: 未能提取风场数据，使用默认值")
        u_wind = np.zeros_like(hgt)
        v_wind = np.zeros_like(hgt)

    ds.close()

    log(f"原始网格: {len(lats)}x{len(lons)}")

    # 转换为0-360经度
    if np.any(lons < 0):
        lons = np.where(lons < 0, lons + 360, lons)

    # 裁剪NWP区域
    lat_mask = (lats >= NWP['minLat']) & (lats <= NWP['maxLat'])
    lon_mask = (lons >= NWP['minLon']) & (lons <= NWP['maxLon'])

    if not np.any(lat_mask) or not np.any(lon_mask):
        log("警告: NWP区域无数据，返回全部数据")
        lat_indices = slice(None)
        lon_indices = slice(None)
    else:
        lat_indices = np.where(lat_mask)[0]
        lon_indices = np.where(lon_mask)[0]
        # 取连续范围
        lat_indices = slice(lat_indices[0], lat_indices[-1] + 1)
        lon_indices = slice(lon_indices[0], lon_indices[-1] + 1)

    # 生成网格点数据（含风场）
    grid_data = []
    hgt_subset = hgt[lat_indices, lon_indices]
    u_subset = u_wind[lat_indices, lon_indices]
    v_subset = v_wind[lat_indices, lon_indices]
    lats_subset = lats[lat_indices]
    lons_subset = lons[lon_indices]

    # 每隔4个点取一个（1度分辨率）
    stride = 4
    for i in range(0, len(lats_subset), stride):
        for j in range(0, len(lons_subset), stride):
            lat = round(float(lats_subset[i]), 1)
            lon = round(float(lons_subset[j]), 1)
            hgt_val = float(hgt_subset[i, j])
            u_val = float(u_subset[i, j])
            v_val = float(v_subset[i, j])
            if not np.isnan(hgt_val) and hgt_val > 0:
                grid_data.append({
                    'lat': lat,
                    'lon': lon,
                    'height': round(hgt_val),
                    'u': round(u_val, 1) if not np.isnan(u_val) else 0,
                    'v': round(v_val, 1) if not np.isnan(v_val) else 0
                })

    log(f"NWP网格点: {len(grid_data)}")
    return grid_data, lats_subset, lons_subset, hgt_subset


def extract_contour5880(grid_data):
    """提取5880等高线边界"""
    high_points = [p for p in grid_data if p['height'] >= 5880]
    if len(high_points) < 2:
        return []

    lats = [p['lat'] for p in high_points]
    lons = [p['lon'] for p in high_points]
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)

    boundary = []
    step = 2.5
    for lon in np.arange(min_lon, max_lon + 0.01, step):
        boundary.append({'lat': round(max_lat, 1), 'lon': round(lon, 1)})
    for lat in np.arange(max_lat, min_lat - 0.01, -step):
        boundary.append({'lat': round(lat, 1), 'lon': round(max_lon, 1)})
    for lon in np.arange(max_lon, min_lon - 0.01, -step):
        boundary.append({'lat': round(min_lat, 1), 'lon': round(lon, 1)})
    for lat in np.arange(min_lat, max_lat + 0.01, step):
        boundary.append({'lat': round(lat, 1), 'lon': round(min_lon, 1)})
    return boundary


def calc_subhigh_params(grid_data):
    """计算副高特征参数"""
    if not grid_data:
        return {'avgHeight': 0, 'maxHeight': 0, 'count588': 0, 'ridgeLat': 0, 'description': '--'}

    heights = [p['height'] for p in grid_data]
    avg = round(sum(heights) / len(heights))
    max_h = max(heights)
    high_points = [p for p in grid_data if p['height'] >= 5880]
    count = len(high_points)

    if count > 0:
        ridge_lat = round(sum(p['lat'] for p in high_points) / count, 1)
        desc = f"副高脊线约位于北纬{ridge_lat}°附近"
    else:
        ridge_lat = 0
        desc = "副热带高压偏弱，5880线不明显"

    return {'avgHeight': avg, 'maxHeight': max_h, 'count588': count, 'ridgeLat': ridge_lat, 'description': desc}


def output_json(hgt_data, contour5880, params):
    """输出JSON文件"""
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    output = {
        'success': True,
        'type': 'hgt500',
        'description': 'GFS 500hPa位势高度场 (西北太平洋区域)',
        'updateTime': np.datetime_as_string(np.datetime64('now'), timezone='UTC'),
        'dataSource': 'GFS 1.0° PGRB2 (NOAA NOMADS)',
        'gridData': hgt_data,
        'contour5880': contour5880,
        'subHigh': params
    }

    path = os.path.join(OUTPUT_DIR, 'hgt500.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    log(f"输出: {path} ({os.path.getsize(path)/1024:.1f}KB)")


def update_sync_time():
    sync_data = {}
    if os.path.exists(SYNC_FILE):
        with open(SYNC_FILE, 'r') as f:
            sync_data = json.load(f)
    from datetime import datetime, timezone
    sync_data['lastGribSync'] = datetime.now(timezone.utc).isoformat()
    with open(SYNC_FILE, 'w') as f:
        json.dump(sync_data, f, indent=2)
    log("已更新同步时间")


def main():
    log("=" * 60)
    log("GFS 副高数据下载解析")
    log("=" * 60)

    try:
        grib2_path = download_grib2()
        grid_data, lats, lons, hgt = parse_hgt500(grib2_path)
        contour = extract_contour5880(grid_data)
        params = calc_subhigh_params(grid_data)
        output_json(grid_data, contour, params)
        update_sync_time()

        log(f"副高特征: 平均高度={params['avgHeight']}gpm, 5880线内点数={params['count588']}, 脊线={params['ridgeLat']}°N")
        log("完成!")
    except Exception as e:
        log(f"错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()