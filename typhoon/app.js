/**
 * 台风模拟预测系统 - 后端服务
 * 基于 Node.js + Express + EJS
 * 全部使用免费无密钥气象API
 * 
 * 可独立运行 (node typhoon/app.js) 或挂载至现有 Express 项目
 * 
 * 数据接口:
 *   /api/real-typhoon    - 中央气象台真实台风数据
 *   /api/marine-weather   - Open-Meteo 海洋气象数据
 *   /api/gfs              - GFS 500hPa 副高数据
 *   /api/location-weather - GPS定位点天气
 * 
 * 台风推演算法:
 *   6小时步长迭代，受洋流+副高+海面风场驱动
 *   强度随海温/陆地自动升降，登陆预判
 */

'use strict';

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const geolib = require('geolib');
const path = require('path');
const fs = require('fs-extra');
const { CronJob } = require('cron');

// ============ GFS同步配置 ============
const GFS_CONFIG = {
  // GFS DODS 数据源模板
  DODS_URL: 'https://nomads.ncep.noaa.gov/dods/gfs_0p25/gfs{DATE}/gfs_0p25_{HH}z.ascii?{VAR}{DIMS}',
  // 西北太平洋裁剪范围
  NWP: { minLat: 5, maxLat: 45, minLon: 100, maxLon: 160 },
  // 输出目录
  OUTPUT_DIR: path.join(__dirname, '..', 'static', 'weather'),
  RAW_DIR: path.join(__dirname, '..', 'raw_grib'),
  // 持久化文件
  SYNC_FILE: path.join(__dirname, '..', 'last_sync_time.json'),
  // 重试配置
  RETRY: { maxAttempts: 3, delayMs: 5000 },
  // 清理阈值（3天）
  CLEANUP_DAYS: 3,
  // 分辨率增量
  RES_INC: 0.25
};

// ============ 配置 ============
const CONFIG = {
  // 西北太平洋网格范围（用于GFS和海洋数据查询）
  NWP_BBOX: { minLat: 5, maxLat: 45, minLon: 100, maxEon: 160, step: 5 },
  // 台风迭代参数
  TYPHOON: {
    STEP_HOURS: 6,            // 每步小时数
    MAX_STEPS: 60,            // 最大迭代步数（15天，曲线路径更短）
    SST_THRESHOLD: 26.5,      // 海温阈值（°C）
    LAND_WEAKEN_FACTOR: 0.88, // 陆地衰减系数（每次衰减12%，台风登陆后渐近消散）
    INTENSIFY_FACTOR: 0.97,   // 增强系数（气压降低）
    MAX_WIND: 85,             // 最大风速上限（m/s）
    MIN_PRESSURE: 870,        // 最低气压上限（hPa）
    BETA_DRIFT_LAT: 2.0,      // β漂移速度（纬度/天，北半球向西）
    BETA_DRIFT_LON: 1.5       // β漂移速度（经度/天，北半球向北）
  }
};

// ============ 中国沿海城市坐标（用于地图标注） ============
const COASTAL_CITIES = [
  { name: '温州', lat: 28.0, lon: 120.7 },
  { name: '台州', lat: 28.7, lon: 121.4 },
  { name: '宁波', lat: 29.9, lon: 121.5 },
  { name: '上海', lat: 31.2, lon: 121.5 },
  { name: '杭州', lat: 30.3, lon: 120.2 },
  { name: '福州', lat: 26.1, lon: 119.3 },
  { name: '厦门', lat: 24.5, lon: 118.1 },
  { name: '广州', lat: 23.1, lon: 113.3 },
  { name: '深圳', lat: 22.5, lon: 114.1 },
  { name: '珠海', lat: 22.3, lon: 113.6 },
  { name: '海口', lat: 20.0, lon: 110.3 },
  { name: '三亚', lat: 18.3, lon: 109.5 },
  { name: '青岛', lat: 36.1, lon: 120.4 },
  { name: '大连', lat: 38.9, lon: 121.6 },
  { name: '天津', lat: 39.1, lon: 117.2 },
  { name: '香港', lat: 22.3, lon: 114.2 },
  { name: '台北', lat: 25.0, lon: 121.5 },
  { name: '高雄', lat: 22.6, lon: 120.3 },
  { name: '厦门', lat: 24.5, lon: 118.1 },
  { name: '泉州', lat: 24.9, lon: 118.6 },
  { name: '漳州', lat: 24.5, lon: 117.7 },
  { name: '汕头', lat: 23.4, lon: 116.7 },
  { name: '湛江', lat: 21.3, lon: 110.4 },
  { name: '北海', lat: 21.5, lon: 109.1 },
  { name: '连云港', lat: 34.6, lon: 119.2 },
  { name: '盐城', lat: 33.4, lon: 120.1 },
  { name: '南通', lat: 32.0, lon: 120.9 },
  { name: '舟山', lat: 30.0, lon: 122.2 },
  { name: '嘉兴', lat: 30.8, lon: 120.8 },
  { name: '宁德', lat: 26.7, lon: 119.5 }
];

// ============ 简易陆地检测（区分大陆/岛屿） ============
// 将中国大陆拆分为多个窄经度条，排除东海/黄海/南海等海洋区域
const LAND_BBOXES = [
  // 华南（广东/广西/云南）
  { minLat: 18, maxLat: 24, minLon: 108, maxLon: 117 },
  // 华南（福建/广东沿海）
  { minLat: 22, maxLat: 26, minLon: 117, maxLon: 120.5 },
  // 华东（福建/江西/湖南/湖北南部）
  { minLat: 25, maxLat: 30, minLon: 108, maxLon: 118 },
  // 福建沿海（26-28°N，海岸线约119.5-120.5°E）
  { minLat: 26, maxLat: 28, minLon: 118, maxLon: 120.5 },
  // 浙江沿海（28-30°N，海岸线约121-122°E，含舟山群岛）
  { minLat: 28, maxLat: 30, minLon: 118, maxLon: 122 },
  // 上海/江苏南部（30-32°N，海岸线约121-122°E）
  { minLat: 30, maxLat: 32, minLon: 118, maxLon: 122 },
  // 江苏北部沿海（32-34°N，海岸线约119.5-121°E）
  { minLat: 32, maxLat: 34, minLon: 118, maxLon: 121.5 },
  // 山东沿海（34-36°N，海岸线约119.5-121.5°E）
  { minLat: 34, maxLat: 36, minLon: 119, maxLon: 121.5 },
  // 华北（山东/河北/北京/辽宁）
  { minLat: 35, maxLat: 42, minLon: 108, maxLon: 122 },
  // 海南岛
  { minLat: 18, maxLat: 20.5, minLon: 108.5, maxLon: 111.5 },
  // 日本
  { minLat: 30, maxLat: 45, minLon: 129, maxLon: 146 },
  // 朝鲜半岛
  { minLat: 34, maxLat: 42, minLon: 124, maxLon: 130 },
  // 菲律宾
  { minLat: 14, maxLat: 18.5, minLon: 120, maxLon: 122.5 },
  { minLat: 10, maxLat: 14, minLon: 122, maxLon: 125.5 },
  { minLat: 5, maxLat: 10, minLon: 124, maxLon: 126.5 },
  { minLat: 8, maxLat: 12, minLon: 117, maxLon: 119.5 },
  // 中南半岛
  { minLat: 8, maxLat: 22, minLon: 100, maxLon: 110 }
];

// 岛屿检测（台湾、菲律宾等，减速但不触发登陆停止）
const ISLAND_BBOXES = [
  // 台湾
  { minLat: 22, maxLat: 25.5, minLon: 120, maxLon: 122 },
  // 菲律宾北部（吕宋岛额外）
  { minLat: 14, maxLat: 18.5, minLon: 119, maxLon: 122.5 }
];

function isLand(lat, lon) {
  for (const b of LAND_BBOXES) {
    if (lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon) {
      return true;
    }
  }
  return false;
}

function isIsland(lat, lon) {
  for (const b of ISLAND_BBOXES) {
    if (lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon) {
      return true;
    }
  }
  return false;
}

// ============ 初始化 Express ============
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(cors());

// ============ 实时台风数据缓存（从浙江省水利厅API获取） ============
let realTyphoonCache = {
  data: null,
  time: 0,
  TTL: 10 * 60 * 1000 // 10分钟缓存
};

// 硬编码回退数据（API不可用时使用）
const FALLBACK_TYPHOON = {
  id: '2609',
  name: '巴威',
  track: [
    [7, 2, 8, 12.0, 140.0, 1000, 18, '热带低压'],
    [7, 5, 8, 15.0, 138.0, 990, 23, '热带风暴'],
    [7, 8, 8, 18.0, 135.0, 975, 30, '强热带风暴'],
    [7, 9, 8, 20.5, 132.0, 965, 35, '台风'],
    [7, 10, 8, 23.0, 128.0, 950, 42, '强台风'],
    [7, 10, 20, 24.5, 125.5, 945, 45, '强台风'],
    [7, 11, 8, 26.0, 123.0, 955, 40, '台风'],
    [7, 11, 14, 27.0, 122.0, 955, 40, '台风'],
    [7, 11, 23, 28.1, 121.2, 955, 40, '台风'],
    [7, 12, 0, 28.3, 121.0, 960, 38, '台风'],
    [7, 12, 5, 29.3, 120.0, 970, 30, '强热带风暴'],
    [7, 12, 8, 29.9, 119.8, 982, 28, '强热带风暴'],
    [7, 12, 14, 30.5, 119.5, 988, 25, '热带风暴'],
    [7, 12, 17, 31.0, 119.2, 990, 23, '热带风暴'],
    [7, 12, 20, 31.5, 118.8, 992, 22, '热带低压'],
    [7, 13, 5, 32.3, 118.5, 996, 18, '热带低压'],
    [7, 13, 14, 33.2, 118.8, 998, 16, '热带低压'],
    [7, 14, 0, 34.0, 119.5, 1000, 14, '热带低压'],
    [7, 14, 12, 34.8, 120.8, 1002, 12, '温带气旋'],
    [7, 15, 0, 35.5, 122.5, 1005, 10, '温带气旋'],
  ]
};

/**
 * 从浙江省水利厅实时API获取台风数据
 * API: https://typhoon.slt.zj.gov.cn/Api/TyphoonInfo/{tfid}
 */
async function fetchRealTyphoon() {
  if (realTyphoonCache.data && (Date.now() - realTyphoonCache.time) < realTyphoonCache.TTL) {
    return realTyphoonCache.data;
  }

  try {
    const resp = await fetch('https://typhoon.slt.zj.gov.cn/Api/TyphoonInfo/202609', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });
    const data = await resp.json();
    if (data && data.points && data.points.length > 0) {
      realTyphoonCache.data = data;
      realTyphoonCache.time = Date.now();
      console.log(`[实时台风] 已获取 ${data.points.length} 个路径点, 最新: ${data.points[data.points.length-1].time}`);
      return data;
    }
  } catch (e) {
    console.warn('[实时台风] API获取失败:', e.message);
  }
  return null;
}

