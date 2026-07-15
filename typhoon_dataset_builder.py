#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
台风训练数据集构建工具
从CMA（中国气象局）最佳路径数据集下载原始数据，
解析1949~2025年西北太平洋台风路径，
清洗缺失关键字段的无效样本，构造标准化训练特征，
输出 typhoon_train_dataset.csv。

数据源: https://tcdata.typhoon.org.cn/data/CMABSTdata/CMABSTdata.rar
"""

import os
import csv
import sys
import json
import math
import re
import urllib.request
import glob
from datetime import datetime, timezone
from collections import defaultdict

# ============ 配置 ============
CMA_URL = "https://tcdata.typhoon.org.cn/data/CMABSTdata/CMABSTdata.rar"
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
RAR_CACHE = os.path.join(PROJECT_DIR, "raw_grib", "CMABSTdata.rar")
EXTRACT_DIR = os.path.join(PROJECT_DIR, "raw_grib", "CMABSTdata")
OUTPUT_CSV = os.path.join(PROJECT_DIR, "typhoon_train_dataset.csv")
SYNC_FILE = os.path.join(PROJECT_DIR, "last_sync_time.json")

# CMA 强度等级映射 (0-6)
CMA_GRADE_MAP = {
    0: 0,  # 热带低压
    1: 1,  # 热带风暴
    2: 2,  # 强热带风暴
    3: 3,  # 台风
    4: 4,  # 强台风
    5: 5,  # 超强台风
    6: 5,  # 超强台风
}

INTENSITY_NAMES = {
    0: "TD(热带低压)", 1: "TS(热带风暴)", 2: "STS(强热带风暴)",
    3: "TY(台风)", 4: "STY(强台风)", 5: "SuperTY(超强台风)"
}


def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}")


def update_sync_time():
    """更新last_sync_time.json"""
    sync_data = {"lastCMASync": datetime.now(timezone.utc).isoformat()}
    try:
        if os.path.exists(SYNC_FILE):
            with open(SYNC_FILE, "r") as f:
                existing = json.load(f)
                existing["lastCMASync"] = sync_data["lastCMASync"]
                sync_data = existing
        with open(SYNC_FILE, "w") as f:
            json.dump(sync_data, f, indent=2)
        log(f"已更新同步时间")
    except Exception as e:
        log(f"更新同步时间失败: {e}")


def download_cma_data():
    """下载CMABSTdata.rar"""
    if os.path.exists(RAR_CACHE):
        file_size = os.path.getsize(RAR_CACHE)
        if file_size > 100000:
            log(f"使用本地缓存: {RAR_CACHE} ({file_size/1024:.1f}KB)")
            return RAR_CACHE

    log("开始下载 CMABSTdata.rar...")
    raw_dir = os.path.dirname(RAR_CACHE)
    os.makedirs(raw_dir, exist_ok=True)

    try:
        req = urllib.request.Request(
            CMA_URL,
            headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read()
            with open(RAR_CACHE, "wb") as f:
                f.write(data)
        log(f"下载完成: {len(data)/1024:.1f}KB")
        return RAR_CACHE
    except Exception as e:
        log(f"下载失败: {e}")
        if os.path.exists(RAR_CACHE):
            return RAR_CACHE
        raise


def extract_rar(rar_path):
    """解压RAR文件"""
    if os.path.exists(EXTRACT_DIR) and len(os.listdir(EXTRACT_DIR)) > 70:
        log(f"使用已解压目录: {EXTRACT_DIR}")
        return EXTRACT_DIR

    os.makedirs(EXTRACT_DIR, exist_ok=True)
    log("解压RAR文件...")

    # 尝试 patoolib (通过系统已安装的7-Zip)
    try:
        import patoolib
        patoolib.extract_archive(rar_path, outdir=EXTRACT_DIR)
        log("解压完成 (patool + 7-Zip)")
        return EXTRACT_DIR
    except Exception:
        pass

    # 尝试 rarfile
    try:
        import rarfile
        rf = rarfile.RarFile(rar_path)
        rf.extractall(EXTRACT_DIR)
        rf.close()
        log("解压完成 (rarfile)")
        return EXTRACT_DIR
    except Exception as e:
        log(f"rarfile解压失败: {e}")

    log("警告: 无法解压RAR，请手动解压到 raw_grib/CMABSTdata/")
    return EXTRACT_DIR


def parse_cma_file(filepath):
    """
    解析单个CMA年份文件
    返回台风记录列表

    格式:
    头行: 66666 编号 记录数 序号 年号 0 等级 名称 日期
    数据行: YYYYMMDDHH 等级 纬度*10 经度*10 气压 风速
    """
    storms = []
    current_storm = None

    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n\r")
            if not line.strip():
                continue

            parts = line.split()
            if not parts:
                continue

            # 头行: 以66666开头
            if parts[0] == "66666":
                # 保存前一个风暴
                if current_storm and len(current_storm["records"]) >= 3:
                    storms.append(current_storm)

                if len(parts) >= 8:
                    storm_id = parts[1]  # e.g. 2501
                    try:
                        record_count = int(parts[2])
                    except ValueError:
                        record_count = 0
                    try:
                        grade = int(parts[6]) if len(parts) > 6 else 0
                    except ValueError:
                        grade = 0
                    # 名称在parts[7]，可能包含空格后的日期
                    name = parts[7] if len(parts) > 7 else "(nameless)"
                    # 年份
                    year = 2000 + int(storm_id[:2]) if storm_id[:2].isdigit() else 0

                    current_storm = {
                        "storm_id": storm_id,
                        "year": year,
                        "name": name,
                        "max_grade": grade,
                        "records": [],
                        "record_count": record_count,
                    }
                else:
                    current_storm = None
                continue

            # 数据行
            if current_storm is None:
                continue

            if len(parts) < 6:
                continue

            try:
                datetime_str = parts[0]  # YYYYMMDDHH
                grade = int(parts[1])
                lat_raw = int(parts[2])
                lon_raw = int(parts[3])
                pressure = int(parts[4])
                wind_speed = int(parts[5])
            except (ValueError, IndexError):
                continue

            # 经纬度转换 (度*10 → 度)
            lat = lat_raw / 10.0
            lon = lon_raw / 10.0

            # 经度统一到0-360
            if lon < 0:
                lon += 360

            # 解析时间
            if len(datetime_str) >= 10:
                yr = int(datetime_str[:4])
                mo = int(datetime_str[4:6])
                dy = int(datetime_str[6:8])
                hr = int(datetime_str[8:10])
            else:
                continue

            # 过滤无效数据
            if lat < 0 or lat > 60:
                continue
            if lon < 100 or lon > 200:
                continue
            if pressure < 850 or pressure > 1050:
                continue
            if wind_speed < 0 or wind_speed > 120:
                continue

            # 构建ISO时间
            iso_time = f"{yr:04d}-{mo:02d}-{dy:02d}T{hr:02d}:00:00"

            intensity = CMA_GRADE_MAP.get(grade, 0)
            wind_ms = wind_speed  # CMA数据风速单位就是m/s

            current_storm["records"].append({
                "iso_time": iso_time,
                "lat": lat,
                "lon": lon,
                "wind_ms": wind_ms,
                "pressure": pressure,
                "intensity": intensity,
                "grade": grade,
                "year": yr,
                "month": mo,
                "day": dy,
                "hour": hr,
            })

    # 保存最后一个风暴
    if current_storm and len(current_storm["records"]) >= 3:
        storms.append(current_storm)

    return storms


def parse_all_cma_files(extract_dir):
    """解析所有CMA年份文件"""
    log("开始解析CMA数据文件...")

    # 查找所有 CH{年份}BST.txt 文件
    pattern = os.path.join(extract_dir, "CH*BST.txt")
    files = sorted(glob.glob(pattern))

    log(f"找到 {len(files)} 个数据文件")

    all_storms = []
    total_records = 0
    total_storms_before = 0

    for filepath in files:
        fname = os.path.basename(filepath)
        storms = parse_cma_file(filepath)
        rec_count = sum(len(s["records"]) for s in storms)
        total_storms_before += len(storms)
        total_records += rec_count
        all_storms.extend(storms)
        log(f"  {fname}: {len(storms)} 个台风, {rec_count} 条记录")

    # 按storm_id去重（同一个台风可能跨年份文件...但CMA数据应该不会）
    # 实际上CMA按年份分文件，每个台风只在一个文件中

    log(f"总计: {len(all_storms)} 个台风, {total_records} 条记录")
    return all_storms


def build_training_dataset(storms):
    """
    构建标准化训练特征
    输出: storm_id, year, name, step, iso_time, lat, lon, wind_ms, pressure, intensity, dlat, dlon, dwind, dpressure
    每个风暴的连续记录点构成训练样本
    """
    log("开始构建训练特征...")

    all_records = []
    skipped_short = 0
    total_storms = 0

    for storm in storms:
        records = storm["records"]
        if len(records) < 3:
            skipped_short += 1
            continue

        total_storms += 1

        for i, rec in enumerate(records):
            if i > 0:
                prev = records[i - 1]
                dlat = round(rec["lat"] - prev["lat"], 2)
                dlon = round(rec["lon"] - prev["lon"], 2)
                dwind = round(rec["wind_ms"] - prev["wind_ms"], 1)
                dpressure = round(rec["pressure"] - prev["pressure"], 1)
            else:
                dlat = 0
                dlon = 0
                dwind = 0
                dpressure = 0

            all_records.append({
                "storm_id": storm["storm_id"],
                "year": rec["year"],
                "name": storm["name"],
                "step": i,
                "iso_time": rec["iso_time"],
                "lat": round(rec["lat"], 2),
                "lon": round(rec["lon"], 2),
                "wind_ms": round(rec["wind_ms"], 1),
                "pressure": round(rec["pressure"], 1),
                "intensity": rec["intensity"],
                "dlat": dlat,
                "dlon": dlon,
                "dwind": dwind,
                "dpressure": dpressure,
            })

    log(f"有效风暴数: {total_storms}")
    log(f"跳过短序列风暴: {skipped_short}")
    log(f"训练样本总数: {len(all_records)}")

    return all_records


def write_csv(records, output_path):
    """写入CSV文件"""
    log(f"写入CSV: {output_path}")

    fieldnames = [
        "storm_id", "year", "name", "step",
        "iso_time", "lat", "lon", "wind_ms", "pressure", "intensity",
        "dlat", "dlon", "dwind", "dpressure"
    ]

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for rec in records:
            writer.writerow({k: rec.get(k, "") for k in fieldnames})

    file_size = os.path.getsize(output_path)
    log(f"输出完成: {output_path} ({file_size/1024/1024:.1f}MB)")
    log(f"共计 {len(records)} 条训练样本")


def print_summary(records, storms):
    """打印数据摘要"""
    if not records:
        log("无有效数据")
        return

    years = set(r["year"] for r in records if r["year"] > 0)
    years_range = f"{min(years)}-{max(years)}" if years else "未知"

    winds = [r["wind_ms"] for r in records]
    pressures = [r["pressure"] for r in records]
    intensities = [r["intensity"] for r in records]

    intensity_dist = defaultdict(int)
    for i in intensities:
        intensity_dist[i] += 1

    log("\n========== 数据集摘要 ==========")
    log(f"数据年份范围: {years_range}")
    log(f"台风总数: {len(storms)}")
    log(f"总样本数: {len(records)}")
    log(f"风速范围: {min(winds):.1f} - {max(winds):.1f} m/s")
    log(f"气压范围: {min(pressures):.1f} - {max(pressures):.1f} hPa")
    log(f"\n强度分布:")
    for idx in sorted(intensity_dist.keys()):
        name = INTENSITY_NAMES.get(idx, f"未知({idx})")
        count = intensity_dist[idx]
        pct = count / len(records) * 100
        log(f"  {name}: {count:>6} ({pct:.1f}%)")
    log("==============================\n")


def main():
    log("=" * 60)
    log("CMA台风训练数据集构建工具")
    log("数据源: 中国气象局最佳路径数据集 (1949-2025)")
    log("=" * 60)

    try:
        # 1. 下载RAR
        rar_path = download_cma_data()

        # 2. 解压
        extract_dir = extract_rar(rar_path)

        # 3. 解析所有年份文件
        storms = parse_all_cma_files(extract_dir)

        if not storms:
            log("警告: 未找到有效的台风数据")
            write_csv([], OUTPUT_CSV)
            return

        # 4. 构建训练特征
        records = build_training_dataset(storms)

        # 5. 输出CSV
        write_csv(records, OUTPUT_CSV)

        # 6. 打印摘要
        print_summary(records, storms)

        # 7. 更新同步时间
        update_sync_time()

        log("数据集构建完成！")

    except Exception as e:
        log(f"运行失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()