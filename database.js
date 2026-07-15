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
  db.run(`ALTER TABLE announcements ADD COLUMN game_type TEXT DEFAULT 'all'`, () => {});
  db.run(`ALTER TABLE announcements ADD COLUMN created_by INTEGER DEFAULT NULL`, () => {});

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

  // ========== 攻击日志表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS attack_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL,
    ip TEXT NOT NULL,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    attack_type TEXT NOT NULL,
    user_agent TEXT DEFAULT '',
    user_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_attack_logs_time ON attack_logs (created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_attack_logs_type ON attack_logs (attack_type)`);

  // ========== 购物车表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS cart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_id)
  )`);

  // ========== 收藏/心愿单表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS wishlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_id)
  )`);

  // ========== 用户等级表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS user_levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    level INTEGER DEFAULT 1,
    total_spent REAL DEFAULT 0,
    points INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ========== 商品分类表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    icon TEXT DEFAULT '📦',
    sort_order INTEGER DEFAULT 0
  )`);
  db.run(`ALTER TABLE products ADD COLUMN category_id INTEGER DEFAULT NULL`, () => {});
  // 初始化默认分类
  db.get("SELECT COUNT(*) as n FROM categories", (e, r) => {
    if (r && r.n === 0) {
      db.run("INSERT INTO categories (name, icon, sort_order) VALUES ('电子产品', '💻', 1)");
      db.run("INSERT INTO categories (name, icon, sort_order) VALUES ('办公用品', '📎', 2)");
      db.run("INSERT INTO categories (name, icon, sort_order) VALUES ('生活家居', '🏠', 3)");
      db.run("INSERT INTO categories (name, icon, sort_order) VALUES ('其他', '📦', 4)");
    }
  });

  // 用户表增加等级字段
  db.run(`ALTER TABLE users ADD COLUMN user_level INTEGER DEFAULT 1`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN total_points INTEGER DEFAULT 0`, () => {});

  // ========== 游戏系统表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS game_blackjack_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    bet_amount REAL NOT NULL,
    result TEXT NOT NULL,
    payout REAL NOT NULL,
    player_hands TEXT DEFAULT '[]',
    dealer_hand TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS game_wheel_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    prize_name TEXT NOT NULL,
    prize_type TEXT NOT NULL,
    prize_value REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_game_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    blackjack_games INTEGER DEFAULT 0,
    blackjack_wins INTEGER DEFAULT 0,
    blackjack_losses INTEGER DEFAULT 0,
    blackjack_pushes INTEGER DEFAULT 0,
    blackjack_net REAL DEFAULT 0,
    blackjack_points INTEGER DEFAULT 0,
    wheel_spins INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ========== Glicko2 等级分表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS game_glicko2_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    game_type TEXT NOT NULL,
    rating REAL DEFAULT 1500.0,
    rd REAL DEFAULT 350.0,
    volatility REAL DEFAULT 0.06,
    games_played INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    streak INTEGER DEFAULT 0,
    season INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, game_type, season)
  )`);

  // ========== 赛季配置表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS game_seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_type TEXT NOT NULL,
    season_number INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    start_date TEXT DEFAULT '',
    end_date TEXT DEFAULT '',
    status TEXT DEFAULT 'inactive',
    reward_first TEXT DEFAULT '',
    reward_second TEXT DEFAULT '',
    reward_third TEXT DEFAULT '',
    min_rating INTEGER DEFAULT 0,
    max_rating INTEGER DEFAULT 9999,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_type, season_number)
  )`);

  // ========== 棋盘游戏对局记录表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS game_match_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_type TEXT NOT NULL,
    room_id TEXT NOT NULL,
    player1_id INTEGER NOT NULL,
    player2_id INTEGER NOT NULL,
    winner_id INTEGER DEFAULT NULL,
    result TEXT DEFAULT '',
    player1_rating_before REAL,
    player2_rating_before REAL,
    player1_rating_after REAL,
    player2_rating_after REAL,
    player1_rd_before REAL,
    player2_rd_before REAL,
    player1_rd_after REAL,
    player2_rd_after REAL,
    is_ranked INTEGER DEFAULT 1,
    time_control TEXT DEFAULT 'standard',
    move_count INTEGER DEFAULT 0,
    pgn TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ========== 游戏房间表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS game_rooms (
    id TEXT PRIMARY KEY,
    game_type TEXT NOT NULL,
    player1_id INTEGER NOT NULL,
    player2_id INTEGER DEFAULT NULL,
    status TEXT DEFAULT 'waiting',
    is_ranked INTEGER DEFAULT 1,
    time_control TEXT DEFAULT 'standard',
    is_private INTEGER DEFAULT 0,
    password TEXT DEFAULT '',
    board_state TEXT DEFAULT '',
    current_turn INTEGER DEFAULT NULL,
    move_history TEXT DEFAULT '[]',
    started_at DATETIME DEFAULT NULL,
    finished_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ========== 画画游戏记录表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS game_draw_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    word TEXT NOT NULL,
    drawing_data TEXT DEFAULT '',
    ai_guess_result TEXT DEFAULT '',
    is_correct INTEGER DEFAULT 0,
    score INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ========== 画画卧底游戏房间表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS game_draw_undercover (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    word_common TEXT NOT NULL,
    word_undercover TEXT NOT NULL,
    player_count INTEGER DEFAULT 0,
    round INTEGER DEFAULT 1,
    status TEXT DEFAULT 'playing',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ========== 画画卧底游戏玩家表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS game_draw_undercover_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    is_undercover INTEGER DEFAULT 0,
    drawing_data TEXT DEFAULT '',
    vote_target INTEGER DEFAULT NULL,
    is_alive INTEGER DEFAULT 1,
    UNIQUE(room_id, user_id)
  )`);

  // ========== FPS 游戏统计表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS game_fps_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    games_played INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    headshots INTEGER DEFAULT 0,
    highest_wave INTEGER DEFAULT 0,
    highest_score INTEGER DEFAULT 0,
    total_score INTEGER DEFAULT 0,
    accuracy REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ========== FPS 对局记录表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS game_fps_match_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    match_type TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    headshots INTEGER DEFAULT 0,
    accuracy REAL DEFAULT 0,
    wave_reached INTEGER DEFAULT 0,
    survived INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ========== 赛季排行榜表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS game_season_leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    game_type TEXT NOT NULL,
    season INTEGER NOT NULL,
    rating REAL DEFAULT 1500,
    rank INTEGER DEFAULT 0,
    tier TEXT DEFAULT 'beginner',
    games_played INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, game_type, season)
  )`);

  // ========== 画画主题词库表 ==========
  db.run(`CREATE TABLE IF NOT EXISTS game_draw_themes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    level INTEGER DEFAULT 1,
    word TEXT NOT NULL,
    hint TEXT DEFAULT '',
    difficulty INTEGER DEFAULT 1,
    UNIQUE(category, level)
  )`);

  // 默认管理员
  const adminPassword = bcrypt.hashSync('admin123', 12);
  db.run(`INSERT OR IGNORE INTO users (username, password, balance, is_admin) VALUES ('admin', ?, 0.0, 1)`, [adminPassword]);
});

module.exports = db;