// ============ 获取当前已知台风 ============
async function getKnownTyphoon(now) {
  // 优先从实时API获取
  const realData = await fetchRealTyphoon();

  if (realData && realData.points) {
    const points = realData.points;
    // 找到当前时间最近的实况点（forecast !== '1' 为实况点）
    const actualPoints = points.filter(p => p.forecast !== '1' && p.speed && p.speed !== '0');
    if (actualPoints.length > 0) {
      // 找到当前时间最近的点
      const nowTime = now.getTime();
      let closest = actualPoints[0];
      let minDiff = Infinity;
      for (const pt of actualPoints) {
        const ptTime = new Date(pt.time.replace(' ', 'T') + '+08:00').getTime();
        const diff = Math.abs(ptTime - nowTime);
        if (diff < minDiff) {
          minDiff = diff;
          closest = pt;
        }
      }

      // 找到最新预报点（中国预报）
      let forecastPoints = [];
      if (closest.forecast) {
        const cnForecast = closest.forecast.find(f => f.tm === '中国');
        if (cnForecast && cnForecast.forecastpoints) {
          forecastPoints = cnForecast.forecastpoints.slice(1).map(fp => ({
            lat: parseFloat(fp.lat),
            lon: parseFloat(fp.lng),
            pressure: parseInt(fp.pressure) || 998,
            windSpeed: parseInt(fp.speed) || 18,
            windLevel: fp.strong || '热带低压',
            time: new Date(fp.time.replace(' ', 'T') + '+08:00').toISOString()
          }));
        }
      }

      const lat = parseFloat(closest.lat);
      const lon = parseFloat(closest.lng);
      const windSpeed = parseInt(closest.speed) || 20;
      const pressure = parseInt(closest.pressure) || 990;
      const windLevel = closest.strong || '热带风暴';
      const moveSpeed = parseInt(closest.movespeed) || 15;
      const moveDir = closest.movedirection || '北北西';

      // 风圈半径
      const radius7 = closest.radius7 ? parseInt(closest.radius7) : Math.round(150 + Math.max(0, windSpeed - 25) * 10);
      const radius10 = closest.radius10 ? parseInt(closest.radius10) : Math.round(80 + Math.max(0, windSpeed - 25) * 5);
      const radius12 = closest.radius12 ? parseInt(closest.radius12) : Math.round(30 + Math.max(0, windSpeed - 25) * 3);

      return {
        id: realData.tfid || '2609',
        name: realData.name || '巴威',
        lat: Math.round(lat * 10) / 10,
        lon: Math.round(lon * 10) / 10,
        pressure: Math.round(pressure),
        windSpeed: Math.round(windSpeed),
        windLevel: windLevel.trim() || '热带风暴',
        power: closest.power || '9',
        radius7: Math.max(50, radius7),
        radius10: Math.max(20, radius10),
        radius12: Math.max(10, radius12),
        moveSpeed: moveSpeed,
        moveDir: moveDir,
        ckposition: closest.ckposition || null,
        jl: closest.jl || null,
        forecast: forecastPoints,
        dataSource: '浙江省水利厅实时台风API'
      };
    }
  }

  // 回退到硬编码数据
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hour = now.getHours();

  const typhoon = FALLBACK_TYPHOON;
  let before = null, after = null;
  for (const pt of typhoon.track) {
    const ptTime = pt[0] * 100 + pt[1] * 1 + pt[2] / 24;
    const curTime = month * 100 + day * 1 + hour / 24;
    if (ptTime <= curTime) before = pt;
    if (ptTime >= curTime && after === null) after = pt;
  }

  if (!before) return null;

  const interpolate = (a, b, t) => a + (b - a) * t;
  let lat, lon, pressure, windSpeed, windLevel;

  if (after && before !== after) {
    const bTime = before[0] * 100 + before[1] * 1 + before[2] / 24;
    const aTime = after[0] * 100 + after[1] * 1 + after[2] / 24;
    const curTime = month * 100 + day * 1 + hour / 24;
    const t = aTime > bTime ? (curTime - bTime) / (aTime - bTime) : 0;
    lat = interpolate(before[3], after[3], t);
    lon = interpolate(before[4], after[4], t);
    pressure = Math.round(interpolate(before[5], after[5], t));
    windSpeed = Math.round(interpolate(before[6], after[6], t) * 10) / 10;
    windLevel = after[7] || before[7];
  } else {
    lat = before[3]; lon = before[4];
    pressure = before[5]; windSpeed = before[6]; windLevel = before[7];
  }

  const forecast = [];
  const futurePoints = typhoon.track.filter(pt => {
    const ptTime = pt[0] * 100 + pt[1] * 1 + pt[2] / 24;
    const curTime = month * 100 + day * 1 + hour / 24;
    return ptTime > curTime + 0.01;
  });
  for (let i = 0; i < Math.min(8, futurePoints.length); i++) {
    const pt = futurePoints[i];
    forecast.push({
      lat: Math.round(pt[3] * 10) / 10, lon: Math.round(pt[4] * 10) / 10,
      pressure: pt[5], windSpeed: pt[6], windLevel: pt[7],
      time: new Date(2026, pt[0] - 1, pt[1], pt[2], 0, 0).toISOString()
    });
  }
  if (forecast.length === 0) {
    let fLat = lat, fLon = lon, fPressure = pressure, fWind = windSpeed;
    for (let i = 0; i < 6; i++) {
      fLat += 1.0; fLon -= 0.5; fPressure += 5; fWind = Math.max(10, fWind - 2);
      forecast.push({
        lat: Math.round(fLat * 10) / 10, lon: Math.round(fLon * 10) / 10,
        pressure: Math.round(fPressure), windSpeed: Math.round(fWind),
        windLevel: fWind >= 17.2 ? '强热带风暴' : fWind >= 10.8 ? '热带风暴' : '热带低压',
        time: new Date(now.getTime() + (i + 1) * 12 * 3600000).toISOString()
      });
    }
  }

  return {
    id: typhoon.id, name: typhoon.name,
    lat: Math.round(lat * 10) / 10, lon: Math.round(lon * 10) / 10,
    pressure: Math.round(pressure), windSpeed: Math.round(windSpeed), windLevel,
    radius7: Math.max(50, Math.round(150 + Math.max(0, windSpeed - 25) * 10)),
    radius10: Math.max(20, Math.round(80 + Math.max(0, windSpeed - 25) * 5)),
    radius12: Math.max(10, Math.round(30 + Math.max(0, windSpeed - 25) * 3)),
    moveSpeed: 20 + Math.round(Math.random() * 5),
    moveDir: 315 + Math.round(Math.random() * 10 - 5),
    forecast,
    dataSource: '硬编码回退数据'
  };
}

// ============ API 1: 实时台风数据 ============
app.get('/api/real-typhoon', async (req, res) => {
  try {
    const now = new Date();
    const knownTyphoon = await getKnownTyphoon(now);

    if (knownTyphoon) {
      res.json({
        success: true,
        typhoonList: [{
          id: knownTyphoon.id,
          name: knownTyphoon.name,
          lat: knownTyphoon.lat,
          lon: knownTyphoon.lon,
          pressure: knownTyphoon.pressure,
          windSpeed: knownTyphoon.windSpeed,
          windLevel: knownTyphoon.windLevel,
          power: knownTyphoon.power,
          radius7: knownTyphoon.radius7,
          radius10: knownTyphoon.radius10,
          radius12: knownTyphoon.radius12,
          time: now.toISOString(),
          moveSpeed: knownTyphoon.moveSpeed,
          moveDir: knownTyphoon.moveDir,
          ckposition: knownTyphoon.ckposition,
          jl: knownTyphoon.jl,
          dataSource: knownTyphoon.dataSource
        }],
        forecast: knownTyphoon.forecast,
        updateTime: now.toISOString(),
        dataSource: knownTyphoon.dataSource,
        note: knownTyphoon.ckposition
          ? `参考位置: ${knownTyphoon.ckposition}`
          : knownTyphoon.jl
          ? `未来趋势: ${knownTyphoon.jl}`
          : `基于${knownTyphoon.dataSource}`
      });
    } else {
      res.json({
        success: true,
        typhoonList: [],
        forecast: [],
        updateTime: now.toISOString(),
        dataSource: '暂无数据',
        note: '当前无活跃台风'
      });
    }
  } catch (err) {
    console.error('获取台风数据异常:', err.message);
    // 最终兜底：生成模拟数据
    const now = new Date();
    const baseLat = 16; const baseLon = 128;
    const forecast = [];
    for (let i = 0; i < 6; i++) {
      forecast.push({
        lat: Math.round((baseLat + 2.0 + i * 2.0) * 10) / 10,
        lon: Math.round((baseLon - 1.8 - i * 1.8) * 10) / 10,
        pressure: 960 - i * 2, windSpeed: 35 - i * 2,
        time: new Date(now.getTime() + (i + 1) * 12 * 3600000).toISOString()
      });
    }
    res.json({
      success: true,
      typhoonList: [{ id: 'ERR', name: '数据异常', lat: baseLat, lon: baseLon,
        pressure: 965, windSpeed: 35, radius7: 200, radius10: 100, radius12: 40,
        time: now.toISOString(), moveSpeed: 18, moveDir: 315 }],
      forecast, dataSource: '模拟数据（兜底）',
      note: '实时API获取失败，使用模拟数据'
    });
  }
});

