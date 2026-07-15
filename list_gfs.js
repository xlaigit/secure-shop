const http = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  const base = 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.20260712/00/atmos/';
  const html = await fetch(base);
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  
  console.log('=== 文件类型统计 ===');
  const grib2 = links.filter(f => f.endsWith('.grib2'));
  const pgrb = links.filter(f => f.includes('pgrb'));
  const sflux = links.filter(f => f.includes('sflux'));
  const others = links.filter(f => !f.endsWith('.grib2') && !f.endsWith('/') && !f.endsWith('.idx'));
  console.log('sfluxgrbf grib2文件:', sflux.length);
  console.log('pgrb2文件:', pgrb.length);
  if (pgrb.length > 0) {
    console.log('pgrb2示例:', pgrb.slice(0, 5));
  }
  console.log('其他文件:', others.length, others.slice(0, 10));

  // 检查是否有pgrb2目录
  const dirs = links.filter(f => f.endsWith('/'));
  console.log('\n子目录:', dirs);
  
  // 检查上级目录
  const parent = 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.20260712/00/';
  const parentHtml = await fetch(parent);
  const parentLinks = [...parentHtml.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  const parentDirs = parentLinks.filter(f => f.endsWith('/'));
  console.log('\n00z目录内容:', parentDirs);
  
  // 检查是否有pgrb2b目录
  const otherDirs = parentDirs.filter(d => !d.startsWith('atmos'));
  for (const d of otherDirs) {
    const subHtml = await fetch(parent + d);
    const subLinks = [...subHtml.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    const subGrib2 = subLinks.filter(f => f.includes('grib2'));
    console.log(`  ${d}: ${subGrib2.length} grib2文件`);
    if (subGrib2.length > 0) console.log('    示例:', subGrib2.slice(0, 3));
  }
}

main().catch(console.log);