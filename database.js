const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

const dir = path.join(__dirname, 'data');
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
const db = new sqlite3.Database(path.join(dir, 'shop.db'));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    balance REAL DEFAULT 100.0,
    is_admin INTEGER DEFAULT 0,
    avatar TEXT DEFAULT '',
    is_banned INTEGER DEFAULT 0,
    reputation INTEGER DEFAULT 100,
    warning_until TEXT DEFAULT NULL,
    ban_until TEXT DEFAULT NULL,
    online INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER DEFAULT 0,
    name TEXT,
    price REAL,
    stock INTEGER DEFAULT 999
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    product_id INTEGER,
    price REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    friend_id INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS private_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user INTEGER,
    to_user INTEGER,
    message TEXT,
    time TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER,
    name TEXT,
    description TEXT,
    is_banned INTEGER DEFAULT 0,
    warning_until TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    product_id INTEGER,
    rating INTEGER,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER,
    target_type TEXT,
    target_id INTEGER,
    target_name TEXT,
    reason TEXT,
    description TEXT,
    admin_note TEXT DEFAULT '',
    action_taken TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    content TEXT,
    type TEXT DEFAULT 'info',
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS appeals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    appeal_type TEXT DEFAULT 'ban',
    content TEXT,
    status TEXT DEFAULT 'pending',
    admin_reply TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 兼容旧表：补齐可能缺失的字段
  const alterCmds = [
    `ALTER TABLE users ADD COLUMN ban_until TEXT DEFAULT NULL`,
    `ALTER TABLE users ADD COLUMN reputation INTEGER DEFAULT 100`,
    `ALTER TABLE users ADD COLUMN warning_until TEXT DEFAULT NULL`,
    `ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN online INTEGER DEFAULT 0`,
    `ALTER TABLE shops ADD COLUMN is_banned INTEGER DEFAULT 0`,
    `ALTER TABLE shops ADD COLUMN warning_until TEXT DEFAULT NULL`
  ];
  alterCmds.forEach(sql => {
    db.run(sql, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        // 忽略重复列错误
      }
    });
  });

  // 初始化默认商品
  db.get(`SELECT COUNT(*) as count FROM products WHERE shop_id = 0`, (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO products (shop_id, name, price) VALUES (0, '笔记本电脑', 2999.0)`);
      db.run(`INSERT INTO products (shop_id, name, price) VALUES (0, '无线耳机', 199.0)`);
      db.run(`INSERT INTO products (shop_id, name, price) VALUES (0, '机械键盘', 399.0)`);
    }
  });

  // 默认管理员
  const adminPassword = bcrypt.hashSync('admin123', 12);
  db.run(`INSERT OR IGNORE INTO users (username, password, balance, is_admin) VALUES ('admin', ?, 0.0, 1)`, [adminPassword]);
});

module.exports = db;