// ============ API 2: 海洋气象数据（Open-Meteo） ============
app.get('/api/marine-weather', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    const queryLat = parseFloat(lat) || 25;
    const queryLon = parseFloat(lon) || 125;

    let weather = { current: {}, hourly: [], daily: [] };
    let marine = { current: {}, hourly: [] };
    let weatherFetched = false;
    let marineFetched = false;

    // 尝试请求天气数据
    try {
      const weatherResp = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
          latitude: queryLat,
          longitude: queryLon,
          current: ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'wind_speed_10m', 'wind_direction_10m', 'surface_pressure', 'weather_code', 'precipitation'],
          hourly: ['temperature_2m', 'precipitation_probability', 'precipitation', 'wind_speed_10m', 'wind_direction_10m', 'weather_code'],
          daily: ['temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max', 'precipitation_sum', 'wind_speed_10m_max', 'wind_direction_10m_dominant', 'weather_code'],
          timezone: 'Asia/Shanghai',
          forecast_days: 7
        },
        timeout: 8000
      });
      const wd = weatherResp.data;
      if (wd.current) {
        weather.current = {
          temperature: wd.current.temperature_2m,
          apparentTemp: wd.current.apparent_temperature,
          humidity: wd.current.relative_humidity_2m,
          windSpeed: wd.current.wind_speed_10m,
          windDirection: wd.current.wind_direction_10m,
          pressure: wd.current.surface_pressure,
          weatherCode: wd.current.weather_code,
          precipitation: wd.current.precipitation
        };
      }
      if (wd.hourly && wd.hourly.time) {
        for (let i = 0; i < wd.hourly.time.length; i++) {
          weather.hourly.push({
            time: wd.hourly.time[i],
            temperature: wd.hourly.temperature_2m?.[i],
            precip: wd.hourly.precipitation?.[i],
            precipProb: wd.hourly.precipitation_probability?.[i],
            windSpeed: wd.hourly.wind_speed_10m?.[i],
            windDirection: wd.hourly.wind_direction_10m?.[i],
            weatherCode: wd.hourly.weather_code?.[i]
          });
        }
      }
      if (wd.daily && wd.daily.time) {
        for (let i = 0; i < wd.daily.time.length; i++) {
          weather.daily.push({
            date: wd.daily.time[i],
            tempMax: wd.daily.temperature_2m_max?.[i],
            tempMin: wd.daily.temperature_2m_min?.[i],
            precipProb: wd.daily.precipitation_probability_max?.[i],
            precipSum: wd.daily.precipitation_sum?.[i],
            windSpeedMax: wd.daily.wind_speed_10m_max?.[i],
            windDirection: wd.daily.wind_direction_10m_dominant?.[i],
            weatherCode: wd.daily.weather_code?.[i]
          });
        }
      }
      weatherFetched = true;
    } catch (e) {
      console.warn('天气数据获取失败，使用模拟数据:', e.message);
    }

    // 尝试请求海洋数据
    try {
      const marineResp = await axios.get('https://marine-api.open-meteo.com/v1/marine', {
        params: {
          latitude: queryLat,
          longitude: queryLon,
          current: ['ocean_current_velocity', 'ocean_current_direction', 'sea_surface_temperature', 'sea_surface_height'],
          hourly: ['ocean_current_velocity', 'ocean_current_direction', 'sea_surface_temperature'],
          timezone: 'Asia/Shanghai',
          forecast_days: 7
        },
        timeout: 8000
      });
      const md = marineResp.data;
      if (md.current) {
        marine.current = {
          currentVelocity: md.current.ocean_current_velocity,
          currentDirection: md.current.ocean_current_direction,
          seaSurfaceTemp: md.current.sea_surface_temperature,
          seaSurfaceHeight: md.current.sea_surface_height
        };
      }
      if (md.hourly && md.hourly.time) {
        for (let i = 0; i < md.hourly.time.length; i++) {
          marine.hourly.push({
            time: md.hourly.time[i],
            currentVelocity: md.hourly.ocean_current_velocity?.[i],
            currentDirection: md.hourly.ocean_current_direction?.[i],
            seaSurfaceTemp: md.hourly.sea_surface_temperature?.[i]
          });
        }
      }
      marineFetched = true;
    } catch (e) {
      console.warn('海洋数据获取失败，使用模拟数据:', e.message);
    }

    // 生成模拟数据（如果获取失败）
    if (!weatherFetched || Object.keys(weather.current).length === 0) {
      const baseTemp = 26 + (30 - queryLat) * 0.3;
      weather.current = {
        temperature: Math.round((baseTemp + Math.random() * 4) * 10) / 10,
        apparentTemp: Math.round((baseTemp + 2 + Math.random() * 3) * 10) / 10,
        humidity: Math.round(70 + Math.random() * 20),
        windSpeed: Math.round((4 + Math.random() * 8) * 10) / 10,
        windDirection: Math.round(150 + Math.random() * 120),
        pressure: Math.round(1005 + Math.random() * 10),
        weatherCode: Math.random() > 0.7 ? 1 : 0,
        precipitation: 0
      };
      // 生成7天预报
      const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const today = new Date();
      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        weather.daily.push({
          date: d.toISOString().split('T')[0],
          tempMax: Math.round((baseTemp + 2 + Math.random() * 3) * 10) / 10,
          tempMin: Math.round((baseTemp - 2 + Math.random() * 2) * 10) / 10,
          precipProb: Math.round(20 + Math.random() * 60),
          precipSum: Math.round(Math.random() * 10 * 10) / 10,
          windSpeedMax: Math.round((5 + Math.random() * 8) * 10) / 10,
          windDirection: Math.round(150 + Math.random() * 120),
          weatherCode: [0, 1, 2, 3, 61][Math.floor(Math.random() * 5)]
        });
      }
    }

    if (!marineFetched || Object.keys(marine.current).length === 0) {
      const sst = 26 + (25 - Math.abs(queryLat - 20)) * 0.4;
      marine.current = {
        currentVelocity: Math.round((0.2 + Math.random() * 0.6) * 100) / 100,
        currentDirection: Math.round(270 + (Math.random() - 0.5) * 60),
        seaSurfaceTemp: Math.round((sst + Math.random() * 2) * 10) / 10,
        seaSurfaceHeight: Math.round((0.3 + Math.random() * 0.5) * 100) / 100
      };
    }

    res.json({
      success: true,
      weather,
      marine,
      queryLat,
      queryLon,
      dataSource: weatherFetched && marineFetched ? 'Open-Meteo实况' : (weatherFetched ? '天气实况+海洋模拟' : marineFetched ? '海洋实况+天气模拟' : '模拟数据'),
      updateTime: new Date().toISOString()
    });
  } catch (err) {
    console.error('获取海洋气象数据异常:', err.message);
    const baseTemp = 26 + (30 - (parseFloat(req.query.lat) || 25)) * 0.3;
    const weatherDaily = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      weatherDaily.push({
        date: d.toISOString().split('T')[0],
        tempMax: Math.round(baseTemp + 3),
        tempMin: Math.round(baseTemp - 1),
        precipProb: 30,
        precipSum: 0,
        windSpeedMax: 8,
        windDirection: 180,
        weatherCode: 1
      });
    }
    res.json({
      success: true,
      weather: {
        current: { temperature: baseTemp, apparentTemp: baseTemp + 2, humidity: 78, windSpeed: 6, windDirection: 180, pressure: 1008, weatherCode: 1, precipitation: 0 },
        hourly: [],
        daily: weatherDaily
      },
      marine: {
        current: { currentVelocity: 0.4, currentDirection: 270, seaSurfaceTemp: 28.5, seaSurfaceHeight: 0.5 },
        hourly: []
      },
      queryLat: parseFloat(req.query.lat) || 25,
      queryLon: parseFloat(req.query.lon) || 125,
      dataSource: '模拟数据',
      updateTime: new Date().toISOString()
    });
  }
});

// ============ API 3: GFS 500hPa 副高数据 ============
app.get('/api/gfs', async (req, res) => {
  try {
    // 优先读取本地文件
    const hgtPath = path.join(__dirname, '..', 'static', 'weather', 'hgt500.json');
    if (fs.existsSync(hgtPath)) {
      const fileData = JSON.parse(fs.readFileSync(hgtPath, 'utf8'));
      if (fileData.success && fileData.gridData && fileData.gridData.length > 0) {
        return res.json({
          success: true,
          gridData: fileData.gridData,
          contour5880: fileData.contour5880 || [],
          avgHeight: fileData.subHigh?.avgHeight || 0,
          maxHeight: fileData.subHigh?.maxHeight || 0,
          minHeight: fileData.subHigh?.minHeight || 0,
          count588: fileData.subHigh?.count588 || 0,
          description: fileData.subHigh?.description || '--',
          ridgeLat: fileData.subHigh?.ridgeLat || 0,
          dataSource: fileData.dataSource || '本地GFS数据',
          updateTime: fileData.updateTime || new Date().toISOString()
        });
      }
    }

    // 文件不存在或无法解析，生成模拟数据（基于7月气候特征）
    const mockGrid = [];
    for (let lat = 15; lat <= 40; lat += 5) {
      for (let lon = 110; lon <= 155; lon += 5) {
        let h = 5820;
        if (lat >= 20 && lat <= 38 && lon >= 115 && lon <= 155) {
          const d = Math.sqrt(Math.pow((lat - 28) / 10, 2) + Math.pow((lon - 135) / 25, 2));
          h = 5920 - d * 120;
        }
        mockGrid.push({ lat, lon, height: Math.round(h) });
      }
    }
    const highPts = mockGrid.filter(p => p.height >= 5880);
    const c5880 = [];
    if (highPts.length > 0) {
      const mlat = Math.max(...highPts.map(p => p.lat));
      const mlon = Math.max(...highPts.map(p => p.lon));
      const nlat = Math.min(...highPts.map(p => p.lat));
      const nlon = Math.min(...highPts.map(p => p.lon));
      for (let lon = nlon; lon <= mlon + 0.01; lon += 2.5) c5880.push({ lat: mlat, lon: Math.round(lon*10)/10 });
      for (let lat = mlat; lat >= nlat - 0.01; lat -= 2.5) c5880.push({ lat: Math.round(lat*10)/10, lon: mlon });
      for (let lon = mlon; lon >= nlon - 0.01; lon -= 2.5) c5880.push({ lat: nlat, lon: Math.round(lon*10)/10 });
      for (let lat = nlat; lat <= mlat + 0.01; lat += 2.5) c5880.push({ lat: Math.round(lat*10)/10, lon: nlon });
    }
    res.json({
      success: true,
      gridData: mockGrid,
      contour5880: c5880,
      avgHeight: 5850, maxHeight: 5940, minHeight: 5700,
      count588: highPts.length,
      description: highPts.length > 0 ? '副高脊线约位于北纬28°附近' : '副热带高压偏弱',
      dataSource: '模拟数据（无本地文件）',
      updateTime: new Date().toISOString()
    });
  } catch (err) {
    console.error('GFS数据处理失败:', err.message);
    res.json({
      success: true, gridData: [], contour5880: [],
      avgHeight: 5850, maxHeight: 5900, minHeight: 5800, count588: 0,
      description: '副高数据暂不可用', dataSource: '错误', updateTime: new Date().toISOString()
    });
  }
});

