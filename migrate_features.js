const sqlite3 = require('sqlite3');
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'data', 'shop.db'));

const tables = [
  // 优惠券模板
  `CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL DEFAULT 'fixed',       -- fixed: 固定金额, percent: 折扣百分比
    value REAL NOT NULL DEFAULT 0,            -- 金额或百分比值
    min_amount REAL DEFAULT 0,                -- 最低消费金额
    max_discount REAL DEFAULT NULL,           -- 最大折扣（百分比券时）
    expires_at TEXT,                          -- 过期时间
    usage_limit INTEGER DEFAULT 0,            -- 0=不限
    used_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  // 用户领取的优惠券
  `CREATE TABLE IF NOT EXISTS user_coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    coupon_id INTEGER DEFAULT NULL,
    code TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'fixed',
    value REAL NOT NULL DEFAULT 0,
    min_amount REAL DEFAULT 0,
    max_discount REAL DEFAULT NULL,
    expires_at TEXT,
    used_at TEXT DEFAULT NULL,
    order_id TEXT DEFAULT NULL,
    claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  // 邀请记录
  `CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inviter_id INTEGER NOT NULL,
    invitee_id INTEGER NOT NULL,
    invitee_username TEXT DEFAULT '',
    code TEXT NOT NULL,
    reward_amount REAL DEFAULT 5.0,
    reward_paid INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(invitee_id)
  )`,
  // 邀请码
  `CREATE TABLE IF NOT EXISTS invite_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE,
    used_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  // 促销活动
  `CREATE TABLE IF NOT EXISTS promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    type TEXT DEFAULT 'promo',               -- promo: 促销, free: 限免, event: 活动
    banner TEXT DEFAULT '',
    discount REAL DEFAULT 0,
    discount_type TEXT DEFAULT 'percent',     -- percent: 百分比, fixed: 固定金额
    start_time TEXT,
    end_time TEXT,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    product_ids TEXT DEFAULT '',              -- 参与商品ID,逗号分隔
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  // 用户推荐分数
  `CREATE TABLE IF NOT EXISTS user_recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    score REAL DEFAULT 0,
    reason TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_id)
  )`,
  // 用户浏览历史
  `CREATE TABLE IF NOT EXISTS browse_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  // 每日签到
  `CREATE TABLE IF NOT EXISTS daily_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    checkin_date TEXT NOT NULL,
    reward_points INTEGER DEFAULT 0,
    reward_coupon_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, checkin_date)
  )`
];

let idx = 0;
function runNext() {
  if (idx >= tables.length) {
    console.log('✅ 所有表创建完成');
    // 插入默认优惠券
    db.get("SELECT COUNT(*) as n FROM coupons", (e, r) => {
      if (r && r.n === 0) {
        db.run("INSERT INTO coupons (code, type, value, min_amount, max_discount, expires_at, usage_limit, description) VALUES ('WELCOME10', 'fixed', 10, 50, NULL, datetime('now','+30 days','localtime'), 0, '新用户欢迎券 - 满50减10')");
        db.run("INSERT INTO coupons (code, type, value, min_amount, max_discount, expires_at, usage_limit, description) VALUES ('SAVE20', 'percent', 20, 100, 30, datetime('now','+30 days','localtime'), 0, '全场8折 - 满100可用，最高减30')");
        db.run("INSERT INTO coupons (code, type, value, min_amount, max_discount, expires_at, usage_limit, description) VALUES ('FREESHIP', 'fixed', 15, 0, NULL, datetime('now','+15 days','localtime'), 100, '免运费券 - 无门槛直减15元')");
        db.run("INSERT INTO coupons (code, type, value, min_amount, max_discount, expires_at, usage_limit, description) VALUES ('NEW50', 'fixed', 50, 200, NULL, datetime('now','+7 days','localtime'), 50, '新人专享 - 满200减50')");
        db.run("INSERT INTO coupons (code, type, value, min_amount, max_discount, expires_at, usage_limit, description) VALUES ('VIP30', 'percent', 30, 150, 50, datetime('now','+14 days','localtime'), 20, 'VIP特惠 - 满150享7折，最高减50')");
        console.log('✅ 已插入默认优惠券');
      }
      // 插入默认促销活动
      db.get("SELECT COUNT(*) as n FROM promotions", (e2, r2) => {
        if (r2 && r2.n === 0) {
          const now = new Date();
          const future = new Date(now.getTime() + 30*24*3600*1000);
          const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
          db.run(`INSERT INTO promotions (title, description, type, discount, discount_type, start_time, end_time, is_active, sort_order) VALUES ('🔥 夏日狂欢大促', '全场商品大促，精选商品低至5折，限时优惠不容错过！', 'promo', 50, 'percent', '${fmt(now)}', '${fmt(future)}', 1, 1)`);
          db.run(`INSERT INTO promotions (title, description, type, discount, discount_type, start_time, end_time, is_active, sort_order) VALUES ('🎉 新用户专享', '新注册用户首单满200减50，更有专属优惠券等你领取！', 'event', 0, 'percent', '${fmt(now)}', '${fmt(future)}', 1, 2)`);
          db.run(`INSERT INTO promotions (title, description, type, discount, discount_type, start_time, end_time, is_active, sort_order) VALUES ('⭐ 会员日特惠', '每周五会员日，精选商品限时特价，积分双倍！', 'event', 0, 'percent', '${fmt(now)}', '${fmt(future)}', 1, 3)`);
          console.log('✅ 已插入默认促销活动');
        }
        console.log('🎉 数据库初始化完成！');
        db.close();
      });
    });
    return;
  }
  db.run(tables[idx], (err) => {
    if (err) console.log('表创建失败:', err.message);
    idx++;
    runNext();
  });
}
runNext();