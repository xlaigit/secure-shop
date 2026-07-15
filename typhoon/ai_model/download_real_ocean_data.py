#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NCEP/NCAR再分析数据 - 分批发下载+本地插值
SST: skt.sfc (degC), 风场: uwnd/vwnd (m/s)
全部通过10年分批下载，避免大文件传输问题
"""
import os, sys, warnings
warnings.filterwarnings('ignore')
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

import numpy as np
import pandas as pd

CSV_PATH = os.path.join(os.path.dirname(__file__), 'typhoon_train_with_subhigh.csv')
CSV_OUT = os.path.join(os.path.dirname(__file__), 'typhoon_train_realtime_ocean.csv')

BASE = 'https://psl.noaa.gov/thredds/dodsC/Datasets/ncep.reanalysis.derived'

def log(msg):
    print(f"[数据] {msg}")

def download_batch(var, level_slice, y1, y2):
    """下载一批10年数据，返回numpy数组+坐标"""
    import xarray as xr
    t1, t2 = f'{y1}-01-01', f'{y2}-12-31'
    url = f'{BASE}/pressure/{var}.mon.mean.nc' if 'wnd' in var else f'{BASE}/surface_gauss/{var}.mon.mean.nc'
    ds = xr.open_dataset(url, decode_times=True)
    da = ds[var.replace('skt.sfc','skt')]  # variable name in dataset
    sel = da.sel(time=slice(t1, t2), lat=slice(50, 0), lon=slice(100, 180))
    if level_slice is not None:
        sel = sel.sel(level=level_slice)
    data = sel.values
    lats = da.sel(lat=slice(50, 0)).lat.values
    lons = da.sel(lon=slice(100, 180)).lon.values
    times = sel.time.values.astype('datetime64[M]')
    ds.close()
    return data, times, lats, lons

def main():
    print("=" * 60)
    print(" NCEP/NCAR再分析 - 分批下载+插值")
    print("=" * 60)

    import xarray as xr

    year_batches = [(1948, 1957), (1958, 1967), (1968, 1977), (1978, 1987),
                    (1988, 1997), (1998, 2007), (2008, 2017), (2018, 2026)]

    # ===== 1. SST (skt.sfc, degC) =====
    log("步骤1: 下载SST (skt.sfc, 10年分批)...")
    all_sst, sst_times = [], None
    sst_lats, sst_lons = None, None
    for y1, y2 in year_batches:
        log(f"  SST {y1}-{y2}...")
        data, times, lats, lons = download_batch('skt.sfc', None, y1, y2)
        all_sst.append(data)
        if sst_times is None:
            sst_times, sst_lats, sst_lons = times, lats, lons
        else:
            sst_times = np.concatenate([sst_times, times])
    sst_data = np.concatenate(all_sst, axis=0)
    log(f"  SST形状: {sst_data.shape} ({str(sst_times[0])[:10]}~{str(sst_times[-1])[:10]})")

    # ===== 2. 风场 (uwnd, vwnd, 200/850hPa) =====
    log("步骤2: 下载风场 (10年分批)...")
    all_u, all_v = [], []
    wind_times, wind_lats, wind_lons = None, None, None
    for y1, y2 in year_batches:
        log(f"  风场 {y1}-{y2}...")
        try:
            u_data, ut, ul, uo = download_batch('uwnd', [200, 850], y1, y2)
            v_data, vt, vl, vo = download_batch('vwnd', [200, 850], y1, y2)
            all_u.append(u_data)
            all_v.append(v_data)
            if wind_times is None:
                wind_times, wind_lats, wind_lons = ut, ul, uo
            else:
                wind_times = np.concatenate([wind_times, ut])
        except Exception as e:
            log(f"    跳过: {e}")
            continue
    if len(all_u) == 0:
        log("风场下载失败，使用气候态")
        use_wind_clim = True
    else:
        use_wind_clim = False
        u_data = np.concatenate(all_u, axis=0)
        v_data = np.concatenate(all_v, axis=0)
        log(f"  风场形状: {u_data.shape}")

    # ===== 3. 加载台风数据 =====
    log("步骤3: 加载台风数据...")
    df = pd.read_csv(CSV_PATH)
    if 'iso_time' in df.columns:
        df['iso_time'] = pd.to_datetime(df['iso_time'])
    log(f"共 {len(df)} 行")

    # ===== 4. 插值 =====
    log("步骤4: 插值...")
    sst_vals, ohc_vals, vws_vals, wv_vals = [], [], [], []
    success = 0
    total = len(df)

    for idx, row in df.iterrows():
        lat, lon = row['lat'], row['lon']
        lon_360 = lon if lon >= 0 else lon + 360
        time_val = row['iso_time']
        if isinstance(time_val, str):
            time_val = pd.to_datetime(time_val)
        time_m = np.datetime64(time_val.strftime('%Y-%m'), 'M')

        try:
            # SST
            lat_i = int(np.argmin(np.abs(sst_lats - lat)))
            lon_i = int(np.argmin(np.abs(sst_lons - lon_360)))
            time_i = int(np.argmin(np.abs(sst_times - time_m)))
            sst_c = float(sst_data[time_i, lat_i, lon_i])

            # 风场
            ulat_i = int(np.argmin(np.abs(wind_lats - lat)))
            ulon_i = int(np.argmin(np.abs(wind_lons - lon_360)))
            utime_i = int(np.argmin(np.abs(wind_times - time_m)))
            if not use_wind_clim:
                u200 = float(u_data[utime_i, 0, ulat_i, ulon_i])
                v200 = float(v_data[utime_i, 0, ulat_i, ulon_i])
                u850 = float(u_data[utime_i, 1, ulat_i, ulon_i])
                v850 = float(v_data[utime_i, 1, ulat_i, ulon_i])
                vws = np.sqrt((u200-u850)**2 + (v200-v850)**2)
            else:
                env_wind = np.sqrt(row['u500']**2 + row['v500']**2)
                vws = max(0, env_wind - 0.4 * row['wind_ms'] * 0.7)

            # OHC
            if sst_c >= 26: ohc = 30 + 12 * (sst_c - 26)
            elif sst_c >= 22: ohc = 10 + 5 * (sst_c - 22)
            else: ohc = max(0, 2 * (sst_c - 10))

            # 水汽
            es = 6.112 * np.exp(17.67 * sst_c / (sst_c + 243.5))
            e = 0.8 * es
            wv = 622 * e / (row['pressure'] - e)

            sst_vals.append(round(sst_c, 2))
            ohc_vals.append(round(ohc, 1))
            vws_vals.append(round(vws, 2))
            wv_vals.append(round(wv, 2))
            success += 1

        except Exception as e:
            if success == 0 and idx == 0:
                print(f"\n[错误] 首次插值失败: {e}")
                import traceback
                traceback.print_exc()
            abs_lat = abs(lat)
            base = 28.5 - 0.18 * abs_lat
            month = pd.to_datetime(time_val).month if not isinstance(time_val, str) else 6
            month_angle = 2 * np.pi * (month - 8) / 12
            sst_c = np.clip(base + 2.5 * np.cos(month_angle), 0, 31)
            ohc = max(0, 2 * (sst_c - 10))
            if sst_c >= 26: ohc = 30 + 12 * (sst_c - 26)
            elif sst_c >= 22: ohc = 10 + 5 * (sst_c - 22)
            sst_vals.append(round(sst_c, 2))
            ohc_vals.append(round(ohc, 1))
            vws_vals.append(round(8 + np.random.uniform(-3, 3), 2))
            wv_vals.append(round(15 + np.random.uniform(-3, 3), 2))

        if (idx + 1) % 5000 == 0:
            log(f"进度: {idx+1}/{total} ({100*(idx+1)//total}%)")

    log(f"插值完成: {success}/{total} 成功")
    df['sst'] = sst_vals
    df['ohc'] = ohc_vals
    df['vws'] = vws_vals
    df['wvapor'] = wv_vals
    df.to_csv(CSV_OUT, index=False)
    log(f"\n已保存: {CSV_OUT}")
    print(f"\n海洋特征统计:")
    print(f"  SST:   {df['sst'].min():.1f}~{df['sst'].max():.1f}°C, 平均={df['sst'].mean():.1f}")
    print(f"  OHC:   {df['ohc'].min():.1f}~{df['ohc'].max():.1f} kJ/cm²")
    print(f"  VWS:   {df['vws'].min():.1f}~{df['vws'].max():.1f} m/s")
    print(f"  WVapor: {df['wvapor'].min():.1f}~{df['wvapor'].max():.1f} g/kg")
    print(f"\n✅ 完成！")

if __name__ == '__main__':
    main()