// ============ API 4: GPS定位点本地天气 ============
app.get('/api/location-weather', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ success: false, message: '请提供经纬度参数' });
    }
    const queryLat = parseFloat(lat);
    const queryLon = parseFloat(lon);

    const [weatherResp, marineResp] = await Promise.allSettled([
      axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
          latitude: queryLat,
          longitude: queryLon,
          current: ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'wind_speed_10m', 'wind_direction_10m', 'surface_pressure', 'weather_code', 'precipitation'],
          daily: ['temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max', 'precipitation_sum', 'wind_speed_10m_max', 'wind_direction_10m_dominant', 'weather_code', 'sunrise', 'sunset'],
          hourly: ['temperature_2m', 'precipitation_probability', 'weather_code', 'wind_speed_10m', 'wind_direction_10m'],
          timezone: 'Asia/Shanghai',
          forecast_days: 7
        },
        timeout: 10000
      }),
      axios.get('https://marine-api.open-meteo.com/v1/marine', {
        params: {
          latitude: queryLat,
          longitude: queryLon,
          current: ['ocean_current_velocity', 'ocean_current_direction', 'sea_surface_temperature'],
          timezone: 'Asia/Shanghai'
        },
        timeout: 10000
      })
    ]);

    const result = { location: { lat: queryLat, lon: queryLon }, current: {}, daily: [], hourly: [], marine: {} };

    if (weatherResp.status === 'fulfilled') {
      const wd = weatherResp.value.data;
      result.cityName = wd.timezone || '未知';
      if (wd.current) {
        result.current = {
          temperature: wd.current.temperature_2m,
          apparentTemp: wd.current.apparent_temperature,
          humidity: wd.current.relative_humidity_2m,
          windSpeed: wd.current.wind_speed_10m,
          windDirection: wd.current.wind_direction_10m,
          pressure: wd.current.surface_pressure,
          weatherCode: wd.current.weather_code,
          precipitation: wd.current.precipitation
        };
      }
      if (wd.daily) {
        for (let i = 0; i < (wd.daily.time || []).length; i++) {
          result.daily.push({
            date: wd.daily.time[i],
            tempMax: wd.daily.temperature_2m_max?.[i],
            tempMin: wd.daily.temperature_2m_min?.[i],
            precipProb: wd.daily.precipitation_probability_max?.[i],
            precipSum: wd.daily.precipitation_sum?.[i],
            windSpeedMax: wd.daily.wind_speed_10m_max?.[i],
            windDirection: wd.daily.wind_direction_10m_dominant?.[i],
            weatherCode: wd.daily.weather_code?.[i],
            sunrise: wd.daily.sunrise?.[i],
            sunset: wd.daily.sunset?.[i]
          });
        }
      }
      if (wd.hourly) {
        for (let i = 0; i < Math.min(48, (wd.hourly.time || []).length); i++) {
          result.hourly.push({
            time: wd.hourly.time[i],
            temperature: wd.hourly.temperature_2m?.[i],
            precipProb: wd.hourly.precipitation_probability?.[i],
            weatherCode: wd.hourly.weather_code?.[i],
            windSpeed: wd.hourly.wind_speed_10m?.[i],
            windDirection: wd.hourly.wind_direction_10m?.[i]
          });
        }
      }
    }

    if (marineResp.status === 'fulfilled') {
      const md = marineResp.value.data;
      if (md.current) {
        result.marine = {
          currentVelocity: md.current.ocean_current_velocity,
          currentDirection: md.current.ocean_current_direction,
          seaSurfaceTemp: md.current.sea_surface_temperature
        };
      }
    }

    res.json({ success: true, ...result, dataSource: (weatherResp.status === 'fulfilled' && marineResp.status === 'fulfilled') ? 'Open-Meteo实况' : (weatherResp.status === 'fulfilled' ? '天气实况+海洋模拟' : marineResp.status === 'fulfilled' ? '海洋实况+天气模拟' : '模拟数据') });
  } catch (err) {
    console.error('获取定位天气失败:', err.message);
    const queryLat = parseFloat(req.query.lat) || 25;
    const queryLon = parseFloat(req.query.lon) || 125;
    const baseTemp = 26 + (30 - queryLat) * 0.3;
    const daily = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      daily.push({
        date: d.toISOString().split('T')[0],
        tempMax: Math.round((baseTemp + 3) * 10) / 10,
        tempMin: Math.round((baseTemp - 1) * 10) / 10,
        precipProb: 30,
        precipSum: 0,
        windSpeedMax: 8,
        windDirection: 180,
        weatherCode: 1
      });
    }
    res.json({
      success: true,
      location: { lat: queryLat, lon: queryLon },
      current: { temperature: baseTemp, apparentTemp: baseTemp + 2, humidity: 78, windSpeed: 6, windDirection: 180, pressure: 1008, weatherCode: 1, precipitation: 0 },
      daily,
      hourly: [],
      marine: { currentVelocity: 0.4, currentDirection: 270, seaSurfaceTemp: 28.5 },
      dataSource: '模拟数据'
    });
  }
});

// ============ 天气数据缓存（海温+洋流，每20分钟更新） ============
const WEATHER_CACHE = {
  GRID_LATS: [10, 15, 20, 25, 30, 35, 40],
  GRID_LONS: [110, 115, 120, 125, 130, 135, 140, 145, 150],
  data: {}, // "lat,lon" → { sst, velocity, direction, timestamp }
  lastRefresh: 0,
  TTL: 20 * 60 * 1000,
  refreshing: false
};

/**
 * 刷新天气数据缓存（并行请求，每批10个）
 */
async function refreshWeatherCache() {
  if (WEATHER_CACHE.refreshing) return;
  WEATHER_CACHE.refreshing = true;
  const startTime = Date.now();
  console.log('[天气缓存] 开始更新海温/洋流数据...');

  const points = [];
  for (const lat of WEATHER_CACHE.GRID_LATS) {
    for (const lon of WEATHER_CACHE.GRID_LONS) {
      points.push({ lat, lon });
    }
  }

  // 分批并行请求，每批10个
  const BATCH_SIZE = 10;
  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    const batch = points.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map(async ({ lat, lon }) => {
      try {
        const resp = await axios.get('https://marine-api.open-meteo.com/v1/marine', {
          params: {
            latitude: lat,
            longitude: lon,
            current: ['ocean_current_velocity', 'ocean_current_direction', 'sea_surface_temperature'],
            timezone: 'Asia/Shanghai'
          },
          timeout: 10000
        });
        if (resp.data && resp.data.current) {
          const key = `${lat},${lon}`;
          WEATHER_CACHE.data[key] = {
            sst: resp.data.current.sea_surface_temperature,
            velocity: resp.data.current.ocean_current_velocity || 0,
            direction: resp.data.current.ocean_current_direction || 0,
            timestamp: Date.now()
          };
        }
      } catch (e) {
        // 请求失败时保留旧数据
      }
    }));
  }

  WEATHER_CACHE.lastRefresh = Date.now();
  WEATHER_CACHE.refreshing = false;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const count = Object.keys(WEATHER_CACHE.data).length;
  console.log(`[天气缓存] 更新完成: ${count} 个网格点, 耗时 ${elapsed}s`);
}

/**
 * 从缓存中查找最近网格点的天气数据
 */
function getCachedWeather(lat, lon) {
  let nearest = null;
  let minDist = Infinity;
  for (const [key, data] of Object.entries(WEATHER_CACHE.data)) {
    const [gLat, gLon] = key.split(',').map(Number);
    const dist = Math.sqrt((gLat - lat) ** 2 + (gLon - lon) ** 2);
    if (dist < minDist) {
      minDist = dist;
      nearest = data;
    }
  }
  return nearest;
}

/**
 * 启动天气数据缓存定时任务（每20分钟）
 */
function startWeatherCacheCron() {
  const job = new CronJob(
    '*/20 * * * *',
    async () => {
      console.log('[定时任务] 触发天气数据缓存更新...');
      await refreshWeatherCache();
    },
    null,
    true,
    'Asia/Shanghai'
  );
  console.log('天气数据缓存定时任务已启动 (每20分钟)');
  return job;
}

// ============ 台风推演算法核心 ============

/**
 * 获取某点的海洋表面温度（通过Open-Meteo Marine API + 缓存）
 */
async function fetchSST(lat, lon) {
  // 优先使用缓存
  const cached = getCachedWeather(lat, lon);
  if (cached && cached.sst !== undefined && cached.sst !== null) {
    return cached.sst;
  }
  // 缓存未命中，直接请求API
  try {
    const resp = await axios.get('https://marine-api.open-meteo.com/v1/marine', {
      params: {
        latitude: lat,
        longitude: lon,
        current: 'sea_surface_temperature',
        timezone: 'Asia/Shanghai'
      },
      timeout: 5000
    });
    if (resp.data && resp.data.current && resp.data.current.sea_surface_temperature !== null) {
      return resp.data.current.sea_surface_temperature;
    }
    // 根据纬度估算海温（西北太平洋夏季平均）
    return estimateSST(lat);
  } catch (e) {
    return estimateSST(lat);
  }
}

/**
 * 估算海温（基于纬度）
 */
function estimateSST(lat) {
  // 简单模型：赤道附近最高，随纬度递减
  const absLat = Math.abs(lat);
  if (absLat < 10) return 29 + Math.random() * 1.5;
  if (absLat < 20) return 28 + Math.random() * 1.5;
  if (absLat < 25) return 26 + Math.random() * 2;
  if (absLat < 30) return 24 + Math.random() * 2;
  if (absLat < 35) return 22 + Math.random() * 2;
  if (absLat < 40) return 19 + Math.random() * 2;
  return 16 + Math.random() * 2;
}

/**
 * 获取某点的洋流数据
 */
async function fetchOceanCurrent(lat, lon) {
  // 优先使用缓存
  const cached = getCachedWeather(lat, lon);
  if (cached && cached.velocity !== undefined) {
    return { velocity: cached.velocity, direction: cached.direction };
  }
  try {
    const resp = await axios.get('https://marine-api.open-meteo.com/v1/marine', {
      params: {
        latitude: lat,
        longitude: lon,
        current: ['ocean_current_velocity', 'ocean_current_direction'],
        timezone: 'Asia/Shanghai'
      },
      timeout: 5000
    });
    if (resp.data && resp.data.current) {
      return {
        velocity: resp.data.current.ocean_current_velocity || 0,
        direction: resp.data.current.ocean_current_direction || 0
      };
    }
    return { velocity: 0.2, direction: 270 + Math.random() * 20 };
  } catch (e) {
    return { velocity: 0.2, direction: 270 + Math.random() * 20 };
  }
}

/**
 * 获取某点的GFS 500hPa位势高度和风向（简化）
 */
async function fetchSteeringFlow(lat, lon) {
  try {
    const resp = await axios.get('https://api.open-meteo.com/v1/gfs', {
      params: {
        latitude: lat,
        longitude: lon,
        hourly: ['geopotential_height_500hPa', 'wind_speed_500hPa', 'wind_direction_500hPa'],
        timezone: 'Asia/Shanghai',
        forecast_hours: 24
      },
      timeout: 5000
    });
    if (resp.data && resp.data.hourly) {
      const idx = 0;
      return {
        height: resp.data.hourly.geopotential_height_500hPa?.[idx] || 5800,
        windSpeed: resp.data.hourly.wind_speed_500hPa?.[idx] || 5,
        windDirection: resp.data.hourly.wind_direction_500hPa?.[idx] || 270
      };
    }
    return { height: 5850 + Math.random() * 50, windSpeed: 5 + Math.random() * 3, windDirection: 90 + Math.random() * 20 };
  } catch (e) {
    return { height: 5850 + Math.random() * 50, windSpeed: 5 + Math.random() * 3, windDirection: 90 + Math.random() * 20 };
  }
}

/**
 * 计算风力等级（基于最大风速，m/s）
 */
function getWindLevel(windSpeed) {
  if (windSpeed < 10.8) return 6;
  if (windSpeed < 17.2) return 8;
  if (windSpeed < 24.5) return 10;
  if (windSpeed < 32.7) return 12;
  if (windSpeed < 41.5) return 14;
  if (windSpeed < 51.0) return 16;
  return 17;
}

/**
 * 根据风速估算风圈半径（km）
 */
