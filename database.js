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
    online INTEGER DEFAULT 0,
    city TEXT DEFAULT ''
  )`);
  db.run('ALTER TABLE user_file ADD COLUMN file_path TEXT DEFAULT ""', () => {});
  db.run('ALTER TABLE user_file ADD COLUMN file_size INTEGER DEFAULT 0', () => {});
  db.run('ALTER TABLE user_file ADD COLUMN mime_type TEXT DEFAULT ""', () => {});
  db.run('ALTER TABLE user_file ADD COLUMN enc_key TEXT DEFAULT ""', () => {});
  db.run('ALTER TABLE user_file ADD COLUMN enc_iv TEXT DEFAULT ""', () => {});
  db.run('ALTER TABLE user_file ADD COLUMN enc_salt TEXT DEFAULT ""', () => {});
  db.run('ALTER TABLE user_file ADD COLUMN enc_iterations INTEGER DEFAULT 0', () => {});

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
    model TEXT DEFAULT 'flux',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run('ALTER TABLE ai_artworks ADD COLUMN model TEXT DEFAULT \'flux\'', () => {});

  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    creator_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    last_read_id INTEGER DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, user_id)
  )`);
  db.run('ALTER TABLE group_members ADD COLUMN last_read_id INTEGER DEFAULT 0', () => {});

  db.run(`CREATE TABLE IF NOT EXISTS group_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER,
    from_user INTEGER,
    message TEXT,
    time TEXT
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
    `ALTER TABLE users ADD COLUMN enc_salt TEXT DEFAULT ''`,
    `ALTER TABLE shops ADD COLUMN is_banned INTEGER DEFAULT 0`,
    `ALTER TABLE shops ADD COLUMN warning_until TEXT DEFAULT NULL`,
    `ALTER TABLE products ADD COLUMN shipping_policy INTEGER DEFAULT 1`
  ];
  alterCmds.forEach(sql => {
    db.run(sql, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        // 忽略重复列错误
      }
    });
  });

  db.run(`CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 初始化默认商品
  db.get(`SELECT COUNT(*) as count FROM products WHERE shop_id = 0`, (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO products (shop_id, name, price) VALUES (0, '笔记本电脑', 2999.0)`);
      db.run(`INSERT INTO products (shop_id, name, price) VALUES (0, '无线耳机', 199.0)`);
      db.run(`INSERT INTO products (shop_id, name, price) VALUES (0, '机械键盘', 399.0)`);
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS ai_artworks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    image_url TEXT,
    local_path TEXT DEFAULT '',
    prompt_scene TEXT,
    prompt_adjective TEXT,
    prompt_characters TEXT,
    prompt_style TEXT,
    prompt_genre TEXT,
    prompt_artist TEXT,
    summary TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS daily_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_date TEXT NOT NULL,
    visitor_ip TEXT,
    user_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_daily_visits_date ON daily_visits (visit_date)`);

  db.run(`CREATE TABLE IF NOT EXISTS daily_pv (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_date TEXT NOT NULL UNIQUE,
    count INTEGER DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ========== 文件云盘 ==========
  db.run(`CREATE TABLE IF NOT EXISTS user_dir (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    parent_dir_id INTEGER DEFAULT NULL,
    dir_name TEXT NOT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, parent_dir_id, dir_name)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_file (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    dir_id INTEGER DEFAULT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT DEFAULT '',
    file_size INTEGER DEFAULT 0,
    mime_type TEXT DEFAULT '',
    content TEXT DEFAULT '',
    content_length INTEGER NOT NULL DEFAULT 0,
    enc_key TEXT DEFAULT '',
    enc_iv TEXT DEFAULT '',
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, dir_id, file_name)
  )`);
  db.run('ALTER TABLE user_file ADD COLUMN file_path TEXT DEFAULT ""', () => {});
  db.run('ALTER TABLE user_file ADD COLUMN file_size INTEGER DEFAULT 0', () => {});
  db.run('ALTER TABLE user_file ADD COLUMN mime_type TEXT DEFAULT ""', () => {});
  db.run('ALTER TABLE user_file ADD COLUMN enc_key TEXT DEFAULT ""', () => {});
  db.run('ALTER TABLE user_file ADD COLUMN enc_iv TEXT DEFAULT ""', () => {});

  db.run(`CREATE TABLE IF NOT EXISTS user_file_oper_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    target_type INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    oper_type TEXT NOT NULL,
    oper_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    remark TEXT DEFAULT ''
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS file_share (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    code TEXT DEFAULT '',
    expire_time DATETIME DEFAULT NULL,
    max_downloads INTEGER DEFAULT 0,
    download_count INTEGER DEFAULT 0,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS upload_chunk (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    dir_id INTEGER DEFAULT NULL,
    chunk_index INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    chunk_path TEXT NOT NULL,
    enc_key TEXT NOT NULL,
    enc_iv TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_storage_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    total_quota INTEGER NOT NULL DEFAULT 200000,
    buy_times INTEGER NOT NULL DEFAULT 0,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_storage_buy_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    cost_coin INTEGER NOT NULL DEFAULT 200,
    add_quota INTEGER NOT NULL DEFAULT 200000,
    buy_time DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 默认管理员
  const adminPassword = bcrypt.hashSync('admin123', 12);
  db.run(`INSERT OR IGNORE INTO users (username, password, balance, is_admin) VALUES ('admin', ?, 0.0, 1)`, [adminPassword]);
});

module.exports = db;