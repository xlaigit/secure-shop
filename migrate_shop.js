const sqlite3 = require('sqlite3');
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'data', 'shop.db'));

const columns = [
  `ALTER TABLE products ADD COLUMN brand TEXT DEFAULT ''`,
  `ALTER TABLE products ADD COLUMN description TEXT DEFAULT ''`,
  `ALTER TABLE products ADD COLUMN sales_count INTEGER DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN image_url TEXT DEFAULT ''`,
];

let idx = 0;
function runNext() {
  if (idx >= columns.length) {
    console.log('✅ 字段迁移完成');
    // 为所有商品生成随机销量
    db.run(`UPDATE products SET sales_count = ABS(RANDOM() % 500) + 10 WHERE shop_id = 0`, (err) => {
      if (err) console.log('销量更新失败:', err.message);
      else console.log('✅ 已为商品生成随机销量数据');
      // 为部分商品添加品牌
      db.run(`UPDATE products SET brand = 'Apple' WHERE name LIKE '%iPhone%' OR name LIKE '%Apple%' OR name LIKE '%iPad%' OR name LIKE '%MacBook%' OR name LIKE '%AirPods%' OR name LIKE '%Apple Watch%' OR name LIKE '%Apple TV%'`);
      db.run(`UPDATE products SET brand = '华为' WHERE name LIKE '%华为%'`);
      db.run(`UPDATE products SET brand = '小米' WHERE name LIKE '%小米%' OR name LIKE '%米家%'`);
      db.run(`UPDATE products SET brand = 'OPPO' WHERE name LIKE '%OPPO%'`);
      db.run(`UPDATE products SET brand = 'vivo' WHERE name LIKE '%vivo%'`);
      db.run(`UPDATE products SET brand = '荣耀' WHERE name LIKE '%荣耀%'`);
      db.run(`UPDATE products SET brand = '一加' WHERE name LIKE '%一加%'`);
      db.run(`UPDATE products SET brand = '三星' WHERE name LIKE '%三星%'`);
      db.run(`UPDATE products SET brand = 'Sony' WHERE name LIKE '%Sony%' OR name LIKE '%索尼%'`);
      db.run(`UPDATE products SET brand = 'Samsung' WHERE name LIKE '%Samsung%'`);
      db.run(`UPDATE products SET brand = 'Bose' WHERE name LIKE '%Bose%'`);
      db.run(`UPDATE products SET brand = '大疆' WHERE name LIKE '%大疆%'`);
      db.run(`UPDATE products SET brand = '戴森' WHERE name LIKE '%戴森%'`);
      db.run(`UPDATE products SET brand = 'Nintendo' WHERE name LIKE '%Nintendo%'`);
      db.run(`UPDATE products SET brand = 'Xbox' WHERE name LIKE '%Xbox%'`);
      db.run(`UPDATE products SET brand = '联想' WHERE name LIKE '%联想%'`);
      db.run(`UPDATE products SET brand = '华硕' WHERE name LIKE '%华硕%'`);
      db.run(`UPDATE products SET brand = '戴尔' WHERE name LIKE '%戴尔%'`);
      db.run(`UPDATE products SET brand = '惠普' WHERE name LIKE '%惠普%'`);
      db.run(`UPDATE products SET brand = '海天' WHERE name LIKE '%海天%'`);
      db.run(`UPDATE products SET brand = '金龙鱼' WHERE name LIKE '%金龙鱼%'`);
      db.run(`UPDATE products SET brand = '伊利' WHERE name LIKE '%伊利%'`);
      db.run(`UPDATE products SET brand = '蒙牛' WHERE name LIKE '%蒙牛%'`);
      db.run(`UPDATE products SET brand = '康师傅' WHERE name LIKE '%康师傅%'`);
      db.run(`UPDATE products SET brand = '统一' WHERE name LIKE '%统一%'`);
      db.run(`UPDATE products SET brand = '良品铺子' WHERE name LIKE '%良品铺子%'`);
      db.run(`UPDATE products SET brand = '三只松鼠' WHERE name LIKE '%三只松鼠%'`);
      db.run(`UPDATE products SET brand = '苏泊尔' WHERE name LIKE '%苏泊尔%'`);
      db.run(`UPDATE products SET brand = '美的' WHERE name LIKE '%美的%'`);
      db.run(`UPDATE products SET brand = '九阳' WHERE name LIKE '%九阳%'`);
      db.run(`UPDATE products SET brand = '得力' WHERE name LIKE '%得力%'`);
      db.run(`UPDATE products SET brand = '晨光' WHERE name LIKE '%晨光%'`);

      console.log('✅ 品牌数据更新完成');
      db.close();
    });
    return;
  }
  db.run(columns[idx], (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.log('跳过:', err.message);
    }
    idx++;
    runNext();
  });
}
runNext();