function estimateWindRadius(windSpeed, level) {
  // 7级风圈（约17m/s）半径
  const baseRadius7 = 100 + windSpeed * 5;
  const baseRadius10 = 60 + windSpeed * 3;
  const baseRadius12 = 30 + windSpeed * 1.5;
  switch (level) {
    case 7: return { r7: Math.round(baseRadius7), r10: Math.round(baseRadius10 * 0.6), r12: Math.round(baseRadius12 * 0.3) };
    case 10: return { r7: Math.round(baseRadius7), r10: Math.round(baseRadius10), r12: Math.round(baseRadius12 * 0.5) };
    case 12: return { r7: Math.round(baseRadius7), r10: Math.round(baseRadius10), r12: Math.round(baseRadius12) };
    default: return { r7: Math.round(baseRadius7 * 0.5), r10: Math.round(baseRadius10 * 0.3), r12: Math.round(baseRadius12 * 0.1) };
  }
}

/**
 * 核心台风推演算法
 * @param {Object} params - 初始参数
 * @param {number} params.lat - 初始纬度
 * @param {number} params.lon - 初始经度
 * @param {number} params.pressure - 初始中心气压(hPa)
 * @param {number} params.windSpeed - 初始最大风速(m/s)
 * @returns {Object} 推演结果
 */
async function simulateTyphoon(params) {
  const { lat: initLat, lon: initLon, pressure: initPressure, windSpeed: initWind } = params;
  const steps = CONFIG.TYPHOON.MAX_STEPS;
  const stepHours = CONFIG.TYPHOON.STEP_HOURS;

  const trajectory = [];
  const events = [];
  let currentLat = initLat;
  let currentLon = initLon;
  let currentPressure = initPressure;
  let currentWind = initWind;
  let landed = false;
  let landfallPoint = null;
  let landfallTime = null;
  let landfallPressure = null;
  let landfallWind = null;

  // 记录登陆后的步数（用于停止条件判断）
  let landfallSteps = 0;
  let islandLanded = false; // 是否已过岛（台湾/菲律宾等）

  // 初始状态
  const startTime = new Date();
  trajectory.push({
    step: 0,
    lat: Math.round(currentLat * 100) / 100,
    lon: Math.round(currentLon * 100) / 100,
    pressure: Math.round(currentPressure),
    windSpeed: Math.round(currentWind * 10) / 10,
    windLevel: getWindLevel(currentWind),
    stage: 'initial',
    time: new Date(startTime.getTime() + 0 * stepHours * 3600000).toISOString(),
    radius: estimateWindRadius(currentWind, getWindLevel(currentWind))
  });

  // 逐6小时迭代
  for (let step = 1; step <= steps; step++) {
    // 获取当前点的环境数据
    const [sst, oceanCurrent, steeringFlow] = await Promise.all([
      fetchSST(currentLat, currentLon),
      fetchOceanCurrent(currentLat, currentLon),
      fetchSteeringFlow(currentLat, currentLon)
    ]);

    // 判断是否在陆地上（区分大陆和岛屿）
    const onLand = isLand(currentLat, currentLon);
    const onIsland = !onLand && isIsland(currentLat, currentLon);

    // ========== 移动计算 ==========
    // 台风移动 = 西北方向引导气流 + 洋流 + β漂移
    // 使用曲线路径模型：随纬度增加，方向从偏西逐渐转为偏北
    // 典型西北太平洋台风路径：先西行→西北行→北行→东北行
    // 低纬度(16°N): 偏西(285°)，避开菲律宾
    // 中纬度(20°N): 西北(305°)，指向台湾-福建
    // 高纬度(25°N): 偏北(325°)，指向浙江-江苏
    // 登陆后: 继续偏北(340°)，快速消散
    const latBase = 16; // 起始纬度
    const latRange = Math.max(0, currentLat - latBase);
    // 方向角随纬度平滑变化：285° → 305° → 325° → 340°
    const angleOffset = latRange * 2.5; // 每向北1°，转向2.5°
    let baseAngle = 285 + Math.min(angleOffset, 55); // 285°→340°
    // 陆地摩擦导致方向略微不稳定
    const terrainJitter = onLand ? 12 : (landed ? 6 : 0);
    // 添加随机波动（海面±8°，陆地±12°）
    const steerAngle = baseAngle + (Math.random() - 0.5) * (16 + terrainJitter);
    const steerRad = steerAngle * Math.PI / 180;
    // 移动速度：海面0.6-1.0°/6h（随强度增加），登陆后受摩擦减慢
    const speedBase = 0.6 + (currentWind / CONFIG.TYPHOON.MAX_WIND) * 0.4;
    const steerSpeed = onLand ? Math.max(0.2, speedBase * 0.6) : (landed ? Math.max(0.25, speedBase * 0.7) : Math.min(speedBase, 1.0));

    // 洋流影响（方向角：0°=北, 90°=东, 180°=南, 270°=西）
    const currentRad = oceanCurrent.direction * Math.PI / 180;
    // 洋流速度(m/s)转移动量(°/6h)：黑潮平均0.5-1.5m/s → 0.17-0.5°/6h
    const currentSpeed = oceanCurrent.velocity / 3;

    // β漂移（北半球向西北方向漂移，小量修正）
    const betaLat = CONFIG.TYPHOON.BETA_DRIFT_LAT * stepHours / 24 * 0.2;   // 向北
    const betaLon = -CONFIG.TYPHOON.BETA_DRIFT_LON * stepHours / 24 * 0.2;  // 向西

    // 合成移动分量
    // dLat = cos(dir) * speed（北分量）, dLon = sin(dir) * speed（东分量）
    let dLat = Math.cos(steerRad) * steerSpeed + Math.cos(currentRad) * currentSpeed + betaLat;
    let dLon = Math.sin(steerRad) * steerSpeed + Math.sin(currentRad) * currentSpeed + betaLon;

    // 更新位置
    currentLat += dLat;
    currentLon += dLon;

    // 边界限制（不超出西北太平洋范围）
    currentLat = Math.max(5, Math.min(45, currentLat));
    currentLon = Math.max(110, Math.min(180, currentLon));

    // ========== 强度计算 ==========
    // 先更新风速，再根据风速计算气压，确保两者一致
    if (onIsland) {
      // 岛屿过境（如台湾、菲律宾）：轻微衰减5%，触发岛屿登陆事件但不停模拟
      currentWind *= 0.95;
      // 第一次过岛时记录岛屿登陆事件
      if (!islandLanded) {
        islandLanded = true;
        events.push({
          type: 'island_landfall',
          step,
          lat: Math.round(currentLat * 100) / 100,
          lon: Math.round(currentLon * 100) / 100,
          time: new Date(startTime.getTime() + step * stepHours * 3600000).toISOString(),
          pressure: Math.round(1013 - 143 * Math.pow(Math.min(currentWind, 85) / 85, 1.5)),
          windSpeed: Math.round(currentWind * 10) / 10,
          description: `台风穿越 ${currentLat >= 22 && currentLat <= 25.5 && currentLon >= 120 && currentLon <= 122 ? '台湾' : '菲律宾'}，中心气压 ${currentPressure}hPa，最大风速 ${Math.round(currentWind * 10) / 10}m/s`
        });
      }
    } else if (onLand) {
      // 大陆陆地：快速衰减（每次衰减12%）
      currentWind *= CONFIG.TYPHOON.LAND_WEAKEN_FACTOR;
      landfallSteps++;
      if (!landed) {
        landed = true;
        landfallPoint = { lat: Math.round(currentLat * 100) / 100, lon: Math.round(currentLon * 100) / 100 };
        landfallTime = new Date(startTime.getTime() + step * stepHours * 3600000).toISOString();
        landfallPressure = Math.round(1013 - 143 * Math.pow(Math.min(currentWind, 85) / 85, 1.5));
        landfallWind = Math.round(currentWind * 10) / 10;
        events.push({
          type: 'landfall',
          step,
          lat: landfallPoint.lat,
          lon: landfallPoint.lon,
          time: landfallTime,
          pressure: landfallPressure,
          windSpeed: landfallWind,
          description: `台风在 ${landfallPoint.lat}°N, ${landfallPoint.lon}°E 附近登陆，中心气压 ${landfallPressure}hPa，最大风速 ${landfallWind}m/s`
        });
      }
    } else if (landed) {
      // 已登陆过：即使暂时离开陆地也持续微衰减
      // 台风结构已被陆地破坏，但短时间离陆不会恢复
      currentWind *= 0.96;
    } else {
      // 海洋：根据海温调整强度
      if (sst > CONFIG.TYPHOON.SST_THRESHOLD) {
        // 温暖海域：增强（更平缓的增长率）
        const intensifyRate = (sst - CONFIG.TYPHOON.SST_THRESHOLD) * 0.015;
        currentWind = Math.min(currentWind * (1 + intensifyRate), CONFIG.TYPHOON.MAX_WIND);
      } else {
        // 冷水域：减弱
        const weakenRate = (CONFIG.TYPHOON.SST_THRESHOLD - sst) * 0.02;
        currentWind = Math.max(currentWind * (1 - weakenRate), 10);
      }
    }

    // 根据风速计算气压（风压关系：P = 1013 - 143 * (V/85)^1.5）
    // 保证风速和气压物理一致，避免风弱气压低的不合理情况
    // 气压下限受陆地摩擦影响，登陆后最低可到990hPa以上
    currentPressure = 1013 - 143 * Math.pow(Math.min(Math.max(currentWind, 5), 85) / 85, 1.5);
    currentPressure = Math.max(currentPressure, CONFIG.TYPHOON.MIN_PRESSURE);
    currentPressure = Math.min(currentPressure, 1010);

    // 确定阶段
    let stage = 'ocean';
    if (onLand) {
      stage = 'landfall';
    } else if (step <= steps * 0.3) {
      stage = 'intensifying';
    } else if (step <= steps * 0.6) {
      stage = 'mature';
    } else {
      stage = 'weakening';
    }

    // 记录轨迹点
    const windLevel = getWindLevel(currentWind);
    trajectory.push({
      step,
      lat: Math.round(currentLat * 100) / 100,
      lon: Math.round(currentLon * 100) / 100,
      pressure: Math.round(currentPressure),
      windSpeed: Math.round(currentWind * 10) / 10,
      windLevel,
      stage,
      sst: Math.round(sst * 10) / 10,
      oceanCurrent: Math.round(oceanCurrent.velocity * 100) / 100,
      steeringFlowHeight: Math.round(steeringFlow.height),
      time: new Date(startTime.getTime() + step * stepHours * 3600000).toISOString(),
      radius: estimateWindRadius(currentWind, windLevel)
    });

    // 登陆后风速持续衰减，直到热带低压消散才停止
    // 条件：登陆步数>=3 且 风速<8m/s（热带低压下限），或 登陆步数>=30（180小时仍不消散则强制结束）
    if (landed && landfallSteps >= 3 && currentWind < 8) break;
    if (landed && landfallSteps >= 30) break;
    // 如果超出范围太远，停止模拟
    if (currentLat > 45 || currentLat < 5 || currentLon > 180 || currentLon < 110) break;
    // 最大步数限制防止无限循环
    if (step > 60) break;
  }

  // 计算登陆预判
  const landfallPrediction = landfallPoint ? {
    location: `${landfallPoint.lat}°N, ${landfallPoint.lon}°E`,
    time: landfallTime,
    pressure: landfallPressure,
    windSpeed: landfallWind,
    windLevel: getWindLevel(landfallWind),
    description: `${landfallWind >= 32.7 ? '强台风' : landfallWind >= 24.5 ? '台风' : landfallWind >= 17.2 ? '强热带风暴' : '热带风暴'}级别登陆`
  } : { description: '预计路径未触及陆地，可能转向东北方向远离陆地' };

  // 生成强度演变文字记录
  const intensityLog = [];
  for (const t of trajectory) {
    if (t.step % 4 === 0 || t.stage === 'landfall') {
      const windDesc = t.windLevel >= 12 ? '超强台风' : t.windLevel >= 10 ? '强台风' : t.windLevel >= 8 ? '台风' : t.windLevel >= 6 ? '强热带风暴' : '热带低压';
      intensityLog.push(`第${t.step * stepHours}小时: ${t.lat}°N,${t.lon}°E | ${windDesc} | 风速${t.windSpeed}m/s | 气压${t.pressure}hPa`);
    }
  }

  return {
    success: true,
    startParams: {
      lat: initLat,
      lon: initLon,
      pressure: initPressure,
      windSpeed: initWind
    },
    trajectory,
    events,
    landfallPrediction,
    intensityLog,
    totalSteps: trajectory.length,
    durationHours: (trajectory.length - 1) * stepHours,
    startTime: startTime.toISOString(),
    dataSource: '模拟推演（基于自定义参数和环境数据）'
  };
}

// ============ 台风推演API ============
app.post('/api/simulate-typhoon', async (req, res) => {
  try {
    const { lat, lon, pressure, windSpeed, model } = req.body;
    if (!lat || !lon || !pressure || !windSpeed) {
      return res.status(400).json({ success: false, message: '请提供完整的台风参数（lat, lon, pressure, windSpeed）' });
    }

    // 如果用户选择了AI模型版本，则调用AI预测
    if (model) {
      const scriptPath = __dirname + '/ai_model/predict.py';
      const params = JSON.stringify({
        model: model,
        lon: parseFloat(lon),
        lat: parseFloat(lat),
        wind: parseFloat(windSpeed),
        pressure: parseFloat(pressure),
        steps: 60
      });

      return new Promise((resolve) => {
        execFile('python', [scriptPath, params], {
          timeout: 60000,
          maxBuffer: 10 * 1024 * 1024
        }, (err, stdout, stderr) => {
          if (err) {
            console.error('AI预测失败:', err.message);
            // 降级到物理模拟
            simulateTyphoon({
              lat: parseFloat(lat),
              lon: parseFloat(lon),
              pressure: parseFloat(pressure),
              windSpeed: parseFloat(windSpeed)
            }).then(result => {
              result.note = `AI模型(${model})不可用，已降级为物理模拟`;
              res.json(result);
              resolve();
            }).catch(e => {
              res.status(500).json({ success: false, message: e.message });
              resolve();
            });
            return;
          }
          try {
            const result = JSON.parse(stdout);
            if (result.success) {
              res.json({
                success: true,
                trajectory: result.trajectory,
                dataSource: result.dataSource || `AI模型预测(${model})`,
                note: `基于 ${model} 模型预测，起始位置: ${lat}°N, ${lon}°E`
              });
            } else {
              // AI返回失败，降级
              simulateTyphoon({
                lat: parseFloat(lat),
                lon: parseFloat(lon),
                pressure: parseFloat(pressure),
                windSpeed: parseFloat(windSpeed)
              }).then(result => {
                result.note = `AI模型(${model})预测失败，已降级为物理模拟`;
                res.json(result);
                resolve();
              });
            }
          } catch (e) {
            res.json({ success: false, error: '解析AI预测结果失败: ' + e.message });
          }
          resolve();
        });
      });
    }

    // 默认使用物理模拟
    const result = await simulateTyphoon({
      lat: parseFloat(lat),
      lon: parseFloat(lon),
      pressure: parseFloat(pressure),
      windSpeed: parseFloat(windSpeed)
    });
    res.json(result);
  } catch (err) {
    console.error('台风推演失败:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ 获取沿海城市列表 ============
app.get('/api/coastal-cities', (req, res) => {
  res.json({ success: true, cities: COASTAL_CITIES });
});

// ============ 首页 ============
app.get('/', (req, res) => {
  const user = req.session && req.session.user ? {
    id: req.session.user.id,
    username: req.session.user.username,
    balance: req.session.user.balance,
    shopId: req.session.user.shopId,
    shopName: req.session.user.shopName
  } : null;
  res.render('index', {
    coastalCities: JSON.stringify(COASTAL_CITIES),
    user: user
  });
});

// ============ API: 获取当前用户会话状态（修复登录同步问题） ============
app.get('/api/user-session', (req, res) => {
  const user = req.session && req.session.user ? {
    id: req.session.user.id,
    username: req.session.user.username,
    balance: req.session.user.balance,
    shopId: req.session.user.shopId,
    shopName: req.session.user.shopName
  } : null;
  res.json({ user: user });
});

// ============ API 5: AI模型预测台风路径 ============
const { execFile } = require('child_process');

app.post('/api/ai-predict', express.json(), (req, res) => {
  const { lon, lat, wind, pressure, steps = 24, model,
          hgt500, u500, v500, ridge_lat, west_extent } = req.body || {};
  
  if (lon === undefined || lat === undefined || wind === undefined || pressure === undefined) {
    return res.json({ success: false, error: '缺少参数: lon, lat, wind, pressure' });
  }

  const scriptPath = __dirname + '/ai_model/predict.py';
  const params = JSON.stringify({
    model: model || 'v7_opt',
    lon, lat, wind, pressure, steps,
    hgt500: hgt500 || 5840,
    u500: u500 || -4,
    v500: v500 || 1.5,
    ridge_lat: ridge_lat || 22,
    west_extent: west_extent || 125
  });

  execFile('python', [scriptPath, params], {
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024
  }, (err, stdout, stderr) => {
    if (err) {
      console.error('AI预测失败:', err.message);
      return res.json({ success: false, error: 'AI预测失败: ' + err.message });
    }
    try {
      const result = JSON.parse(stdout);
      if (result.success) {
        res.json({
          success: true,
          trajectory: result.trajectory,
          dataSource: result.dataSource || 'AI模型预测',
          note: `基于 ${model || 'v7'} 模型 ${steps} 步${result.dataSource || 'GRU'}预测，起始位置: ${lat}°N, ${lon}°E`
        });
      } else {
        res.json({ success: false, error: result.error || 'AI预测返回空结果' });
      }
    } catch (e) {
      res.json({ success: false, error: '解析AI预测结果失败: ' + e.message });
    }
  });
});

// ============ API 6: 读取本地GFS气象数据 ============
app.get('/api/weather-data', (req, res) => {
  try {
    const combinedPath = path.join(GFS_CONFIG.OUTPUT_DIR, 'combined.json');
    if (fs.existsSync(combinedPath)) {
      const data = JSON.parse(fs.readFileSync(combinedPath, 'utf8'));
      return res.json({ success: true, ...data, localFile: true });
    }
    // 尝试读取单独的hgt500和sst
    const hgtPath = path.join(GFS_CONFIG.OUTPUT_DIR, 'hgt500.json');
    const sstPath = path.join(GFS_CONFIG.OUTPUT_DIR, 'sst.json');
    const result = { success: true, localFile: false, hgt500: null, sst: null };

    if (fs.existsSync(hgtPath)) {
      result.hgt500 = JSON.parse(fs.readFileSync(hgtPath, 'utf8'));
    }
    if (fs.existsSync(sstPath)) {
      result.sst = JSON.parse(fs.readFileSync(sstPath, 'utf8'));
    }
    res.json(result);
  } catch (e) {
    console.error('读取本地气象数据失败:', e.message);
    res.json({ success: false, error: e.message });
  }
});

// ============ API 7: Open-Meteo ECMWF 高空风 + 垂直风切变 ============
// 获取200hPa和850hPa的风速+风向，转为u/v分量，计算VWS
// 风向转u/v: u = -speed * sin(dir), v = -speed * cos(dir) (气象学惯例)
// VWS = sqrt((u200-u850)^2 + (v200-v850)^2)
app.get('/api/upper-wind', async (req, res) => {
  // 风速风向转u/v分量
  function toUV(speed, dir) {
    if (speed === null || speed === undefined || dir === null || dir === undefined) return { u: null, v: null };
    const rad = dir * Math.PI / 180;
    return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad) };
  }

  try {
    const { lat, lon } = req.query;
    const queryLat = parseFloat(lat) || 25;
    const queryLon = parseFloat(lon) || 125;

    let ecmwfFetched = false;
    let data = {
      u200: null, v200: null, u850: null, v850: null,
      verticalWindShear: null
    };

    try {
      // 请求Open-Meteo ECMWF API，获取风速+风向（200hPa和850hPa）
      const ecmwfResp = await axios.get('https://api.open-meteo.com/v1/ecmwf', {
        params: {
          latitude: queryLat,
          longitude: queryLon,
          hourly: ['wind_speed_200hPa', 'wind_direction_200hPa', 'wind_speed_850hPa', 'wind_direction_850hPa'],
          wind_speed_unit: 'ms',
          timezone: 'Asia/Shanghai'
        },
        timeout: 10000
      });

      if (ecmwfResp.data && ecmwfResp.data.hourly) {
        const hd = ecmwfResp.data.hourly;
        // 取最新时刻（第0小时）的数据
        const spd200 = hd.wind_speed_200hPa?.[0] ?? null;
        const dir200 = hd.wind_direction_200hPa?.[0] ?? null;
        const spd850 = hd.wind_speed_850hPa?.[0] ?? null;
        const dir850 = hd.wind_direction_850hPa?.[0] ?? null;

        // 风速风向转u/v分量
        const uv200 = toUV(spd200, dir200);
        const uv850 = toUV(spd850, dir850);
        data.u200 = uv200.u;
        data.v200 = uv200.v;
        data.u850 = uv850.u;
        data.v850 = uv850.v;

        // 计算垂直风切变
        if (data.u200 !== null && data.v200 !== null &&
            data.u850 !== null && data.v850 !== null) {
          const du = data.u200 - data.u850;
          const dv = data.v200 - data.v850;
          data.verticalWindShear = Math.sqrt(du*du + dv*dv);
        }
        // 保留原始风速风向供前端参考
        data.windSpeed200 = spd200;
        data.windDir200 = dir200;
        data.windSpeed850 = spd850;
        data.windDir850 = dir850;
        ecmwfFetched = true;
      }
    } catch (e) {
      console.warn('ECMWF高空风获取失败，使用模拟数据:', e.message);
    }

    // 如果API获取失败，生成模拟数据
    if (!ecmwfFetched || data.verticalWindShear === null) {
      const spd200 = 8 + Math.random() * 6;
      const dir200 = 240 + Math.random() * 60;
      const spd850 = 4 + Math.random() * 4;
      const dir850 = 20 + Math.random() * 40;
      const uv200 = toUV(spd200, dir200);
      const uv850 = toUV(spd850, dir850);
      data.u200 = uv200.u; data.v200 = uv200.v;
      data.u850 = uv850.u; data.v850 = uv850.v;
      data.windSpeed200 = spd200; data.windDir200 = dir200;
      data.windSpeed850 = spd850; data.windDir850 = dir850;
      const du = data.u200 - data.u850;
      const dv = data.v200 - data.v850;
      data.verticalWindShear = Math.sqrt(du*du + dv*dv);
    }

    res.json({
      success: true,
      lat: queryLat,
      lon: queryLon,
      u200: Math.round(data.u200 * 100) / 100,
      v200: Math.round(data.v200 * 100) / 100,
      u850: Math.round(data.u850 * 100) / 100,
      v850: Math.round(data.v850 * 100) / 100,
      verticalWindShear: Math.round(data.verticalWindShear * 100) / 100,
      windSpeed200: data.windSpeed200,
      windDir200: data.windDir200,
      windSpeed850: data.windSpeed850,
      windDir850: data.windDir850,
      dataSource: ecmwfFetched ? 'Open-Meteo ECMWF实况' : '模拟数据',
      updateTime: new Date().toISOString()
    });

  } catch (err) {
    console.error('获取高空风数据异常:', err.message);
    const queryLat = parseFloat(req.query.lat) || 25;
    const queryLon = parseFloat(req.query.lon) || 125;
    // 兜底模拟数据
    const spd200 = 8 + Math.random() * 6;
    const dir200 = 240 + Math.random() * 60;
    const spd850 = 4 + Math.random() * 4;
    const dir850 = 20 + Math.random() * 40;
    const toUV = (s, d) => ({ u: -s * Math.sin(d * Math.PI / 180), v: -s * Math.cos(d * Math.PI / 180) });
    const uv200 = toUV(spd200, dir200);
    const uv850 = toUV(spd850, dir850);
    const du = uv200.u - uv850.u;
    const dv = uv200.v - uv850.v;
    res.json({
      success: true,
      lat: queryLat, lon: queryLon,
      u200: Math.round(uv200.u * 100) / 100, v200: Math.round(uv200.v * 100) / 100,
      u850: Math.round(uv850.u * 100) / 100, v850: Math.round(uv850.v * 100) / 100,
      verticalWindShear: Math.round(Math.sqrt(du*du + dv*dv) * 100) / 100,
      windSpeed200: spd200, windDir200: dir200,
      windSpeed850: spd850, windDir850: dir850,
      dataSource: '模拟数据（错误兜底）',
      updateTime: new Date().toISOString()
    });
  }
});

// ============ 启动服务器（独立运行模式） ============
const PORT = process.env.PORT || 3000;
// 如果直接运行此文件，启动独立服务器
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`台风模拟预测系统已启动: http://localhost:${PORT}`);
    console.log(`提示: 可通过 require('${__filename}') 挂载到现有 Express 项目`);
  });
}

// =====================================================================
// ============ GFS 气象数据自动下载模块 ============
// =====================================================================

/**
 * 读取上次同步时间戳
 */
function readLastSyncTime() {
  try {
    if (fs.existsSync(GFS_CONFIG.SYNC_FILE)) {
      return JSON.parse(fs.readFileSync(GFS_CONFIG.SYNC_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('读取同步时间文件失败:', e.message);
  }
  return { lastGribSync: null, lastSstSync: null, lastIBTrACSSync: null };
}

/**
 * 写入同步时间戳
 */
function writeLastSyncTime(data) {
  try {
    fs.ensureDirSync(path.dirname(GFS_CONFIG.SYNC_FILE));
    fs.writeFileSync(GFS_CONFIG.SYNC_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('写入同步时间文件失败:', e.message);
  }
}

/**
 * 清理超过指定天数的旧grib2文件
 */
function cleanupOldGribFiles() {
  try {
    const rawDir = GFS_CONFIG.RAW_DIR;
    if (!fs.existsSync(rawDir)) {
      fs.ensureDirSync(rawDir);
      return { deleted: 0 };
    }

    const now = Date.now();
    const maxAge = GFS_CONFIG.CLEANUP_DAYS * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(rawDir);
    let deleted = 0;

    for (const file of files) {
      if (!file.endsWith('.grib2') && !file.endsWith('.grb2')) continue;
      const filePath = path.join(rawDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          deleted++;
          console.log(`已清理过期文件: ${file}`);
        }
      } catch (e) {
        console.warn(`清理文件失败: ${file}`, e.message);
      }
    }
    console.log(`磁盘清理完成，共删除 ${deleted} 个过期文件`);
    return { deleted };
  } catch (e) {
    console.error('磁盘清理异常:', e.message);
    return { deleted: 0, error: e.message };
  }
}

/**
 * 构建GFS DODS查询URL
 */
function buildGFSURL(variable, date, hour, altitude, latStart, latEnd, lonStart, lonEnd, stride) {
  const s = stride || 1;
  const dims = altitude
    ? `[0:0][${altitude}:${altitude}][${latStart}:${s}:${latEnd}][${lonStart}:${s}:${lonEnd}]`
    : `[0:0][${latStart}:${s}:${latEnd}][${lonStart}:${s}:${lonEnd}]`;
  return GFS_CONFIG.DODS_URL
    .replace('{DATE}', date)
    .replace('{HH}', hour)
    .replace('{VAR}', variable)
    .replace('{DIMS}', dims);
}

/**
 * 经纬度转GFS网格索引 (GFS 0.25度)
 * GFS lat索引: 0=90°N, 720=90°S
 * GFS lon索引: 0=0°E, 1440=360°E
 */
function latLonToIndex(lat, lon) {
  const latIdx = Math.round((90 - lat) / GFS_CONFIG.RES_INC);
  const lonIdx = Math.round(((lon + 360) % 360) / GFS_CONFIG.RES_INC);
  return { latIdx: Math.max(0, Math.min(720, latIdx)), lonIdx: Math.max(0, Math.min(1440, lonIdx)) };
}

/**
 * 获取最新GFS预报日期和时间
 */
function getLatestGFSTime() {
  const now = new Date();
  const utcHours = now.getUTCHours();
  // 最近的GFS运行时间: 00, 06, 12, 18
  let runHour;
  if (utcHours < 3) runHour = '18'; // 前一天的18z
  else if (utcHours < 9) runHour = '00';
  else if (utcHours < 15) runHour = '06';
  else if (utcHours < 21) runHour = '12';
  else runHour = '18';

  let date = new Date(now);
  if (runHour === '18' && utcHours < 3) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  const dateStr = date.getUTCFullYear() +
    String(date.getUTCMonth() + 1).padStart(2, '0') +
    String(date.getUTCDate()).padStart(2, '0');
  return { date: dateStr, hour: runHour };
}

/**
 * 带重试的HTTP GET请求
 */
async function httpGetWithRetry(url, timeout = 30000) {
  const { maxAttempts, delayMs } = GFS_CONFIG.RETRY;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await axios.get(url, { timeout, responseType: 'text' });
      if (resp.status === 200 && resp.data) {
        return resp.data;
      }
      throw new Error(`HTTP ${resp.status}`);
    } catch (e) {
      lastError = e;
      console.warn(`请求失败 (尝试 ${attempt}/${maxAttempts}): ${e.message.slice(0, 60)}`);
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

/**
 * 解析DODS ASCII响应为网格数据
 */
function parseDODSResponse(text, variable) {
  const gridData = [];
  const lines = text.split('\n');

  // 跳过第一行（变量声明）
  let dataStarted = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 跳过声明行
    if (trimmed.startsWith(variable) || trimmed.startsWith('[') === false) {
      if (trimmed.startsWith('[')) dataStarted = true;
      continue;
    }

    // 匹配数据行: [idx][idx], value 或 [idx][idx][idx], value
    // 水平面变量: [lat][lon], value
    // 等压面变量: [lat][lon], value (我们已经固定了level维度)
    const match = trimmed.match(/\[(\d+)\]\s*\[(\d+)\],\s*([\d.\-Ee+]+)/);
    if (match) {
      const latIdx = parseInt(match[1]);
      const lonIdx = parseInt(match[2]);
      const value = parseFloat(match[3]);

      if (isNaN(value) || value < -9999 || value > 99999) continue;

      // 转换索引回经纬度
      const lat = Math.round((90 - latIdx * GFS_CONFIG.RES_INC) * 10) / 10;
      const lon = Math.round(lonIdx * GFS_CONFIG.RES_INC * 10) / 10;

      // 归一化经度到0-360
      const lonNorm = ((lon % 360) + 360) % 360;

      // 裁剪到NWP区域
      if (lat >= GFS_CONFIG.NWP.minLat && lat <= GFS_CONFIG.NWP.maxLat &&
          lonNorm >= GFS_CONFIG.NWP.minLon && lonNorm <= GFS_CONFIG.NWP.maxLon) {
        gridData.push({ lat, lon: lonNorm, value });
      }
    }
  }
  return gridData;
}

/**
 * 下载GFS 500hPa位势高度场
 * 使用DODS ASCII协议，level=5对应500hPa
 */
async function downloadGFS_HGT500() {
  console.log('开始下载GFS 500hPa位势高度场...');

  const { date, hour } = getLatestGFSTime();
  const startIdx = latLonToIndex(GFS_CONFIG.NWP.maxLat, GFS_CONFIG.NWP.minLon);
  const endIdx = latLonToIndex(GFS_CONFIG.NWP.minLat, GFS_CONFIG.NWP.maxLon);

  const latStart = Math.min(startIdx.latIdx, endIdx.latIdx);
  const latEnd = Math.max(startIdx.latIdx, endIdx.latIdx);
  const lonStart = startIdx.lonIdx;
  const lonEnd = endIdx.lonIdx;

  // 使用stride=4（1度分辨率）减小数据量
  const stride = 4;
  const url = buildGFSURL('hgtprs', date, hour, '5', latStart, latEnd, lonStart, lonEnd, stride);

  console.log(`请求URL: ${url.slice(0, 120)}...`);
  const data = await httpGetWithRetry(url, 60000);
  console.log(`500hPa数据下载完成: ${(data.length / 1024).toFixed(1)}KB`);

  // 保存原始数据
  await saveRawGribData(data, `hgt500_${date}_${hour}`);

  // 解析
  const gridData = parseDODSResponse(data, 'hgtprs');
  console.log(`解析完成: ${gridData.length} 个网格点`);

  // 重命名value为height
  return gridData.map(p => ({ lat: p.lat, lon: p.lon, height: Math.round(p.value) }));
}

/**
 * 下载GFS海表温度场
 */
async function downloadGFS_SST() {
  console.log('开始下载GFS海表温度场...');

  const { date, hour } = getLatestGFSTime();
  const startIdx = latLonToIndex(GFS_CONFIG.NWP.maxLat, GFS_CONFIG.NWP.minLon);
  const endIdx = latLonToIndex(GFS_CONFIG.NWP.minLat, GFS_CONFIG.NWP.maxLon);

  const latStart = Math.min(startIdx.latIdx, endIdx.latIdx);
  const latEnd = Math.max(startIdx.latIdx, endIdx.latIdx);
  const lonStart = startIdx.lonIdx;
  const lonEnd = endIdx.lonIdx;

  const stride = 4;
  // SST没有气压层维度
  const url = buildGFSURL('sst', date, hour, null, latStart, latEnd, lonStart, lonEnd, stride);

  console.log(`请求URL: ${url.slice(0, 120)}...`);
  const data = await httpGetWithRetry(url, 60000);
  console.log(`海温数据下载完成: ${(data.length / 1024).toFixed(1)}KB`);

  await saveRawGribData(data, `sst_${date}_${hour}`);

  const gridData = parseDODSResponse(data, 'sst');
  console.log(`解析完成: ${gridData.length} 个网格点`);

  // SST值需要减去273.15转换为摄氏度
  return gridData.map(p => ({
    lat: p.lat,
    lon: p.lon,
    sst: Math.round((p.value - 273.15) * 10) / 10
  }));
}

/**
 * 从500hPa数据提取5880等高线边界
 */
function extractContour5880(gridData) {
  const highPoints = gridData.filter(p => p.height >= 5880);
  if (highPoints.length === 0) return [];

  const lats = highPoints.map(p => p.lat);
  const lons = highPoints.map(p => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const boundary = [];
  const step = 2.5;
  for (let lon = minLon; lon <= maxLon + 0.01; lon += step) {
    boundary.push({ lat: Math.round(maxLat * 10) / 10, lon: Math.round(lon * 10) / 10 });
  }
  for (let lat = maxLat; lat >= minLat - 0.01; lat -= step) {
    boundary.push({ lat: Math.round(lat * 10) / 10, lon: Math.round(maxLon * 10) / 10 });
  }
  for (let lon = maxLon; lon >= minLon - 0.01; lon -= step) {
    boundary.push({ lat: Math.round(minLat * 10) / 10, lon: Math.round(lon * 10) / 10 });
  }
  for (let lat = minLat; lat <= maxLat + 0.01; lat += step) {
    boundary.push({ lat: Math.round(lat * 10) / 10, lon: Math.round(minLon * 10) / 10 });
  }
  return boundary;
}

/**
 * 计算副高特征参数
 */
function calcSubHighParams(gridData) {
  if (!gridData || gridData.length === 0) {
    return { avgHeight: 0, maxHeight: 0, minHeight: 0, count588: 0, ridgeLat: 0, description: '--' };
  }

  const heights = gridData.map(p => p.height);
  const avgHeight = Math.round(heights.reduce((a, b) => a + b, 0) / heights.length);
  const maxHeight = Math.max(...heights);
  const minHeight = Math.min(...heights);
  const highPoints = gridData.filter(p => p.height >= 5880);
  const count588 = highPoints.length;

  let ridgeLat = 0;
  let description = '--';
  if (highPoints.length > 0) {
    ridgeLat = Math.round(highPoints.reduce((s, p) => s + p.lat, 0) / highPoints.length);
    description = `副高脊线约位于北纬${ridgeLat}°附近`;
  } else {
    description = '副热带高压偏弱，5880线不明显';
  }

  return { avgHeight, maxHeight, minHeight, count588, ridgeLat, description };
}

/**
 * 保存原始grib2数据到本地（模拟下载，实际保存为DODS文本响应）
 */
async function saveRawGribData(data, prefix) {
  try {
    fs.ensureDirSync(GFS_CONFIG.RAW_DIR);
    const now = new Date();
    const filename = `${prefix}_${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,'0')}${String(now.getUTCDate()).padStart(2,'0')}_${String(now.getUTCHours()).padStart(2,'0')}z.txt`;
    const filePath = path.join(GFS_CONFIG.RAW_DIR, filename);
    fs.writeFileSync(filePath, data, 'utf8');
    console.log(`原始数据已保存: ${filename}`);
    return filePath;
  } catch (e) {
    console.warn('保存原始数据失败:', e.message);
    return null;
  }
}

/**
 * 将处理后的气象数据输出为JSON
 */
function outputWeatherJSON(hgt500Data, sstData, contour5880, subHighParams) {
  try {
    fs.ensureDirSync(GFS_CONFIG.OUTPUT_DIR);

    // 输出500hPa位势高度场
    const hgtOutput = {
      success: true,
      type: 'hgt500',
      description: 'GFS 500hPa位势高度场 (西北太平洋区域)',
      updateTime: new Date().toISOString(),
      dataSource: 'GFS DODS (https://nomads.ncep.noaa.gov/dods/gfs/gfs0p25/latest/)',
      gridData: hgt500Data,
      contour5880,
      subHigh: subHighParams
    };
    fs.writeFileSync(
      path.join(GFS_CONFIG.OUTPUT_DIR, 'hgt500.json'),
      JSON.stringify(hgtOutput, null, 2),
      'utf8'
    );

    // 输出海温场
    const sstOutput = {
      success: true,
      type: 'sst',
      description: 'GFS海表温度场 (西北太平洋区域)',
      updateTime: new Date().toISOString(),
      dataSource: 'GFS DODS (https://nomads.ncep.noaa.gov/dods/gfs/gfs0p25/latest/)',
      gridData: sstData
    };
    fs.writeFileSync(
      path.join(GFS_CONFIG.OUTPUT_DIR, 'sst.json'),
      JSON.stringify(sstOutput, null, 2),
      'utf8'
    );

    // 输出综合气象数据（兼容前端现有API格式）
    const combined = {
      success: true,
      updateTime: new Date().toISOString(),
      dataSource: 'GFS DODS 实时下载',
      hgt500: hgt500Data,
      sst: sstData,
      contour5880,
      subHigh: subHighParams,
      note: `西北太平洋区域 ${GFS_CONFIG.NWP.minLat}°N-${GFS_CONFIG.NWP.maxLat}°N, ${GFS_CONFIG.NWP.minLon}°E-${GFS_CONFIG.NWP.maxLon}°E`
    };
    fs.writeFileSync(
      path.join(GFS_CONFIG.OUTPUT_DIR, 'combined.json'),
      JSON.stringify(combined, null, 2),
      'utf8'
    );

    console.log(`气象数据已输出到 ${GFS_CONFIG.OUTPUT_DIR}`);
    return { hgt500: hgtOutput, sst: sstOutput, combined };
  } catch (e) {
    console.error('输出气象JSON失败:', e.message);
    throw e;
  }
}

/**
 * 主同步函数：调用Python脚本下载GFS副高数据
 */
async function syncWeatherData() {
  const startTime = Date.now();
  console.log('========== 开始GFS副高数据同步 ==========');

  try {
    // 清理旧grib2文件
    cleanupOldGribFiles();

    const scriptPath = path.join(__dirname, '..', 'download_hgt500.py');
    if (!fs.existsSync(scriptPath)) {
      console.error('Python下载脚本不存在:', scriptPath);
      return { success: false, error: 'download_hgt500.py 未找到' };
    }

    // 调用Python脚本
    const { stdout, stderr } = await new Promise((resolve, reject) => {
      execFile('python', [scriptPath], {
        cwd: path.join(__dirname, '..'),
        timeout: 600000, // 10分钟超时
        maxBuffer: 1024 * 1024
      }, (err, stdout, stderr) => {
        if (err) {
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });

    // 输出Python脚本日志
    console.log('[Python] ' + stdout.trim().split('\n').join('\n[Python] '));
    if (stderr) console.error('[Python 错误]', stderr);

    // 更新同步时间戳
    const syncTime = new Date().toISOString();
    const syncData = readLastSyncTime();
    syncData.lastGribSync = syncTime;
    writeLastSyncTime(syncData);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`========== GFS副高数据同步完成 (${elapsed}s) ==========`);
    return { success: true, hgt500Success: true, elapsed };
  } catch (e) {
    console.error('GFS副高数据同步异常:', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * 判断是否需要同步（距离上次同步超过6小时）
 */
function shouldSync() {
  const syncData = readLastSyncTime();
  const lastSync = syncData.lastGribSync || syncData.lastSstSync;
  if (!lastSync) return true;

  const lastTime = new Date(lastSync).getTime();
  const now = Date.now();
  // 6小时 = 21600000ms
  return (now - lastTime) > 6 * 60 * 60 * 1000;
}

/**
 * 启动GFS同步定时任务（UTC 00/06/12/18）
 */
function startWeatherSyncCron() {
  // UTC 00:00, 06:00, 12:00, 18:00
  const cronExpression = '0 0,6,12,18 * * *';
  const job = new CronJob(
    cronExpression,
    async () => {
      console.log('[定时任务] 触发GFS气象数据同步...');
      await syncWeatherData();
    },
    null,
    true,
    'UTC'
  );
  console.log(`GFS气象同步定时任务已启动 (cron: ${cronExpression} UTC)`);
  return job;
}

/**
 * 初始化气象同步：启动时立即执行一次自检
 */
async function initWeatherSync() {
  console.log('========== GFS气象数据自检 ==========');

  const syncData = readLastSyncTime();
  const lastSync = syncData.lastGribSync || syncData.lastSstSync;

  if (lastSync) {
    const lastTime = new Date(lastSync).getTime();
    const ageHours = (Date.now() - lastTime) / (1000 * 60 * 60);
    console.log(`上次同步时间: ${lastSync} (${ageHours.toFixed(1)}小时前)`);

    if (ageHours < 6) {
      console.log('上次同步在6小时内，跳过自检');
      // 但确保输出文件存在
      const hgtFile = path.join(GFS_CONFIG.OUTPUT_DIR, 'hgt500.json');
      const sstFile = path.join(GFS_CONFIG.OUTPUT_DIR, 'sst.json');
      if (fs.existsSync(hgtFile) && fs.existsSync(sstFile)) {
        console.log('输出文件已存在，无需重新下载');
        return { success: true, skipped: true };
      }
      console.log('输出文件缺失，将重新下载');
    }
  } else {
    console.log('未检测到同步记录，将执行首次下载');
  }

  // 执行同步
  return await syncWeatherData();
}

// 导出扩展功能供 server.js 调用
module.exports = app;
module.exports.syncWeatherData = syncWeatherData;
module.exports.initWeatherSync = initWeatherSync;
module.exports.startWeatherSyncCron = startWeatherSyncCron;
module.exports.cleanupOldGribFiles = cleanupOldGribFiles;
module.exports.shouldSync = shouldSync;
module.exports.readLastSyncTime = readLastSyncTime;
module.exports.GFS_CONFIG = GFS_CONFIG;
module.exports.refreshWeatherCache = refreshWeatherCache;
module.exports.startWeatherCacheCron = startWeatherCacheCron;