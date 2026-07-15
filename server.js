const express = require('express');
const { getDistanceKM, cityCoord } = require('./distance');
// 运费计算
function calcShippingFee(carrier, weight, distanceKm) {
  const base = { '邮政': 8, '中通': 12, '顺丰陆运': 18, '顺丰空运': 23 }[carrier] || 10;
  const perKg = { '邮政': 2, '中通': 3, '顺丰陆运': 5, '顺丰空运': 10 }[carrier] || 3;
  const extraKg = Math.max(0, weight - 1);
  let distMultiplier = 1;
  if (distanceKm > 2000) distMultiplier = 2.0;
  else if (distanceKm > 1000) distMultiplier = 1.6;
  else if (distanceKm > 500) distMultiplier = 1.3;
  else if (distanceKm > 100) distMultiplier = 1.0;
  else distMultiplier = 0.8;
  return Math.round((base + extraKg * perKg) * distMultiplier * 100) / 100;
}
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const csurf = require('csurf');
const bcrypt = require('bcrypt');
const validator = require('validator');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const multer = require('multer');
const path = require('path');
const http = require('http');
const fs = require('fs');
const socketio = require('socket.io');
const crypto = require('crypto');
const { ENC_MAGIC, ENC_ALGO, ENC_VERSION, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST, ENC_GLOBAL_SALT, HDR_MIN_SIZE, parseEncFileHeader, deriveAesKey, encryptFileStream, decryptToStream, decryptToBuffer, decryptText } = require('./crypto-utils');
const url = require('url');
const glicko2 = require('./glicko2');
const typhoonApp = require('./typhoon/app');

// 启动GFS气象数据同步（定时任务+启动自检）
// 异步启动，不影响主服务器启动流程
(async () => {
  try {
    // 启动时立即执行一次自检
    await typhoonApp.initWeatherSync();
    // 启动定时任务（UTC 00/06/12/18）
    typhoonApp.startWeatherSyncCron();
  } catch (e) {
    console.error('GFS气象同步初始化失败:', e.message);
  }
})();

// 启动天气数据缓存（海温+洋流，每20分钟更新）
(async () => {
  try {
    // 首次启动时立即刷新缓存
    await typhoonApp.refreshWeatherCache();
    // 启动定时任务（每20分钟）
    typhoonApp.startWeatherCacheCron();
  } catch (e) {
    console.error('天气数据缓存初始化失败:', e.message);
  }
})();

// ========== SSRF 防护：阻止访问内网、本地、云元数据地址 ==========
const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254', '[::1]', '::1'];
const BLOCKED_CIDR = [
  { prefix: '10.', mask: 8 },
  { prefix: '172.16.', mask: 12, end: '172.31.' },
  { prefix: '192.168.', mask: 16 }
];
function isSafeUrl(targetUrl) {
  try {
    const parsed = new url.URL(targetUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTS.includes(hostname)) return false;
    for (const cidr of BLOCKED_CIDR) {
      if (hostname.startsWith(cidr.prefix)) {
        if (!cidr.end) return false;
        const num = parseInt(hostname.split('.')[1]);
        if (num >= 16 && num <= 31) return false;
        return true;
      }
    }
    return true;
  } catch (e) { return false; }
}

const app = express();
app.set('trust proxy', 1);
const httpServer = http.createServer(app);
httpServer.timeout = 600000;
const io = socketio(httpServer, { cors: { origin: ['http://localhost:3000', 'http://127.0.0.1:3000'], methods: ['GET', 'POST'] } });

app.use(express.static('public'));
// 气象JSON数据静态目录（供前端读取）
app.use('/weather-data', express.static(path.join(__dirname, 'static', 'weather')));

// 安全头中间件（自定义 CSP 不含 upgrade-insecure-requests，避免 HTTPS 升级问题）
app.use(helmet({
  contentSecurityPolicy: false,
  strictTransportSecurity: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false
}));
// 手动设置 CSP，可控且不含 upgrade-insecure-requests
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self';script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://webrd01.is.autonavi.com https://webrd02.is.autonavi.com https://webrd03.is.autonavi.com https://webrd04.is.autonavi.com https://webst01.is.autonavi.com https://webst02.is.autonavi.com https://webst03.is.autonavi.com https://webst04.is.autonavi.com;script-src-attr 'unsafe-inline';style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com;img-src 'self' data: https: http:;font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com;connect-src 'self' ws: wss:;frame-src 'self';form-action 'self';frame-ancestors 'self';object-src 'none';base-uri 'self'");
  next();
});

// 登录与注册限流
const loginLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 20 });
const registerLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10 });

// 服务器启动时重置所有用户为离线状态
db.run('UPDATE users SET online = 0');

// 在线用户列表
const onlineUsers = new Map();
const allConnections = new Map(); // socketId -> { id, username, page, ip } 所有连接（含访客）
const attackLog = [];
const MAX_ATTACK_LOG = 200;

function classifyAttack(req) {
  const bodyText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const queryText = JSON.stringify(req.query || {});
  const raw = [
    req.method || '',
    req.originalUrl || req.url || '',
    req.path || '',
    req.get('user-agent') || '',
    bodyText,
    queryText
  ].join('\n').toLowerCase();
  if (/(<\s*script|javascript:|onerror=|onload=)/i.test(raw)) return 'XSS';
  if (/(union\s+select|select\s+.+\s+from|delete\s+from|drop\s+table|insert\s+into|update\s+.*\s+set|or\s+['\"]?\s*\d+\s*['\"]?\s*=\s*['\"]?\s*\d+|sleep\s*\()/i.test(raw)) return 'SQL注入';
  if (/(\.\.\/|%2e%2e|\/etc\/passwd|\.\/\.\.)/i.test(raw)) return '路径遍历';
  return null;
}

function pushAttackLog(req, atk) {
  const logEntry = {
    time: new Date().toLocaleTimeString(),
    ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
    method: req.method,
    url: req.originalUrl || req.url || '',
    atk,
    ua: (req.get('user-agent') || '').substring(0, 120)
  };
  attackLog.push(logEntry);
  if (attackLog.length > MAX_ATTACK_LOG) attackLog.shift();
  // 持久化到数据库
  const userId = req.session && req.session.user ? req.session.user.id : null;
  db.run('INSERT INTO attack_logs (time, ip, method, url, attack_type, user_agent, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [logEntry.time, logEntry.ip, logEntry.method, logEntry.url, atk, logEntry.ua, userId]);
  // 实时推送攻击告警给管理员
  io.emit('attackAlert', logEntry);
  // 通知管理员（每5次攻击只通知一次，避免刷屏）
  if (attackLog.length % 5 === 0) {
    notifyAdmins('⚠️ 安全告警', `已检测到 ${attackLog.length} 次攻击尝试，请查看安全仪表盘`, 'warning');
  }
}

// 验证码生成函数
function generateCaptcha() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40">
    <rect width="100" height="40" fill="#f0f0f0"/>
    <text x="10" y="28" font-size="24" fill="#333" font-family="Arial">${code}</text>
    <line x1="0" y1="10" x2="100" y2="15" stroke="#ccc" stroke-width="1"/>
    <line x1="0" y1="25" x2="100" y2="30" stroke="#ccc" stroke-width="1"/>
  </svg>`;
  return { code, svg };
}

const storage = multer.diskStorage({
  destination: 'public/uploads/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '');
    cb(null, Date.now() + '-' + (name || 'file') + ext);
  }
});
const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'application/pdf', 'text/plain', 'application/zip', 'application/x-zip-compressed'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new Error('不支持的文件类型'), false);
};
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter });
const chatUpload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter });

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
const cookieParser = require('cookie-parser');
app.use(cookieParser());
app.use((req, res, next) => {
  const atk = classifyAttack(req);
  if (atk) pushAttackLog(req, atk);
  next();
});

// 确保 sessions 目录存在（使用绝对路径）
const sessionDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

// 使用文件存储session，重启服务器不影响登录
app.use(session({
  store: new FileStore({
    path: sessionDir,
    ttl: 86400,
    retries: 0
  }),
  secret: process.env.SESSION_SECRET || 'cloud-disk-fixed-secret-2024',
  resave: true,
  saveUninitialized: true,
  cookie: { httpOnly: true, sameSite: 'strict', secure: false }
}));

const csrfProtection = csurf({ cookie: false });
app.use((req, res, next) => {
if (req.path.startsWith('/typhoon/') || ['/chat/upload', '/upload', '/upload-url', '/appeal', '/friend/group', '/track', '/prompt-generator', '/prompt-generator/publish', '/prompt-generator/download'].includes(req.path) || req.path.startsWith('/refund/apply') || req.path.startsWith('/admin/refunds/') || req.path.startsWith('/admin/flash') || req.path.startsWith('/admin/coupons') || req.path.startsWith('/shop/manage') || req.path.startsWith('/shop/coupons') || req.path.startsWith('/shop/product') || req.path.startsWith('/redeem') || req.path.startsWith('/shop/ship') || req.path.startsWith('/shop/warehouses') || req.path.startsWith('/admin/users/balance') || req.path.startsWith('/admin/login') || req.path.startsWith('/login') || req.path.startsWith('/register') || (req.path.startsWith('/orders/') && (req.path.includes('/track') || req.path.includes('/sign') || req.path.includes('/return'))) || req.path.startsWith('/admin/ai-artworks') || req.path.startsWith('/admin/announcements') || req.path.startsWith('/ai-image/') || req.path.startsWith('/api/') || req.path.startsWith('/socket.io') || req.path.startsWith('/profile')) return next();
  csrfProtection(req, res, next);
});
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
  res.locals.user = req.session.user || null;
  next();
});

// 日活统计中间件（必须在 session 之后）
app.use((req, res, next) => {
  if (req.path.startsWith('/socket.io') || req.path.startsWith('/uploads') || req.path.startsWith('/favicon')) return next();
  const today = new Date().toISOString().split('T')[0];
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const userId = req.session.user ? req.session.user.id : null;
  db.get('SELECT id FROM daily_visits WHERE visit_date = ? AND visitor_ip = ?', [today, ip], (err, row) => {
    if (!err && !row) {
      db.run('INSERT INTO daily_visits (visit_date, visitor_ip, user_id) VALUES (?, ?, ?)', [today, ip, userId], function() {
        db.get('SELECT COUNT(*) as count FROM daily_visits WHERE visit_date = ?', [today], (e, r) => {
          if (!e) io.emit('dauUpdate', r ? r.count : 0);
        });
      });
    }
  });
  db.run('INSERT INTO daily_pv (visit_date, count) VALUES (?, 1) ON CONFLICT(visit_date) DO UPDATE SET count = count + 1', [today]);
  next();
});

app.set('view engine', 'ejs');
app.set('view cache', false);
const ejs = require('ejs');
ejs.clearCache();
app.use((req, res, next) => { ejs.clearCache(); next(); });

function sanitize(str) { return typeof str === 'string' ? validator.escape(validator.trim(str)) : ''; }

function syncSessionShop(req, cb) {
  if (!req.session.user || !req.session.user.id) return cb && cb();
  db.get('SELECT id, name FROM shops WHERE owner_id = ?', [req.session.user.id], (err, shop) => {
    if (!err && shop) {
      req.session.user.shopId = shop.id;
      req.session.user.shopName = shop.name;
    } else {
      req.session.user.shopId = null;
      req.session.user.shopName = '';
    }
    if (cb) cb();
  });
}

function isAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  db.get('SELECT balance, is_banned, reputation, warning_until, ban_until FROM users WHERE id = ?', [req.session.user.id], (err, row) => {
    if (err || !row) {
      req.session.destroy();
      return res.redirect('/login');
    }
    const now = Date.now();
    // 检查临时封禁是否已到期（ban_until 过去则自动解封）
    if (row.is_banned && row.ban_until) {
      const until = Date.parse(row.ban_until);
      if (!isNaN(until) && until <= now) {
        db.run('UPDATE users SET is_banned = 0, ban_until = NULL WHERE id = ?', [req.session.user.id]);
        row.is_banned = 0;
      }
    }
    if (row.is_banned) {
      const username = req.session.user.username;
      req.session.user.isBanned = true;
      return res.render('banned', { username, banUntil: row.ban_until, reason: '', appealSent: false });
    }
    // 检查警告是否过期
    let warningActive = false;
    let warningUntil = null;
    if (row.warning_until) {
      const until = Date.parse(row.warning_until);
      if (!isNaN(until) && until <= now) {
        db.run('UPDATE users SET warning_until = NULL WHERE id = ?', [req.session.user.id]);
      } else {
        warningActive = true;
        warningUntil = row.warning_until;
      }
    }
    req.session.user.balance = row.balance;
    req.session.user.reputation = row.reputation;
    req.session.user.warningActive = warningActive;
    req.session.user.warningUntil = warningUntil;
    // 读取店铺状态供后续页面使用
    db.get('SELECT id, name, is_banned, warning_until FROM shops WHERE owner_id = ?', [req.session.user.id], (err2, shop) => {
      req.session.user.shop = shop || null;
      if (shop) { req.session.user.shopId = shop.id; req.session.user.shopName = shop.name; }
      next();
    });
  });
}

function isAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.isAdmin) return res.status(403).send('无权访问');
  next();
}

function notifyAdmins(title, content, type = 'info') {
  db.all('SELECT id FROM users WHERE is_admin = 1', (err, admins) => {
    if (err || !admins) return;
    admins.forEach(a => {
      db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [a.id, title, content, type], function() {
        const notifId = this.lastID;
        // 实时推送通知给在线管理员
        for (let [sid, user] of onlineUsers) {
          if (user.id == a.id) {
            io.to(sid).emit('newNotification', { id: notifId, title, content, type, time: new Date().toLocaleTimeString(), is_read: 0 });
          }
        }
      });
    });
  });
}

// ========== 路由 ==========
app.get('/captcha', (req, res) => {
  const cap = generateCaptcha();
  req.session.captcha = cap.code;
  res.set('Content-Type', 'image/svg+xml');
  res.send(cap.svg);
});

app.get('/', (req, res) => res.redirect('/shop'));

app.get('/register', (req, res) => res.render('register'));
app.post('/register', registerLimiter, (req, res) => {
  const captchaInput = (req.body.captcha || '').toUpperCase();
  const captchaReal = (req.session.captcha || '').toUpperCase();
  if (captchaInput !== captchaReal) return res.status(400).send('验证码错误');
  const u = sanitize(req.body.username || ''), p = req.body.password || '';
  if (!validator.isLength(u, { min: 3, max: 20 }) || !validator.isAlphanumeric(u)) return res.status(400).send('用户名不合法');
  if (p.length < 6) return res.status(400).send('密码至少6位');
  bcrypt.hash(p, 12, (err, hash) => {
    if (err) return res.status(500).send('服务器错误');
    db.run('INSERT INTO users (username, password, balance) VALUES (?, ?, 100.0)', [u, hash], function (err) {
      if (err) return res.status(400).send(err.message.includes('UNIQUE') ? '用户名已存在' : '服务器错误');
      const newUserId = this.lastID;
      // 自动生成邀请码
      const inviteCode = uuidv4().slice(0, 8).toUpperCase();
      db.run('INSERT OR IGNORE INTO invite_codes (user_id, code) VALUES (?, ?)', [newUserId, inviteCode], () => {
        // 自动赠送新人优惠券 WELCOME10
        db.get('SELECT id FROM coupons WHERE code = ?', ['WELCOME10'], (err2, coupon) => {
          if (coupon) {
            db.run('INSERT INTO user_coupons (user_id, coupon_id) VALUES (?, ?)', [newUserId, coupon.id], () => {});
          }
        });
        // 处理邀请码：如果填写了邀请码，查找邀请人并创建关联
        const inviteCodeInput = (req.body.invite_code || '').toUpperCase().trim();
        console.log('[DEBUG] inviteCodeInput:', inviteCodeInput, 'raw:', req.body.invite_code);
        if (inviteCodeInput) {
          db.get('SELECT id, user_id FROM invite_codes WHERE code = ?', [inviteCodeInput], (err3, inviter) => {
            if (inviter && inviter.user_id !== newUserId) {
              // 给邀请人奖励（5元）
              const reward = 5.0;
              db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [reward, inviter.user_id], () => {
                // 记录邀请关系
                db.run('INSERT INTO referrals (inviter_id, invitee_id, code, reward_amount) VALUES (?, ?, ?, ?)',
                  [inviter.user_id, newUserId, inviteCodeInput, reward], () => {
                  // 给邀请人发通知
                  db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)',
                    [inviter.user_id, '🎉 邀请成功', '您邀请的好友已注册成功，获得 ¥' + reward + ' 奖励！', 'success']);
                  // 给新用户也发一张额外优惠券作为奖励
                  db.get('SELECT id FROM coupons WHERE code = ?', ['AUTO5'], (err4, bonusCoupon) => {
                    if (bonusCoupon) {
                      db.run('INSERT INTO user_coupons (user_id, coupon_id) VALUES (?, ?)', [newUserId, bonusCoupon.id], () => {});
                    }
                  });
                });
              });
            }
          });
        }
        res.redirect('/login');
      });
    });
  });
});

app.get('/login', (req, res) => res.render('login'));
app.post('/login', loginLimiter, (req, res) => {
  const u = sanitize(req.body.username || ''), p = req.body.password || '';
  db.get('SELECT * FROM users WHERE username = ?', [u], (err, user) => {
    if (err || !user) return res.status(401).send('用户名或密码错误');
    bcrypt.compare(p, user.password, (err, ok) => {
      if (ok) {
        const now = Date.now();
        // 自动解封：临时封禁到期后自动解除
        if (user.is_banned && user.ban_until) {
          const until = Date.parse(user.ban_until);
          if (!isNaN(until) && until <= now) {
            db.run('UPDATE users SET is_banned = 0, ban_until = NULL WHERE id = ?', [user.id]);
            user.is_banned = 0;
            user.ban_until = null;
          }
        }
        // 封禁用户建立临时 session，用于申诉识别身份
        if (user.is_banned) {
          req.session.user = {
            id: user.id, username: user.username,
            balance: 0, reputation: user.reputation,
            warningActive: false, warningUntil: null,
            isAdmin: false, isBanned: true,
            shopId: null, shopName: ''
          };
          req.session.save(() => {
            res.render('banned', { username: user.username, banUntil: user.ban_until, appealSent: false, reason: '', shopBanned: false });
          });
          return;
        }
        // 直接更新现有 session，不重建 session 避免竞态条件
        let warningActive = false;
        let warningUntil = null;
        if (user.warning_until) {
          const until = Date.parse(user.warning_until);
          if (!isNaN(until) && until <= now) {
            db.run('UPDATE users SET warning_until = NULL WHERE id = ?', [user.id]);
          } else {
            warningActive = true;
            warningUntil = user.warning_until;
          }
        }
        req.session.user = {
          id: user.id, username: user.username, balance: user.balance,
          reputation: user.reputation, warningActive, warningUntil,
          isAdmin: !!user.is_admin, shopId: null, shopName: ''
        };
        // 派生 AES 密钥: PBKDF2(密码, 全局盐+用户盐, 迭代, 32, sha256)
        const userSalt = user.enc_salt ? Buffer.from(user.enc_salt, 'hex') : crypto.randomBytes(16);
        if (!user.enc_salt) {
          db.run('UPDATE users SET enc_salt = ? WHERE id = ?', [userSalt.toString('hex'), user.id]);
        }
        req.session.user.encKey = crypto.pbkdf2Sync(p, Buffer.concat([ENC_GLOBAL_SALT, userSalt]), PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString('hex');
        req.session.user.encSalt = userSalt.toString('hex');
        db.get('SELECT id, name, is_banned, warning_until FROM shops WHERE owner_id = ?', [user.id], (err2, shop) => {
          if (!err2 && shop) {
            req.session.user.shopId = shop.id;
            req.session.user.shopName = shop.name;
            req.session.user.shop = shop;
          }
          db.run('UPDATE users SET online = 1 WHERE id = ?', [user.id]);
          // 强制保存 session 后再跳转，确保 session 写入完成
          req.session.save(() => {
            res.redirect(user.is_admin ? '/admin/dashboard' : '/shop');
          });
        });
        return;
      }
      res.status(401).send('用户名或密码错误');
    });
  });
});

app.get('/logout', (req, res) => {
  if (req.session.user) {
    db.run('UPDATE users SET online = 0 WHERE id = ?', [req.session.user.id]);
    io.emit('onlineUsers', Array.from(onlineUsers.values()));
  }
  req.session.destroy();
  res.redirect('/login');
});

app.get('/shop/json', isAuth, (req, res) => {
  db.all(`SELECT p.*, s.name as shop_name FROM products p LEFT JOIN shops s ON p.shop_id = s.id ORDER BY p.id DESC`, (err, products) => {
    res.json(products.map(p => ({ id: p.id, name: p.name, shop_id: p.shop_id, shop_name: p.shop_name })));
  });
});

// ========== 商品搜索API ==========
app.get('/shop/search', isAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  const minPrice = parseFloat(req.query.minPrice) || 0;
  const maxPrice = parseFloat(req.query.maxPrice) || 0;
  const sort = req.query.sort || 'default';
  
  let where = '1=1';
  const params = [];
  if (q) { where += ' AND p.name LIKE ?'; params.push('%' + q + '%'); }
  if (minPrice > 0) { where += ' AND p.price >= ?'; params.push(minPrice); }
  if (maxPrice > 0) { where += ' AND p.price <= ?'; params.push(maxPrice); }
  
  let order = 'p.id DESC';
  if (sort === 'price_asc') order = 'p.price ASC';
  else if (sort === 'price_desc') order = 'p.price DESC';
  else if (sort === 'newest') order = 'p.id DESC';
  
  db.all(`SELECT p.*, s.name as shop_name,
    COALESCE(r.avg_rating, 0) as avg_rating,
    COALESCE(r.cnt, 0) as review_count
    FROM products p LEFT JOIN shops s ON p.shop_id = s.id
    LEFT JOIN (SELECT product_id, AVG(rating) as avg_rating, COUNT(*) as cnt FROM reviews GROUP BY product_id) r ON p.id = r.product_id
    WHERE ${where} ORDER BY ${order}`, params, (err, products) => {
    db.all(`SELECT p.id, p.name, p.price, p.shop_id, s.name as shop_name FROM products p LEFT JOIN shops s ON p.shop_id = s.id ORDER BY (SELECT COUNT(*) FROM orders WHERE product_id = p.id) DESC LIMIT 10`, (e2, hot) => {
      res.render('shop_search', {
        user: req.session.user,
        products: products || [],
        hotKeywords: (hot || []).map(h => h.name),
        query: q,
        minPrice,
        maxPrice,
        sort,
        csrfToken: req.csrfToken ? req.csrfToken() : ''
      });
    });
  });
});

app.get('/shop', isAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(60, Math.max(12, parseInt(req.query.limit) || 24));
  const offset = (page - 1) * limit;
  const category = req.query.category || '';
  const q = (req.query.q || '').trim();
  const sort = req.query.sort || 'newest';

  let where = '1=1';
  const params = [];
  if (category) { where += ' AND p.category = ?'; params.push(category); }
  if (q) { where += ' AND p.name LIKE ?'; params.push('%' + q + '%'); }

  let orderBy = 'p.id DESC';
  if (sort === 'price_asc') orderBy = 'p.price ASC';
  else if (sort === 'price_desc') orderBy = 'p.price DESC';
  else if (sort === 'sales') orderBy = 'p.sales_count DESC';
  else if (sort === 'newest') orderBy = 'p.id DESC';

  db.get(`SELECT COUNT(*) as total FROM products p WHERE ${where}`, params, (err, countRow) => {
    if (err) return res.status(500).send('服务器错误');
    const total = countRow ? countRow.total : 0;
    const totalPages = Math.ceil(total / limit);

    db.all(`SELECT p.*, s.name as shop_name,
      COALESCE(r.avg_rating, 0) as avg_rating,
      COALESCE(r.review_count, 0) as review_count
      FROM products p
      LEFT JOIN shops s ON p.shop_id = s.id
      LEFT JOIN (
        SELECT product_id, ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as review_count
        FROM reviews GROUP BY product_id
      ) r ON r.product_id = p.id
      WHERE ${where}
      ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...params, limit, offset], (err2, products) => {
      if (err2) return res.status(500).send('服务器错误');

      db.all('SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != \'\' ORDER BY category', (err3, cats) => {
        db.all(`SELECT f.*, p.name, p.price as original_price 
          FROM flash_sales f JOIN products p ON f.product_id = p.id 
          WHERE f.is_active = 1 AND f.stock > 0 
          AND datetime(f.start_time) <= datetime('now','localtime') 
          AND datetime(f.end_time) > datetime('now','localtime')`, (err4, flashSales) => {
          db.all(`SELECT s.*, o.price, p.name as product_name
            FROM shipments s JOIN orders o ON s.order_id = o.id 
            JOIN products p ON o.product_id = p.id
            WHERE o.user_id = ? AND s.status IN ('shipped','delivered')
            ORDER BY s.shipped_at DESC LIMIT 5`, [req.session.user.id], (err5, shipments) => {
            db.all('SELECT * FROM announcements WHERE is_active = 1 ORDER BY id DESC', (err6, announcements) => {
            db.all('SELECT * FROM product_images', (err7, images) => {
            // 获取推荐商品（热门商品补充）
            db.all(`SELECT p.id, p.name, p.price, p.sales_count, p.category,
              COALESCE(r.avg_rating, 0) as avg_rating
              FROM products p
              LEFT JOIN (SELECT product_id, ROUND(AVG(rating), 1) as avg_rating FROM reviews GROUP BY product_id) r ON r.product_id = p.id
              WHERE 1=1
              ORDER BY (SELECT COUNT(*) FROM orders WHERE product_id = p.id) DESC
              LIMIT 12`, (err8, hotProducts) => {
              // 获取促销活动
              db.all(`SELECT * FROM promotions WHERE is_active = 1
                AND datetime(start_time) <= datetime('now','localtime')
                AND datetime(end_time) > datetime('now','localtime')
                ORDER BY id DESC`, (err9, promotions) => {
                // 检查用户是否为新用户（无订单记录）
                db.get('SELECT COUNT(*) as cnt FROM orders WHERE user_id = ?', [req.session.user.id], function(err10, orderRow) {
                const isNewUser = !err10 && orderRow && orderRow.cnt === 0;
                res.render('shop', { 
                  products: products || [],
                  categories: (cats || []).map(c => c.category),
                  currentCategory: category,
                  currentPage: page,
                  totalPages,
                  total,
                  limit,
                  q,
                  sort,
                  flashSales: flashSales || [],
                  shipments: shipments || [],
                  announcements: announcements || [],
                  images: images || [],
                  balance: req.session.user.balance, 
                  warningActive: req.session.user.warningActive, 
                  warningUntil: req.session.user.warningUntil,
                  recommendations: hotProducts || [],
                  promotions: promotions || [],
                  isNewUser: isNewUser
                });
                });
              });
            });
            });
            });
          }); 
          });
        });
      });
    });
});

// ========== 购物车API ==========
app.post('/api/cart/add', isAuth, (req, res) => {
  const pid = parseInt(req.body.product_id);
  if (!pid) return res.json({ ok: false, msg: '参数错误' });
  db.get('SELECT id FROM products WHERE id = ?', [pid], (e, p) => {
    if (!p) return res.json({ ok: false, msg: '商品不存在' });
    db.run('INSERT INTO cart (user_id, product_id, quantity) VALUES (?, ?, 1) ON CONFLICT(user_id, product_id) DO UPDATE SET quantity = quantity + 1',
      [req.session.user.id, pid], (e2) => {
      if (e2) return res.json({ ok: false, msg: '添加失败' });
      db.get('SELECT SUM(quantity) as cnt FROM cart WHERE user_id = ?', [req.session.user.id], (e3, r) => {
        res.json({ ok: true, msg: '已加入购物车', count: r ? r.cnt : 0 });
      });
    });
  });
});

app.get('/api/cart/list', isAuth, (req, res) => {
  db.all(`SELECT c.*, p.name, p.price, p.shop_id, s.name as shop_name, p.stock,
    COALESCE(r.avg_rating, 0) as avg_rating
    FROM cart c JOIN products p ON c.product_id = p.id
    LEFT JOIN shops s ON p.shop_id = s.id
    LEFT JOIN (SELECT product_id, AVG(rating) as avg_rating FROM reviews GROUP BY product_id) r ON r.product_id = p.id
    WHERE c.user_id = ? ORDER BY c.created_at DESC`, [req.session.user.id], (e, items) => {
    res.json(items || []);
  });
});

app.post('/api/cart/update', isAuth, (req, res) => {
  const pid = parseInt(req.body.product_id);
  const qty = parseInt(req.body.quantity);
  if (!pid || qty < 0) return res.json({ ok: false });
  if (qty === 0) {
    db.run('DELETE FROM cart WHERE user_id = ? AND product_id = ?', [req.session.user.id, pid]);
  } else {
    db.run('UPDATE cart SET quantity = ? WHERE user_id = ? AND product_id = ?', [qty, req.session.user.id, pid]);
  }
  res.json({ ok: true });
});

app.post('/api/cart/clear', isAuth, (req, res) => {
  db.run('DELETE FROM cart WHERE user_id = ?', [req.session.user.id]);
  res.json({ ok: true });
});

app.get('/api/cart/count', isAuth, (req, res) => {
  db.get('SELECT SUM(quantity) as cnt FROM cart WHERE user_id = ?', [req.session.user.id], (e, r) => {
    res.json({ count: r ? r.cnt : 0 });
  });
});

// ========== 购物车结算API ==========
app.post('/api/cart/checkout', isAuth, (req, res) => {
  db.all(`SELECT c.product_id, c.quantity, p.name, p.price, p.stock, p.shop_id, f.flash_price
    FROM cart c JOIN products p ON c.product_id = p.id
    LEFT JOIN flash_sales f ON f.product_id = p.id AND f.is_active = 1 AND f.stock > 0
      AND datetime(f.start_time) <= datetime('now','localtime') 
      AND datetime(f.end_time) > datetime('now','localtime')
    WHERE c.user_id = ?`, [req.session.user.id], (err, items) => {
    if (err) return res.json({ ok: false, msg: '查询购物车失败' });
    if (!items || items.length === 0) return res.json({ ok: false, msg: '购物车为空' });

    // 检查库存
    for (const item of items) {
      if (item.stock < item.quantity) {
        return res.json({ ok: false, msg: `商品"${item.name}"库存不足（仅剩${item.stock}件）` });
      }
    }

    // 查询每个商品的促销折扣（秒杀价优先）
    let promoChecked = 0;
    const totalItems = items.length;
    items.forEach(function(item, idx) {
      // 如果该商品有秒杀活动，使用秒杀价作为基础价
      if (item.flash_price) {
        items[idx].price = item.flash_price;
      }
      getPromoDiscountForProduct(item.product_id, item.price, req.session.user.id, function(promoInfo) {
        if (promoInfo.discounted) {
          items[idx].price = promoInfo.finalPrice;
          items[idx].promo_discount = promoInfo.promoDiscountText;
          items[idx].promo_title = promoInfo.promoTitle;
        }
        promoChecked++;
        if (promoChecked >= totalItems) {
          // 所有商品促销检查完毕，计算总价
          checkoutWithItems(items, req, res);
        }
      });
    });
    // 保底：如果没有商品（理论上不会发生），直接返回错误
    if (totalItems === 0) return res.json({ ok: false, msg: '购物车为空' });
  });
});

function checkoutWithItems(items, req, res) {
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    db.get('SELECT balance FROM users WHERE id = ?', [req.session.user.id], (err, user) => {
      if (err || !user || user.balance < total) return res.json({ ok: false, msg: '余额不足，请先充值' });

      const newBalance = Math.round((user.balance - total) * 100) / 100;

      db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        let hasError = false;
        function abortTx(msg) {
          if (hasError) return true;
          hasError = true;
          db.run('ROLLBACK');
          res.json({ ok: false, msg });
          return true;
        }

        db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, req.session.user.id], (err) => {
          if (err) abortTx('扣款失败');
        });

        const orderIds = [];
        let completed = 0;
        const totalItems = items.length;

        items.forEach((item) => {
          const oid = require('uuid').v4();
          orderIds.push(oid);
          db.run('INSERT INTO orders (id, user_id, product_id, price) VALUES (?, ?, ?, ?)',
            [oid, req.session.user.id, item.product_id, item.price * item.quantity], (err) => {
            if (err) { abortTx('创建订单失败'); return; }
          });

          db.run('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.product_id], (err) => {
            if (err) abortTx('更新库存失败');
          });

          // 购物车秒杀库存扣减
          if (item.flash_price) {
            db.run('UPDATE flash_sales SET stock = stock - ? WHERE product_id = ? AND stock >= ?', [item.quantity, item.product_id, item.quantity], function() {
              if (this.changes > 0) {
                db.get('SELECT stock FROM flash_sales WHERE product_id = ?', [item.product_id], (e, fs) => {
                  if (!e) io.emit('flashStockUpdate', { productId: item.product_id, stock: fs ? fs.stock : 0 });
                });
              }
            });
          }

          // 官方商品自动发货
          if (item.shop_id === 0) {
            const tracking = 'YZ' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
            const hours = 24 + Math.floor(Math.random() * 72);
            const d = new Date(Date.now() + hours * 3600000);
            const p = n => String(n).padStart(2, '0');
            const deliverAt = `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
            db.run(`INSERT INTO shipments (order_id, carrier, speed, tracking_number, weight, estimate_hours, deliver_at, status) VALUES (?, '邮政', '标准', ?, 1, ?, ?, 'shipped')`,
              [oid, tracking, hours, deliverAt]);
            db.run("UPDATE orders SET status = 'shipped' WHERE id = ?", [oid]);
          }

          completed++;
        });

        // 清理购物车
        db.run('DELETE FROM cart WHERE user_id = ?', [req.session.user.id]);

        // 更新用户等级和积分
        const spent = total;
        const pointsEarned = Math.floor(spent);
        db.run('INSERT INTO user_levels (user_id, total_spent, points) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET total_spent = total_spent + ?, points = points + ?, updated_at = CURRENT_TIMESTAMP',
          [req.session.user.id, spent, pointsEarned, spent, pointsEarned]);

        db.run('COMMIT', (commitErr) => {
          if (commitErr || hasError) { abortTx('提交事务失败'); return; }

          req.session.user.balance = newBalance;
          req.session.save(() => {
            // 发送余额更新
            for (let [sid, u] of onlineUsers) {
              if (u.id == req.session.user.id) { io.to(sid).emit('balanceUpdate', newBalance); break; }
            }
            // 更新购物车徽章
            io.emit('cartUpdate', { userId: req.session.user.id, count: 0 });
            // 积分更新
            db.get('SELECT points FROM user_levels WHERE user_id = ?', [req.session.user.id], (e, lv) => {
              if (lv) io.emit('pointsUpdate', { userId: req.session.user.id, points: lv.points });
            });

            res.json({ ok: true, msg: '结算成功', total, count: totalItems, orderCount: orderIds.length });
          });
        });
      });
    });
}

// ========== 收藏/心愿单API ==========
app.post('/api/wishlist/toggle', isAuth, (req, res) => {
  const pid = parseInt(req.body.product_id);
  if (!pid) return res.json({ ok: false });
  db.get('SELECT id FROM wishlist WHERE user_id = ? AND product_id = ?', [req.session.user.id, pid], (e, existing) => {
    if (existing) {
      db.run('DELETE FROM wishlist WHERE id = ?', [existing.id]);
      res.json({ ok: true, action: 'removed' });
    } else {
      db.run('INSERT INTO wishlist (user_id, product_id) VALUES (?, ?)', [req.session.user.id, pid]);
      res.json({ ok: true, action: 'added' });
    }
  });
});

app.get('/api/wishlist/list', isAuth, (req, res) => {
  db.all(`SELECT w.*, p.name, p.price, p.shop_id, s.name as shop_name, p.stock,
    COALESCE(r.avg_rating, 0) as avg_rating
    FROM wishlist w JOIN products p ON w.product_id = p.id
    LEFT JOIN shops s ON p.shop_id = s.id
    LEFT JOIN (SELECT product_id, AVG(rating) as avg_rating FROM reviews GROUP BY product_id) r ON r.product_id = p.id
    WHERE w.user_id = ? ORDER BY w.created_at DESC`, [req.session.user.id], (e, items) => {
    res.json(items || []);
  });
});

app.get('/api/wishlist/ids', isAuth, (req, res) => {
  db.all('SELECT product_id FROM wishlist WHERE user_id = ?', [req.session.user.id], (e, items) => {
    res.json((items || []).map(i => i.product_id));
  });
});

// ========== 用户等级API（基于总积分计算）==========
const LEVEL_CONFIG = {
  names: ['', '青铜会员', '白银会员', '黄金会员', '铂金会员', '钻石会员'],
  thresholds: [0, 0, 100, 500, 2000, 10000]
};

function calcLevel(totalPoints) {
  let lv = 1;
  for (let i = LEVEL_CONFIG.thresholds.length - 1; i >= 1; i--) {
    if (totalPoints >= LEVEL_CONFIG.thresholds[i]) { lv = i; break; }
  }
  return lv;
}

app.get('/api/user/level', isAuth, (req, res) => {
  db.get('SELECT COALESCE(total_points, 0) as total_points FROM users WHERE id = ?', [req.session.user.id], (e, user) => {
    const totalPoints = user ? user.total_points : 0;
    const lv = calcLevel(totalPoints);
    const nextThreshold = LEVEL_CONFIG.thresholds[lv + 1] || LEVEL_CONFIG.thresholds[LEVEL_CONFIG.thresholds.length - 1];
    const curThreshold = LEVEL_CONFIG.thresholds[lv] || 0;
    const progress = nextThreshold > curThreshold ? Math.min(100, ((totalPoints - curThreshold) / (nextThreshold - curThreshold)) * 100) : 100;
    res.json({
      level: lv,
      total_points: totalPoints,
      levelName: LEVEL_CONFIG.names[lv] || '钻石会员',
      nextLevelName: LEVEL_CONFIG.names[lv + 1] || 'MAX',
      progress: Math.round(progress),
      nextThreshold
    });
  });
});

// ========== 购物车/收藏页面 ==========
app.get('/cart', isAuth, (req, res) => {
  res.render('cart', { user: req.session.user, csrfToken: req.csrfToken() });
});

app.get('/wishlist', isAuth, (req, res) => {
  res.render('wishlist', { user: req.session.user, csrfToken: req.csrfToken() });
});

// ========== CSV导出 ==========
app.get('/api/export/orders', isAuth, (req, res) => {
  db.all(`SELECT o.id, o.created_at, p.name as product, o.price, o.status
    FROM orders o JOIN products p ON o.product_id = p.id WHERE o.user_id = ? ORDER BY o.created_at DESC`,
    [req.session.user.id], (e, rows) => {
    if (e) return res.status(500).send('导出失败');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
    res.write('\uFEFF'); // BOM for Excel
    res.write('订单ID,时间,商品,金额,状态\n');
    rows.forEach(r => res.write(`${r.id},${r.created_at},${r.product},${r.price},${r.status || '已完成'}\n`));
    res.end();
  });
});

app.get('/api/export/billing', isAuth, (req, res) => {
  db.all(`SELECT t.id, t.created_at, t.amount, t.tax, u1.username as from_user, u2.username as to_user
    FROM transactions t JOIN users u1 ON t.from_user_id = u1.id JOIN users u2 ON t.to_user_id = u2.id
    WHERE t.from_user_id = ? OR t.to_user_id = ? ORDER BY t.created_at DESC`,
    [req.session.user.id, req.session.user.id], (e, rows) => {
    if (e) return res.status(500).send('导出失败');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=billing.csv');
    res.write('\uFEFF');
    res.write('交易ID,时间,金额,税费,付款方,收款方\n');
    rows.forEach(r => res.write(`${r.id},${r.created_at},${r.amount},${r.tax},${r.from_user},${r.to_user}\n`));
    res.end();
  });
});

app.get('/api/export/admin/users', isAdmin, (req, res) => {
  db.all('SELECT id, username, balance, reputation, is_admin, created_at FROM users ORDER BY id', (e, rows) => {
    if (e) return res.status(500).send('导出失败');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
    res.write('\uFEFF');
    res.write('ID,用户名,余额,信誉分,管理员,注册时间\n');
    rows.forEach(r => res.write(`${r.id},${r.username},${r.balance},${r.reputation},${r.is_admin?'是':'否'},${r.created_at}\n`));
    res.end();
  });
});

// ========== 增强物流追踪 ==========
app.get('/track/:orderId', isAuth, (req, res) => {
  db.get(`SELECT s.*, o.price, p.name as product_name, o.user_id, o.status as order_status,
    o.created_at as order_time
    FROM shipments s JOIN orders o ON s.order_id = o.id
    JOIN products p ON o.product_id = p.id
    WHERE s.order_id = ?`, [req.params.orderId], (e, ship) => {
    if (e || !ship) return res.status(404).send('物流信息不存在');
    if (ship.user_id != req.session.user.id && !req.session.user.is_admin) return res.status(403).send('无权查看');
    const isDelivered = ship.status === 'delivered';
    let remainHours = 0, remainMinutes = 0;
    if (ship.status === 'shipped' && !isDelivered) {
      // 计算距送达还有多少小时
      const now = new Date();
      // 从发货时间开始算 estimate_hours 小时
      const shippedTime = new Date(ship.shipped_at).getTime();
      const deliverTime = shippedTime + (ship.estimate_hours || 48) * 3600000;
      const remainMs = deliverTime - now.getTime();
      if (remainMs > 0) {
        remainHours = Math.floor(remainMs / 3600000);
        remainMinutes = Math.floor((remainMs % 3600000) / 60000);
      }
    }
    // 获取物流追踪节点（模拟）
    const trackingEvents = [];
    trackingEvents.push({ time: ship.shipped_at, status: '已发货', desc: '快递已揽收，准备发往目的地', done: true });
    if (ship.status === 'shipped') {
      const midTime = new Date(new Date(ship.shipped_at).getTime() + (ship.estimate_hours || 48) * 1800000);
      trackingEvents.push({ time: midTime.toLocaleString(), status: '运输中', desc: '快递正在运输途中', done: false });
    }
    if (ship.status === 'delivered' || ship.status === 'signed' || isDelivered) {
      const midTime = new Date(new Date(ship.shipped_at).getTime() + (ship.estimate_hours || 48) * 1800000);
      trackingEvents.push({ time: midTime.toLocaleString(), status: '运输中', desc: '快递正在运输途中', done: true });
      trackingEvents.push({ time: ship.deliver_at, status: '已送达', desc: '快递已到达目的地', done: true });
    }
    if (ship.status === 'signed') {
      trackingEvents.push({ time: ship.signed_at, status: '已签收', desc: '已由本人签收', done: true });
    }
    if (ship.status === 'returning') {
      trackingEvents.push({ time: new Date().toLocaleString(), status: '退货中', desc: '退货处理中，等待卖家确认', done: true, isReturn: true });
    }
    res.render('track', {
      user: req.session.user,
      ship,
      isDelivered,
      remainHours,
      remainMinutes,
      trackingEvents,
      csrfToken: req.csrfToken()
    });
  });
});

app.post('/buy', isAuth, (req, res) => {
  const pid = req.body.product_id;
  const qty = Math.max(1, parseInt(req.body.quantity) || 1);
  if (!validator.isInt(pid)) return res.status(400).send('非法商品ID');
  
  db.get('SELECT p.*, s.owner_id FROM products p LEFT JOIN shops s ON p.shop_id = s.id WHERE p.id = ?', [pid], (err, product) => {
    if (err || !product) return res.status(404).send('商品不存在');
    if (product.stock < qty) return res.status(400).send('库存不足');

    db.get(`SELECT flash_price, coupon_code FROM flash_sales 
      WHERE product_id = ? AND is_active = 1 AND stock > 0 
      AND datetime(start_time) <= datetime('now','localtime') 
      AND datetime(end_time) > datetime('now','localtime')`, [product.id], (err, flash) => {
      const basePrice = flash ? flash.flash_price : product.price;

      // 检查促销活动折扣
      getPromoDiscountForProduct(product.id, basePrice, req.session.user.id, function(promoInfo) {
      const finalPrice = promoInfo.discounted ? promoInfo.finalPrice : basePrice;

    const couponCode = (req.body.coupon || '').trim().toUpperCase();
    let couponDiscount = 0;
    let couponId = null;
    const applyCoupon = function(cb) {
      // 如果有秒杀优惠码，自动使用
      if (flash && flash.coupon_code) {
        const autoCode = flash.coupon_code.trim().toUpperCase();
        if (autoCode) {
          db.get(`SELECT c.* FROM coupons c JOIN user_coupons uc ON c.id = uc.coupon_id 
            WHERE c.code = ? AND uc.user_id = ? AND uc.used = 0 
            AND c.is_active = 1 AND datetime(c.expires_at) > datetime('now','localtime')`, [autoCode, req.session.user.id], (err, coupon) => {
            if (err || !coupon) return cb();
            if (coupon.product_id && coupon.product_id !== product.id) return cb();
            if (coupon.shop_id && coupon.shop_id !== product.shop_id) return cb();
            couponDiscount = coupon.discount;
            couponId = coupon.id;
            cb();
          });
          return;
        }
      }
      if (!couponCode) return cb();
      db.get(`SELECT c.* FROM coupons c JOIN user_coupons uc ON c.id = uc.coupon_id 
        WHERE c.code = ? AND uc.user_id = ? AND uc.used = 0 
        AND c.is_active = 1 AND datetime(c.expires_at) > datetime('now','localtime')`, [couponCode, req.session.user.id], (err, coupon) => {
        if (err || !coupon) return cb();
        if (coupon.product_id && coupon.product_id !== product.id) return cb();
        if (coupon.shop_id && coupon.shop_id !== product.shop_id) return cb();
        couponDiscount = coupon.discount;
        couponId = coupon.id;
        cb();
      });
    };
    applyCoupon(function() {
      const discPrice = couponDiscount ? Math.round(finalPrice * (100 - couponDiscount)) / 100 : finalPrice;
      const totalPrice = Math.round(discPrice * qty * 100) / 100;
    
    db.get('SELECT balance FROM users WHERE id = ?', [req.session.user.id], (err, user) => {
      if (err || !user || user.balance < totalPrice) return res.status(400).send('余额不足');
      
      const nb = user.balance - totalPrice;
      const taxRate = 0.05;
      const tax = Math.round(totalPrice * taxRate * 100) / 100;
      const amountToSeller = Math.round((totalPrice - tax) * 100) / 100;
      
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        let hasError = false;
        function handleTxError(msg) {
          if (hasError) return;
          hasError = true;
          db.run('ROLLBACK');
          return res.status(500).send(msg);
        }
        
        db.run('UPDATE users SET balance = ? WHERE id = ?', [nb, req.session.user.id], (err) => {
          if (err) handleTxError('扣款失败');
        });
        
        if (product.shop_id > 0 && product.owner_id) {
          db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amountToSeller, product.owner_id], (err) => {
            if (err) handleTxError('打款失败');
          });
        }
        
        db.run('UPDATE products SET stock = stock - ? WHERE id = ?', [qty, pid], (err) => {
          if (err) handleTxError('更新库存失败');
        });
        
        const oid = uuidv4();
        db.run('INSERT INTO orders (id, user_id, product_id, price) VALUES (?, ?, ?, ?)', 
          [oid, req.session.user.id, pid, totalPrice], (err) => {
          if (err) { handleTxError('创建订单失败'); return; }
          
          if (product.shop_id > 0 && product.owner_id) {
            db.run('INSERT INTO transactions (order_id, from_user_id, to_user_id, amount, tax) VALUES (?, ?, ?, ?, ?)', 
              [oid, req.session.user.id, product.owner_id, amountToSeller, tax], (err) => {
              if (err) console.error('记录交易失败:', err);
            });
          }

          if (flash) {
            db.run('UPDATE flash_sales SET stock = stock - ? WHERE product_id = ? AND stock >= ?', [qty, product.id, qty], function() {
              if (this.changes > 0) {
                db.get('SELECT stock FROM flash_sales WHERE product_id = ?', [product.id], (e, fs) => {
                  if (!e) io.emit('flashStockUpdate', { productId: product.id, stock: fs ? fs.stock : 0 });
                });
              }
            });
          }
          if (couponId) db.run('UPDATE user_coupons SET used = 1 WHERE coupon_id = ? AND user_id = ?', [couponId, req.session.user.id]);

          db.run('COMMIT', (commitErr) => {
            if (commitErr) { handleTxError('提交事务失败'); return; }
            req.session.user.balance = nb;
            for (let [sid, u] of onlineUsers) {
              if (u.id == req.session.user.id) { io.to(sid).emit('balanceUpdate', nb); break; }
            }
            io.emit('productStockUpdate', { productId: product.id, stock: product.stock - 1 });
            // 官方商品自动发货
            if (product.shop_id === 0) {
              const tracking = 'YZ' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
              const hours = 24 + Math.floor(Math.random() * 72);
              const d = new Date(Date.now() + hours * 3600000);
              const p = n => String(n).padStart(2, '0');
              const deliverAt = `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
              db.run(`INSERT INTO shipments (order_id, carrier, speed, tracking_number, weight, estimate_hours, deliver_at, status) VALUES (?, '邮政', '标准', ?, 1, ?, ?, 'shipped')`,
                [oid, tracking, hours, deliverAt]);
              db.run("UPDATE orders SET status = 'shipped' WHERE id = ?", [oid]);
            }
            res.redirect('/orders');
            // 更新用户等级和积分（异步，不影响主流程）
            const spent = discPrice || product.price;
            const pointsEarned = Math.floor(spent);
            // 更新 users.total_points（购买也加积分）
            db.run('UPDATE users SET total_points = COALESCE(total_points, 0) + ? WHERE id = ?', [pointsEarned, req.session.user.id]);
            db.run('INSERT INTO user_levels (user_id, total_spent, points) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET total_spent = total_spent + ?, points = points + ?, updated_at = CURRENT_TIMESTAMP',
              [req.session.user.id, spent, pointsEarned, spent, pointsEarned], (eLv) => {
              if (!eLv) {
                db.get('SELECT COALESCE(total_points, 0) as tp FROM users WHERE id = ?', [req.session.user.id], (eLv2, ur) => {
                  const totalPoints = ur ? ur.tp : 0;
                  const newLevel = calcLevel(totalPoints);
                  // 查询当前等级，如果升级了则通知
                  db.get('SELECT level FROM user_levels WHERE user_id = ?', [req.session.user.id], (eLv3, lvRec) => {
                    const oldLevel = lvRec ? lvRec.level : 1;
                    if (newLevel > oldLevel) {
                      db.run('UPDATE user_levels SET level = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [newLevel, req.session.user.id]);
                      io.emit('levelUp', { userId: req.session.user.id, level: newLevel });
                    }
                    // 不论是否升级，都发送积分更新通知
                    io.emit('pointsUpdate', { userId: req.session.user.id, points: totalPoints });
                  });
                });
                // 从购物车中移除已购买商品
                db.run('DELETE FROM cart WHERE user_id = ? AND product_id = ?', [req.session.user.id, pid]);
                // 更新购物车徽章
                db.get('SELECT SUM(quantity) as cnt FROM cart WHERE user_id = ?', [req.session.user.id], (eC, c) => {
                  io.emit('cartUpdate', { userId: req.session.user.id, count: c ? c.cnt : 0 });
                });
              }
            });
          });
        });
      });
    });
    }); // applyCoupon
    }); // getPromoDiscountForProduct
    }); // flash
  });
});

app.get('/orders', isAuth, (req, res) => {
  db.all(`SELECT o.id, o.product_id, p.name as product_name, o.price, o.created_at, o.status,
    s.id as ship_id, s.carrier, s.tracking_number, s.status as ship_status, s.deliver_at
    FROM orders o JOIN products p ON o.product_id = p.id 
    LEFT JOIN shipments s ON s.order_id = o.id
    WHERE o.user_id = ? ORDER BY o.created_at DESC`, [req.session.user.id], (err, rows) => {
    if (err) return res.status(500).send('服务器错误');
    res.render('orders', { orders: rows, warningActive: req.session.user.warningActive, warningUntil: req.session.user.warningUntil });
  });
});

// 账单功能
app.get('/billing', isAuth, (req, res) => {
  db.all(`
    SELECT 
      o.id as order_id,
      o.created_at as time,
      'order' as type,
      o.price as amount,
      p.name as product_name,
      o.status as status
    FROM orders o
    JOIN products p ON o.product_id = p.id
    WHERE o.user_id = ?
    UNION ALL
    SELECT 
      r.order_id,
      r.created_at as time,
      'refund' as type,
      r.amount as amount,
      p.name as product_name,
      r.status as status
    FROM refunds r
    JOIN orders o ON r.order_id = o.id
    JOIN products p ON o.product_id = p.id
    WHERE o.user_id = ?
    ORDER BY time DESC
  `, [req.session.user.id, req.session.user.id], (err, transactions) => {
    if (err) return res.status(500).send('服务器错误');
    const stats = { orders: 0, totalSpent: 0, refunds: 0, refundedAmount: 0, refundCount: 0 };
    transactions.forEach(t => {
      if (t.type === 'order') { stats.orders++; stats.totalSpent += t.amount; }
      else { stats.refunds++; stats.refundedAmount += t.amount; stats.refundCount++; }
    });
    res.render('billing', { transactions, stats });
  });
});

// 兑换中心
app.get('/redeem', isAuth, (req, res) => {
  db.all(`SELECT uc.*, c.code, c.discount, c.product_id, c.shop_id, c.expires_at, p.name as product_name
    FROM user_coupons uc JOIN coupons c ON uc.coupon_id = c.id
    LEFT JOIN products p ON c.product_id = p.id
    WHERE uc.user_id = ? ORDER BY uc.claimed_at DESC`, [req.session.user.id], (err, coupons) => {
    res.render('redeem', { coupons, msg: null });
  });
});

app.post('/redeem', isAuth, (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase();
  if (!code) return res.render('redeem', { coupons: [], msg: '请输入兑换码' });
  db.get(`SELECT * FROM coupons WHERE code = ? AND is_active = 1 AND used_count < max_uses 
    AND datetime(expires_at) > datetime('now','localtime')`, [code], (err, coupon) => {
    if (err || !coupon) {
      return db.all(`SELECT uc.*, c.code, c.discount, c.expires_at FROM user_coupons uc JOIN coupons c ON uc.coupon_id = c.id WHERE uc.user_id = ?`, [req.session.user.id], (err2, coupons) => {
        res.render('redeem', { coupons: coupons || [], msg: '兑换码无效或已过期' });
      });
    }
    db.get('SELECT id FROM user_coupons WHERE user_id = ? AND coupon_id = ?', [req.session.user.id, coupon.id], (err, exist) => {
      if (exist) {
        return db.all(`SELECT uc.*, c.code, c.discount, c.expires_at FROM user_coupons uc JOIN coupons c ON uc.coupon_id = c.id WHERE uc.user_id = ?`, [req.session.user.id], (err2, coupons) => {
          res.render('redeem', { coupons: coupons || [], msg: '你已经领取过该优惠券' });
        });
      }
      db.run('INSERT INTO user_coupons (user_id, coupon_id) VALUES (?, ?)', [req.session.user.id, coupon.id], () => {
        db.run('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', [coupon.id]);
        db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)',
          [req.session.user.id, '🎫 优惠券到账', `恭喜获得 ${coupon.discount}% 折扣券，兑换码：${code}`, 'coupon']);
        db.all(`SELECT uc.*, c.code, c.discount, c.product_id, c.shop_id, c.expires_at, p.name as product_name
          FROM user_coupons uc JOIN coupons c ON uc.coupon_id = c.id
          LEFT JOIN products p ON c.product_id = p.id
          WHERE uc.user_id = ? ORDER BY uc.claimed_at DESC`, [req.session.user.id], (err2, coupons) => {
          res.render('redeem', { coupons, msg: `🎉 兑换成功！获得 ${coupon.discount}% 折扣券` });
        });
      });
    });
  });
});

// 申请退款
app.post('/refund/apply/:orderId', isAuth, (req, res) => {
  const orderId = req.params.orderId;
  const reason = sanitize(req.body.reason || '');
  
  if (!reason || reason.length < 10) {
    return res.status(400).send('退款理由至少10个字符');
  }
  
  db.get('SELECT o.*, p.name as product_name, p.shop_id, s.owner_id FROM orders o JOIN products p ON o.product_id = p.id LEFT JOIN shops s ON p.shop_id = s.id WHERE o.id = ? AND o.user_id = ?', [orderId, req.session.user.id], (err, order) => {
    if (err || !order) return res.status(404).send('订单不存在');
    if (order.status === 'refunded' || order.status === 'refunding') return res.status(400).send('该订单已申请退款');
    if (Date.now() - new Date(order.created_at).getTime() > 7 * 24 * 60 * 60 * 1000) {
      return res.status(400).send('订单超过7天，无法申请退款');
    }
    
    db.run('INSERT INTO refunds (order_id, user_id, reason, amount, status) VALUES (?, ?, ?, ?, ?)', [orderId, req.session.user.id, reason, order.price, 'pending'], (err) => {
      if (err) return res.status(500).send('申请退款失败');
      
      // 更新订单状态
      db.run('UPDATE orders SET status = ? WHERE id = ?', ['refunding', orderId]);
      
      // 通知管理员
      notifyAdmins('💸 退款申请', `用户 ${req.session.user.username} 申请退款：${order.product_name} (¥${order.price})`, 'refund');
      
      // 通知商家
      if (order.shop_id > 0 && order.owner_id) {
        db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [order.owner_id, '退款申请', `您的商品 "${order.product_name}" 收到退款申请，请等待管理员处理`, 'refund']);
      }
      
      res.redirect('/orders');
    });
  });
});

// 管理员处理退款申请
app.post('/admin/refunds/:id/:action', isAdmin, (req, res) => {
  const refundId = req.params.id;
  const action = req.params.action;
  const reply = sanitize(req.body.reply || '');
  
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).send('无效操作');
  }
  
  db.get('SELECT r.*, o.user_id, o.product_id, o.price, p.shop_id, s.owner_id FROM refunds r JOIN orders o ON r.order_id = o.id JOIN products p ON o.product_id = p.id LEFT JOIN shops s ON p.shop_id = s.id WHERE r.id = ?', [refundId], (err, refund) => {
    if (err || !refund) return res.status(404).send('退款申请不存在');
    if (refund.status !== 'pending') return res.status(400).send('该退款申请已处理');
    
    const status = action === 'approve' ? 'approved' : 'rejected';
    
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // 更新退款状态
      db.run('UPDATE refunds SET status = ?, admin_reply = ? WHERE id = ?', [status, reply, refundId]);
      
      if (action === 'approve') {
        // 退款给用户
        db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [refund.amount, refund.user_id]);
        
        // 如果是店铺商品，从商家余额扣除
        if (refund.shop_id > 0 && refund.owner_id) {
          db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [refund.amount, refund.owner_id]);
        }
        
        // 更新订单状态为已退款
        db.run('UPDATE orders SET status = ? WHERE id = ?', ['refunded', refund.order_id]);
        db.run("UPDATE shipments SET status = 'cancelled' WHERE order_id = ?", [refund.order_id]);
        
        // 通知用户退款成功
        db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [refund.user_id, '退款成功', `您的退款申请已通过，金额 ¥${refund.amount} 已退回账户`, 'refund']);
        
        // 通知商家退款成功
        if (refund.shop_id > 0 && refund.owner_id) {
          db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [refund.owner_id, '退款完成', `商品 "${refund.product_name}" 的退款已处理，金额 ¥${refund.amount} 已从您的账户扣除`, 'refund']);
        }
      } else {
        // 通知用户退款被驳回
        db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [refund.user_id, '退款被驳回', `您的退款申请被驳回：${reply || '未提供理由'}`, 'refund']);
        
        // 恢复订单状态为已完成
        db.run("UPDATE orders SET status = 'completed' WHERE id = ?", [refund.order_id]);
      }
      
      db.run('COMMIT');
      res.redirect('/admin/refunds');
    });
  });
});

// 管理员查看退款申请列表
app.get('/admin/refunds', isAdmin, (req, res) => {
  db.all(`
    SELECT 
      r.*,
      o.id as order_id,
      u.username as user_name,
      p.name as product_name,
      s.name as shop_name
    FROM refunds r
    JOIN orders o ON r.order_id = o.id
    JOIN users u ON r.user_id = u.id
    JOIN products p ON o.product_id = p.id
    LEFT JOIN shops s ON p.shop_id = s.id
    ORDER BY r.created_at DESC
  `, (err, refunds) => {
    if (err) return res.status(500).send('服务器错误');
    res.render('admin_refunds', { refunds });
  });
});

app.post('/profile/address', isAuth, (req, res) => {
  const city = sanitize(req.body.city || '');
  if (!city || !cityCoord[city]) return res.render('profile', { msg: '请选择有效城市', city: '' });
  db.run('UPDATE users SET city = ? WHERE id = ?', [city, req.session.user.id], () => {
    req.session.user.city = city;
    res.render('profile', { msg: '地址绑定成功！', city });
  });
});

app.get('/profile', isAuth, (req, res) => {
  db.get('SELECT city, avatar FROM users WHERE id = ?', [req.session.user.id], (err, row) => {
    res.render('profile', { msg: null, city: row ? row.city : '', avatar: row ? row.avatar : '' });
  });
});
app.get('/attack-log', isAuth, (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) return res.status(403).json({ error: '无权访问' });
  res.json(attackLog.slice(-100));
});
app.get('/dashboard', isAuth, (req, res) => {
  if (!req.session.user.isAdmin) return res.status(403).send('无权访问');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.post('/upload', isAuth, (req, res) => {
  upload.single('avatar')(req, res, function (err) {
    if (err || !req.file) return res.render('profile', { msg: '上传失败' });
    const avatarPath = '/uploads/' + req.file.filename;
    db.run('UPDATE users SET avatar = ? WHERE id = ?', [avatarPath, req.session.user.id], (err) => {
      db.get('SELECT city FROM users WHERE id = ?', [req.session.user.id], (err2, row) => {
        res.render('profile', { msg: err ? '保存失败' : '头像更新成功！', avatar: avatarPath, city: row ? row.city : '' });
      });
    });
  });
});

// 通过URL上传头像
app.post('/upload-url', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const url = req.body.imageUrl;
  if (!url) return res.render('profile', { msg: '请输入图片URL', city: '' });
  const https = require('https');
  const http = require('http');
  const proto = url.startsWith('https') ? https : http;
  proto.get(url, { timeout: 15000 }, (imgRes) => {
    if (imgRes.statusCode >= 300 && imgRes.statusCode < 400 && imgRes.headers.location) {
      return proto.get(imgRes.headers.location, { timeout: 15000 }, (redirectRes) => {
        pipeResponse(redirectRes);
      }).on('error', () => res.render('profile', { msg: '下载图片失败', city: '' }));
    }
    pipeResponse(imgRes);
  }).on('error', () => res.render('profile', { msg: '下载图片失败', city: '' }));
  function pipeResponse(imgRes) {
    const ext = path.extname(new URL(url).pathname) || '.jpg';
    const fname = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
    const fpath = path.join('public', 'uploads', fname);
    const ws = fs.createWriteStream(fpath);
    imgRes.pipe(ws);
    ws.on('finish', () => {
      const avatarPath = '/uploads/' + fname;
      db.run('UPDATE users SET avatar = ? WHERE id = ?', [avatarPath, uid], (err) => {
        db.get('SELECT city FROM users WHERE id = ?', [uid], (err2, row) => {
          res.render('profile', { msg: err ? '保存失败' : '头像更新成功！', avatar: avatarPath, city: row ? row.city : '' });
        });
      });
    });
    ws.on('error', () => res.render('profile', { msg: '保存图片失败', city: '' }));
  }
});

// ========== 聊天室 ==========
const chatHistory = [];
app.get('/chat', isAuth, (req, res) => res.render('chat', { username: req.session.user.username }));
app.get('/chat/public', isAuth, (req, res) => res.render('chat_public', { username: req.session.user.username }));
app.post('/chat/upload', isAuth, (req, res) => {
  chatUpload.single('file')(req, res, function (err) {
    if (err) return res.json({ error: '上传失败' });
    if (!req.file) return res.json({ error: '请选择文件' });
    const fileObj = { type: 'file', name: sanitize(req.file.originalname), url: '/uploads/' + req.file.filename, size: req.file.size, uploader: req.session.user.username, time: new Date().toLocaleTimeString() };
    chatHistory.push(fileObj);
    if (chatHistory.length > 100) chatHistory.shift();
    io.emit('msg', fileObj);
    res.json({ success: true });
  });
});

// ========== 好友系统 ==========
app.get('/friends', isAuth, (req, res) => {
  const userId = req.session.user.id;
  db.all(`SELECT f.id, CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END as friend_id, u.username, u.avatar, f.status
    FROM friends f JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
    WHERE (f.user_id = ? OR f.friend_id = ?) AND u.id != ? ORDER BY f.status = 'pending' DESC, u.username`, [userId, userId, userId, userId, userId], (err, rows) => {
    res.render('friends', { friends: rows });
  });
});

app.post('/friend/add', isAuth, (req, res) => {
  if (req.session.user.isAdmin) return res.status(400).send('管理员不能添加好友');
  const friendName = sanitize(req.body.username);
  if (!friendName) return res.status(400).send('请输入用户名');
  db.get('SELECT id, is_admin FROM users WHERE username = ?', [friendName], (err, user) => {
    if (err || !user) return res.status(400).send('用户不存在');
    if (user.id === req.session.user.id) return res.status(400).send('不能添加自己');
    if (user.is_admin) return res.status(400).send('不能添加管理员');
    db.get('SELECT * FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)', [req.session.user.id, user.id, user.id, req.session.user.id], (err, row) => {
      if (row) return res.status(400).send('已存在好友关系');
      db.run('INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)', [req.session.user.id, user.id, 'pending'], (err) => {
        if (err) return res.status(500).send('添加失败');
        res.redirect('/friends');
      });
    });
  });
});

app.post('/friend/accept/:id', isAuth, (req, res) => {
  db.run('UPDATE friends SET status = ? WHERE id = ? AND friend_id = ?', ['accepted', req.params.id, req.session.user.id], (err) => {
    if (err) return res.status(500).send('操作失败');
    res.redirect('/friends');
  });
});

app.post('/friend/delete/:id', isAuth, (req, res) => {
  db.run('DELETE FROM friends WHERE id = ? AND (user_id = ? OR friend_id = ?)', [req.params.id, req.session.user.id, req.session.user.id], (err) => {
    res.redirect('/friends');
  });
});

app.post('/friend/group', isAuth, (req, res) => {
  const friendIds = req.body.friend_ids;
  if (!friendIds || friendIds.length < 1) {
    return res.send('请至少选择一个好友');
  }
  const ids = Array.isArray(friendIds) ? friendIds.map(x => parseInt(x)) : [parseInt(friendIds)];
  const allIds = [...ids, req.session.user.id];
  const placeholders = ids.map(() => '?').join(',');
  db.all(`SELECT u.id, u.username FROM users u
    JOIN friends f ON (f.user_id = u.id AND f.friend_id = ?) OR (f.user_id = ? AND f.friend_id = u.id)
    WHERE u.id IN (${placeholders}) AND f.status = 'accepted'`,
    [req.session.user.id, req.session.user.id, ...ids], (err, rows) => {
    if (err || rows.length < ids.length) return res.send('只能邀请好友');
    const names = rows.map(r => r.username);
    names.push(req.session.user.username);
    const name = names.join('、');
    db.run('INSERT INTO groups (name, creator_id) VALUES (?, ?)', [name, req.session.user.id], function(err) {
      if (err) return res.send('创建群聊失败');
      const groupId = this.lastID;
      const stmt = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)');
      allIds.forEach(uid => stmt.run(groupId, uid));
      stmt.finalize();
      res.redirect('/chat/group/' + groupId);
    });
  });
});

// ========== 群聊页面 ==========
app.get('/chat/group/:id', isAuth, (req, res) => {
  const gid = parseInt(req.params.id);
  db.get('SELECT * FROM groups WHERE id = ?', [gid], (err, group) => {
    if (err || !group) return res.status(404).send('群聊不存在');
    db.get('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?', [gid, req.session.user.id], (err, member) => {
      if (!member) return res.status(403).send('你不是该群成员');
      db.all(`SELECT u.id, u.username, u.avatar FROM group_members gm
        JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ?`, [gid], (err, members) => {
        db.all(`SELECT gm.id, gm.from_user, u.username, u.avatar, gm.message, gm.time
          FROM group_messages gm JOIN users u ON gm.from_user = u.id
          WHERE gm.group_id = ? ORDER BY gm.id LIMIT 100`, [gid], (err, msgs) => {
          res.render('group_chat', { group, members, messages: msgs, csrfToken: req.csrfToken ? req.csrfToken() : '' });
        });
      });
    });
  });
});

// ========== 我的群列表 ==========
app.get('/api/groups', isAuth, (req, res) => {
  db.all(`SELECT g.*, (SELECT COUNT(*) FROM group_messages gm WHERE gm.group_id = g.id AND gm.id > COALESCE((SELECT last_read_id FROM group_members WHERE group_id = g.id AND user_id = ?), 0)) as unread
    FROM groups g JOIN group_members gm ON g.id = gm.group_id
    WHERE gm.user_id = ? ORDER BY g.id DESC`, [req.session.user.id, req.session.user.id], (err, rows) => {
    if (err) return res.json([]);
    res.json(rows);
  });
});

// ========== 私聊 ==========
app.get('/chat/private/:friendId', isAuth, (req, res) => {
  const friendId = parseInt(req.params.friendId, 10);
  if (!friendId || friendId === req.session.user.id) return res.status(400).send('非法私聊对象');
  db.get('SELECT id, username FROM users WHERE id = ?', [friendId], (err, friend) => {
    if (err || !friend) return res.status(404).send('用户不存在');
    db.get('SELECT id FROM friends WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = ?', [req.session.user.id, friendId, friendId, req.session.user.id, 'accepted'], (err, row) => {
      if (err || !row) return res.status(403).send('你们还不是好友，无法私聊');
      db.all('SELECT * FROM private_messages WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?) ORDER BY id LIMIT 100', [req.session.user.id, friendId, friendId, req.session.user.id], (err, msgs) => {
        res.render('private_chat', { friend, messages: msgs });
      });
    });
  });
});

// ========== 商品详情页 ==========
app.get('/product/:id', isAuth, (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(404).send('商品不存在');

  db.get(`SELECT p.*, s.name as shop_name,
    COALESCE(r.avg_rating, 0) as avg_rating,
    COALESCE(r.review_count, 0) as review_count
    FROM products p
    LEFT JOIN shops s ON p.shop_id = s.id
    LEFT JOIN (
      SELECT product_id, ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as review_count
      FROM reviews GROUP BY product_id
    ) r ON r.product_id = p.id
    WHERE p.id = ?`, [id], (err, product) => {
    if (err || !product) return res.status(404).send('商品不存在');

    // 浏览记录放到 cookie
    let viewed = req.cookies.viewed ? JSON.parse(req.cookies.viewed) : [];
    viewed = [id, ...viewed.filter(v => v !== id)].slice(0, 30);
    res.cookie('viewed', JSON.stringify(viewed), { maxAge: 30 * 24 * 3600 * 1000, httpOnly: true });

    // 猜你喜欢：同分类随机 6 个
    db.all(`SELECT id, name, price, sales_count, category FROM products
      WHERE 1=1 AND category = ? AND id != ? ORDER BY RANDOM() LIMIT 6`,
      [product.category, id], (err, related) => {
      // 获取评价
      db.all(`SELECT r.*, u.username FROM reviews r JOIN users u ON r.user_id = u.id
        WHERE r.product_id = ? ORDER BY r.created_at DESC LIMIT 10`, [id], (err, reviews) => {
        // 检查是否已收藏
        db.get('SELECT id FROM wishlist WHERE user_id = ? AND product_id = ?', [req.session.user.id, id], (err, wish) => {
          // 检查购物车中数量
          db.get('SELECT quantity FROM cart WHERE user_id = ? AND product_id = ?', [req.session.user.id, id], (err, cartItem) => {
            // 检查促销活动折扣
            getPromoDiscountForProduct(product.id, product.price, req.session.user.id, function(promoInfo) {
            res.render('product', {
              product,
              related: related || [],
              reviews: reviews || [],
              isWished: !!wish,
              cartQty: cartItem ? cartItem.quantity : 0,
              promoInfo: promoInfo,
              balance: req.session.user.balance,
              warningActive: req.session.user.warningActive,
              warningUntil: req.session.user.warningUntil
            });
            });
          });
        });
      });
    });
  });
});

// ========== 商家入驻 ==========
app.get('/shop/create', isAuth, (req, res) => {
  if (req.session.user.warningActive) return res.status(403).send('您当前处于警告期，暂时无法开店');
  res.render('shop_create');
});
app.post('/shop/create', isAuth, (req, res) => {
  if (req.session.user.warningActive) return res.status(403).send('警告期无法开店');
  const name = sanitize(req.body.name);
  const desc = sanitize(req.body.desc);
  if (!name) return res.status(400).send('店铺名不能为空');
  db.run('INSERT INTO shops (owner_id, name, description) VALUES (?, ?, ?)', [req.session.user.id, name, desc], function (err) {
    if (err) return res.status(500).send('创建失败');
    req.session.user.shopId = this.lastID;
    req.session.user.shopName = name;
    res.redirect('/shop/manage');
  });
});

app.get('/shop/manage', isAuth, (req, res) => {
  db.get('SELECT * FROM shops WHERE owner_id = ?', [req.session.user.id], (err, shop) => {
    if (err || !shop) return res.status(404).send('你还没有店铺，请先创建');
    const now = Date.now();
    let shopWarning = false;
    if (shop.warning_until) {
      const until = Date.parse(shop.warning_until);
      if (!isNaN(until) && until > now) shopWarning = true;
    }
    if (shop.is_banned) return res.render('banned', { username: req.session.user.username, banUntil: null, appealSent: false, shopBanned: true });
      db.all(`SELECT o.*, p.name as product_name, u.username as buyer_name, s.carrier, s.tracking_number, s.status as ship_status
        FROM orders o JOIN products p ON o.product_id = p.id 
        JOIN users u ON o.user_id = u.id 
        LEFT JOIN shipments s ON s.order_id = o.id
        WHERE p.shop_id = ? ORDER BY o.created_at DESC`, [shop.id], (err, orders) => {
        db.all('SELECT * FROM products WHERE shop_id = ?', [shop.id], (err2, products) => {
          db.all('SELECT * FROM warehouses WHERE shop_id = ?', [shop.id], (err3, whs) => {
            db.all('SELECT * FROM product_images WHERE product_id IN (SELECT id FROM products WHERE shop_id = ?)', [shop.id], (err4, images) => {
            db.all('SELECT * FROM categories ORDER BY sort_order', (err5, categories) => {
            res.render('shop_manage', { shop, products, orders: orders || [], warehouses: whs || [], images: images || [], categories: categories || [], shopWarning, warningUntil: shop.warning_until });
            });
            });
          });
  });
});
});
});

app.post('/shop/manage', isAuth, (req, res) => {
  res.redirect('/shop/manage');
});

app.get('/shop/coupons', isAuth, (req, res) => {
  db.get('SELECT * FROM shops WHERE owner_id = ?', [req.session.user.id], (err, shop) => {
    if (err || !shop) return res.status(404).send('你还没有店铺');
    db.all(`SELECT c.*, p.name as product_name FROM coupons c LEFT JOIN products p ON c.product_id = p.id WHERE c.shop_id = ? ORDER BY c.id DESC`, [shop.id], (err, coupons) => {
      db.all('SELECT id, name FROM products WHERE shop_id = ?', [shop.id], (err2, products) => {
        res.render('shop_coupons', { shop, coupons, products });
      });
    });
  });
});

app.post('/shop/coupons/create', isAuth, (req, res) => {
  db.get('SELECT * FROM shops WHERE owner_id = ?', [req.session.user.id], (err, shop) => {
    if (err || !shop) return res.redirect('/shop');
    const { code, discount, product_id, max_uses, expires_at } = req.body;
    const pid = product_id ? parseInt(product_id) : null;
    const max = parseInt(max_uses) || 50;
    const d = parseInt(discount);
    if (!code || isNaN(d) || d < 1 || d > 99) return res.redirect('/shop/coupons');
    db.run('INSERT INTO coupons (code, discount, product_id, shop_id, owner_id, max_uses, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [code.toUpperCase(), d, pid, shop.id, req.session.user.id, max, expires_at], () => res.redirect('/shop/coupons'));
  });
});

app.post('/shop/coupons/delete/:id', isAuth, (req, res) => {
  db.run('DELETE FROM coupons WHERE id = ?', [req.params.id], () => res.redirect('/shop/coupons'));
});

app.post('/shop/product/add', isAuth, (req, res) => {
  const name = sanitize(req.body.name);
  const price = parseFloat(req.body.price);
  const stock = parseInt(req.body.stock) || 0;
  if (!name || isNaN(price) || price < 1) return res.status(400).send('价格最低1元');
  if (req.session.user.warningActive) return res.status(403).send('您当前处于警告期，暂时无法发布新商品');
  db.get('SELECT id, is_banned, warning_until FROM shops WHERE owner_id = ?', [req.session.user.id], (err, shop) => {
    if (err || !shop) return res.status(400).send('请先创建店铺');
    if (shop.is_banned) return res.status(403).send('您的店铺已被封禁，无法发布商品');
    if (shop.warning_until) {
      const until = Date.parse(shop.warning_until);
      if (!isNaN(until) && until > Date.now()) return res.status(403).send('您的店铺当前处于警告期，暂时无法发布商品');
    }
    db.run('INSERT INTO products (shop_id, name, price, stock, category, shipping_policy) VALUES (?, ?, ?, ?, ?, ?)', [shop.id, name, price, stock, req.body.category || '其他', parseInt(req.body.shipping_policy) || 0], (err) => {
      if (err) return res.status(500).send('添加失败');
      res.redirect('/shop/manage');
    });
  });
});

app.post('/shop/product/delete/:id', isAuth, (req, res) => {
  db.get('SELECT * FROM shops WHERE owner_id = ?', [req.session.user.id], (err, shop) => {
    if (err || !shop) return res.redirect('/shop');
    db.run('DELETE FROM products WHERE id = ? AND shop_id = ?', [req.params.id, shop.id], (err) => {
      db.run('DELETE FROM product_images WHERE product_id = ?', [req.params.id]);
      res.redirect('/shop/manage');
    });
  });
});

app.post('/shop/product/:id/images', isAuth, (req, res) => {
  db.get('SELECT * FROM shops WHERE owner_id = ?', [req.session.user.id], (err, shop) => {
    if (err || !shop) return res.redirect('/shop');
    db.get('SELECT * FROM products WHERE id = ? AND shop_id = ?', [req.params.id, shop.id], (err, product) => {
      if (err || !product) return res.status(404).send('商品不存在');
      upload.array('images', 5)(req, res, function(err) {
        if (err) return res.status(400).send('上传失败：' + err.message);
        if (!req.files || req.files.length === 0) return res.status(400).send('请选择图片');
        let done = 0;
        req.files.forEach((file, i) => {
          db.run('INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)', [product.id, '/uploads/' + file.filename, i], () => {
            done++;
            if (done === req.files.length) res.redirect('/shop/manage');
          });
        });
      });
    });
  });
});

app.post('/shop/product/:id/images/delete/:imgId', isAuth, (req, res) => {
  db.get('SELECT * FROM shops WHERE owner_id = ?', [req.session.user.id], (err, shop) => {
    if (err || !shop) return res.redirect('/shop');
    db.run('DELETE FROM product_images WHERE id = ? AND product_id = ?', [req.params.imgId, req.params.id], (err) => {
      res.redirect('/shop/manage');
    });
  });
});

// ========== 商品评价 ==========
app.get('/review/', isAuth, (req, res) => res.redirect('/shop'));
app.get('/review/:productId', isAuth, (req, res) => {
  db.get('SELECT * FROM products WHERE id = ?', [req.params.productId], (err, product) => {
    if (err || !product) return res.status(404).send('商品不存在');
    if (req.session.user.warningActive) return res.status(403).send('你当前处于警告期，暂时不能进行店铺评价');
    db.get('SELECT id FROM orders WHERE user_id = ? AND product_id = ? LIMIT 1', [req.session.user.id, req.params.productId], (err, order) => {
      if (err || !order) return res.status(403).send('请先购买该商品后再评价');
      db.all('SELECT reviews.*, users.username, users.avatar FROM reviews JOIN users ON reviews.user_id = users.id WHERE product_id = ? ORDER BY created_at DESC', [req.params.productId], (err, reviews) => {
        const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : 0;
        res.render('reviews', { product, reviews, avgRating });
      });
    });
  });
});

app.post('/review/:productId', isAuth, (req, res) => {
  if (req.session.user.warningActive) return res.status(403).send('你当前处于警告期，暂时不能进行店铺评价');
  const rating = parseInt(req.body.rating) || 5;
  const comment = sanitize(req.body.comment);
  db.run('INSERT INTO reviews (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)', [req.session.user.id, req.params.productId, rating, comment], (err) => {
    if (err) return res.status(500).send('评价失败');
    res.redirect('/review/' + req.params.productId);
  });
});

// ========== 举报系统 ==========
app.get('/notifications', isAuth, (req, res) => {
  db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.session.user.id], (err, notifications) => {
    if (err) notifications = [];
    const totalCount = notifications.length;
    const unreadCount = notifications.filter(n => !n.is_read).length;
    const banCount = notifications.filter(n => n.type === 'ban').length;
    db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.session.user.id]);
    res.render('notifications', { notifications, totalCount, unreadCount, banCount });
  });
});
app.post('/notifications/read-all', isAuth, (req, res) => {
  db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.session.user.id], () => res.redirect('/notifications'));
});

app.get('/report', isAuth, (req, res) => {
  const targetType = sanitize(req.query.type || '');
  const targetId = sanitize(req.query.id || '');
  const targetName = sanitize(req.query.name || '');
  res.render('report', { targetType, targetId, targetName, msg: null });
});
app.post('/report', isAuth, (req, res) => {
  const targetType = sanitize(req.body.target_type || '');
  const targetId = parseInt(req.body.target_id) || 0;
  const targetName = sanitize(req.body.target_name || '');
  const reason = sanitize(req.body.reason || '');
  const description = sanitize(req.body.description || '');
  if (!targetType || !targetId || !reason) return res.render('report', { targetType, targetId, targetName, msg: '请填写完整举报信息' });
  db.run('INSERT INTO reports (reporter_id, target_type, target_id, target_name, reason, description) VALUES (?, ?, ?, ?, ?, ?)',
    [req.session.user.id, targetType, targetId, targetName, reason, description], (err) => {
      if (err) return res.render('report', { targetType, targetId, targetName, msg: '举报失败' });
      notifyAdmins('🚩 新举报', `用户 ${req.session.user.username} 举报了 ${targetName}`, 'report');
      db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [req.session.user.id, '举报已提交', '您的举报已提交，管理员将尽快处理', 'report']);
      res.render('report', { targetType, targetId, targetName, msg: '举报提交成功' });
    });
});

// ========== 申诉系统 ==========
app.get('/appeal', (req, res) => {
  const hasUser = req.session && req.session.user;
  const userId = hasUser ? req.session.user.id : 0;
  const username = hasUser ? req.session.user.username : (req.query.username || '');
  db.get('SELECT * FROM appeals WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId], (err, appeal) => {
    res.render('appeal', { appeal, msg: '', success: false, username });
  });
});
app.post('/appeal', (req, res) => {
  const content = (req.body.content || '').toString().trim();
  const appealType = (req.body.appeal_type || 'ban').toString();
  const username = (req.body.username || '').toString().trim().substring(0, 50);
  if (!username && !(req.session && req.session.user)) {
    return res.render('appeal', { appeal: null, msg: '请填写用户名', success: false, username: '' });
  }
  if (content.length < 5) return res.render('appeal', { appeal: null, msg: '申诉内容至少5个字符', success: false, username });
  let userId = null;
  let displayName = username;
  if (req.session && req.session.user) {
    userId = req.session.user.id;
    displayName = req.session.user.username;
  } else if (username) {
    db.get('SELECT id FROM users WHERE username = ?', [username], (err2, u) => {
      if (err2 || !u) return res.render('appeal', { appeal: null, msg: '未找到对应账号', success: false, username });
      userId = u.id;
      db.run('INSERT INTO appeals (user_id, appeal_type, content) VALUES (?, ?, ?)', [userId, appealType, content], function (err) {
        if (err) return res.render('appeal', { appeal: null, msg: '提交失败', success: false, username });
        notifyAdmins('📢 新申诉', `用户 ${displayName} 提交了 ${appealType} 申诉`, 'appeal');
        res.render('appeal', { appeal: null, msg: '申诉已提交，管理员会尽快处理', success: true, username });
      });
    });
    return;
  }
  db.run('INSERT INTO appeals (user_id, appeal_type, content) VALUES (?, ?, ?)', [userId, appealType, content], function (err) {
    if (err) return res.render('appeal', { appeal: null, msg: '提交失败', success: false, username });
    notifyAdmins('📢 新申诉', `用户 ${displayName} 提交了 ${appealType} 申诉`, 'appeal');
    res.render('appeal', { appeal: null, msg: '申诉已提交，管理员会尽快处理', success: true, username });
  });
});

// ========== 后台管理 ==========
app.get('/admin/login', (req, res) => res.render('admin_login', { error: null }));
app.post('/admin/login', rateLimit({ windowMs: 1 * 60 * 1000, max: 10 }), (req, res) => {
  const u = sanitize(req.body.username || ''), p = req.body.password || '';
  db.get('SELECT * FROM users WHERE username = ? AND is_admin = 1', [u], (err, admin) => {
    if (err || !admin) return res.render('admin_login', { error: '管理员账号或密码错误' });
    bcrypt.compare(p, admin.password, (err, ok) => {
      if (ok) { req.session.user = { id: admin.id, username: admin.username, isAdmin: true }; return req.session.save(() => res.redirect('/admin/dashboard')); }
      res.render('admin_login', { error: '管理员账号或密码错误' });
    });
  });
});
app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });



// ========== 管理员：举报处理操作 ==========

// 从举报页面直接封禁被举报用户
app.post('/admin/reports/:id/action/ban-user', isAdmin, (req, res) => {
  db.get('SELECT r.*, u.username as reporter_name FROM reports r JOIN users u ON r.reporter_id = u.id WHERE r.id = ?', [req.params.id], (err, report) => {
    if (err || !report) return res.redirect('/admin/reports');
    db.get('SELECT id, username, is_admin, reputation FROM users WHERE username = ? OR id = ?', [report.target_id, report.target_id], (err2, user) => {
      if (err2 || !user || user.is_admin) return res.redirect('/admin/reports');
      if (user.id == req.session.user.id) return res.redirect('/admin/reports');
      const adminNote = sanitize(req.body.note || '');
      const banMin = parseInt(req.body.banDuration) || 0; // 0 = 永久
      const newReputation = Math.max(0, user.reputation - 20);
      const banUntil = banMin > 0 ? new Date(Date.now() + banMin * 60 * 1000).toISOString() : null;
      db.run('UPDATE users SET is_banned = 1, online = 0, reputation = ?, warning_until = NULL, ban_until = ? WHERE id = ?', [newReputation, banUntil, user.id], () => {
        db.run('UPDATE reports SET status = ?, admin_note = ?, action_taken = ? WHERE id = ?', ['resolved', adminNote, '封禁用户（' + (banMin === 0 ? '永久' : banMin + ' 分钟') + '）', report.id], () => {
          // 通知被举报用户
          db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [user.id, '🚫 账号已被封禁', `您因违规被封禁${banMin === 0 ? '永久' : banMin + '分钟'}，信誉分降至${newReputation}。如有异议可提交申诉。`, 'ban']);
          // 通知举报人
          db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [report.reporter_id, '✅ 举报已处理', `您对 ${report.target_name} 的举报已处理：该用户已被封禁。`, 'report']);
          io.emit('onlineUsers', Array.from(onlineUsers.values()));
          res.redirect('/admin/reports');
        });
      });
    });
  });
});

// 从举报页面直接扣除被举报用户信誉分
app.post('/admin/reports/:id/action/penalty-user', isAdmin, (req, res) => {
  db.get('SELECT r.*, u.username as reporter_name FROM reports r JOIN users u ON r.reporter_id = u.id WHERE r.id = ?', [req.params.id], (err, report) => {
    if (err || !report) return res.redirect('/admin/reports');
    db.get('SELECT id, username, is_admin, reputation FROM users WHERE username = ? OR id = ?', [report.target_id, report.target_id], (err2, user) => {
      if (err2 || !user || user.is_admin) return res.redirect('/admin/reports');
      const adminNote = sanitize(req.body.note || '');
      const newRep = Math.max(0, user.reputation - 15);
      db.run('UPDATE users SET reputation = ? WHERE id = ?', [newRep, user.id], () => {
        db.run('UPDATE reports SET status = ?, admin_note = ?, action_taken = ? WHERE id = ?', ['resolved', adminNote, '扣除信誉分 15', report.id], () => {
          // 通知被举报用户
          db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [user.id, '⚠️ 信誉分已扣除', `您的信誉分被扣除15分，当前为${newRep}。请规范行为。`, 'warning']);
          // 通知举报人
          db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [report.reporter_id, '✅ 举报已处理', `您对 ${report.target_name} 的举报已处理：该用户被扣除信誉分。`, 'report']);
          res.redirect('/admin/reports');
        });
      });
    });
  });
});

// 从举报页面直接给被举报用户发警告
app.post('/admin/reports/:id/action/warn-user', isAdmin, (req, res) => {
  db.get('SELECT r.*, u.username as reporter_name FROM reports r JOIN users u ON r.reporter_id = u.id WHERE r.id = ?', [req.params.id], (err, report) => {
    if (err || !report) return res.redirect('/admin/reports');
    db.get('SELECT id, username, is_admin FROM users WHERE username = ? OR id = ?', [report.target_id, report.target_id], (err2, user) => {
      if (err2 || !user || user.is_admin) return res.redirect('/admin/reports');
      const adminNote = sanitize(req.body.note || '');
      const warnUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      db.run('UPDATE users SET warning_until = ? WHERE id = ?', [warnUntil, user.id], () => {
        db.run('UPDATE reports SET status = ?, admin_note = ?, action_taken = ? WHERE id = ?', ['resolved', adminNote, '发送警告（10分钟限制）', report.id], () => {
          // 通知被举报用户
          db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [user.id, '⚠️ 平台警告', '您收到一次平台警告，部分功能受限10分钟。请规范行为。', 'warning']);
          // 通知举报人
          db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [report.reporter_id, '✅ 举报已处理', `您对 ${report.target_name} 的举报已处理：该用户被警告。`, 'report']);
          res.redirect('/admin/reports');
        });
      });
    });
  });
});

// 从举报页面直接删除被举报商品
app.post('/admin/reports/:id/action/delete-product', isAdmin, (req, res) => {
  db.get('SELECT r.*, u.username as reporter_name FROM reports r JOIN users u ON r.reporter_id = u.id WHERE r.id = ?', [req.params.id], (err, report) => {
    if (err || !report) return res.redirect('/admin/reports');
    const pid = parseInt(report.target_id);
    if (!pid || isNaN(pid)) return res.redirect('/admin/reports');
    const adminNote = sanitize(req.body.note || '');
    db.run('DELETE FROM products WHERE id = ?', [pid], () => {
      db.run('UPDATE reports SET status = ?, admin_note = ?, action_taken = ? WHERE id = ?', ['resolved', adminNote, '商品已删除', report.id], () => {
        // 通知举报人
        db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [report.reporter_id, '✅ 举报已处理', `您对商品 ${report.target_name} 的举报已处理：商品已下架。`, 'report']);
        res.redirect('/admin/reports');
      });
    });
  });
});

app.get('/admin/dashboard', isAdmin, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  db.get('SELECT COUNT(*) AS n FROM users', (err1, u) => {
    db.get('SELECT COUNT(*) AS n FROM products', (err2, p) => {
      db.get('SELECT COUNT(*) AS n FROM orders', (err3, o) => {
        db.get("SELECT COUNT(*) AS n FROM reports WHERE status = 'pending'", (err4, r) => {
          db.get("SELECT COUNT(*) AS n FROM appeals WHERE status = 'pending' OR status IS NULL", (err5, ap) => {
            db.get('SELECT COUNT(*) AS n FROM daily_visits WHERE visit_date = ?', [today], (err6, uv) => {
              db.get('SELECT COALESCE(count, 0) AS n FROM daily_pv WHERE visit_date = ?', [today], (err7, pv) => {
                // Game stats from in-memory game rooms
                const gameRooms = req.app.locals.gameRooms || {};
                const roomList = Object.values(gameRooms);
                const gameRoomsActive = roomList.filter(r => r.state === 'playing' || r.state === 'started').length;
                const gameRoomsWaiting = roomList.filter(r => r.state === 'waiting').length;
                const gameRoomsTotal = roomList.length;
                res.render('admin_dashboard', {
                  user: req.session.user,
                  userCount: u?.n || 0,
                  productCount: p?.n || 0,
                  orderCount: o?.n || 0,
                  pendingReports: r?.n || 0,
                  pendingAppeals: ap?.n || 0,
                  todayUV: uv?.n || 0,
                  todayPV: pv?.n || 0,
                  gameRoomsActive,
                  gameRoomsWaiting,
                  gameRoomsTotal
                });
              });
            });
          });
        });
      });
    });
  });
});

// ========== 安全仪表盘 ==========
app.get('/admin/security', isAdmin, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  db.get('SELECT COUNT(*) AS n FROM attack_logs', (e1, total) => {
    db.get("SELECT COUNT(*) AS n FROM attack_logs WHERE date(created_at) = ?", [today], (e2, todayAtk) => {
      db.get("SELECT attack_type, COUNT(*) AS n FROM attack_logs GROUP BY attack_type ORDER BY n DESC", (e3, typeDist) => {
        db.get("SELECT ip, COUNT(*) AS n FROM attack_logs GROUP BY ip ORDER BY n DESC LIMIT 10", (e4, topIps) => {
          db.all("SELECT * FROM attack_logs ORDER BY id DESC LIMIT 50", (e5, logs) => {
            res.render('admin_security', {
              user: req.session.user,
              totalAttacks: total?.n || 0,
              todayAttacks: todayAtk?.n || 0,
              typeDist: typeDist || [],
              topIps: topIps || [],
              logs: logs || []
            });
          });
        });
      });
    });
  });
});

// 攻击统计API（Chart.js用）
app.get('/api/admin/attack-stats', isAdmin, (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  db.all(`SELECT date(created_at) as d, attack_type, COUNT(*) as n FROM attack_logs WHERE created_at >= ? GROUP BY d, attack_type ORDER BY d`, [since], (err, rows) => {
    if (err) return res.json({ error: '查询失败' });
    // 按天分组
    const map = {};
    let totalCount = 0;
    rows.forEach(r => {
      if (!map[r.d]) map[r.d] = {};
      map[r.d][r.attack_type] = (map[r.d][r.attack_type] || 0) + r.n;
      if (r.d === new Date().toISOString().split('T')[0]) totalCount += r.n;
    });
    res.json({ days: Object.keys(map), data: map, count: totalCount });
  });
});

// 图表数据API（销售额/订单趋势）
app.get('/api/admin/chart-data', isAdmin, (req, res) => {
  const days = parseInt(req.query.days) || 7;
  db.all(`SELECT date(created_at) as d, COUNT(*) as orders, COALESCE(SUM(price), 0) as revenue FROM orders WHERE created_at >= date('now', '-${days} days') GROUP BY d ORDER BY d`, (err, orders) => {
    db.all(`SELECT date(created_at) as d, COUNT(*) as users FROM users WHERE created_at >= date('now', '-${days} days') GROUP BY d ORDER BY d`, (err2, users) => {
      db.all(`SELECT date(created_at) as d, COUNT(*) as visits FROM daily_visits WHERE visit_date >= date('now', '-${days} days') GROUP BY d ORDER BY d`, (err3, visits) => {
        res.json({ orders: orders || [], users: users || [], visits: visits || [] });
      });
    });
  });
});

app.get('/admin/coupons', isAdmin, (req, res) => {
  db.all(`SELECT c.*, p.name as product_name FROM coupons c LEFT JOIN products p ON c.product_id = p.id ORDER BY c.id DESC`, (err, coupons) => {
    db.all('SELECT id, name FROM products', (err2, products) => {
      res.render('admin_coupons', { coupons, products });
    });
  });
});

app.post('/admin/coupons/create', isAdmin, (req, res) => {
  const { code, discount, product_id, max_uses, expires_at } = req.body;
  const pid = product_id ? parseInt(product_id) : null;
  const max = parseInt(max_uses) || 100;
  const d = parseInt(discount);
  if (!code || isNaN(d) || d < 1 || d > 99) return res.redirect('/admin/coupons');
  db.run('INSERT INTO coupons (code, discount, product_id, shop_id, owner_id, max_uses, expires_at) VALUES (?, ?, ?, NULL, ?, ?, ?)',
    [code.toUpperCase(), d, pid, req.session.user.id, max, expires_at], () => res.redirect('/admin/coupons'));
});

app.post('/admin/coupons/delete/:id', isAdmin, (req, res) => {
  db.run('DELETE FROM coupons WHERE id = ?', [req.params.id], () => res.redirect('/admin/coupons'));
});

app.get('/admin/products', (req, res) => db.all('SELECT * FROM products', (err, products) => res.render('admin_products', { products })));
app.get('/admin/flash', isAdmin, (req, res) => {
  db.all(`SELECT f.*, p.name as product_name, p.price as original_price 
    FROM flash_sales f JOIN products p ON f.product_id = p.id ORDER BY f.id DESC`, (err, sales) => {
    db.all('SELECT id, name, price FROM products', (err2, products) => {
      res.render('admin_flash', { sales, products });
    });
  });
});

app.post('/admin/flash/create', isAdmin, (req, res) => {
  const { product_id, flash_price, stock, start_time, end_time, schedule_type, schedule_days, schedule_duration, coupon_code } = req.body;
  const sType = schedule_type || 'manual';
  const sDays = schedule_days || '';
  const duration = parseInt(schedule_duration) || 0;
  const cc = (coupon_code || '').trim().toUpperCase();
  db.run('INSERT INTO flash_sales (product_id, flash_price, stock, start_time, end_time, schedule_type, schedule_days, schedule_duration, is_active, coupon_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [product_id, flash_price, stock, start_time, end_time, sType, sDays, duration, sType === 'manual' ? 1 : 0, cc], () => res.redirect('/admin/flash'));
});

app.post('/admin/flash/edit/:id', isAdmin, (req, res) => {
  const { product_id, flash_price, stock, start_time, end_time, schedule_type, schedule_days, schedule_duration, coupon_code } = req.body;
  const sType = schedule_type || 'manual';
  const sDays = schedule_days || '';
  const duration = parseInt(schedule_duration) || 0;
  const cc = (coupon_code || '').trim().toUpperCase();
  db.run('UPDATE flash_sales SET product_id=?, flash_price=?, stock=?, start_time=?, end_time=?, schedule_type=?, schedule_days=?, schedule_duration=?, coupon_code=? WHERE id=?',
    [product_id, flash_price, stock, start_time, end_time, sType, sDays, duration, cc, req.params.id], () => res.redirect('/admin/flash'));
});

app.post('/admin/flash/delete/:id', isAdmin, (req, res) => {
  db.run('DELETE FROM flash_sales WHERE id = ?', [req.params.id], () => res.redirect('/admin/flash'));
});

// ========== 定期自动开启/关闭秒杀&促销（每5分钟检查）==========
function checkScheduledItems() {
  const now = new Date();
  const dow = now.getDay();       // 0=Sun, 1=Mon ... 6=Sat
  const dom = now.getDate();      // 1-31
  const timeStr = now.toTimeString().slice(0, 5); // HH:MM

  // 检查秒杀
  db.all("SELECT * FROM flash_sales WHERE schedule_type != 'manual' AND schedule_type IS NOT NULL", (err, sales) => {
    if (err) return;
    sales.forEach(s => {
      const days = (s.schedule_days || '').split(',').map(d => d.trim()).filter(Boolean);
      let matchToday = false;
      if (s.schedule_type === 'weekly') {
        matchToday = days.includes(String(dow));
      } else if (s.schedule_type === 'monthly') {
        matchToday = days.includes(String(dom));
      }
      if (!matchToday) {
        if (s.is_active) db.run('UPDATE flash_sales SET is_active = 0 WHERE id = ?', [s.id]);
        return;
      }
      const startT = s.start_time ? s.start_time.slice(11, 16) : '';
      let actualEnd = s.end_time ? s.end_time.slice(11, 16) : '';
      if (s.schedule_duration > 0 && startT) {
        const [sh, sm] = startT.split(':').map(Number);
        const totalMin = sh * 60 + sm + s.schedule_duration;
        const eh = Math.floor(totalMin / 60) % 24;
        const em = totalMin % 60;
        actualEnd = String(eh).padStart(2, '0') + ':' + String(em).padStart(2, '0');
      }
      // 判断时间是否在范围内（支持跨午夜）
      const inTime = isTimeInRange(timeStr, startT, actualEnd);
      if (inTime && !s.is_active) {
        db.run('UPDATE flash_sales SET is_active = 1 WHERE id = ?', [s.id]);
      } else if (!inTime && s.is_active) {
        db.run('UPDATE flash_sales SET is_active = 0 WHERE id = ?', [s.id]);
      }
    });
  });

  // 检查促销活动
  db.all("SELECT * FROM promotions WHERE schedule_type != 'manual' AND schedule_type IS NOT NULL", (err, sales) => {
    if (err) return;
    sales.forEach(s => {
      const days = (s.schedule_days || '').split(',').map(d => d.trim()).filter(Boolean);
      let matchToday = false;
      if (s.schedule_type === 'weekly') {
        matchToday = days.includes(String(dow));
      } else if (s.schedule_type === 'monthly') {
        matchToday = days.includes(String(dom));
      }
      if (!matchToday) {
        if (s.is_active) db.run('UPDATE promotions SET is_active = 0 WHERE id = ?', [s.id]);
        return;
      }
      const startT = s.start_time ? s.start_time.slice(11, 16) : '';
      let actualEnd = s.end_time ? s.end_time.slice(11, 16) : '';
      if (s.schedule_duration > 0 && startT) {
        const [sh, sm] = startT.split(':').map(Number);
        const totalMin = sh * 60 + sm + s.schedule_duration;
        const eh = Math.floor(totalMin / 60) % 24;
        const em = totalMin % 60;
        actualEnd = String(eh).padStart(2, '0') + ':' + String(em).padStart(2, '0');
      }
      const inTime = isTimeInRange(timeStr, startT, actualEnd);
      if (inTime && !s.is_active) {
        db.run('UPDATE promotions SET is_active = 1 WHERE id = ?', [s.id]);
      } else if (!inTime && s.is_active) {
        db.run('UPDATE promotions SET is_active = 0 WHERE id = ?', [s.id]);
      }
    });
  });
}

// 判断当前时间是否在[start, end)范围内（支持跨午夜）
function isTimeInRange(now, start, end) {
  if (!start || !end) return false;
  if (end > start) {
    // 正常同一天范围：00:00~23:59 或 10:00~18:00 等
    return start <= now && now < end;
  } else {
    // 跨午夜范围：如 21:00~09:00
    return now >= start || now < end;
  }
}
// 启动后立即检查一次，之后每5分钟检查
checkScheduledItems();
setInterval(checkScheduledItems, 5 * 60 * 1000);

// ========== 促销活动管理 ==========
app.get('/admin/promotions', isAdmin, (req, res) => {
  db.all(`SELECT p.*, (SELECT COUNT(*) FROM promotion_products WHERE promotion_id = p.id) as product_count FROM promotions p ORDER BY p.id DESC`, (err, promotions) => {
    db.all('SELECT id, name, price FROM products ORDER BY id', (err2, products) => {
      res.render('admin_promotions', { promotions: promotions || [], products: products || [] });
    });
  });
});

app.post('/admin/promotions/create', isAdmin, (req, res) => {
  const { title, description, type, discount, discount_type, start_time, end_time, sort_order, product_ids, schedule_type, schedule_days, schedule_duration } = req.body;
  if (!title) return res.status(400).send('促销标题不能为空');
  const discountVal = parseFloat(discount) || 0;
  const sortVal = parseInt(sort_order) || 0;
  const sType = schedule_type || 'manual';
  const sDays = schedule_days || '';
  const duration = parseInt(schedule_duration) || 0;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const isActive = sType === 'manual' ? 1 : 0;
  db.run(`INSERT INTO promotions (title, description, type, discount, discount_type, start_time, end_time, sort_order, is_active, created_at, schedule_type, schedule_days, schedule_duration)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title.trim(), description || '', type || 'promo', discountVal, discount_type || 'percent', start_time || now, end_time || now, sortVal, isActive, now, sType, sDays, duration],
    function(err) {
      if (err) return res.status(500).send('创建失败');
      const promoId = this.lastID;
      // 关联商品
      if (product_ids) {
        const ids = Array.isArray(product_ids) ? product_ids : [product_ids];
        const stmt = db.prepare('INSERT OR IGNORE INTO promotion_products (promotion_id, product_id) VALUES (?, ?)');
        ids.forEach(pid => {
          if (pid) stmt.run(promoId, parseInt(pid));
        });
        stmt.finalize();
      }
      res.redirect('/admin/promotions');
    });
});

app.post('/admin/promotions/edit/:id', isAdmin, (req, res) => {
  const { title, description, type, discount, discount_type, start_time, end_time, sort_order, is_active, product_ids, schedule_type, schedule_days, schedule_duration } = req.body;
  const id = req.params.id;
  if (!title) return res.status(400).send('促销标题不能为空');
  const discountVal = parseFloat(discount) || 0;
  const sortVal = parseInt(sort_order) || 0;
  const activeVal = is_active ? 1 : 0;
  const sType = schedule_type || 'manual';
  const sDays = schedule_days || '';
  const duration = parseInt(schedule_duration) || 0;
  db.run(`UPDATE promotions SET title=?, description=?, type=?, discount=?, discount_type=?, start_time=?, end_time=?, sort_order=?, is_active=?, schedule_type=?, schedule_days=?, schedule_duration=? WHERE id=?`,
    [title.trim(), description || '', type || 'promo', discountVal, discount_type || 'percent', start_time, end_time, sortVal, activeVal, sType, sDays, duration, id],
    function(err) {
      if (err) return res.status(500).send('更新失败');
      // 重新关联商品：先删除旧关联，再插入新关联
      db.run('DELETE FROM promotion_products WHERE promotion_id = ?', [id], () => {
        if (product_ids) {
          const ids = Array.isArray(product_ids) ? product_ids : [product_ids];
          const stmt = db.prepare('INSERT OR IGNORE INTO promotion_products (promotion_id, product_id) VALUES (?, ?)');
          ids.forEach(pid => {
            if (pid) stmt.run(parseInt(id), parseInt(pid));
          });
          stmt.finalize();
        }
        res.redirect('/admin/promotions');
      });
    });
});

app.post('/admin/promotions/delete/:id', isAdmin, (req, res) => {
  const id = req.params.id;
  db.run('DELETE FROM promotion_products WHERE promotion_id = ?', [id], () => {
    db.run('DELETE FROM promotions WHERE id = ?', [id], () => res.redirect('/admin/promotions'));
  });
});

app.post('/admin/promotions/:id/toggle', isAdmin, (req, res) => {
  db.run('UPDATE promotions SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?', [req.params.id], () => res.redirect('/admin/promotions'));
});
app.get('/admin/products/add', (req, res) => {
  db.all('SELECT * FROM categories ORDER BY sort_order', (err, categories) => {
    res.render('admin_product_form', { product: null, action: '/admin/products/add', categories: categories || [] });
  });
});
app.post('/admin/products/add', (req, res) => {
  const n = sanitize(req.body.name || ''), p = parseFloat(req.body.price);
  if (!n || isNaN(p) || p < 1) return res.status(400).send('价格最低1元');
  db.run('INSERT INTO products (shop_id, name, price, category) VALUES (0, ?, ?, ?)', [n, p, req.body.category || '其他'], (err) => res.redirect('/admin/products'));
});
app.get('/admin/products/edit/:id', (req, res) => db.get('SELECT * FROM products WHERE id = ?', [req.params.id], (err, p) => {
  db.all('SELECT * FROM categories ORDER BY sort_order', (err2, categories) => {
    res.render('admin_product_form', { product: p, action: '/admin/products/edit/' + req.params.id, categories: categories || [] });
  });
}));
app.post('/admin/products/edit/:id', (req, res) => {
  const n = sanitize(req.body.name || ''), p = parseFloat(req.body.price);
  if (!n || isNaN(p) || p < 1) return res.status(400).send('价格最低1元');
  db.run('UPDATE products SET name = ?, price = ?, category = ? WHERE id = ?', [n, p, req.body.category || '其他', req.params.id], (err) => res.redirect('/admin/products'));
});
app.post('/admin/products/delete/:id', (req, res) => db.run('DELETE FROM products WHERE id = ?', [req.params.id], (err) => res.redirect('/admin/products')));

app.get('/admin/orders', (req, res) => {
  db.all('SELECT orders.id, users.username, products.name as product_name, orders.price, orders.created_at, orders.status FROM orders JOIN users ON orders.user_id = users.id JOIN products ON orders.product_id = products.id ORDER BY orders.created_at DESC', (err, rows) => {
    res.render('admin_orders', { orders: rows });
  });
});

app.get('/admin/users', (req, res) => {
  db.all('SELECT id, username, balance, is_admin, is_banned, reputation, warning_until, ban_until FROM users', (err, users) => {
    res.render('admin_users', { users });
  });
});

db.run(`CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  discount INTEGER NOT NULL,
  product_id INTEGER,
  shop_id INTEGER,
  owner_id INTEGER NOT NULL,
  max_uses INTEGER DEFAULT 100,
  used_count INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS user_coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  coupon_id INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  claimed_at TEXT DEFAULT (datetime('now','localtime'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS flash_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  flash_price REAL NOT NULL,
  stock INTEGER NOT NULL DEFAULT 10,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (product_id) REFERENCES products(id)
)`);

db.run(`
  CREATE TABLE IF NOT EXISTS warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    address TEXT DEFAULT '',
    city TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    warehouse_id INTEGER,
    carrier TEXT NOT NULL DEFAULT '邮政',
    speed TEXT DEFAULT '标准',
    tracking_number TEXT DEFAULT '',
    weight REAL DEFAULT 0,
    estimate_hours INTEGER DEFAULT 72,
    shipped_at TEXT DEFAULT (datetime('now','localtime')),
    deliver_at TEXT,
    status TEXT DEFAULT 'pending',
    signed_at TEXT,
    return_reason TEXT,
    shipping_fee REAL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  )
`);

// 初始化退款表（首次运行时执行）
db.run(`CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  from_user_id INTEGER,
  to_user_id INTEGER,
  amount REAL,
  tax REAL,
  type TEXT DEFAULT 'purchase',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
db.run(`
  CREATE TABLE IF NOT EXISTS refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    admin_reply TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// 为orders表添加status字段（如果不存在）
// 为orders表添加status字段
db.run(`ALTER TABLE orders ADD COLUMN status TEXT DEFAULT 'completed'`, (err) => {
  // 如果字段已存在会报错，忽略即可
});
app.post('/admin/users/ban/:id', isAdmin, (req, res) => {
  if (req.params.id == req.session.user.id) return res.status(400).send('不能封禁自己');
  const minutes = parseInt(req.body.minutes) || 0;
  db.get('SELECT id, username, is_admin, reputation FROM users WHERE id = ?', [req.params.id], (err, user) => {
    if (err || !user || user.is_admin) return res.redirect('/admin/users');
    const newRep = Math.max(0, user.reputation - 20);
    const banUntil = minutes > 0 ? new Date(Date.now() + minutes * 60 * 1000).toISOString() : null;
    db.run('UPDATE users SET is_banned = 1, online = 0, reputation = ?, warning_until = NULL, ban_until = ? WHERE id = ?', [newRep, banUntil, req.params.id], (err) => {
      if (err) return res.status(500).send('封禁失败');
      notifyAdmins('🚫 用户被封禁', `${user.username} 被封禁 ${minutes === 0 ? '永久' : minutes + '分钟'}`);
      const sockets = io.sockets.sockets;
      for (const s of sockets.values()) {
        if (s.handshake.session && s.handshake.session.user && s.handshake.session.user.id == user.id) {
          s.emit('kicked', '您的账号已被管理员封禁');
          s.disconnect(true);
        }
      }
      io.emit('onlineUsers', Array.from(onlineUsers.values()));
      res.redirect('/admin/users');
    });
  });
});
app.post('/admin/users/unban/:id', isAdmin, (req, res) => {
  db.run('UPDATE users SET is_banned = 0, ban_until = NULL WHERE id = ?', [req.params.id], (err) => res.redirect('/admin/users'));
});
app.post('/admin/users/restore-reputation/:id', isAdmin, (req, res) => {
  db.run('UPDATE users SET reputation = MIN(100, reputation + 20) WHERE id = ?', [req.params.id], (err) => res.redirect('/admin/users'));
});
app.post('/admin/users/warn/:id', isAdmin, (req, res) => {
  const minutes = parseInt(req.body.minutes) || 10;
  const note = sanitize(req.body.note || '');
  const warnUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  db.get('SELECT id, username, reputation FROM users WHERE id = ?', [req.params.id], (err, user) => {
    if (err || !user) return res.redirect('/admin/users');
    const newRep = Math.max(0, (user.reputation || 100) - 5);
    db.run('UPDATE users SET warning_until = ?, reputation = ? WHERE id = ?', [warnUntil, newRep, req.params.id], () => {
      db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', 
        [user.id, '⚠️ 平台警告', `您收到一次平台警告，部分功能受限${minutes}分钟${note ? '：' + note : ''}。请规范行为。`, 'warning']);
      res.redirect('/admin/users');
    });
  });
});
app.post('/admin/users/clear-warning/:id', isAdmin, (req, res) => {
  db.run('UPDATE users SET warning_until = NULL WHERE id = ?', [req.params.id], (err) => res.redirect('/admin/users'));
});
app.post('/admin/users/balance/:id', isAdmin, (req, res) => {
  const bal = parseFloat(req.body.balance);
  if (isNaN(bal) || bal < 0) return res.status(400).send('余额不合法');
  db.run('UPDATE users SET balance = ? WHERE id = ?', [bal, req.params.id], (err) => res.redirect('/admin/users'));
});
app.post('/admin/users/delete/:id', isAdmin, (req, res) => {
  if (req.params.id == req.session.user.id) return res.status(400).send('不能注销自己');
  db.get('SELECT is_admin FROM users WHERE id = ?', [req.params.id], (err, user) => {
    if (err || !user || user.is_admin) return res.redirect('/admin/users');
    db.run('DELETE FROM users WHERE id = ?', [req.params.id], (err) => res.redirect('/admin/users'));
  });
});

app.get('/admin/shops', isAdmin, (req, res) => {
  db.all('SELECT s.*, u.username as owner_name FROM shops s JOIN users u ON s.owner_id = u.id ORDER BY s.id DESC', (err, shops) => {
    res.render('admin_shops', { shops });
    });
  });
app.post('/admin/shops/:id/warn', isAdmin, (req, res) => {
    const minutes = parseInt(req.body.minutes) || 60;
    const note = sanitize(req.body.note || '');
    const warnUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    db.get('SELECT s.*, u.username as owner_name, u.id as owner_id FROM shops s JOIN users u ON s.owner_id = u.id WHERE s.id = ?', [req.params.id], (err, shop) => {
      if (err || !shop) return res.redirect('/admin/shops');
      db.run('UPDATE shops SET warning_until = ? WHERE id = ?', [warnUntil, req.params.id], () => {
        db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [shop.owner_id, '店铺警告', `您的店铺收到警告，持续 ${minutes} 分钟`, 'warning']);
        res.redirect('/admin/shops');
      });
    });
  });
app.post('/admin/shops/:id/ban', isAdmin, (req, res) => {
    const minutes = parseInt(req.body.minutes) || 0;
    const note = sanitize(req.body.note || '');
    const banUntil = minutes > 0 ? new Date(Date.now() + minutes * 60 * 1000).toISOString() : null;
    db.get('SELECT s.*, u.username as owner_name, u.id as owner_id FROM shops s JOIN users u ON s.owner_id = u.id WHERE s.id = ?', [req.params.id], (err, shop) => {
      if (err || !shop) return res.redirect('/admin/shops');
      db.run('UPDATE shops SET is_banned = 1, warning_until = ? WHERE id = ?', [banUntil, req.params.id], () => {
        db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [shop.owner_id, '店铺封禁', `您的店铺已被封禁${minutes === 0 ? '永久' : minutes + '分钟'}`, 'ban']);
        res.redirect('/admin/shops');
      });
    });
});
app.post('/admin/shops/:id/unban', isAdmin, (req, res) => {
    db.get('SELECT s.*, u.id as owner_id FROM shops s JOIN users u ON s.owner_id = u.id WHERE s.id = ?', [req.params.id], (err, shop) => {
      if (err || !shop) return res.redirect('/admin/shops');
      db.run('UPDATE shops SET is_banned = 0, warning_until = NULL WHERE id = ?', [req.params.id], () => {
        db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [shop.owner_id, '店铺解封', '您的店铺已解除封禁', 'info']);
        res.redirect('/admin/shops');
      });
    });
  });

app.get('/admin/reports', isAdmin, (req, res) => {
    db.all('SELECT r.*, u.username as reporter_name FROM reports r JOIN users u ON r.reporter_id = u.id ORDER BY r.created_at DESC', (err, reports) => {
      if (err) return res.status(500).send('服务器错误');

      // 为每个举报查询被举报用户的状态
      let pending = 0;
      reports.forEach(r => { if (r.status === 'pending') pending++; });

      // 异步查询每个被举报用户的状态
      const userIds = [...new Set(reports.filter(r => r.target_type === 'user').map(r => r.target_id))];

      if (userIds.length === 0) {
        return res.render('admin_reports', { reports });
      }

      const placeholders = userIds.map(() => '?').join(',');
      db.all(`SELECT id, username, is_banned, reputation, warning_until FROM users WHERE id IN (${placeholders})`, userIds, (err, users) => {
        const userMap = {};
        if (users) users.forEach(u => { userMap[u.id] = u; });

        reports.forEach(r => {
          if (r.target_type === 'user' && userMap[r.target_id]) {
            r._reportedUser = userMap[r.target_id];
          }
        });

        res.render('admin_reports', { reports });
      });
    });
  });

app.get('/admin/appeals', isAdmin, (req, res) => {
    db.all('SELECT a.*, u.username FROM appeals a JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC LIMIT 100', (err, appeals) => {
      res.render('admin_appeals', { appeals });
    });
});
app.post('/admin/appeals/:id/accept', isAdmin, (req, res) => {
    const reply = sanitize(req.body.reply || '您的申诉已通过，账号已恢复正常');
    db.get('SELECT * FROM appeals WHERE id = ?', [req.params.id], (err, appeal) => {
      if (err || !appeal) return res.redirect('/admin/appeals');
      db.run('UPDATE users SET is_banned = 0, ban_until = NULL, warning_until = NULL WHERE id = ?', [appeal.user_id]);
      db.run('UPDATE shops SET is_banned = 0, warning_until = NULL WHERE owner_id = ?', [appeal.user_id]);
      db.run('UPDATE appeals SET status = ?, admin_reply = ? WHERE id = ?', ['accepted', reply, req.params.id]);
      db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [appeal.user_id, '申诉通过', reply, 'info']);
      res.redirect('/admin/appeals');
  });
  });
app.post('/admin/appeals/:id/reject', isAdmin, (req, res) => {
    const reply = sanitize(req.body.reply || '您的申诉未通过，请耐心等待');
    db.get('SELECT * FROM appeals WHERE id = ?', [req.params.id], (err, appeal) => {
      if (err || !appeal) return res.redirect('/admin/appeals');
      db.run('UPDATE appeals SET status = ?, admin_reply = ? WHERE id = ?', ['rejected', reply, req.params.id]);
      db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [appeal.user_id, '申诉未通过', reply, 'info']);
      res.redirect('/admin/appeals');
    });
});

// ========== 文件云盘 ==========

// 云盘上传 multer（边上传边加密，只写一次盘）
const cloudUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join('public', 'uploads', 'cloud', String(req.session.user.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[\\/:*?"<>|]/g, '_');
      cb(null, Date.now() + '_' + safe);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const blocked = ['.exe','.bat','.cmd','.sh','.php','.asp','.aspx','.jsp','.dll','.so','.msi','.scr','.vbs','.ps1','.jar','.war','.com','.pif','.cgi','.pl','.py','.rb','.reg','.hta','.wsf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (blocked.includes(ext)) return cb(new Error('禁止上传可执行/脚本文件'));
    cb(null, true);
  }
});

// 限流器
const fileRateLimit = {};
function checkFileRateLimit(uid) {
  const now = Date.now();
  if (!fileRateLimit[uid]) fileRateLimit[uid] = [];
  fileRateLimit[uid] = fileRateLimit[uid].filter(t => now - t < 60000);
  if (fileRateLimit[uid].length >= 10) return false;
  fileRateLimit[uid].push(now);
  return true;
}

// 文件名校验
const forbiddenChars = /[\\/:*?"<>|]/;
function validateFileName(name) {
  if (!name || name.length < 1 || name.length > 100) return false;
  if (forbiddenChars.test(name)) return false;
  return true;
}

// 确保存储配置
function ensureStorageConfig(uid, cb) {
  db.get('SELECT * FROM user_storage_config WHERE user_id = ?', [uid], (err, cfg) => {
    if (err) { console.error('ensureStorageConfig db.get error:', err); return cb(err); }
    if (cfg) return cb(null, cfg);
    db.run('INSERT INTO user_storage_config (user_id, total_quota, buy_times) VALUES (?, 200000, 0)', [uid], function(err) {
      if (err) { console.error('ensureStorageConfig insert error:', err); return cb(err); }
      cb(null, { user_id: uid, total_quota: 200000, buy_times: 0 });
    });
  });
}

// 操作日志
function logOper(uid, targetType, targetId, operType, remark) {
  db.run('INSERT INTO user_file_oper_log (user_id, target_type, target_id, oper_type, remark) VALUES (?,?,?,?,?)',
    [uid, targetType, targetId, operType, remark || '']);
}

// ========== 加密工具已整合至 crypto-utils.js，通过 require 导入 ==========
const SERVER_ENC_SECRET = crypto.createHash('sha256').update('CLOUD_DISK_SERVER_KEY_' + (process.env.SECRET || 'default')).digest();

function xorEncrypt(buf, secret) {
  const result = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) result[i] = buf[i] ^ secret[i % secret.length];
  return result;
}

function getSessionKey(req) {
  if (!req.session || !req.session.user || !req.session.user.encKey) return null;
  return Buffer.from(req.session.user.encKey, 'hex');
}

function getFileEncKey(req, file) {
  if (file.enc_key) return Buffer.from(file.enc_key, 'hex');
  // enc_iterations=0: XOR加密的密钥，直接从数据库恢复
  if (file.enc_iterations === 0 && file.enc_salt) {
    return xorEncrypt(Buffer.from(file.enc_salt, 'hex'), SERVER_ENC_SECRET);
  }
  // enc_iterations>0: 旧格式，密钥在session中
  const sk = getSessionKey(req);
  if (sk) return sk;
  // session中没有密钥，尝试用file.enc_salt（用户盐）+密码重新派生
  // 但密码不在session中，无法恢复，返回null
  console.log('[getFileEncKey] 密钥不可用: session.encKey缺失, file.enc_iterations=', file.enc_iterations);
  return null;
}

function migrateOldFileSync(filePath, file) {
  if (!file.enc_key || !file.enc_iv) return false;
  try { if (fs.existsSync(filePath + '.mig')) fs.unlinkSync(filePath + '.mig'); } catch (e) {}
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const hdr8 = Buffer.alloc(8);
    fs.readSync(fd, hdr8, 0, 8, 0);
    fs.closeSync(fd); fd = null;
    if (hdr8.toString('utf8', 0, 8) !== 'CLOUDENC') return false;
  } catch (e) {
    if (fd) try { fs.closeSync(fd); } catch (e2) {}
    return false;
  }
  const oldKey = Buffer.from(file.enc_key, 'hex');
  const oldIv = Buffer.from(file.enc_iv, 'hex');
  const encBuf = fs.readFileSync(filePath);
  const decipher = crypto.createDecipheriv('aes-256-cbc', oldKey, oldIv);
  const plain = Buffer.concat([decipher.update(encBuf.slice(8)), decipher.final()]);
  const newIv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', oldKey, newIv);
  const newHdr = Buffer.alloc(40);
  newHdr.write('CLOUDKEY', 0, 8, 'utf8');
  newHdr.writeUInt16BE(ENC_VERSION, 8);
  newHdr.writeUInt8(12, 10);
  newHdr.writeUInt8(16, 11);
  newIv.copy(newHdr, 12);
  const encData = cipher.update(plain);
  const finalData = cipher.final();
  const tag = cipher.getAuthTag();
  tag.copy(newHdr, 24);
  const tmpPath = filePath + '.tmp' + Date.now();
  try {
    const outFd = fs.openSync(tmpPath, 'w');
    fs.writeSync(outFd, newHdr);
    fs.writeSync(outFd, encData);
    if (finalData && finalData.length) fs.writeSync(outFd, finalData);
    fs.closeSync(outFd);
    fs.unlinkSync(filePath);
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e2) {}
    return false;
  }
  const encSalt = xorEncrypt(oldKey, SERVER_ENC_SECRET).toString('hex');
  db.run('UPDATE user_file SET enc_salt = ?, enc_iterations = 0, enc_key = "", enc_iv = "", file_size = ? WHERE id = ?', [encSalt, plain.length, file.id]);
  file.enc_key = null;
  file.enc_iv = null;
  file.enc_salt = encSalt;
  file.enc_iterations = 0;
  return true;
}

// 递归获取子孙文件夹ID
function getDescendantDirIds(uid, dirId, cb) {
  db.all('SELECT id FROM user_dir WHERE user_id = ? AND parent_dir_id = ?', [uid, dirId], (err, children) => {
    if (err || !children.length) return cb(null, [dirId]);
    let ids = [dirId], pending = children.length;
    children.forEach(c => {
      getDescendantDirIds(uid, c.id, (e, subIds) => {
        ids = ids.concat(subIds);
        if (--pending === 0) cb(null, ids);
      });
    });
  });
}

// 云盘主页
app.get('/cloud', isAuth, (req, res) => res.render('cloud_disk'));

// 存储信息
app.get('/api/cloud/storage', isAuth, (req, res) => {
  const uid = req.session.user.id;
  ensureStorageConfig(uid, (err, cfg) => {
    if (err) return res.status(500).json({ error: '获取配置失败' });
    db.get('SELECT COALESCE(SUM(file_size),0) + COALESCE(SUM(content_length),0) as used FROM user_file WHERE user_id = ?', [uid], (err, r1) => {
      db.get('SELECT COUNT(*) as cnt FROM user_file WHERE user_id = ?', [uid], (err, r2) => {
        db.get('SELECT COUNT(*) as cnt FROM user_dir WHERE user_id = ?', [uid], (err, r3) => {
          db.get('SELECT balance FROM users WHERE id = ?', [uid], (err, r4) => {
            res.json({ totalQuota: cfg.total_quota, usedQuota: r1.used, fileCount: r2.cnt, folderCount: r3.cnt, maxFiles: 100, maxFolders: 20, balance: r4 ? r4.balance : 0 });
          });
        });
      });
    });
  });
});

// 文件夹树
app.get('/api/cloud/tree', isAuth, (req, res) => {
  const uid = req.session.user.id;
  db.all('SELECT * FROM user_dir WHERE user_id = ? ORDER BY dir_name', [uid], (err, dirs) => {
    if (err) return res.json([]);
    function buildTree(parentId) {
      return dirs.filter(d => d.parent_dir_id === parentId).map(d => ({
        id: d.id, name: d.dir_name, children: buildTree(d.id)
      }));
    }
    res.json(buildTree(null));
  });
});

// 解析文件夹路径
function resolveDirPath(uid, dirId, cb) {
  if (!dirId) return cb(null, '');
  db.get('SELECT * FROM user_dir WHERE id = ? AND user_id = ?', [dirId, uid], (err, dir) => {
    if (!dir) return cb(null, '');
    resolveDirPath(uid, dir.parent_dir_id, (e, parentPath) => {
      cb(null, parentPath ? parentPath + '/' + dir.dir_name : dir.dir_name);
    });
  });
}

// 获取目录内容 + 面包屑
app.get('/api/cloud/list', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const dirId = req.query.dir_id ? parseInt(req.query.dir_id) : null;

  db.all('SELECT * FROM user_dir WHERE user_id = ? AND parent_dir_id IS ? ORDER BY dir_name', [uid, dirId], (err, folders) => {
    db.all('SELECT * FROM user_file WHERE user_id = ? AND dir_id IS ? ORDER BY file_name', [uid, dirId], (err, files) => {
      function getBreadcrumb(id, cb) {
        if (!id) return cb([{ id: null, name: '根目录' }]);
        db.get('SELECT * FROM user_dir WHERE id = ? AND user_id = ?', [id, uid], (err, d) => {
          if (!d) return cb([{ id: null, name: '根目录' }]);
          getBreadcrumb(d.parent_dir_id, (parents) => {
            parents.push({ id: d.id, name: d.dir_name });
            cb(parents);
          });
        });
      }
      getBreadcrumb(dirId, (breadcrumb) => {
        res.json({ folders, files, breadcrumb });
      });
    });
  });
});

// ========== 分片上传 ==========
const CHUNK_SIZE = 5 * 1024 * 1024; // 每片 5MB
const chunkStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public', 'uploads', 'cloud', 'chunks', String(req.session.user.id), req.body.upload_id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, String(req.body.chunk_index))
});
const chunkUpload = multer({ storage: chunkStorage, limits: { fileSize: CHUNK_SIZE + 1024 * 1024 } });

// 初始化上传
app.post('/api/cloud/upload/init', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const { file_name, file_size, mime_type, total_chunks } = req.body;
  if (!file_name || !file_size || !total_chunks) return res.status(400).json({ error: '参数不完整' });
  if (!validateFileName(file_name)) return res.status(400).json({ error: '文件名不合法' });
  const uploadId = require('uuid').v4().replace(/-/g, '');
  const encKey = crypto.randomBytes(32).toString('hex');
  const encIv = crypto.randomBytes(16).toString('hex');
  db.run('INSERT INTO upload_chunk (upload_id, user_id, file_name, dir_id, chunk_index, total_chunks, chunk_path, enc_key, enc_iv, file_size, mime_type) VALUES (?,?,?,?,0,?,?,?,?,?,?)',
    [uploadId, uid, file_name, null, total_chunks, '', encKey, encIv, file_size, mime_type || 'application/octet-stream'], (err) => {
    if (err) return res.status(500).json({ error: '初始化失败' });
    res.json({ upload_id: uploadId, enc_key: encKey, enc_iv: encIv });
  });
});

// 上传分片
app.post('/api/cloud/upload/chunk', isAuth, (req, res) => {
  req.setTimeout(0);
  const uid = req.session.user.id;
  chunkUpload.single('chunk')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const { upload_id, chunk_index } = req.body;
    if (!upload_id || chunk_index === undefined) return res.status(400).json({ error: '参数不完整' });
    db.run('UPDATE upload_chunk SET chunk_path = chunk_path || ? || \',\' WHERE upload_id = ? AND user_id = ? AND chunk_index = 0',
      [req.file.path, upload_id, uid], (err2) => {
      if (err2) return res.status(500).json({ error: '保存分片失败' });
      res.json({ ok: true, chunk_index: parseInt(chunk_index) });
    });
  });
});

// 合并分片
app.post('/api/cloud/upload/merge', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const { upload_id, dir_id } = req.body;
  if (!upload_id) return res.status(400).json({ error: '缺少 upload_id' });
  db.get('SELECT * FROM upload_chunk WHERE upload_id = ? AND user_id = ? AND chunk_index = 0', [upload_id, uid], (err, meta) => {
    if (err || !meta) return res.status(404).json({ error: '上传会话不存在' });
    const chunkPaths = meta.chunk_path.split(',').filter(Boolean);
    if (chunkPaths.length < meta.total_chunks) return res.status(400).json({ error: '分片不完整，已上传 ' + chunkPaths.length + '/' + meta.total_chunks });
    
    ensureStorageConfig(uid, (err2, cfg) => {
      db.get('SELECT COALESCE(SUM(file_size),0)+COALESCE(SUM(content_length),0) as used FROM user_file WHERE user_id = ?', [uid], (err3, r) => {
        if (r.used + meta.file_size > cfg.total_quota) return res.status(400).json({ error: '存储空间不足' });
        
        const finalDir = path.join(__dirname, 'public', 'uploads', 'cloud', String(uid));
        fs.mkdirSync(finalDir, { recursive: true });
        const safe = meta.file_name.replace(/[\\/:*?"<>|]/g, '_');
        const finalName = Date.now() + '_' + safe;
        const finalPath = path.join(finalDir, finalName);
        
        const encKey = req.session.user && req.session.user.encKey ? Buffer.from(req.session.user.encKey, 'hex') : crypto.randomBytes(32);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
        const out = fs.createWriteStream(finalPath);
        const hdr = Buffer.alloc(40);
        hdr.write(ENC_MAGIC, 0, 8, 'utf8');
        hdr.writeUInt16BE(ENC_VERSION, 8);
        hdr.writeUInt8(12, 10);
        hdr.writeUInt8(16, 11);
        iv.copy(hdr, 12);
        out.write(hdr);
        
        let idx = 0;
        function pipeNext() {
          if (idx >= chunkPaths.length) {
            cipher.end();
            return;
          }
          const cp = chunkPaths[idx];
          if (!fs.existsSync(cp)) { out.destroy(); return res.status(500).json({ error: '分片文件丢失: ' + idx }); }
          fs.createReadStream(cp).on('end', () => { idx++; pipeNext(); }).on('error', (e) => { out.destroy(); res.status(500).json({ error: '读取分片失败' }); }).pipe(cipher, { end: false });
        }
        cipher.pipe(out);
        out.on('finish', () => {
          const tag = cipher.getAuthTag();
          tag.copy(hdr, 24);
          const fd = fs.openSync(finalPath, 'r+');
          fs.writeSync(fd, hdr, 24, 16, 24);
          fs.closeSync(fd);
          const relPath = 'uploads/cloud/' + uid + '/' + finalName;
          const salt = req.session.user && req.session.user.encSalt || '';
          db.run('INSERT INTO user_file (user_id, dir_id, file_name, file_path, file_size, mime_type, content_length, enc_salt, enc_iterations) VALUES (?,?,?,?,?,?,0,?,?)',
            [uid, dir_id || null, meta.file_name, relPath, meta.file_size, meta.mime_type, salt, PBKDF2_ITERATIONS], function(err4) {
            if (err4) { fs.unlink(finalPath, () => {}); return res.status(400).json({ error: '保存失败' }); }
            // 清理分片
            chunkPaths.forEach(p => fs.unlink(p, () => {}));
            const chunkDir = path.dirname(chunkPaths[0]);
            fs.rmdir(chunkDir, () => {});
            db.run('DELETE FROM upload_chunk WHERE upload_id = ?', [upload_id]);
            logOper(uid, 2, this.lastID, 'create', '上传文件: ' + meta.file_name);
            res.json({ ok: true, id: this.lastID, file_name: meta.file_name, file_size: meta.file_size });
          });
        });
        out.on('error', () => { if (!res.headersSent) res.status(500).json({ error: '合并失败' }); });
        pipeNext();
      });
    });
  });
});

// 上传文件（兼容旧版单体上传）
app.post('/api/cloud/upload', isAuth, (req, res) => {
  req.setTimeout(0);
  const uid = req.session.user.id;
  if (!checkFileRateLimit(uid)) return res.status(429).json({ error: '操作太频繁，请1分钟后再试' });

  db.get('SELECT COUNT(*) as cnt FROM user_file WHERE user_id = ?', [uid], (err, r) => {
    if (r.cnt >= 100) return res.status(400).json({ error: '文件数量已达上限（100个）' });

    cloudUpload.single('file')(req, res, function(err) {
      if (err) return res.status(400).json({ error: err.message || '上传失败' });
      if (!req.file) return res.status(400).json({ error: '请选择文件' });

      const dirId = req.body.dir_id ? parseInt(req.body.dir_id) : null;
      const originalName = req.file.originalname;

      if (!validateFileName(originalName)) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: '文件名不合法' });
      }

      ensureStorageConfig(uid, (err, cfg) => {
        db.get('SELECT COALESCE(SUM(file_size),0)+COALESCE(SUM(content_length),0) as used FROM user_file WHERE user_id = ?', [uid], (err, r2) => {
          const rawSize = fs.statSync(req.file.path).size;
          if (r2.used + rawSize > cfg.total_quota) {
            fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: '存储空间不足，请扩容或清理文件' });
          }

          // 加密原文件（流式，无竞态）
          if (!req.session.user || !req.session.user.encKey) {
            fs.unlink(req.file.path, () => {});
            return res.status(500).json({ error: '密钥未就绪，请重新登录后再试' });
          }
          const encKey = Buffer.from(req.session.user.encKey, 'hex');
          console.log('[UPLOAD] encKey hex:', req.session.user.encKey.substring(0, 16) + '...');
          const encPath = req.file.path + '.enc';
          encryptFileStream(req.file.path, encPath, encKey).then(({ encSize }) => {
            try { fs.unlinkSync(req.file.path); } catch (e2) {}
            fs.renameSync(encPath, req.file.path);
            const fileSize = fs.statSync(req.file.path).size;
            const relPath = 'uploads/cloud/' + uid + '/' + req.file.filename;
            const salt = req.session.user && req.session.user.encSalt || '';
            db.run('INSERT INTO user_file (user_id, dir_id, file_name, file_path, file_size, mime_type, content_length, enc_salt, enc_iterations) VALUES (?,?,?,?,?,?,?,?,?)',
              [uid, dirId, originalName, relPath, fileSize, req.file.mimetype, rawSize, salt, PBKDF2_ITERATIONS], function(err2) {
            if (err2) { fs.unlink(req.file.path, () => {}); return res.status(400).json({ error: '保存失败，可能同名文件已存在' }); }
            logOper(uid, 2, this.lastID, 'create', '上传文件: ' + originalName);
            res.json({ id: this.lastID, file_name: originalName, file_size: rawSize, mime_type: req.file.mimetype });
          });
          }).catch(e => {
            try { fs.unlinkSync(req.file.path); } catch (e2) {}
            try { if (fs.existsSync(encPath)) fs.unlinkSync(encPath); } catch (e2) {}
            return res.status(500).json({ error: '加密失败: ' + e.message });
          });
        });
      });
    });
  });
});

// 创建文件夹
app.post('/api/cloud/folder/create', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const name = (req.body.dir_name || '').trim();
  const parentId = req.body.parent_dir_id ? parseInt(req.body.parent_dir_id) : null;
  if (!validateFileName(name)) return res.status(400).json({ error: '文件夹名不合法（1-100字符，不含 /\\:*?"<>|）' });

  db.get('SELECT COUNT(*) as cnt FROM user_dir WHERE user_id = ?', [uid], (err, r) => {
    if (r.cnt >= 20) return res.status(400).json({ error: '文件夹数量已达上限（20个）' });
    db.run('INSERT INTO user_dir (user_id, parent_dir_id, dir_name) VALUES (?,?,?)', [uid, parentId, name], function(err) {
      if (err) return res.status(400).json({ error: '创建失败，可能同名文件夹已存在' });
      logOper(uid, 1, this.lastID, 'create', '创建文件夹: ' + name);
      res.json({ id: this.lastID });
    });
  });
});

// 重命名文件夹
app.post('/api/cloud/folder/rename', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const id = parseInt(req.body.id);
  const newName = (req.body.new_name || '').trim();
  if (!id || !validateFileName(newName)) return res.status(400).json({ error: '名称不合法' });
  db.get('SELECT * FROM user_dir WHERE id = ? AND user_id = ?', [id, uid], (err, dir) => {
    if (!dir) return res.status(404).json({ error: '文件夹不存在' });
    if (dir.parent_dir_id === null) return res.status(400).json({ error: '根目录禁止重命名' });
    db.run('UPDATE user_dir SET dir_name = ? WHERE id = ? AND user_id = ?', [newName, id, uid], function(err) {
      if (err) return res.status(400).json({ error: '重命名失败，可能同名已存在' });
      logOper(uid, 1, id, 'rename', dir.dir_name + ' → ' + newName);
      res.json({ ok: true });
    });
  });
});

// 移动文件夹
app.post('/api/cloud/folder/move', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const id = parseInt(req.body.id);
  const newParent = req.body.new_parent_id ? parseInt(req.body.new_parent_id) : null;
  if (!id) return res.status(400).json({ error: '参数错误' });
  db.get('SELECT * FROM user_dir WHERE id = ? AND user_id = ?', [id, uid], (err, dir) => {
    if (!dir) return res.status(404).json({ error: '文件夹不存在' });
    getDescendantDirIds(uid, id, (e, descIds) => {
      if (newParent && descIds.includes(newParent)) return res.status(400).json({ error: '不能移动到自身或子文件夹' });
      db.run('UPDATE user_dir SET parent_dir_id = ? WHERE id = ? AND user_id = ?', [newParent, id, uid], function(err) {
        if (err) return res.status(400).json({ error: '移动失败' });
        logOper(uid, 1, id, 'move', '移动到 ' + (newParent || '根目录'));
        res.json({ ok: true });
      });
    });
  });
});

// 递归删除文件夹
app.post('/api/cloud/folder/delete', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const id = parseInt(req.body.id);
  if (!id) return res.status(400).json({ error: '参数错误' });
  db.get('SELECT * FROM user_dir WHERE id = ? AND user_id = ?', [id, uid], (err, dir) => {
    if (!dir) return res.status(404).json({ error: '文件夹不存在' });
    if (dir.parent_dir_id === null) return res.status(400).json({ error: '根目录禁止删除' });
    getDescendantDirIds(uid, id, (e, descIds) => {
      const ph = descIds.map(() => '?').join(',');
      // 先删除关联文件
      db.all(`SELECT file_path FROM user_file WHERE user_id = ? AND dir_id IN (${ph})`, [uid, ...descIds], (err, files) => {
        files.forEach(f => { if (f.file_path) fs.unlink(path.join('public', f.file_path), () => {}); });
        db.serialize(() => {
          db.run('BEGIN TRANSACTION');
          db.run(`DELETE FROM user_file WHERE user_id = ? AND dir_id IN (${ph})`, [uid, ...descIds]);
          db.run(`DELETE FROM user_dir WHERE user_id = ? AND id IN (${ph})`, [uid, ...descIds]);
          db.run('COMMIT', (err) => {
            if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: '删除失败' }); }
            logOper(uid, 1, id, 'delete', '删除文件夹: ' + dir.dir_name);
            res.json({ ok: true });
          });
        });
      });
    });
  });
});

// 创建文本文件
app.post('/api/cloud/file/create', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const name = (req.body.file_name || '').trim();
  const dirId = req.body.dir_id ? parseInt(req.body.dir_id) : null;
  if (!checkFileRateLimit(uid)) return res.status(429).json({ error: '操作太频繁，请1分钟后再试' });
  if (!validateFileName(name)) return res.status(400).json({ error: '文件名不合法（1-100字符）' });
  db.get('SELECT COUNT(*) as cnt FROM user_file WHERE user_id = ?', [uid], (err, r) => {
    if (r.cnt >= 100) return res.status(400).json({ error: '文件数量已达上限（100个）' });
    db.run('INSERT INTO user_file (user_id, dir_id, file_name, content, content_length, file_size) VALUES (?,?,?,?,0,0)',
      [uid, dirId, name, ''], function(err) {
      if (err) return res.status(400).json({ error: '创建失败，可能同名文件已存在' });
      logOper(uid, 2, this.lastID, 'create', '创建文件: ' + name);
      res.json({ id: this.lastID });
    });
  });
});

// 读取文件
app.get('/api/cloud/file/read', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const id = parseInt(req.query.id);
  db.get('SELECT * FROM user_file WHERE id = ? AND user_id = ?', [id, uid], (err, file) => {
    if (!file) return res.status(404).json({ error: '文件不存在' });
    if (file.file_path) {
      const filePath = path.join(__dirname, 'public', file.file_path);
      if (!fs.existsSync(filePath)) return res.json({ id: file.id, file_name: file.file_name, file_path: file.file_path,
        file_size: file.file_size, mime_type: file.mime_type, content: '', content_length: 0 });
      if (file.enc_key && file.enc_iv) migrateOldFileSync(filePath, file);
      const hdr = parseEncFileHeader(filePath);
      if (hdr && hdr.valid) {
        try {
          const encKey = getFileEncKey(req, file);
          if (!encKey) return res.json({ id: file.id, file_name: file.file_name, file_path: file.file_path,
            file_size: file.file_size, mime_type: file.mime_type, content: '', content_length: 0 });
          const data = decryptText(filePath, encKey);
          res.json({ id: file.id, file_name: file.file_name, file_path: file.file_path,
            file_size: file.file_size, mime_type: file.mime_type, content: data, content_length: data.length });
        } catch (e) {
          res.json({ id: file.id, file_name: file.file_name, file_path: file.file_path,
            file_size: file.file_size, mime_type: file.mime_type, content: '', content_length: 0 });
        }
      } else {
        fs.readFile(filePath, 'utf-8', (err, data) => {
          if (err) return res.json({ id: file.id, file_name: file.file_name, file_path: file.file_path,
            file_size: file.file_size, mime_type: file.mime_type, content: '', content_length: 0 });
          res.json({ id: file.id, file_name: file.file_name, file_path: file.file_path,
            file_size: file.file_size, mime_type: file.mime_type, content: data, content_length: data.length });
        });
      }
    } else {
      res.json({ id: file.id, file_name: file.file_name, file_path: file.file_path,
        file_size: file.file_size, mime_type: file.mime_type,
        content: file.content || '', content_length: file.content_length });
    }
  });
});

// 保存文本文件
app.post('/api/cloud/file/save', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const id = parseInt(req.body.id);
  const content = req.body.content || '';
  if (!checkFileRateLimit(uid)) return res.status(429).json({ error: '操作太频繁，请1分钟后再试' });
  if (content.length > 50000) return res.status(400).json({ error: '单个文本文件最大50000字符' });
  db.get('SELECT * FROM user_file WHERE id = ? AND user_id = ?', [id, uid], (err, file) => {
    if (!file) return res.status(404).json({ error: '文件不存在' });
    if (file.file_path) {
      const filePath = path.join(__dirname, 'public', file.file_path);
      if (file.enc_key && file.enc_iv) migrateOldFileSync(filePath, file);
      const hdr2 = parseEncFileHeader(filePath);
      if (hdr2 && hdr2.valid) {
        try {
          const encKey = getFileEncKey(req, file);
          if (!encKey) return res.status(500).json({ error: '密钥未就绪' });
          const tmpPath = filePath + '.tmp';
          const iv = crypto.randomBytes(12);
          const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
          const hdr = Buffer.alloc(40);
          hdr.write(ENC_MAGIC, 0, 8, 'utf8');
          hdr.writeUInt16BE(ENC_VERSION, 8);
          hdr.writeUInt8(12, 10);
          hdr.writeUInt8(16, 11);
          iv.copy(hdr, 12);
          const encBuf = Buffer.concat([hdr, cipher.update(content, 'utf-8'), cipher.final()]);
          const tag = cipher.getAuthTag();
          tag.copy(encBuf, 24);
          fs.writeFileSync(tmpPath, encBuf);
          fs.renameSync(tmpPath, filePath);
          logOper(uid, 2, id, 'save', '保存文件');
          res.json({ ok: true, content_length: content.length });
        } catch (e) {
          res.status(500).json({ error: '加密保存失败' });
        }
      } else {
        fs.writeFile(filePath, content, 'utf-8', (err) => {
          if (err) return res.status(500).json({ error: '保存失败' });
          logOper(uid, 2, id, 'save', '保存文件');
          res.json({ ok: true, content_length: content.length });
        });
      }
    } else {
    ensureStorageConfig(uid, (err, cfg) => {
      db.get('SELECT COALESCE(SUM(file_size),0)+COALESCE(SUM(content_length),0) as used FROM user_file WHERE user_id = ?', [uid], (err, r) => {
        const newUsed = r.used - file.content_length + content.length;
        if (newUsed > cfg.total_quota) return res.status(400).json({ error: '存储空间不足' });
        db.run('UPDATE user_file SET content=?, content_length=?, update_time=CURRENT_TIMESTAMP WHERE id=? AND user_id=?',
          [content, content.length, id, uid], function(err) {
          if (err) return res.status(500).json({ error: '保存失败' });
          logOper(uid, 2, id, 'save', '保存文件');
          res.json({ ok: true, content_length: content.length });
        });
      });
    });
    }
  });
});

// 重命名文件
app.post('/api/cloud/file/rename', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const id = parseInt(req.body.id);
  const newName = (req.body.new_name || '').trim();
  if (!id || !validateFileName(newName)) return res.status(400).json({ error: '文件名不合法' });
  db.get('SELECT * FROM user_file WHERE id = ? AND user_id = ?', [id, uid], (err, file) => {
    if (!file) return res.status(404).json({ error: '文件不存在' });
    db.run('UPDATE user_file SET file_name = ? WHERE id = ? AND user_id = ?', [newName, id, uid], function(err) {
      if (err) return res.status(400).json({ error: '重命名失败，可能同名已存在' });
      logOper(uid, 2, id, 'rename', file.file_name + ' → ' + newName);
      res.json({ ok: true });
    });
  });
});

// 移动文件
app.post('/api/cloud/file/move', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const id = parseInt(req.body.id);
  const newDir = req.body.new_dir_id ? parseInt(req.body.new_dir_id) : null;
  if (!id) return res.status(400).json({ error: '参数错误' });
  db.get('SELECT * FROM user_file WHERE id = ? AND user_id = ?', [id, uid], (err, file) => {
    if (!file) return res.status(404).json({ error: '文件不存在' });
    db.run('UPDATE user_file SET dir_id = ? WHERE id = ? AND user_id = ?', [newDir, id, uid], function(err) {
      if (err) return res.status(400).json({ error: '移动失败，可能同名已存在' });
      logOper(uid, 2, id, 'move', '移动到 ' + (newDir || '根目录'));
      res.json({ ok: true });
    });
  });
});

// 删除文件
app.post('/api/cloud/file/delete', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const id = parseInt(req.body.id);
  if (!id) return res.status(400).json({ error: '参数错误' });
  db.get('SELECT * FROM user_file WHERE id = ? AND user_id = ?', [id, uid], (err, file) => {
    if (!file) return res.status(404).json({ error: '文件不存在' });
    if (file.file_path) fs.unlink(path.join('public', file.file_path), () => {});
    db.run('DELETE FROM user_file WHERE id = ? AND user_id = ?', [id, uid], function(err) {
      if (err) return res.status(500).json({ error: '删除失败' });
      logOper(uid, 2, id, 'delete', '删除文件: ' + file.file_name);
      res.json({ ok: true });
    });
  });
});

// 下载文件（解密后发送）
app.get('/api/cloud/file/download/:id', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const id = parseInt(req.params.id);
  db.get('SELECT * FROM user_file WHERE id = ? AND user_id = ?', [id, uid], (err, file) => {
    if (!file) return res.status(404).json({ error: '文件不存在' });
    if (!file.file_path) return res.status(400).json({ error: '该文件无物理存储' });
    const filePath = path.join(__dirname, 'public', file.file_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件已被删除' });
    res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(file.file_name));
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    if (file.enc_key && file.enc_iv) migrateOldFileSync(filePath, file);
    const hdr = parseEncFileHeader(filePath);
    console.log('[DOWNLOAD] 文件:', file.file_name, '| 头检测:', hdr ? (hdr.valid ? '有效加密文件' : '无效:' + hdr.reason) : '无头信息');
    if (hdr && hdr.valid) {
      const encKey = getFileEncKey(req, file);
      console.log('[DOWNLOAD] encKey:', encKey ? encKey.toString('hex').substring(0, 16) + '...' : 'NULL');
      if (!encKey) { console.log('[DOWNLOAD] 密钥未就绪'); return res.status(500).json({ error: '密钥未就绪，请重新登录' }); }
      decryptToStream(filePath, encKey, res).catch(err => {
        console.log('[DOWNLOAD] 解密失败:', err.message);
        if (!res.headersSent) res.status(500).json({ error: '解密失败: ' + err.message });
      });
    } else {
      console.log('[DOWNLOAD] 未加密文件，直接输出');
      fs.createReadStream(filePath).pipe(res);
    }
  });
});

// 流媒体播放（支持 Range 进度条拖动）
app.get('/api/cloud/file/stream/:id', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const id = parseInt(req.params.id);
  db.get('SELECT * FROM user_file WHERE id = ? AND user_id = ?', [id, uid], (err, file) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    if (!file) return res.status(404).json({ error: '文件不存在' });
    if (!file.file_path) return res.status(400).json({ error: '该文件无物理存储' });
    const filePath = path.join(__dirname, 'public', file.file_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件已被删除' });
    const mime = file.mime_type || 'application/octet-stream';
    if (file.enc_key && file.enc_iv) migrateOldFileSync(filePath, file);
    const hdr = parseEncFileHeader(filePath);
    console.log('[STREAM] 文件:', file.file_name, '| 头检测:', hdr ? (hdr.valid ? '有效加密文件' : '无效:' + hdr.reason) : '无头信息');
    if (hdr && hdr.valid) {
      const encKey = getFileEncKey(req, file);
      console.log('[STREAM] encKey:', encKey ? encKey.toString('hex').substring(0, 16) + '...' : 'NULL');
      if (!encKey) { console.log('[STREAM] 密钥未就绪'); return res.status(500).json({ error: '密钥未就绪' }); }
      res.setHeader('Content-Type', mime);
      decryptToStream(filePath, encKey, res).catch(e => {
        console.log('[STREAM] 解密失败:', e.message);
        if (!res.headersSent) res.status(500).json({ error: '解密失败' });
      });
    } else {
      const stat = fs.statSync(filePath);
      const total = stat.size;
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? Math.min(parseInt(parts[1], 10), total - 1) : total - 1;
        if (start >= total) { res.status(416).set('Content-Range', 'bytes */' + total).end(); return; }
        res.writeHead(206, { 'Content-Range': 'bytes ' + start + '-' + end + '/' + total, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': mime });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Length': total, 'Content-Type': mime, 'Accept-Ranges': 'bytes' });
        fs.createReadStream(filePath).pipe(res);
      }
    }
  });
});

// PDF 预览（方案 B: URL 携带 CSRF Token，不解除 CSRF 拦截）
app.get('/api/cloud/file/preview/pdf/:id', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const id = parseInt(req.params.id);
  db.get('SELECT * FROM user_file WHERE id = ? AND user_id = ?', [id, uid], (err, file) => {
    if (!file) return res.status(404).json({ error: '文件不存在' });
    if (!file.file_path) return res.status(400).json({ error: '无物理存储' });
    const filePath = path.join(__dirname, 'public', file.file_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件已删除' });
    if (file.enc_key && file.enc_iv) migrateOldFileSync(filePath, file);
    const hdr = parseEncFileHeader(filePath);
    if (hdr && hdr.valid) {
      const encKey = getFileEncKey(req, file);
      if (!encKey) return res.status(500).json({ error: '密钥未就绪，请重新登录' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(file.file_name) + '"');
      decryptToStream(filePath, encKey, res).catch(e => {
        if (!res.headersSent) res.status(500).json({ error: '解密失败: ' + e.message });
      });
    } else {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(file.file_name) + '"');
      fs.createReadStream(filePath).pipe(res);
    }
  });
});

// 扩容礼包
const EXPAND_PACKAGES = [
  { id: 1, name: '迷你礼包', quota: 5*1024*1024, cost: 100, bonusCoin: 50, bonusFiles: 0, bonusFolders: 0, desc: '适合轻度用户' },
  { id: 2, name: '标准礼包', quota: 50*1024*1024, cost: 500, bonusCoin: 300, bonusFiles: 5, bonusFolders: 0, desc: '性价比之选' },
  { id: 3, name: '豪华礼包', quota: 500*1024*1024, cost: 2000, bonusCoin: 1500, bonusFiles: 10, bonusFolders: 3, desc: '大容量超值' },
  { id: 4, name: '旗舰礼包', quota: 1024*1024*1024, cost: 5000, bonusCoin: 4000, bonusFiles: 20, bonusFolders: 5, desc: '顶级享受' },
];
app.get('/api/cloud/storage/packages', isAuth, (req, res) => {
  res.json({ packages: EXPAND_PACKAGES });
});
app.post('/api/cloud/storage/package', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const pkgId = parseInt(req.body.package_id);
  const pkg = EXPAND_PACKAGES.find(p => p.id === pkgId);
  if (!pkg) return res.status(400).json({ error: '无效的礼包' });
  db.get('SELECT balance FROM users WHERE id = ?', [uid], (err, user) => {
    if (err || !user) return res.status(500).json({ error: '查询用户失败' });
    if (user.balance < pkg.cost) return res.status(400).json({ error: '虚拟币不足，需要' + pkg.cost + '，当前余额: ' + user.balance });
    ensureStorageConfig(uid, (err, cfg) => {
      if (err) return res.status(500).json({ error: '获取配置失败' });
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const nb = user.balance - pkg.cost + pkg.bonusCoin;
        db.run('UPDATE users SET balance = ? WHERE id = ?', [nb, uid], (err) => { if (err) db.run('ROLLBACK'); });
        db.run('UPDATE user_storage_config SET total_quota=total_quota+?, buy_times=buy_times+1, update_time=CURRENT_TIMESTAMP WHERE user_id=?', [pkg.quota, uid], (err) => { if (err) db.run('ROLLBACK'); });
        db.run('INSERT INTO user_storage_buy_log (user_id, cost_coin, add_quota) VALUES (?,?,?)', [uid, pkg.cost, pkg.quota], (err) => { if (err) db.run('ROLLBACK'); });
        db.run('COMMIT', (err) => {
          if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: '购买失败' }); }
          req.session.user.balance = nb;
          res.json({ ok: true, pkg: pkg.name, newQuota: cfg.total_quota + pkg.quota, newBalance: nb, bonusCoin: pkg.bonusCoin, bonusFiles: pkg.bonusFiles, bonusFolders: pkg.bonusFolders });
        });
      });
    });
  });
});

// ========== 文件夹自动同步 ==========
const OLD_MAGIC = Buffer.from('CLOUDENC');

function syncUserFolder(uid, callback) {
  const dir = path.join(__dirname, 'public', 'uploads', 'cloud', String(uid));
  function cleanOrphanRecords(s, f, m) {
    db.all('SELECT id, file_path FROM user_file WHERE user_id = ?', [uid], (er, rows) => {
      if (!rows || !rows.length) return callback(null, { scanned: s, fixed: f, migrated: m, cleaned: 0 });
      let pending = rows.length, cleaned = 0;
      rows.forEach(r => {
        const fp = path.join(__dirname, 'public', r.file_path);
        if (!fs.existsSync(fp)) {
          db.run('DELETE FROM user_file WHERE id = ?', [r.id], () => { cleaned++; if (--pending === 0) callback(null, { scanned: s, fixed: f, migrated: m, cleaned }); });
        } else { if (--pending === 0) callback(null, { scanned: s, fixed: f, migrated: m, cleaned }); }
      });
    });
  }
  if (!fs.existsSync(dir)) return cleanOrphanRecords(0, 0, 0);
  fs.readdir(dir, (err, files) => {
    if (err || !files.length) return cleanOrphanRecords(0, 0, 0);
    let scanned = 0, fixed = 0, migrated = 0, pending = 0;
    files.forEach(fname => {
      const fpath = path.join(dir, fname);
      let stats;
      try { stats = fs.statSync(fpath); } catch(e) { return; }
      if (!stats.isFile()) return;
      scanned++;
      const fd = fs.openSync(fpath, 'r');
      const hdr = Buffer.alloc(40);
      fs.readSync(fd, hdr, 0, 40, 0);
      fs.closeSync(fd);
      const relPath = 'uploads/cloud/' + uid + '/' + fname;
      const hdrStr = hdr.toString('utf8', 0, 8);

      if (hdrStr === 'CLOUDKEY') {
        const hdrInfo = parseEncFileHeader(fpath);
        const realSize = hdrInfo && hdrInfo.valid ? stats.size - hdrInfo.cipherStart : stats.size - 40;
        pending++;
        db.get('SELECT id, file_size FROM user_file WHERE user_id = ? AND file_path = ?', [uid, relPath], (er, dbF) => {
          if (dbF && (dbF.file_size === 0 || dbF.file_size !== realSize)) {
            db.run('UPDATE user_file SET file_size = ? WHERE id = ?', [realSize, dbF.id], () => { pending--; fixed++; maybeDone(); });
          } else { pending--; maybeDone(); }
        });
        return;
      }

      if (hdrStr === 'CLOUDENC') {
        pending++;
        db.get('SELECT id, enc_key, enc_iv, file_size FROM user_file WHERE user_id = ? AND file_path = ?', [uid, relPath], (er, dbF) => {
          if (!dbF || !dbF.enc_key) { pending--; maybeDone(); return; }
          try {
            const oldKey = Buffer.from(dbF.enc_key, 'hex');
            const oldIv = Buffer.from(dbF.enc_iv, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', oldKey, oldIv);
            const chunks = [];
            const input = fs.createReadStream(fpath, { start: 8 });
            input.pipe(decipher);
            decipher.on('data', chunk => chunks.push(chunk));
            decipher.on('end', () => {
              const plain = Buffer.concat(chunks);
              const newIv = crypto.randomBytes(12);
              const cipher = crypto.createCipheriv('aes-256-gcm', oldKey, newIv);
              const tmpPath = fpath + '.mig';
              const out = fs.createWriteStream(tmpPath);
              const newHdr = Buffer.alloc(40);
              newHdr.write('CLOUDKEY', 0, 8, 'utf8');
              newHdr.writeUInt16BE(ENC_VERSION, 8);
              newHdr.writeUInt8(12, 10);
              newHdr.writeUInt8(16, 11);
              newIv.copy(newHdr, 12);
              out.write(newHdr);
              cipher.pipe(out);
              cipher.write(plain);
              cipher.end();
              cipher.on('final', () => {
                const tag = cipher.getAuthTag();
                tag.copy(newHdr, 24);
                const fd2 = fs.openSync(tmpPath, 'r+');
                fs.writeSync(fd2, newHdr, 24, 16, 24);
                fs.closeSync(fd2);
                out.end();
              });
              out.on('finish', () => {
                fs.unlink(fpath, () => {});
                fs.rename(tmpPath, fpath, () => {
                  const encSalt = xorEncrypt(oldKey, SERVER_ENC_SECRET).toString('hex');
                  db.run('UPDATE user_file SET enc_salt = ?, enc_iterations = 0, enc_key = \"\", enc_iv = \"\", file_size = ? WHERE id = ?', [encSalt, plain.length, dbF.id], () => { pending--; migrated++; maybeDone(); });
                });
              });
              out.on('error', () => { try { fs.unlinkSync(tmpPath); } catch(e) {} pending--; maybeDone(); });
            });
            decipher.on('error', () => { pending--; maybeDone(); });
            input.on('error', () => { pending--; maybeDone(); });
          } catch(e) { pending--; maybeDone(); }
        });
        return;
      }

      pending++;
      db.get('SELECT enc_key, enc_iv FROM user_file WHERE user_id = ? AND file_path = ?', [uid, relPath], (err2, dbFile) => {
        if (dbFile && dbFile.enc_key) {
          const tmp = fpath + '.hdr';
          const w = fs.createWriteStream(tmp);
          w.write(OLD_MAGIC);
          fs.createReadStream(fpath).pipe(w);
          w.on('finish', () => { fs.unlink(fpath, () => {}); fs.rename(tmp, fpath, () => { pending--; fixed++; maybeDone(); }); });
          w.on('error', () => { pending--; maybeDone(); });
        } else {
          pending--; maybeDone();
        }
      });
    });
    function maybeDone() { if (pending <= 0) cleanOrphanRecords(scanned, fixed, migrated); }
    if (pending === 0) cleanOrphanRecords(scanned, fixed, migrated);
  });
}

app.post('/api/cloud/sync', isAuth, (req, res) => {
  syncUserFolder(req.session.user.id, (err, r) => {
    if (err) return res.status(500).json({ error: '同步失败' });
    res.json({ ok: true, ...r });
  });
});

setInterval(() => {
  db.all('SELECT DISTINCT user_id FROM user_file', (err, users) => {
    if (err || !users) return;
    users.forEach(u => syncUserFolder(u.user_id, () => {}));
  });
}, 60000);

// ========== 文件分享 ==========

// 创建分享链接
app.post('/api/cloud/share/create', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const { file_id, expire_hours, code, max_downloads } = req.body;
  if (!file_id) return res.status(400).json({ error: '缺少文件ID' });
  db.get('SELECT * FROM user_file WHERE id = ? AND user_id = ?', [file_id, uid], (err, file) => {
    if (err || !file) return res.status(404).json({ error: '文件不存在' });
    const token = require('uuid').v4().replace(/-/g, '').substring(0, 16);
    const expireTime = expire_hours > 0 ? new Date(Date.now() + expire_hours * 3600000).toISOString() : null;
    const shareCode = (code || '').trim();
    const maxDl = Math.max(0, parseInt(max_downloads) || 0);
    db.run('INSERT INTO file_share (user_id, file_id, token, code, expire_time, max_downloads) VALUES (?,?,?,?,?,?)',
      [uid, file_id, token, shareCode, expireTime, maxDl], function(err2) {
        if (err2) return res.status(500).json({ error: '创建分享失败' });
        res.json({ ok: true, token, code: shareCode, file_name: file.file_name });
      });
  });
});

// 我的分享列表
app.get('/api/cloud/share/list', isAuth, (req, res) => {
  const uid = req.session.user.id;
  db.all(`SELECT s.*, f.file_name FROM file_share s LEFT JOIN user_file f ON s.file_id = f.id WHERE s.user_id = ? ORDER BY s.create_time DESC`, [uid], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(rows || []);
  });
});

// 删除分享
app.post('/api/cloud/share/delete', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const { id } = req.body;
  db.run('DELETE FROM file_share WHERE id = ? AND user_id = ?', [id, uid], function(err) {
    if (err) return res.status(500).json({ error: '删除失败' });
    res.json({ ok: true });
  });
});

// 公开分享页面（无需登录）
app.get('/share/:token', (req, res) => {
  const { token } = req.params;
  db.get('SELECT s.*, f.file_name, f.file_size, f.mime_type FROM file_share s LEFT JOIN user_file f ON s.file_id = f.id WHERE s.token = ?', [token], (err, share) => {
    if (err || !share) return res.status(404).send('分享不存在或已删除');
    if (share.expire_time && new Date(share.expire_time) < new Date()) return res.status(410).send('分享已过期');
    if (share.max_downloads > 0 && share.download_count >= share.max_downloads) return res.status(410).send('下载次数已用完');
    res.render('share', { share, layout: false });
  });
});

// 验证提取码
app.post('/api/share/:token/verify', (req, res) => {
  const { token } = req.params;
  const { code } = req.body;
  db.get('SELECT * FROM file_share WHERE token = ?', [token], (err, share) => {
    if (err || !share) return res.json({ ok: false, error: '分享不存在' });
    if (share.expire_time && new Date(share.expire_time) < new Date()) return res.json({ ok: false, error: '分享已过期' });
    if (share.max_downloads > 0 && share.download_count >= share.max_downloads) return res.json({ ok: false, error: '下载次数已用完' });
    if (share.code && share.code !== (code || '').trim()) return res.json({ ok: false, error: '提取码错误' });
    res.json({ ok: true });
  });
});

// 下载分享文件
app.get('/api/share/:token/download', (req, res) => {
  const { token } = req.params;
  const { code } = req.query;
  db.get('SELECT s.*, f.file_name, f.file_path, f.mime_type, f.enc_key, f.enc_iv FROM file_share s LEFT JOIN user_file f ON s.file_id = f.id WHERE s.token = ?', [token], (err, share) => {
    if (err || !share) return res.status(404).json({ error: '分享不存在' });
    if (share.expire_time && new Date(share.expire_time) < new Date()) return res.status(410).json({ error: '分享已过期' });
    if (share.max_downloads > 0 && share.download_count >= share.max_downloads) return res.status(410).json({ error: '下载次数已用完' });
    if (share.code && share.code !== (code || '').trim()) return res.status(403).json({ error: '提取码错误' });
    if (!share.file_path) return res.status(400).json({ error: '文件无物理存储' });
    const filePath = path.join(__dirname, 'public', share.file_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件已被删除' });
    db.run('UPDATE file_share SET download_count = download_count + 1 WHERE id = ?', [share.id]);
    res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(share.file_name));
    res.setHeader('Content-Type', share.mime_type || 'application/octet-stream');
    if (share.enc_key) {
      const encKey = Buffer.from(share.enc_key, 'hex');
      decryptToStream(filePath, encKey, res).catch(() => {
        if (!res.headersSent) res.status(500).json({ error: '解密失败' });
      });
    } else {
      fs.createReadStream(filePath).pipe(res);
    }
  });
});

// ========== Socket.IO ==========
  function broadcastOnlineCount() {
    const uniqueIds = new Set();
    let guestCount = 0;
    for (let [sid, u] of allConnections) {
      if (u.id) uniqueIds.add(u.id);
      else guestCount++;
    }
    io.emit('onlineCount', uniqueIds.size + guestCount);
  }
  io.on('connection', (socket) => {
    allConnections.set(socket.id, { id: null, username: '访客', page: '未知', ip: socket.handshake.address });
    broadcastOnlineCount();
    io.emit('onlineUsers', Array.from(allConnections.values()).map(u => ({ id: u.id, username: u.username, page: u.page })));
    socket.emit('history', chatHistory.slice(-50));
    socket.on('msg', (data) => {
      const msg = sanitize(data.msg || '').substring(0, 500);
      if (!msg) return;
      const msgObj = { type: 'text', user: data.user || '未知', msg, time: new Date().toLocaleTimeString() };
      chatHistory.push(msgObj);
      if (chatHistory.length > 100) chatHistory.shift();
      io.emit('msg', msgObj);
    });

    socket.on('login', (user) => {
      if (user && user.id) {
        db.get('SELECT avatar FROM users WHERE id = ?', [user.id], (err, row) => {
          const avatar = row ? row.avatar : '';
          onlineUsers.set(socket.id, { id: user.id, username: user.username, avatar: avatar });
          allConnections.set(socket.id, { id: user.id, username: user.username, page: user.page || '未知', ip: socket.handshake.address });
          io.emit('onlineUsers', Array.from(allConnections.values()).map(u => ({ id: u.id, username: u.username, page: u.page })));
          broadcastOnlineCount();
        });
      }
    });

    socket.on('privateMsg', (data) => {
      const { to, message } = data;
      const fromUser = onlineUsers.get(socket.id);
      if (!fromUser) return;
      const msg = sanitize(message).substring(0, 500);
      if (!msg) return;
      db.run('INSERT INTO private_messages (from_user, to_user, message, time, is_read) VALUES (?, ?, ?, ?, 0)', [fromUser.id, to, msg, new Date().toLocaleTimeString()], (err) => {
        if (err) {
          console.error('保存私信失败:', err);
          socket.emit('error', '发送消息失败，请重试');
          return;
        }
        for (let [sid, user] of onlineUsers) {
          if (user.id == to) {
            io.to(sid).emit('privateMsg', { from: fromUser.username, fromId: fromUser.id, message: msg, time: new Date().toLocaleTimeString() });
            break;
          }
        }
        // 通知接收者有新私信
        for (let [sid, user] of onlineUsers) {
          if (user.id == to) {
            db.get('SELECT COUNT(*) as cnt FROM private_messages WHERE to_user = ? AND is_read = 0', [to], (e, r) => {
              io.to(sid).emit('unreadUpdate', { privateUnread: r ? r.cnt : 0 });
            });
            break;
          }
        }
      });
    });

    socket.on('joinGroup', (groupId) => {
      socket.join('group_' + groupId);
    });

    socket.on('groupMsg', (data) => {
      const { groupId, message } = data;
      const fromUser = onlineUsers.get(socket.id);
      if (!fromUser) return;
      const msg = sanitize(message).substring(0, 500);
      if (!msg) return;
      const now = new Date().toLocaleTimeString();
      db.run('INSERT INTO group_messages (group_id, from_user, message, time) VALUES (?, ?, ?, ?)', [groupId, fromUser.id, msg, now], function(err) {
        if (err) return;
        const msgId = this.lastID;
        io.to('group_' + groupId).emit('newGroupMsg', {
          id: msgId, groupId: parseInt(groupId), from: fromUser.username, fromId: fromUser.id, message: msg, time: now, avatar: fromUser.avatar || ''
        });
        // 通知群成员有未读消息（排除发送者）
        db.all('SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?', [groupId, fromUser.id], (err, members) => {
          if (err) return;
          members.forEach(m => {
            for (let [sid, user] of onlineUsers) {
              if (user.id == m.user_id) {
                db.get('SELECT COUNT(*) as cnt FROM group_messages gm WHERE gm.group_id = ? AND gm.id > COALESCE((SELECT last_read_id FROM group_members WHERE group_id = ? AND user_id = ?), 0)', [groupId, groupId, m.user_id], (e, r) => {
                  io.to(sid).emit('groupUnread', { groupId: parseInt(groupId), unread: r ? r.cnt : 0 });
                });
                break;
              }
            }
          });
        });
      });
    });

    socket.on('markRead', (data) => {
      const { groupId } = data;
      const user = onlineUsers.get(socket.id);
      if (!user) return;
      db.run('UPDATE group_members SET last_read_id = (SELECT COALESCE(MAX(id), 0) FROM group_messages WHERE group_id = ?) WHERE group_id = ? AND user_id = ?', [groupId, groupId, user.id]);
      socket.emit('groupUnread', { groupId: parseInt(groupId), unread: 0 });
    });

    socket.on('markPrivateRead', (data) => {
      const { fromId } = data;
      const user = onlineUsers.get(socket.id);
      if (!user) return;
      db.run('UPDATE private_messages SET is_read = 1 WHERE to_user = ? AND from_user = ? AND is_read = 0', [user.id, fromId]);
      db.get('SELECT COUNT(*) as cnt FROM private_messages WHERE to_user = ? AND is_read = 0', [user.id], (e, r) => {
        socket.emit('unreadUpdate', { privateUnread: r ? r.cnt : 0 });
      });
    });

    socket.on('getUnread', () => {
      const user = onlineUsers.get(socket.id);
      if (!user) return;
      db.get('SELECT COUNT(*) as cnt FROM private_messages WHERE to_user = ? AND is_read = 0', [user.id], (e, r) => {
        const privateUnread = r ? r.cnt : 0;
        db.all('SELECT g.id, (SELECT COUNT(*) FROM group_messages gm WHERE gm.group_id = g.id AND gm.id > COALESCE(gm2.last_read_id, 0)) as unread FROM groups g JOIN group_members gm2 ON g.id = gm2.group_id WHERE gm2.user_id = ?', [user.id], (e2, rows) => {
          socket.emit('unreadUpdate', { privateUnread, groups: rows || [] });
        });
      });
    });

    socket.on('getNotifUnread', () => {
      const user = onlineUsers.get(socket.id);
      if (!user) return;
      db.get('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0', [user.id], (e, r) => {
        socket.emit('notifUnreadUpdate', { count: r ? r.cnt : 0 });
      });
    });

    // ===================== 棋类联机匹配系统 =====================
    const gameQueues = { chess: [], gomoku: [], go: [] };
    const gameRooms = {};
    req.app.locals.gameRooms = gameRooms;

    function joinGameQueue(socket, gameType, userId, username, mode, timeControl, boardSize) {
      const queue = gameQueues[gameType];
      if (!queue) return;
      // Remove from queue if already in it
      leaveGameQueue(socket, gameType);
      queue.push({ socket, userId, username, mode, timeControl, boardSize, joinedAt: Date.now() });
      socket.join('queue_' + gameType);
      socket.emit(gameType + '_queue_status', { inQueue: true, position: queue.length });
      // Try to match
      tryMatch(gameType);
    }

    function leaveGameQueue(socket, gameType) {
      const queue = gameQueues[gameType];
      if (!queue) return;
      const idx = queue.findIndex(q => q.socket.id === socket.id);
      if (idx !== -1) {
        queue.splice(idx, 1);
        socket.leave('queue_' + gameType);
        socket.emit(gameType + '_queue_status', { inQueue: false });
      }
    }

    function tryMatch(gameType) {
      const queue = gameQueues[gameType];
      if (queue.length < 2) return;
      // Simple matching: match first two players with same mode
      for (let i = 0; i < queue.length - 1; i++) {
        for (let j = i + 1; j < queue.length; j++) {
          const a = queue[i], b = queue[j];
          if (a.mode === b.mode && a.userId !== b.userId) {
            queue.splice(j, 1);
            queue.splice(i, 1);
            createGameRoom(gameType, a, b);
            return;
          }
        }
      }
    }

    function createGameRoom(gameType, playerA, playerB) {
      const roomId = gameType + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
      const room = {
        id: roomId,
        gameType,
        players: [
          { socket: playerA.socket, userId: playerA.userId, username: playerA.username, ready: false },
          { socket: playerB.socket, userId: playerB.userId, username: playerB.username, ready: false }
        ],
        state: 'playing',
        moves: [],
        board: null,
        currentTurn: playerA.userId,
        timeControl: playerA.timeControl || 'standard',
        boardSize: playerA.boardSize || null,
        startedAt: Date.now()
      };
      gameRooms[roomId] = room;

      playerA.socket.join(roomId);
      playerB.socket.join(roomId);

      // Get ratings
      const getRatings = (cb) => {
        db.all(`SELECT user_id, rating, rd, tier FROM game_glicko2_ratings WHERE game_type = ? AND season = (SELECT COALESCE(MAX(season),1) FROM game_glicko2_ratings WHERE game_type = ?) AND user_id IN (?, ?)`,
          [gameType, gameType, playerA.userId, playerB.userId], (err, rows) => {
            const ratings = {};
            (rows || []).forEach(r => { ratings[r.user_id] = { rating: r.rating, rd: r.rd, tier: glicko2.getTier(r.rating) }; });
            if (!ratings[playerA.userId]) ratings[playerA.userId] = { rating: 1500, rd: 350, tier: '初学' };
            if (!ratings[playerB.userId]) ratings[playerB.userId] = { rating: 1500, rd: 350, tier: '初学' };
            cb(ratings);
          });
      };

      getRatings((ratings) => {
        const timeLimits = { standard: 900, blitz: 180, rapid: 60 };
        const timeLimit = timeLimits[room.timeControl] || 900;
        io.to(roomId).emit(gameType + '_match_found', {
          roomId,
          opponent: { id: playerB.userId, username: playerB.username, rating: ratings[playerB.userId] },
          selfRating: ratings[playerA.userId],
          timeLimit,
          boardSize: room.boardSize
        });
        // Notify player B
        io.to(playerB.socket.id).emit(gameType + '_match_found', {
          roomId,
          opponent: { id: playerA.userId, username: playerA.username, rating: ratings[playerA.userId] },
          selfRating: ratings[playerB.userId],
          timeLimit,
          boardSize: room.boardSize
        });
      });
    }

    // Board game Socket.IO events
    ['chess', 'gomoku', 'go'].forEach(gameType => {
      socket.on(gameType + '_join_queue', (data) => {
        if (!socket.userId) return;
        joinGameQueue(socket, gameType, socket.userId, socket.username, data.mode || 'casual', data.timeControl || 'standard', data.boardSize || null);
      });
      socket.on(gameType + '_leave_queue', () => {
        leaveGameQueue(socket, gameType);
      });
      socket.on(gameType + '_create_room', (data) => {
        if (!socket.userId) return;
        const roomId = gameType + '_pvt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
        const room = {
          id: roomId, gameType, players: [{ socket, userId: socket.userId, username: socket.username }],
          state: 'waiting', moves: [], board: null, currentTurn: null,
          timeControl: data.timeControl || 'standard', boardSize: data.boardSize || null,
          isPrivate: true, password: data.password || '', startedAt: Date.now()
        };
        gameRooms[roomId] = room;
        socket.join(roomId);
        socket.emit(gameType + '_room_created', { roomId, password: data.password || '' });
      });
      socket.on(gameType + '_join_room', (data) => {
        if (!socket.userId || !data.roomId) return;
        const room = gameRooms[data.roomId];
        if (!room) return socket.emit(gameType + '_error', '房间不存在');
        if (room.players.length >= 2) return socket.emit(gameType + '_error', '房间已满');
        if (room.password && room.password !== data.password) return socket.emit(gameType + '_error', '密码错误');
        room.players.push({ socket, userId: socket.userId, username: socket.username });
        socket.join(data.roomId);
        room.state = 'playing';
        room.currentTurn = room.players[0].userId;
        room.startedAt = Date.now();
        io.to(data.roomId).emit(gameType + '_game_start', { roomId: data.roomId, players: room.players.map(p => ({ id: p.userId, username: p.username })), currentTurn: room.currentTurn, timeControl: room.timeControl, boardSize: room.boardSize || undefined });
      });
      socket.on(gameType + '_move', (data) => {
        if (!data.roomId) return;
        const room = gameRooms[data.roomId];
        if (!room) return;
        room.moves.push(data.move);
        room.currentTurn = room.players.find(p => p.userId !== socket.userId)?.userId;
        socket.to(data.roomId).emit(gameType + '_moved', { move: data.move, currentTurn: room.currentTurn, userId: socket.userId });
      });
      socket.on(gameType + '_resign', (data) => {
        if (!data.roomId) return;
        const room = gameRooms[data.roomId];
        if (!room) return;
        const winner = room.players.find(p => p.userId !== socket.userId);
        finishGame(gameType, room, winner?.userId, socket.userId, 'resign');
      });
      socket.on(gameType + '_offer_draw', (data) => {
        if (!data.roomId) return;
        socket.to(data.roomId).emit(gameType + '_draw_offer', { from: socket.userId });
      });
      socket.on(gameType + '_accept_draw', (data) => {
        if (!data.roomId) return;
        const room = gameRooms[data.roomId];
        if (!room) return;
        finishGame(gameType, room, null, null, 'draw');
      });
      socket.on(gameType + '_chat', (data) => {
        if (!data.roomId || !data.message) return;
        io.to(data.roomId).emit(gameType + '_chat', { from: socket.username, message: data.message.substring(0, 200), userId: socket.userId });
      });
      socket.on(gameType + '_timeout', (data) => {
        if (!data.roomId) return;
        const room = gameRooms[data.roomId];
        if (!room) return;
        const winner = room.players.find(p => p.userId !== socket.userId);
        finishGame(gameType, room, winner?.userId, socket.userId, 'timeout');
      });
    });

    function finishGame(gameType, room, winnerId, loserId, reason) {
      if (!room) return;
      room.state = 'finished';
      room.finishedAt = Date.now();

      const p1 = room.players[0], p2 = room.players[1];
      if (!p1 || !p2) return;

      const isRanked = room.isPrivate !== true;
      const result = winnerId ? (winnerId === p1.userId ? 'player1_win' : 'player2_win') : 'draw';

      io.to(room.id).emit(gameType + '_game_over', { winnerId, reason, result });

      if (isRanked && winnerId) {
        // Get current ratings
        db.all(`SELECT user_id, rating, rd, volatility, games_played, streak FROM game_glicko2_ratings WHERE game_type = ? AND season = (SELECT COALESCE(MAX(season),1) FROM game_glicko2_ratings WHERE game_type = ?) AND user_id IN (?, ?)`,
          [gameType, gameType, p1.userId, p2.userId], (err, rows) => {
            const ratingMap = {};
            (rows || []).forEach(r => { ratingMap[r.user_id] = r; });
            [p1, p2].forEach(p => {
              if (!ratingMap[p.userId]) ratingMap[p.userId] = { rating: 1500, rd: 350, volatility: 0.06, games_played: 0, streak: 0 };
            });
            const r1 = ratingMap[p1.userId], r2 = ratingMap[p2.userId];
            const score1 = winnerId === p1.userId ? 1 : (result === 'draw' ? 0.5 : 0);
            const score2 = winnerId === p2.userId ? 1 : (result === 'draw' ? 0.5 : 0);
            const streak1 = score1 === 1 ? (r1.streak > 0 ? r1.streak + 1 : 1) : (score1 === 0 ? (r1.streak < 0 ? r1.streak - 1 : -1) : 0);
            const streak2 = score2 === 1 ? (r2.streak > 0 ? r2.streak + 1 : 1) : (score2 === 0 ? (r2.streak < 0 ? r2.streak - 1 : -1) : 0);

            // Calculate new ratings using Glicko2
            const new1 = glicko2.calculate(r1.rating, r1.rd, r1.volatility, [{ opponent_rating: r2.rating, opponent_rd: r2.rd, score: score1 }]);
            const new2 = glicko2.calculate(r2.rating, r2.rd, r2.volatility, [{ opponent_rating: r1.rating, opponent_rd: r1.rd, score: score2 }]);

            // Apply streak multiplier
            const mult1 = glicko2.getStreakMultiplier(streak1, r1.games_played + 1);
            const mult2 = glicko2.getStreakMultiplier(streak2, r2.games_played + 1);
            const finalRating1 = 1500 + (new1.rating - 1500) * mult1;
            const finalRating2 = 1500 + (new2.rating - 1500) * mult2;

            const season = 1;
            const upsertRating = (userId, rating, rd, volatility, games, wins, losses, draws, streakVal) => {
              db.run(`INSERT INTO game_glicko2_ratings (user_id, game_type, rating, rd, volatility, games_played, wins, losses, draws, streak, season) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, game_type, season) DO UPDATE SET rating=excluded.rating, rd=excluded.rd, volatility=excluded.volatility, games_played=excluded.games_played, wins=excluded.wins, losses=excluded.losses, draws=excluded.draws, streak=excluded.streak, updated_at=datetime('now','localtime')`,
                [userId, gameType, rating, rd, volatility, games, wins, losses, draws, streakVal]);
            };
            const w1 = score1 === 1 ? 1 : 0, l1 = score1 === 0 ? 1 : 0, d1 = score1 === 0.5 ? 1 : 0;
            const w2 = score2 === 1 ? 1 : 0, l2 = score2 === 0 ? 1 : 0, d2 = score2 === 0.5 ? 1 : 0;
            upsertRating(p1.userId, finalRating1, new1.rd, new1.volatility, r1.games_played + 1, w1, l1, d1, streak1);
            upsertRating(p2.userId, finalRating2, new2.rd, new2.volatility, r2.games_played + 1, w2, l2, d2, streak2);

            // Save match record
            db.run(`INSERT INTO game_match_records (game_type, room_id, player1_id, player2_id, winner_id, result, player1_rating_before, player2_rating_before, player1_rating_after, player2_rating_after, player1_rd_before, player2_rd_before, player1_rd_after, player2_rd_after, is_ranked, time_control, move_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [gameType, room.id, p1.userId, p2.userId, winnerId || null, result, r1.rating, r2.rating, finalRating1, finalRating2, r1.rd, r2.rd, new1.rd, new2.rd, 1, room.timeControl, room.moves.length]);

            // Update leaderboard
            const tier1 = glicko2.getTier(finalRating1);
            const tier2 = glicko2.getTier(finalRating2);
            db.run(`INSERT INTO game_season_leaderboard (user_id, game_type, season, rating, tier, games_played, wins) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, game_type, season) DO UPDATE SET rating=excluded.rating, tier=excluded.tier, games_played=excluded.games_played, wins=excluded.wins`,
              [p1.userId, gameType, season, finalRating1, tier1, r1.games_played + 1, w1]);
            db.run(`INSERT INTO game_season_leaderboard (user_id, game_type, season, rating, tier, games_played, wins) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, game_type, season) DO UPDATE SET rating=excluded.rating, tier=excluded.tier, games_played=excluded.games_played, wins=excluded.wins`,
              [p2.userId, gameType, season, finalRating2, tier2, r2.games_played + 1, w2]);

            // Notify players of rating change
            io.to(room.id).emit(gameType + '_rating_update', {
              [p1.userId]: { rating: finalRating1, rd: new1.rd, tier: tier1, change: Math.round(finalRating1 - r1.rating) },
              [p2.userId]: { rating: finalRating2, rd: new2.rd, tier: tier2, change: Math.round(finalRating2 - r2.rating) }
            });
          });
      }
      delete gameRooms[room.id];
    }

    // ===================== 你画我猜 Socket.IO =====================
    const drawRooms = {};
    socket.on('draw_join_game', (data) => {
      if (!socket.userId) return;
      const roomId = data.roomId || 'draw_public_' + Date.now();
      let room = drawRooms[roomId];
      if (!room) {
        room = { id: roomId, players: [], state: 'lobby', round: 0, maxPlayers: data.maxPlayers || 8 };
        drawRooms[roomId] = room;
      }
      if (room.players.length >= room.maxPlayers) return socket.emit('draw_error', '房间已满');
      room.players.push({ socket, userId: socket.userId, username: socket.username, score: 0, isAlive: true });
      socket.join(roomId);
      io.to(roomId).emit('draw_room_update', { players: room.players.map(p => ({ id: p.userId, name: p.username, score: p.score, alive: p.isAlive })) });
    });
    socket.on('draw_leave_game', (data) => {
      if (!data.roomId) return;
      const room = drawRooms[data.roomId];
      if (!room) return;
      room.players = room.players.filter(p => p.userId !== socket.userId);
      socket.leave(data.roomId);
      io.to(data.roomId).emit('draw_room_update', { players: room.players.map(p => ({ id: p.userId, name: p.username, score: p.score, alive: p.isAlive })) });
      if (room.players.length === 0) delete drawRooms[data.roomId];
    });
    socket.on('draw_submit', (data) => {
      if (!data.roomId) return;
      socket.to(data.roomId).emit('draw_update', { userId: socket.userId, drawingData: data.drawingData });
    });
    socket.on('draw_vote', (data) => {
      if (!data.roomId || !data.targetId) return;
      const room = drawRooms[data.roomId];
      if (!room) return;
      // Simple vote counting
      const target = room.players.find(p => p.userId === data.targetId);
      if (target) target.votes = (target.votes || 0) + 1;
    });
    socket.on('draw_chat', (data) => {
      if (!data.roomId || !data.message) return;
      io.to(data.roomId).emit('draw_chat', { from: socket.username, message: data.message.substring(0, 200), userId: socket.userId });
    });

    // ===================== FPS 多人对战 =====================
    const fpsRooms = {};
    req.app.locals.fpsRooms = fpsRooms;

    socket.on('fps_join_room', (data) => {
      if (!socket.userId || !data.roomId) return;
      let room = fpsRooms[data.roomId];
      if (!room) {
        room = {
          id: data.roomId,
          name: data.roomName || 'FPS 房间',
          password: data.password || '',
          maxPlayers: data.maxPlayers || 8,
          players: [],
          state: 'waiting',
          gameMode: data.gameMode || 'deathmatch',
          createdBy: socket.userId,
          createdAt: Date.now()
        };
        fpsRooms[data.roomId] = room;
      }
      if (room.players.length >= room.maxPlayers) return socket.emit('fps_error', '房间已满');
      if (room.password && room.password !== data.password) return socket.emit('fps_error', '密码错误');

      room.players.push({ socket, userId: socket.userId, username: socket.username, kills: 0, deaths: 0, score: 0, team: data.team || 0 });
      socket.join('fps_' + data.roomId);
      socket.fpsRoomId = data.roomId;

      io.to('fps_' + data.roomId).emit('fps_room_update', {
        roomId: data.roomId,
        players: room.players.map(p => ({ id: p.userId, name: p.username, kills: p.kills, deaths: p.deaths, score: p.score, team: p.team })),
        state: room.state
      });
    });

    socket.on('fps_leave_room', (data) => {
      const roomId = data?.roomId || socket.fpsRoomId;
      if (!roomId) return;
      const room = fpsRooms[roomId];
      if (!room) return;
      room.players = room.players.filter(p => p.userId !== socket.userId);
      socket.leave('fps_' + roomId);
      delete socket.fpsRoomId;
      io.to('fps_' + roomId).emit('fps_room_update', {
        roomId, players: room.players.map(p => ({ id: p.userId, name: p.username, kills: p.kills, deaths: p.deaths, score: p.score, team: p.team })),
        state: room.state
      });
      if (room.players.length === 0) delete fpsRooms[roomId];
    });

    socket.on('fps_start_game', (data) => {
      const roomId = data?.roomId || socket.fpsRoomId;
      if (!roomId) return;
      const room = fpsRooms[roomId];
      if (!room) return;
      if (room.createdBy !== socket.userId) return socket.emit('fps_error', '只有房主可以开始游戏');
      room.state = 'playing';
      io.to('fps_' + roomId).emit('fps_game_started', { roomId, map: 'arena', mode: room.gameMode });
    });

    socket.on('fps_player_update', (data) => {
      const roomId = socket.fpsRoomId;
      if (!roomId) return;
      socket.to('fps_' + roomId).emit('fps_player_moved', {
        userId: socket.userId,
        position: data.position,
        rotation: data.rotation,
        health: data.health,
        isShooting: data.isShooting,
        isAiming: data.isAiming
      });
    });

    socket.on('fps_player_hit', (data) => {
      const roomId = socket.fpsRoomId;
      if (!roomId) return;
      io.to('fps_' + roomId).emit('fps_player_hit', {
        shooterId: socket.userId,
        targetId: data.targetId,
        damage: data.damage,
        isHeadshot: data.isHeadshot || false
      });
    });

    socket.on('fps_player_killed', (data) => {
      const roomId = socket.fpsRoomId;
      if (!roomId) return;
      const room = fpsRooms[roomId];
      if (!room) return;
      const shooter = room.players.find(p => p.userId === socket.userId);
      const victim = room.players.find(p => p.userId === data.targetId);
      if (shooter) shooter.kills++;
      if (victim) victim.deaths++;
      io.to('fps_' + roomId).emit('fps_player_killed', {
        killerId: socket.userId,
        killerName: socket.username,
        victimId: data.targetId,
        victimName: data.victimName || 'Unknown',
        weapon: data.weapon || 'rifle',
        isHeadshot: data.isHeadshot || false
      });
      io.to('fps_' + roomId).emit('fps_room_update', {
        roomId, players: room.players.map(p => ({ id: p.userId, name: p.username, kills: p.kills, deaths: p.deaths, score: p.kills * 100, team: p.team })),
        state: room.state
      });
    });

    socket.on('fps_player_respawn', (data) => {
      const roomId = socket.fpsRoomId;
      if (!roomId) return;
      io.to('fps_' + roomId).emit('fps_player_respawned', {
        userId: socket.userId,
        position: data.position
      });
    });

    socket.on('fps_chat', (data) => {
      const roomId = socket.fpsRoomId;
      if (!roomId || !data.message) return;
      io.to('fps_' + roomId).emit('fps_chat', {
        userId: socket.userId,
        username: socket.username,
        message: data.message.substring(0, 200)
      });
    });

    socket.on('fps_get_rooms', () => {
      const rooms = Object.values(fpsRooms).filter(r => r.state === 'waiting').map(r => ({
        id: r.id, name: r.name, playerCount: r.players.length, maxPlayers: r.maxPlayers, gameMode: r.gameMode, hasPassword: !!r.password
      }));
      socket.emit('fps_room_list', rooms);
    });

    socket.on('disconnect', () => {
      onlineUsers.delete(socket.id);
      allConnections.delete(socket.id);
      io.emit('onlineUsers', Array.from(allConnections.values()).map(u => ({ id: u.id, username: u.username, page: u.page })));
      broadcastOnlineCount();
      // Clean up FPS room
      if (socket.fpsRoomId) {
        const fpsRoom = fpsRooms[socket.fpsRoomId];
        if (fpsRoom) {
          fpsRoom.players = fpsRoom.players.filter(p => p.userId !== socket.userId);
          io.to('fps_' + socket.fpsRoomId).emit('fps_room_update', {
            roomId: socket.fpsRoomId,
            players: fpsRoom.players.map(p => ({ id: p.userId, name: p.username, kills: p.kills, deaths: p.deaths, score: p.score, team: p.team })),
            state: fpsRoom.state
          });
          if (fpsRoom.players.length === 0) delete fpsRooms[socket.fpsRoomId];
        }
      }
    });
  });

app.post('/admin/reports/:id/resolve', isAdmin, (req, res) => {
  db.run('UPDATE reports SET status = "resolved" WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).send('数据库错误');
    res.redirect('/admin/reports');
  });
});

app.post('/admin/reports/:id/reject', isAdmin, (req, res) => {
  db.run('UPDATE reports SET status = "rejected" WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).send('数据库错误');
    res.redirect('/admin/reports');
  });
});


// ========== 仓库管理 ==========
app.get('/shop/warehouses', isAuth, (req, res) => {
  db.get('SELECT * FROM shops WHERE owner_id = ?', [req.session.user.id], (err, shop) => {
    if (err || !shop) return res.status(404).send('你还没有店铺');
    db.all('SELECT * FROM warehouses WHERE shop_id = ? ORDER BY id DESC', [shop.id], (err, whs) => {
      res.render('shop_warehouses', { shop, warehouses: whs || [] });
    });
  });
});

app.post('/shop/warehouses/add', isAuth, (req, res) => {
  db.get('SELECT * FROM shops WHERE owner_id = ?', [req.session.user.id], (err, shop) => {
    if (err || !shop) return res.redirect('/shop');
    const name = sanitize(req.body.name || '默认仓库');
    const address = sanitize(req.body.address || '');
    const city = sanitize(req.body.city || '');
    db.run('INSERT INTO warehouses (shop_id, name, address, city) VALUES (?, ?, ?, ?)', [shop.id, name, address, city], () => res.redirect('/shop/warehouses'));
  });
});

app.post('/shop/warehouses/delete/:id', isAuth, (req, res) => {
  db.run('DELETE FROM warehouses WHERE id = ?', [req.params.id], () => res.redirect('/shop/warehouses'));
});

// ========== 商家发货 ==========
app.post('/shop/ship/:order_id', isAuth, (req, res) => {
  db.get('SELECT * FROM shops WHERE owner_id = ?', [req.session.user.id], (err, shop) => {
    if (err || !shop) return res.redirect('/shop');
    const oid = req.params.order_id;
    db.get('SELECT * FROM orders WHERE id = ?', [oid], (err, order) => {
      if (err || !order) return res.status(404).send('订单不存在');
      const warehouseId = parseInt(req.body.warehouse_id) || 0;
      const carrier = sanitize(req.body.carrier || '邮政');
      const speedMap = { '顺丰空运': '特快', '顺丰陆运': '快速', '中通': '标准', '邮政': '标准' };
      const speed = speedMap[carrier] || '标准';
      const prefix = { '邮政': 'YZ', '中通': 'ZT', '顺丰陆运': 'SF', '顺丰空运': 'SF' }[carrier] || 'KD';
      const tracking = prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
      const weight = parseFloat(req.body.weight) || 1;
      db.get('SELECT city FROM users WHERE id = ?', [order.user_id], (err2, user) => {
        db.get('SELECT city FROM warehouses WHERE id = ?', [warehouseId], (err3, wh) => {
          let dist = 500;
          const from = wh ? wh.city : '';
          const to = user ? user.city : '';
          if (from && to && cityCoord[from] && cityCoord[to]) {
            dist = getDistanceKM(cityCoord[from].lat, cityCoord[from].lon, cityCoord[to].lat, cityCoord[to].lon);
          }
          const speedKmh = { '顺丰空运': 500, '顺丰陆运': 70, '中通': 50, '邮政': 30 }[carrier] || 40;
          const base = Math.ceil(dist / speedKmh);
          const processing = 2 + Math.floor(Math.random() * 5);
          const variance = Math.floor(base * (Math.random() * 0.4 - 0.2));
          const hours = Math.max(6, base + processing + variance);
          const shippingFee = calcShippingFee(carrier, weight, dist);
          db.get('SELECT shipping_policy FROM products WHERE id = ?', [order.product_id], (err4, product) => {
            if (err4) { console.error('查询运费策略失败:', err4.message); }
            const policy = product ? (product.shipping_policy || 1) : 1;
            let buyerPay = shippingFee, merchantPay = 0;
            if (policy === 0) { buyerPay = 0; merchantPay = shippingFee; }
            else if (policy === 2) { buyerPay = Math.round(shippingFee * 0.5 * 100) / 100; merchantPay = shippingFee - buyerPay; }
            const policyLabel = { 0: '包邮', 1: '不包邮', 2: '半包邮' }[policy] || '不包邮';
          const d = new Date(Date.now() + hours * 3600000);
          const p = n => String(n).padStart(2, '0');
          const deliverAt = `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
          db.run('UPDATE orders SET status = ? WHERE id = ?', ['shipped', oid]);
          db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [buyerPay, order.user_id]);
          if (merchantPay > 0) db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [merchantPay, shop.owner_id]);
          db.run(`INSERT INTO shipments (order_id, warehouse_id, carrier, speed, tracking_number, weight, estimate_hours, deliver_at, shipping_fee, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'shipped')`,
            [oid, warehouseId, carrier, speed, tracking, weight, hours, deliverAt, shippingFee], (err) => {
              if (err) return res.status(500).send('发货失败，请重试');
              db.run("INSERT INTO notifications (user_id, title, content, type) VALUES (?, '📦 订单已发货', ?, 'ship')",
                [order.user_id, `订单 ${oid} 已由${carrier}(${speed})发货，单号：${tracking}，距离${dist}km，运费¥${shippingFee}（${policyLabel}，你付¥${buyerPay}），预计${hours}小时送达`]);
              res.redirect('/shop/manage');
            });
          });
        });
      });
    });
  });
});

// ========== 快递单号查询入口 ==========
app.get('/track', isAuth, (req, res) => {
  res.render('track_search', { msg: null });
});

app.post('/track', isAuth, (req, res) => {
  const tracking = sanitize((req.body.tracking_number || '').trim().toUpperCase());
  if (!tracking) return res.render('track_search', { msg: '请输入快递单号' });
  db.get('SELECT order_id FROM shipments WHERE tracking_number = ?', [tracking], (err, row) => {
    if (err || !row) return res.render('track_search', { msg: '未找到该快递单号' });
    res.redirect('/orders/' + row.order_id + '/track');
  });
});

// ========== 快递追踪 ==========
app.get('/orders/:id/track', isAuth, (req, res) => {
  res.redirect('/track/' + req.params.id);
});

// ========== 签收 ==========
app.post('/orders/:id/sign', isAuth, (req, res) => {
  const oid = req.params.id;
  db.get('SELECT * FROM shipments WHERE order_id = ?', [oid], (err, ship) => {
    if (err || !ship) return res.status(404).send('物流不存在');
    db.run("UPDATE shipments SET status = 'signed', signed_at = datetime('now','localtime') WHERE order_id = ?", [oid]);
    db.run("UPDATE orders SET status = 'completed' WHERE id = ?", [oid]);
    res.redirect('/orders/' + oid + '/track');
  });
});

// ========== 退货 ==========
app.post('/orders/:id/return', isAuth, (req, res) => {
  const oid = req.params.id;
  const reason = sanitize(req.body.reason || '');
  db.get('SELECT * FROM shipments WHERE order_id = ?', [oid], (err, ship) => {
    if (err || !ship) return res.status(404).send('物流不存在');
    db.run("UPDATE shipments SET status = 'returning', return_reason = ? WHERE order_id = ?", [reason, oid]);
    db.run("UPDATE orders SET status = 'returning' WHERE id = ?", [oid]);
    db.run("INSERT INTO refunds (order_id, user_id, reason, amount, status) VALUES (?, ?, ?, ?, 'pending')",
      [oid, req.session.user.id, reason, 0]);
    res.redirect('/orders/' + oid + '/track');
  });
});

// ========== 系统自动发货 ==========
app.post('/system/ship/:order_id', isAdmin, (req, res) => {
  const oid = req.params.order_id;
  const hours = 24 + Math.floor(Math.random() * 120);
  const d = new Date(Date.now() + hours * 3600000);
  const p = n => String(n).padStart(2, '0');
  const deliverAt = `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const tracking = 'YZ' + Date.now().toString(36).toUpperCase();
  db.run('UPDATE orders SET status = ? WHERE id = ?', ['shipped', oid]);
  db.run("INSERT INTO shipments (order_id, warehouse_id, carrier, speed, tracking_number, weight, estimate_hours, deliver_at, status) VALUES (?, 0, '邮政', '标准', ?, 1, ?, ?, 'shipped')",
    [oid, tracking, hours, deliverAt], () => res.redirect('/admin/orders'));
});

// ========== AI 图像提示词生成器 ==========
app.get('/prompt-generator', (req, res) => {
  res.render('prompt_generator', { user: req.session.user || null });
});

// 日活统计 API
app.get('/api/dau', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  db.get('SELECT COUNT(*) as count FROM daily_visits WHERE visit_date = ?', [today], (err, row) => {
    if (err) return res.json({ count: 0 });
    res.json({ count: row ? row.count : 0 });
  });
});

// 在线用户列表 API（管理员）
app.get('/api/online-users', isAdmin, (req, res) => {
  const users = [];
  const seen = new Set();
  for (let [sid, u] of allConnections) {
    const key = u.id ? 'u' + u.id : 'g' + sid;
    if (seen.has(key)) continue;
    seen.add(key);
    users.push({ id: u.id, username: u.username || '访客', page: u.page || '未知', ip: u.ip || '未知' });
  }
  res.json(users);
});

// PV 统计 API
app.get('/api/pv', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  db.get('SELECT COALESCE(count, 0) as count FROM daily_pv WHERE visit_date = ?', [today], (err, row) => {
    if (err) return res.json({ count: 0 });
    res.json({ count: row ? row.count : 0 });
  });
});

// 最近 7 天访问趋势 API
app.get('/api/visit-trend', isAdmin, (req, res) => {
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    dates.push(d.toISOString().split('T')[0]);
  }
  db.all('SELECT visit_date, COUNT(*) as uv FROM daily_visits WHERE visit_date >= ? GROUP BY visit_date', [dates[0]], (err, uvRows) => {
    db.all('SELECT visit_date, count as pv FROM daily_pv WHERE visit_date >= ?', [dates[0]], (err2, pvRows) => {
      const uvMap = {};
      (uvRows || []).forEach(r => uvMap[r.visit_date] = r.uv);
      const pvMap = {};
      (pvRows || []).forEach(r => pvMap[r.visit_date] = r.pv);
      const result = dates.map(d => ({ date: d, uv: uvMap[d] || 0, pv: pvMap[d] || 0 }));
      res.json(result);
    });
  });
});

// ========== 公告管理 ==========
app.get('/admin/announcements', isAdmin, (req, res) => {
  db.all('SELECT * FROM announcements ORDER BY id DESC', (err, rows) => {
    res.render('admin_announcements', { announcements: rows || [] });
  });
});
app.post('/admin/announcements/create', isAdmin, (req, res) => {
  const title = sanitize(req.body.title || '').trim();
  const content = sanitize(req.body.content || '').trim();
  if (!title || !content) return res.redirect('/admin/announcements');
  db.run('INSERT INTO announcements (title, content) VALUES (?, ?)', [title, content], () => res.redirect('/admin/announcements'));
});
app.post('/admin/announcements/toggle/:id', isAdmin, (req, res) => {
  db.get('SELECT is_active FROM announcements WHERE id = ?', [req.params.id], (err, row) => {
    if (err || !row) return res.redirect('/admin/announcements');
    db.run('UPDATE announcements SET is_active = ? WHERE id = ?', [row.is_active ? 0 : 1, req.params.id], () => res.redirect('/admin/announcements'));
  });
});
app.post('/admin/announcements/delete/:id', isAdmin, (req, res) => {
  db.run('DELETE FROM announcements WHERE id = ?', [req.params.id], () => res.redirect('/admin/announcements'));
});

// 发布 AI 作品
app.post('/prompt-generator/publish', isAuth, (req, res) => {
  const imageUrl = (req.body.image_url || '').trim();
  if (!imageUrl || !/^https?:\/\//.test(imageUrl)) return res.json({ ok: false, msg: '请先生成图像' });
  const scene = sanitize(req.body.scene || '');
  const adjective = sanitize(req.body.adjective || '');
  const characters = sanitize(req.body.characters || '');
  const style = sanitize(req.body.style || '');
  const genre = sanitize(req.body.genre || '');
  const artist = sanitize(req.body.artist || '');
  const summary = sanitize(req.body.summary || '');
  db.run(
    'INSERT INTO ai_artworks (user_id, username, image_url, prompt_scene, prompt_adjective, prompt_characters, prompt_style, prompt_genre, prompt_artist, summary, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [req.session.user.id, req.session.user.username, imageUrl, scene, adjective, characters, style, genre, artist, summary, 'approved'],
    function (err) {
      if (err) return res.json({ ok: false, msg: '发布失败' });
      res.json({ ok: true, msg: '发布成功！可在画廊中查看' });
    }
  );
});

// 下载/保存 AI 图像到本地
app.post('/prompt-generator/download', isAuth, (req, res) => {
  const imageUrl = (req.body.image_url || '').trim();
  if (!imageUrl || !/^https?:\/\//.test(imageUrl)) return res.json({ ok: false, msg: '无图像URL' });
  if (!isSafeUrl(imageUrl)) return res.json({ ok: false, msg: '不安全的URL' });
  const https = require('https');
  const http = require('http');
  const protocol = imageUrl.startsWith('https') ? https : http;
  protocol.get(imageUrl, (imgRes) => {
    if (imgRes.statusCode !== 200) return res.json({ ok: false, msg: '下载失败' });
    const filename = 'ai_' + Date.now() + '.jpg';
    const filepath = path.join(__dirname, 'public', 'uploads', filename);
    const file = fs.createWriteStream(filepath);
    imgRes.pipe(file);
    file.on('finish', () => {
      file.close();
      const localUrl = '/uploads/' + filename;
      db.run('INSERT INTO ai_artworks (user_id, username, image_url, local_path, status) VALUES (?, ?, ?, ?, ?)',
        [req.session.user.id, req.session.user.username, imageUrl, localUrl, 'approved'],
        function () {
          res.json({ ok: true, msg: '保存成功', local_url: localUrl });
        });
    });
    file.on('error', () => res.json({ ok: false, msg: '保存失败' }));
  }).on('error', () => res.json({ ok: false, msg: '网络请求失败' }));
});

// AI 作品画廊
app.get('/prompt-generator/gallery', (req, res) => {
  db.all('SELECT * FROM ai_artworks WHERE status = ? ORDER BY created_at DESC LIMIT 50', ['approved'], (err, artworks) => {
    res.render('ai_gallery', { artworks: artworks || [], user: req.session.user || null });
  });
});

// ========== 管理员 AI 作品审核 ==========
app.get('/admin/ai-artworks', isAdmin, (req, res) => {
  db.all('SELECT * FROM ai_artworks ORDER BY created_at DESC LIMIT 100', (err, artworks) => {
    res.render('admin_ai_artworks', { artworks: artworks || [] });
  });
});

app.post('/admin/ai-artworks/:id/approve', isAdmin, (req, res) => {
  db.run('UPDATE ai_artworks SET status = ? WHERE id = ?', ['approved', req.params.id], () => {
    res.redirect('/admin/ai-artworks');
  });
});

app.post('/admin/ai-artworks/:id/reject', isAdmin, (req, res) => {
  db.run('UPDATE ai_artworks SET status = ? WHERE id = ?', ['rejected', req.params.id], () => {
    res.redirect('/admin/ai-artworks');
  });
});

app.post('/admin/ai-artworks/:id/delete', isAdmin, (req, res) => {
  db.get('SELECT local_path FROM ai_artworks WHERE id = ?', [req.params.id], (err, row) => {
    if (row && row.local_path) {
      const fp = path.join(__dirname, 'public', row.local_path);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    db.run('DELETE FROM ai_artworks WHERE id = ?', [req.params.id], () => {
      res.redirect('/admin/ai-artworks');
    });
  });
});

// ===================== 管理员：游戏管理 =====================
// 赛季管理
// ========== 游戏赛季管理 ==========
app.get('/admin/games/seasons', isAdmin, (req, res) => {
  // Get from season config table, joined with glicko2 stats
  db.all(`SELECT gs.*,
    COALESCE(gr.player_count, 0) as player_count,
    COALESCE(gr.avg_rating, 0) as avg_rating
    FROM game_seasons gs
    LEFT JOIN (
      SELECT game_type, season, COUNT(*) as player_count, AVG(rating) as avg_rating
      FROM game_glicko2_ratings GROUP BY game_type, season
    ) gr ON gs.game_type = gr.game_type AND gs.season_number = gr.season
    ORDER BY gs.game_type, gs.season_number DESC`, [], (err, seasons) => {
    // Also get available game types and max season numbers from ratings
    db.all(`SELECT game_type, MAX(season) as max_season, COUNT(DISTINCT season) as season_count FROM game_glicko2_ratings GROUP BY game_type`, [], (err, ratingStats) => {
      res.render('admin_games_seasons', {
        user: req.session.user,
        csrfToken: req.csrfToken(),
        seasons: seasons || [],
        ratingStats: ratingStats || []
      });
    });
  });
});

app.post('/admin/games/seasons/create', isAdmin, (req, res) => {
  const { game_type, season_number, name, description, start_date, end_date, reward_first, reward_second, reward_third, min_rating, max_rating, status } = req.body;
  if (!game_type || !season_number) {
    return res.status(400).json({ error: '游戏类型和赛季号不能为空' });
  }
  db.run(`INSERT OR REPLACE INTO game_seasons (game_type, season_number, name, description, start_date, end_date, reward_first, reward_second, reward_third, min_rating, max_rating, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [game_type, season_number, name || '', description || '', start_date || '', end_date || '',
     reward_first || '', reward_second || '', reward_third || '',
     min_rating || 0, max_rating || 9999, status || 'inactive'],
    function(err) {
      if (err) return res.status(500).json({ error: '创建失败: ' + err.message });
      res.json({ ok: true, id: this.lastID });
    });
});

app.post('/admin/games/seasons/update', isAdmin, (req, res) => {
  const { id, name, description, start_date, end_date, reward_first, reward_second, reward_third, min_rating, max_rating, status } = req.body;
  if (!id) return res.status(400).json({ error: '赛季ID不能为空' });
  db.run(`UPDATE game_seasons SET name=?, description=?, start_date=?, end_date=?,
    reward_first=?, reward_second=?, reward_third=?, min_rating=?, max_rating=?, status=?, updated_at=datetime('now')
    WHERE id=?`,
    [name || '', description || '', start_date || '', end_date || '',
     reward_first || '', reward_second || '', reward_third || '',
     min_rating || 0, max_rating || 9999, status || 'inactive', id],
    function(err) {
      if (err) return res.status(500).json({ error: '更新失败: ' + err.message });
      res.json({ ok: true, changes: this.changes });
    });
});

app.post('/admin/games/seasons/delete', isAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: '赛季ID不能为空' });
  db.run(`DELETE FROM game_seasons WHERE id=?`, [id], function(err) {
    if (err) return res.status(500).json({ error: '删除失败: ' + err.message });
    res.json({ ok: true, changes: this.changes });
  });
});

app.post('/admin/games/seasons/reset', isAdmin, (req, res) => {
  const { game_type } = req.body;
  // Get current max season
  db.get(`SELECT COALESCE(MAX(season_number), 0) as max_season FROM game_seasons WHERE game_type = ?`, [game_type], (err, row) => {
    const newSeason = (row?.max_season || 0) + 1;
    // Copy current ratings to new season with reset values
    db.run(`INSERT INTO game_glicko2_ratings (user_id, game_type, rating, rd, volatility, games_played, wins, losses, draws, streak, season) SELECT user_id, game_type, 1500, 350, 0.06, 0, 0, 0, 0, 0, ? FROM game_glicko2_ratings WHERE game_type = ? AND season = (SELECT COALESCE(MAX(season), 0) FROM game_glicko2_ratings WHERE game_type = ?)`,
      [newSeason, game_type, game_type], () => {
        // Also create a season config entry
        const names = { chess: '国际象棋', gomoku: '五子棋', go: '围棋' };
        const seasonName = names[game_type] ? names[game_type] + ' S' + newSeason : 'S' + newSeason + ' ' + game_type;
        db.run(`INSERT OR IGNORE INTO game_seasons (game_type, season_number, name, status) VALUES (?, ?, ?, 'active')`,
          [game_type, newSeason, seasonName], () => {
            res.json({ ok: true, newSeason });
          });
      });
  });
});

// ========== 赛季奖励发放 ==========
app.post('/admin/games/seasons/rankings', isAdmin, (req, res) => {
  const { game_type, season_number } = req.body;
  if (!game_type || !season_number) return res.status(400).json({ error: '参数不完整' });
  db.all(`SELECT r.user_id, r.rating, r.wins, r.losses, r.games_played, u.username, u.title, u.balance
    FROM game_glicko2_ratings r
    JOIN users u ON r.user_id = u.id
    WHERE r.game_type = ? AND r.season = ?
    ORDER BY r.rating DESC
    LIMIT 10`, [game_type, season_number], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, rankings: rows || [] });
  });
});

app.post('/admin/games/seasons/issue_rewards', isAdmin, (req, res) => {
  const { game_type, season_number, rewards } = req.body;
  // rewards: [{ rank: 1, user_id: 123, coins: 5000, title: 'S1冠军' }, ...]
  if (!game_type || !season_number || !rewards || !Array.isArray(rewards)) {
    return res.status(400).json({ error: '参数不完整' });
  }

  let successCount = 0;
  let errors = [];
  let completed = 0;
  const total = rewards.length;

  rewards.forEach(function(r) {
    if (!r.user_id) { completed++; return; }

    // Update user balance and title
    var updates = [];
    var params = [];

    if (r.coins > 0) {
      updates.push('balance = COALESCE(balance, 0) + ?');
      params.push(r.coins);
    }
    if (r.title) {
      updates.push('title = ?');
      params.push(r.title);
    }

    if (updates.length === 0) { completed++; return; }

    params.push(r.user_id);
    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params, function(err) {
      completed++;
      if (err) {
        errors.push('用户' + r.user_id + ': ' + err.message);
      } else {
        successCount++;
      }
      if (completed >= total) {
        // Also mark the season as rewarded
        db.run(`UPDATE game_seasons SET status = 'ended', updated_at = datetime('now') WHERE game_type = ? AND season_number = ?`,
          [game_type, season_number], () => {
            res.json({ ok: true, successCount, errors: errors.length > 0 ? errors : undefined });
          });
      }
    });
  });
});

// 公告管理
app.get('/admin/games/announcements', isAdmin, (req, res) => {
  res.render('admin_games_announcements', { user: req.session.user, csrfToken: req.csrfToken() });
});

app.post('/admin/games/announcements', isAdmin, (req, res) => {
  const { title, content, game_type } = req.body;
  if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });
  db.run(`INSERT INTO announcements (title, content, game_type, created_by) VALUES (?, ?, ?, ?)`,
    [title, content, game_type || 'all', req.session.user.id], function() {
      res.json({ ok: true, id: this.lastID });
    });
});

// 获取公告列表
app.get('/api/games/announcements', isAuth, (req, res) => {
  const gameType = req.query.game_type || 'all';
  db.all(`SELECT * FROM announcements WHERE game_type = ? OR game_type = 'all' ORDER BY created_at DESC LIMIT 20`,
    [gameType], (err, rows) => {
      res.json(rows || []);
    });
});

// 删除公告
app.post('/admin/games/announcements/delete', isAdmin, (req, res) => {
  const { id } = req.body;
  db.run(`DELETE FROM announcements WHERE id = ?`, [id], () => {
    res.json({ ok: true });
  });
});

// 房间管理
app.get('/admin/games/rooms', isAdmin, (req, res) => {
  // Read from memory (gameRooms is in the Socket.IO scope, so we store it in app.locals)
  const rooms = req.app.locals.gameRooms || {};
  const roomList = Object.values(rooms).map(r => ({
    id: r.id,
    gameType: r.gameType,
    playerCount: r.players?.length || 0,
    players: r.players?.map(p => p.username || 'Unknown').join(', ') || '',
    state: r.state || 'unknown',
    createdAt: r.startedAt ? new Date(r.startedAt).toLocaleString() : 'N/A'
  }));
  res.render('admin_games_rooms', { user: req.session.user, csrfToken: req.csrfToken(), rooms: roomList });
});

app.post('/admin/games/rooms/close', isAdmin, (req, res) => {
  const { roomId } = req.body;
  const rooms = req.app.locals.gameRooms || {};
  if (rooms[roomId]) {
    delete rooms[roomId];
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: '房间不存在' });
  }
});

// 图片代理：隐藏原始 Pollinations URL
app.get('/ai-image/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id || id < 1) return res.status(400).end();
  db.get('SELECT image_url, local_path FROM ai_artworks WHERE id = ?', [id], (err, row) => {
    if (err || !row) return res.status(404).end();
    if (row.local_path) {
      const fp = path.join(__dirname, 'public', row.local_path);
      if (fs.existsSync(fp)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return fs.createReadStream(fp).pipe(res);
      }
    }
    const url = row.image_url;
    if (!url || !isSafeUrl(url)) return res.status(404).end();
    const protocol = url.startsWith('https') ? require('https') : require('http');
    protocol.get(url, (imgRes) => {
      if (imgRes.statusCode !== 200) return res.status(502).end();
      res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      imgRes.pipe(res);
    }).on('error', () => res.status(502).end());
  });
});

// ============================================================
// 新功能路由：浏览记录、推荐算法、优惠券、邀请系统、促销活动、签到系统
// ============================================================

// ---------- 新表创建 ----------
db.run(`CREATE TABLE IF NOT EXISTS browse_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  browsed_at TEXT DEFAULT (datetime('now','localtime'))
)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_browse_history_user ON browse_history (user_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_browse_history_product ON browse_history (product_id)`);

db.run(`CREATE TABLE IF NOT EXISTS invite_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  code TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS referral_earnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER NOT NULL,
  referred_user_id INTEGER NOT NULL,
  amount REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  discount_type TEXT NOT NULL DEFAULT 'percentage',
  discount_value REAL NOT NULL,
  min_purchase REAL DEFAULT 0,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS promotion_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promotion_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  UNIQUE(promotion_id, product_id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS checkin_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  checkin_date TEXT NOT NULL,
  consecutive_days INTEGER DEFAULT 1,
  points_earned INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(user_id, checkin_date)
)`);

// 确保 WELCOME10 新人优惠券存在
db.get("SELECT id FROM coupons WHERE code = 'WELCOME10'", (err, row) => {
  if (!row) {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 10);
    db.run("INSERT INTO coupons (code, discount, owner_id, max_uses, expires_at, is_active) VALUES ('WELCOME10', 10, 0, 999999, ?, 1)", [future.toISOString()]);
  }
});

// ===================== 1. 浏览记录 API =====================
app.post('/api/browse/record', isAuth, (req, res) => {
  const productId = parseInt(req.body.product_id);
  if (!productId) return res.json({ ok: false, msg: '参数错误' });
  db.get('SELECT id FROM products WHERE id = ?', [productId], (err, product) => {
    if (!product) return res.json({ ok: false, msg: '商品不存在' });
    db.run('INSERT INTO browse_history (user_id, product_id) VALUES (?, ?)', [req.session.user.id, productId], (err2) => {
      if (err2) return res.json({ ok: false, msg: '记录失败' });
      res.json({ ok: true, msg: '已记录浏览' });
    });
  });
});

// 获取促销活动关联的商品ID（用于编辑弹窗）
app.get('/api/promotion/:id/products', isAdmin, (req, res) => {
  db.all('SELECT product_id FROM promotion_products WHERE promotion_id = ?', [req.params.id], (err, rows) => {
    if (err) return res.json([]);
    res.json(rows.map(r => r.product_id));
  });
});

// ===================== 2. 推荐算法 API =====================
// 升级版推荐算法：协同过滤 + 偏好分类 + 热门加权混合，附带推荐理由
app.get('/api/recommendations', isAuth, (req, res) => {
  const userId = req.session.user.id;
  const limit = Math.min(24, Math.max(6, parseInt(req.query.limit) || 12));
  const tab = req.query.tab || 'recommend'; // recommend | hot | new

  // 热榜
  if (tab === 'hot') {
    db.all(`SELECT p.*,
      COALESCE(r.avg_rating, 0) as avg_rating,
      COALESCE(r.review_count, 0) as review_count
      FROM products p
      LEFT JOIN (SELECT product_id, ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as review_count FROM reviews GROUP BY product_id) r ON r.product_id = p.id
      WHERE 1=1
      ORDER BY p.sales_count DESC, avg_rating DESC LIMIT ?`, [limit], (err, hot) => {
      res.json({ recommendations: hot || [], reason: '🔥 热销排行榜' });
    });
    return;
  }

  // 新品
  if (tab === 'new') {
    db.all(`SELECT p.*,
      COALESCE(r.avg_rating, 0) as avg_rating,
      COALESCE(r.review_count, 0) as review_count
      FROM products p
      LEFT JOIN (SELECT product_id, ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as review_count FROM reviews GROUP BY product_id) r ON r.product_id = p.id
      WHERE 1=1
      ORDER BY p.id DESC LIMIT ?`, [limit], (err, newest) => {
      res.json({ recommendations: newest || [], reason: '✨ 新品首发' });
    });
    return;
  }

  // ===== 个性化推荐（协同过滤 + 偏好 + 热门） =====
  // 1. 协同过滤：买过同类商品的用户还买了什么
  // 2. 偏好分类：用户购买/浏览最多的分类
  // 3. 热门补充
  const boughtProductIds = [];
  db.all('SELECT DISTINCT product_id FROM orders WHERE user_id = ?', [userId], (err, orders) => {
    (orders || []).forEach(o => boughtProductIds.push(o.product_id));

    // 查用户购买过的分类
    db.all(`SELECT DISTINCT p.category FROM products p
      JOIN orders o ON o.product_id = p.id
      WHERE o.user_id = ? AND p.category IS NOT NULL AND p.category != ''`, [userId], (err, purchasedCats) => {
      // 查浏览最多的分类
      db.all(`SELECT p.category, COUNT(*) as cnt FROM browse_history b
        JOIN products p ON b.product_id = p.id
        WHERE b.user_id = ? AND p.category IS NOT NULL AND p.category != ''
        GROUP BY p.category ORDER BY cnt DESC`, [userId], (err2, browsedCats) => {

      const catSet = new Set();
      (purchasedCats || []).forEach(c => { if (c.category) catSet.add(c.category); });
      (browsedCats || []).forEach(c => { if (c.category) catSet.add(c.category); });
      const prefCats = [...catSet];
      const hasBehavior = boughtProductIds.length > 0 || prefCats.length > 0;

      if (!hasBehavior) {
        // 新用户：热门推荐
        db.all(`SELECT p.*,
          COALESCE(r.avg_rating, 0) as avg_rating,
          COALESCE(r.review_count, 0) as review_count
          FROM products p
          LEFT JOIN (SELECT product_id, ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as review_count FROM reviews GROUP BY product_id) r ON r.product_id = p.id
          WHERE 1=1
          ORDER BY p.sales_count DESC LIMIT ?`, [limit], (err3, hot) => {
          res.json({ recommendations: hot || [], reason: '🔥 热门推荐 · 新用户专享' });
        });
        return;
      }

      // 有行为数据：协同过滤 + 偏好 + 热门
      const scoredProducts = {}; // { id: { score, product, reason } }

      // 获取用户已购买/浏览过的商品ID（排除）
      const excludeIds = new Set(boughtProductIds);
      db.all('SELECT DISTINCT product_id FROM browse_history WHERE user_id = ?', [userId], (err, browsed) => {
        (browsed || []).forEach(b => excludeIds.add(b.product_id));

        // ---- A. 协同过滤（40%权重） ----
        if (boughtProductIds.length > 0) {
          // 买了A的人也买了B
          const boughtPlaceholders = boughtProductIds.map(() => '?').join(',');
          db.all(`SELECT o2.product_id, COUNT(DISTINCT o2.user_id) as co_buy_count
            FROM orders o1
            JOIN orders o2 ON o1.user_id = o2.user_id AND o2.product_id != o1.product_id
            WHERE o1.product_id IN (${boughtPlaceholders})
            GROUP BY o2.product_id
            ORDER BY co_buy_count DESC LIMIT 30`, boughtProductIds, (err4, coBuy) => {
            (coBuy || []).forEach(item => {
              if (!excludeIds.has(item.product_id)) {
                const score = Math.min(item.co_buy_count / 5, 1) * 0.40;
                if (!scoredProducts[item.product_id]) {
                  scoredProducts[item.product_id] = { score: 0, reason: '🛒 买了此商品的用户也买了' };
                }
                scoredProducts[item.product_id].score += score;
              }
            });

            // ---- B. 偏好分类推荐（30%权重） ----
            if (prefCats.length > 0) {
              const catPlaceholders = prefCats.map(() => '?').join(',');
              db.all(`SELECT p.id, p.sales_count
                FROM products p
                WHERE 1=1 AND p.category IN (${catPlaceholders})
                ORDER BY p.sales_count DESC LIMIT 30`, prefCats, (err5, prefItems) => {
                (prefItems || []).forEach(item => {
                  if (!excludeIds.has(item.id)) {
                    const score = Math.min(item.sales_count / 100, 1) * 0.30;
                    if (!scoredProducts[item.id]) {
                      scoredProducts[item.id] = { score: 0, reason: '🎯 根据您的偏好推荐' };
                    }
                    scoredProducts[item.id].score += score;
                  }
                });

                // ---- C. 热门补充（30%权重） ----
                db.all(`SELECT p.id, p.sales_count, p.avg_rating
                  FROM (SELECT p.*, COALESCE(r.avg_rating, 0) as avg_rating FROM products p
                    LEFT JOIN (SELECT product_id, ROUND(AVG(rating), 1) as avg_rating FROM reviews GROUP BY product_id) r ON r.product_id = p.id
                    WHERE 1=1) p
                  ORDER BY p.sales_count DESC LIMIT 30`, (err6, hotItems) => {
                  (hotItems || []).forEach(item => {
                    if (!excludeIds.has(item.id)) {
                      const score = Math.min(item.sales_count / 100, 1) * 0.30;
                      if (!scoredProducts[item.id]) {
                        scoredProducts[item.id] = { score: 0, reason: '🔥 热门推荐' };
                      }
                      scoredProducts[item.id].score += score;
                    }
                  });

                  // ---- D. 促销活动商品加分（额外+20%权重） ----
                  db.all(`SELECT DISTINCT pp.product_id FROM promotion_products pp
                    JOIN promotions pr ON pp.promotion_id = pr.id
                    WHERE pr.is_active = 1 AND datetime(pr.end_time) > datetime('now','localtime')`, (errPromo, promoProducts) => {
                    (promoProducts || []).forEach(pp => {
                      if (scoredProducts[pp.product_id]) {
                        scoredProducts[pp.product_id].score += 0.20;
                        scoredProducts[pp.product_id].reason = '🔥 促销活动推荐';
                      }
                    });

                  // ---- 排序取前N个 ----
                  const sortedIds = Object.keys(scoredProducts)
                    .sort((a, b) => scoredProducts[b].score - scoredProducts[a].score)
                    .slice(0, limit);

                  if (sortedIds.length === 0) {
                    // 后备：热门
                    db.all(`SELECT p.*,
                      COALESCE(r.avg_rating, 0) as avg_rating,
                      COALESCE(r.review_count, 0) as review_count
                      FROM products p
                      LEFT JOIN (SELECT product_id, ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as review_count FROM reviews GROUP BY product_id) r ON r.product_id = p.id
                      WHERE 1=1
                      ORDER BY p.sales_count DESC LIMIT ?`, [limit], (err7, fallback) => {
                      res.json({ recommendations: fallback || [], reason: '🔥 热门推荐' });
                    });
                    return;
                  }

                  const idPlaceholders = sortedIds.map(() => '?').join(',');
                  db.all(`SELECT p.*,
                    COALESCE(r.avg_rating, 0) as avg_rating,
                    COALESCE(r.review_count, 0) as review_count
                    FROM products p
                    LEFT JOIN (SELECT product_id, ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as review_count FROM reviews GROUP BY product_id) r ON r.product_id = p.id
                    WHERE p.id IN (${idPlaceholders})`, sortedIds, (err8, products) => {
                    // 按排序顺序排列
                    const productMap = {};
                    (products || []).forEach(p => { productMap[p.id] = p; });
                    const result = [];
                    sortedIds.forEach(id => {
                      if (productMap[id]) {
                        const p = productMap[id];
                        p.recommend_reason = scoredProducts[id].reason;
                        p.recommend_score = Math.round(scoredProducts[id].score * 100);
                        result.push(p);
                      }
                    });

                    // 生成推荐理由标题
                    let reason = '🎯 为您推荐';
                    if (boughtProductIds.length > 0) reason = '🛒 基于您的购买记录推荐';
                    else if (prefCats.length > 0) reason = '🎯 根据您的浏览偏好推荐';

                    res.json({ recommendations: result, reason });
                  });
                });
              });
              });
            } else {
              // 无偏好分类，只用协同过滤+热门
              // 简化处理，走热门
              db.all(`SELECT p.*,
                COALESCE(r.avg_rating, 0) as avg_rating,
                COALESCE(r.review_count, 0) as review_count
                FROM products p
                LEFT JOIN (SELECT product_id, ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as review_count FROM reviews GROUP BY product_id) r ON r.product_id = p.id
                WHERE 1=1
                ORDER BY p.sales_count DESC LIMIT ?`, [limit], (err7, fallback) => {
                res.json({ recommendations: fallback || [], reason: '🔥 热门推荐' });
              });
            }
          });
        } else {
          // 无购买记录，只用偏好+热门
          if (prefCats.length > 0) {
            const catPlaceholders = prefCats.map(() => '?').join(',');
            db.all(`SELECT p.id, p.sales_count
              FROM products p
              WHERE 1=1 AND p.category IN (${catPlaceholders})
              ORDER BY p.sales_count DESC LIMIT 30`, prefCats, (err5, prefItems) => {
              (prefItems || []).forEach(item => {
                if (!excludeIds.has(item.id)) {
                  const score = Math.min(item.sales_count / 100, 1) * 0.50;
                  if (!scoredProducts[item.id]) {
                    scoredProducts[item.id] = { score: 0, reason: '🎯 根据您的浏览推荐' };
                  }
                  scoredProducts[item.id].score += score;
                }
              });

              db.all(`SELECT p.id, p.sales_count
                FROM products p WHERE 1=1
                ORDER BY p.sales_count DESC LIMIT 30`, (err6, hotItems) => {
                (hotItems || []).forEach(item => {
                  if (!excludeIds.has(item.id)) {
                    const score = Math.min(item.sales_count / 100, 1) * 0.50;
                    if (!scoredProducts[item.id]) {
                      scoredProducts[item.id] = { score: 0, reason: '🔥 热门推荐' };
                    }
                    scoredProducts[item.id].score += score;
                  }
                });

                const sortedIds = Object.keys(scoredProducts)
                  .sort((a, b) => scoredProducts[b].score - scoredProducts[a].score)
                  .slice(0, limit);

                if (sortedIds.length === 0) {
                  db.all(`SELECT p.*,
                    COALESCE(r.avg_rating, 0) as avg_rating,
                    COALESCE(r.review_count, 0) as review_count
                    FROM products p
                    LEFT JOIN (SELECT product_id, ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as review_count FROM reviews GROUP BY product_id) r ON r.product_id = p.id
                    WHERE 1=1
                    ORDER BY p.sales_count DESC LIMIT ?`, [limit], (err7, fallback) => {
                    res.json({ recommendations: fallback || [], reason: '🔥 热门推荐' });
                  });
                  return;
                }

                const idPlaceholders = sortedIds.map(() => '?').join(',');
                db.all(`SELECT p.*,
                  COALESCE(r.avg_rating, 0) as avg_rating,
                  COALESCE(r.review_count, 0) as review_count
                  FROM products p
                  LEFT JOIN (SELECT product_id, ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as review_count FROM reviews GROUP BY product_id) r ON r.product_id = p.id
                  WHERE p.id IN (${idPlaceholders})`, sortedIds, (err8, products) => {
                  const productMap = {};
                  (products || []).forEach(p => { productMap[p.id] = p; });
                  const result = [];
                  sortedIds.forEach(id => {
                    if (productMap[id]) {
                      const p = productMap[id];
                      p.recommend_reason = scoredProducts[id].reason;
                      p.recommend_score = Math.round(scoredProducts[id].score * 100);
                      result.push(p);
                    }
                  });
                  res.json({ recommendations: result, reason: '🎯 根据您的浏览偏好推荐' });
                });
              });
            });
          } else {
            db.all(`SELECT p.*,
              COALESCE(r.avg_rating, 0) as avg_rating,
              COALESCE(r.review_count, 0) as review_count
              FROM products p
              LEFT JOIN (SELECT product_id, ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as review_count FROM reviews GROUP BY product_id) r ON r.product_id = p.id
              WHERE 1=1
              ORDER BY p.sales_count DESC LIMIT ?`, [limit], (err7, fallback) => {
              res.json({ recommendations: fallback || [], reason: '🔥 热门推荐' });
            });
          }
        }
      });
    });
  });
  });
});

// ===================== 3. 优惠券系统 API =====================
app.get('/api/coupons', isAuth, (req, res) => {
  db.all(`SELECT id, code, discount as value, max_uses as usage_limit, used_count, expires_at as end_time, is_active, '满减' as type, code as name, '' as description, 0 as min_amount, NULL as max_discount, created_at FROM coupons WHERE is_active = 1
    AND (max_uses <= 0 OR used_count < max_uses)
    AND datetime(expires_at) > datetime('now','localtime')
    ORDER BY id DESC`, (err, coupons) => {
    if (err) return res.json([]);
    res.json(coupons || []);
  });
});

app.get('/api/user/coupons', isAuth, (req, res) => {
  db.all(`SELECT c.id, c.code, c.discount as value, c.max_uses as usage_limit, c.used_count, c.expires_at as end_time, c.is_active, '满减' as type, c.code as name, '' as description, 0 as min_amount, NULL as max_discount, uc.claimed_at, uc.used as status FROM user_coupons uc JOIN coupons c ON uc.coupon_id = c.id WHERE uc.user_id = ? AND uc.used = 0 AND datetime(c.expires_at) > datetime('now','localtime') ORDER BY uc.claimed_at DESC`, [req.session.user.id], (err, coupons) => {
    if (err) return res.json([]);
    res.json(coupons || []);
  });
});

app.post('/api/coupons/claim', isAuth, (req, res) => {
  const couponId = parseInt(req.body.coupon_id);
  if (!couponId) return res.json({ ok: false, msg: '参数错误' });
  db.get('SELECT * FROM coupons WHERE id = ?', [couponId], (err, coupon) => {
    if (!coupon) return res.json({ ok: false, msg: '优惠券不存在' });
    if (!coupon.is_active) return res.json({ ok: false, msg: '优惠券已失效' });
    if (new Date(coupon.expires_at) <= new Date()) return res.json({ ok: false, msg: '优惠券已过期' });
    if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) return res.json({ ok: false, msg: '优惠券已领完' });
    // 检查是否已领过
    db.get('SELECT id FROM user_coupons WHERE user_id = ? AND coupon_id = ?', [req.session.user.id, couponId], (err2, existing) => {
      if (existing) return res.json({ ok: false, msg: '您已领取过该优惠券' });
      db.run('INSERT INTO user_coupons (user_id, coupon_id) VALUES (?, ?)', [req.session.user.id, couponId], (err3) => {
        if (err3) return res.json({ ok: false, msg: '领取失败' });
        db.run('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', [couponId]);
        res.json({ ok: true, msg: '领取成功' });
      });
    });
  });
});

app.get('/coupons', isAuth, (req, res) => {
  db.all(`SELECT * FROM coupons WHERE is_active = 1
    AND (max_uses <= 0 OR used_count < max_uses)
    AND datetime(expires_at) > datetime('now','localtime')
    ORDER BY id DESC`, (err, coupons) => {
    db.all(`SELECT c.*, uc.claimed_at, uc.used
      FROM user_coupons uc JOIN coupons c ON uc.coupon_id = c.id
      WHERE uc.user_id = ?
      ORDER BY uc.claimed_at DESC`, [req.session.user.id], (err2, myCoupons) => {
      res.render('coupons', {
        coupons: coupons || [],
        myCoupons: myCoupons || [],
        balance: req.session.user.balance,
        warningActive: req.session.user.warningActive,
        warningUntil: req.session.user.warningUntil
      });
    });
  });
});

// ===================== 4. 拉新邀请系统 API =====================
app.get('/api/referral/code', isAuth, (req, res) => {
  db.get('SELECT code FROM invite_codes WHERE user_id = ?', [req.session.user.id], (err, row) => {
    if (row) return res.json({ ok: true, code: row.code });
    // 没有则生成
    const code = uuidv4().slice(0, 8).toUpperCase();
    db.run('INSERT INTO invite_codes (user_id, code) VALUES (?, ?)', [req.session.user.id, code], (err2) => {
      if (err2) return res.json({ ok: false, msg: '生成失败' });
      res.json({ ok: true, code });
    });
  });
});

app.get('/api/referral/stats', isAuth, (req, res) => {
  db.get('SELECT COUNT(*) as count, COALESCE(SUM(reward_amount), 0) as total FROM referrals WHERE inviter_id = ?', [req.session.user.id], (err, row) => {
    if (err) return res.json({ invited_count: 0, total_reward: 0, points: 0 });
    res.json({ invited_count: row ? row.count : 0, total_reward: row ? row.total : 0, points: 0 });
  });
});

app.get('/api/referral/records', isAuth, (req, res) => {
  db.all(`SELECT r.id, u.username, r.reward_amount as reward, r.created_at FROM referrals r JOIN users u ON r.invitee_id = u.id WHERE r.inviter_id = ? ORDER BY r.created_at DESC LIMIT 20`, [req.session.user.id], (err, rows) => {
    if (err) return res.json([]);
    res.json(rows || []);
  });
});

app.get('/referral', isAuth, (req, res) => {
  db.get('SELECT code FROM invite_codes WHERE user_id = ?', [req.session.user.id], (err, codeRow) => {
    const inviteCode = codeRow ? codeRow.code : '';
    db.get('SELECT COUNT(*) as count, COALESCE(SUM(reward_amount), 0) as total FROM referrals WHERE inviter_id = ?', [req.session.user.id], (err2, stats) => {
      res.render('referral', {
        inviteCode,
        inviteCount: stats ? stats.count : 0,
        totalEarnings: stats ? stats.total : 0,
        balance: req.session.user.balance,
        warningActive: req.session.user.warningActive,
        warningUntil: req.session.user.warningUntil
      });
    });
  });
});

// ===================== 5. 促销活动系统 API =====================
// 算法动态推荐：根据促销活动类型自动匹配商品，不使用静态关联表
function getPromoProducts(promo, limit, callback) {
  const resultLimit = limit || 8;
  // 根据促销类型选择不同算法
  let query, params;
  if (promo.type === 'promo') {
    // 促销：按销量排序，各分类均匀分布
    query = `SELECT p.*, COALESCE(r.avg_rating, 0) as avg_rating,
      COALESCE(r.review_count, 0) as review_count
      FROM products p
      LEFT JOIN (SELECT product_id, ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as review_count FROM reviews GROUP BY product_id) r ON r.product_id = p.id
      WHERE 1=1
      ORDER BY p.sales_count DESC, RANDOM()
      LIMIT ?`;
    params = [resultLimit * 3];
  } else if (promo.type === 'free') {
    // 限免：按评分排序，选择高评价商品
    query = `SELECT p.*, COALESCE(r.avg_rating, 0) as avg_rating,
      COALESCE(r.review_count, 0) as review_count
      FROM products p
      LEFT JOIN (SELECT product_id, ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as review_count FROM reviews GROUP BY product_id) r ON r.product_id = p.id
      WHERE 1=1 AND r.avg_rating > 0
      ORDER BY r.avg_rating DESC, RANDOM()
      LIMIT ?`;
    params = [resultLimit * 3];
  } else {
    // 活动：按新品排序，结合热门
    query = `SELECT p.*, COALESCE(r.avg_rating, 0) as avg_rating,
      COALESCE(r.review_count, 0) as review_count
      FROM products p
      LEFT JOIN (SELECT product_id, ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as review_count FROM reviews GROUP BY product_id) r ON r.product_id = p.id
      WHERE 1=1
      ORDER BY p.id DESC, RANDOM()
      LIMIT ?`;
    params = [resultLimit * 3];
  }

  db.all(query, params, (err, products) => {
    if (err || !products || products.length === 0) return callback([]);

    // 去重 + 分类多样性：从各分类中均匀取
    const byCategory = {};
    products.forEach(p => {
      if (!byCategory[p.category]) byCategory[p.category] = [];
      byCategory[p.category].push(p);
    });

    const categories = Object.keys(byCategory).sort(() => Math.random() - 0.5);
    const selected = [];
    const usedIds = new Set();
    let round = 0;
    while (selected.length < resultLimit && round < resultLimit * 2) {
      round++;
      categories.forEach(cat => {
        if (selected.length >= resultLimit) return;
        const pool = byCategory[cat].filter(p => !usedIds.has(p.id));
        if (pool.length > 0) {
          const pick = pool[0];
          usedIds.add(pick.id);
          selected.push(pick);
        }
      });
    }

    // 计算折扣价
    selected.forEach(p => {
      if (promo.discount > 0 && promo.discount_type === 'percent') {
        p.promo_price = Math.round(p.price * (100 - promo.discount) / 100 * 100) / 100;
        p.promo_discount_text = promo.discount + '% OFF';
      } else if (promo.discount > 0) {
        p.promo_price = Math.max(0, p.price - promo.discount);
        p.promo_discount_text = '¥' + promo.discount + ' 优惠';
      } else {
        p.promo_price = p.price;
        p.promo_discount_text = '';
      }
    });

    callback(selected.slice(0, resultLimit));
  });
}

// 促销折扣辅助函数：获取商品在促销活动中的折扣价
function getPromoDiscountForProduct(productId, price, userId, callback) {
  // 查所有活跃且有实际折扣的促销活动
  db.all(`SELECT * FROM promotions WHERE is_active = 1
    AND discount > 0
    AND datetime(start_time) <= datetime('now','localtime')
    AND datetime(end_time) > datetime('now','localtime')
    ORDER BY discount DESC`, (err, promotions) => {
    if (err || !promotions || promotions.length === 0) {
      return callback({ discounted: false, originalPrice: price, finalPrice: price, promo: null });
    }

    // 逐个检查促销活动是否适用于当前用户
    let matchedPromo = null;
    let pending = promotions.length;
    let checked = 0;

    promotions.forEach(function(promo, idx) {
      // 如果促销标题包含"新用户"，检查用户是否为新用户（无订单记录）
      if (promo.title && promo.title.indexOf('新用户') !== -1) {
        db.get('SELECT COUNT(*) as cnt FROM orders WHERE user_id = ?', [userId], function(err2, row) {
          checked++;
          if (!err2 && row && row.cnt === 0 && !matchedPromo) {
            matchedPromo = promo;
          }
          if (checked >= pending) {
            finishCheck(matchedPromo || promotions[0]);
          }
        });
      } else {
        checked++;
        if (!matchedPromo) {
          matchedPromo = promo;
        }
        if (checked >= pending) {
          finishCheck(matchedPromo || promotions[0]);
        }
      }
    });

    function finishCheck(promo) {
      let finalPrice = price;
      if (promo.discount_type === 'percent') {
        finalPrice = Math.round(price * (100 - promo.discount) / 100 * 100) / 100;
      } else {
        finalPrice = Math.max(0, price - promo.discount);
      }
      callback({
        discounted: true,
        originalPrice: price,
        finalPrice: finalPrice < price ? finalPrice : price,
        promo: promo,
        promoDiscountText: promo.discount_type === 'percent' ? (promo.discount + '% OFF') : '¥' + promo.discount + ' 优惠',
        promoTitle: promo.title
      });
    }
  });
}

app.get('/api/promotions', isAuth, (req, res) => {
  db.all(`SELECT * FROM promotions WHERE is_active = 1
    AND datetime(start_time) <= datetime('now','localtime')
    AND datetime(end_time) > datetime('now','localtime')
    ORDER BY id DESC`, (err, promotions) => {
    if (err || !promotions || promotions.length === 0) return res.json([]);
    
    // 检查用户是否有订单，用于过滤"新用户专享"促销
    db.get('SELECT COUNT(*) as cnt FROM orders WHERE user_id = ?', [req.session.user.id], function(err2, row) {
      const isNewUser = !err2 && row && row.cnt === 0;
      
      // 过滤：非新用户不显示"新用户专享"促销
      const filtered = promotions.filter(function(p) {
        if (p.title && p.title.indexOf('新用户') !== -1) {
          return isNewUser;
        }
        return true;
      });
      
      if (filtered.length === 0) return res.json([]);
      
      let pending = filtered.length;
      filtered.forEach((promo, idx) => {
        getPromoProducts(promo, 8, (products) => {
          filtered[idx].products = products || [];
          if (--pending === 0) {
            res.json(filtered);
          }
        });
      });
    });
  });
});

app.get('/promotions', isAuth, (req, res) => {
  db.all(`SELECT * FROM promotions WHERE is_active = 1
    AND datetime(start_time) <= datetime('now','localtime')
    AND datetime(end_time) > datetime('now','localtime')
    ORDER BY id DESC`, (err, promotions) => {
    if (err || !promotions || promotions.length === 0) {
      return res.render('promotions', {
        promotions: [],
        balance: req.session.user.balance,
        warningActive: req.session.user.warningActive,
        warningUntil: req.session.user.warningUntil
      });
    }
    
    // 检查用户是否有订单，用于过滤"新用户专享"促销
    db.get('SELECT COUNT(*) as cnt FROM orders WHERE user_id = ?', [req.session.user.id], function(err2, row) {
      const isNewUser = !err2 && row && row.cnt === 0;
      
      // 过滤：非新用户不显示"新用户专享"促销
      const filtered = promotions.filter(function(p) {
        if (p.title && p.title.indexOf('新用户') !== -1) {
          return isNewUser;
        }
        return true;
      });
      
      if (filtered.length === 0) {
        return res.render('promotions', {
          promotions: [],
          balance: req.session.user.balance,
          warningActive: req.session.user.warningActive,
          warningUntil: req.session.user.warningUntil
        });
      }
      
      let pending = filtered.length;
      filtered.forEach((promo, idx) => {
        getPromoProducts(promo, 8, (products) => {
          filtered[idx].products = products || [];
          if (--pending === 0) {
            res.render('promotions', {
              promotions: filtered,
              balance: req.session.user.balance,
              warningActive: req.session.user.warningActive,
              warningUntil: req.session.user.warningUntil
            });
          }
        });
      });
    });
  });
});

// ===================== 6. 每日签到系统 API =====================
app.get('/api/checkin/status', isAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  db.get('SELECT consecutive_days, points_earned FROM checkin_records WHERE user_id = ? AND checkin_date = ?', [req.session.user.id, today], (err, todayRecord) => {
    db.get('SELECT checkin_date, consecutive_days FROM checkin_records WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1', [req.session.user.id], (err2, lastRecord) => {
      let consecutiveDays = 0;
      if (todayRecord) {
        consecutiveDays = todayRecord.consecutive_days;
      } else if (lastRecord) {
        const lastDate = new Date(lastRecord.checkin_date + 'T00:00:00');
        const todayDate = new Date(today + 'T00:00:00');
        const diffDays = Math.round((todayDate - lastDate) / 86400000);
        if (diffDays === 1) {
          consecutiveDays = lastRecord.consecutive_days;
        }
      }
      res.json({
        ok: true,
        checkedIn: !!todayRecord,
        consecutiveDays,
        todayPoints: todayRecord ? todayRecord.points_earned : 0
      });
    });
  });
});

app.post('/api/checkin', isAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  db.get('SELECT id FROM checkin_records WHERE user_id = ? AND checkin_date = ?', [req.session.user.id, today], (err, existing) => {
    if (existing) return res.json({ ok: false, msg: '今日已签到' });
    // 计算连续天数
    db.get('SELECT checkin_date, consecutive_days FROM checkin_records WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1', [req.session.user.id], (err2, lastRecord) => {
      let consecutive = 1;
      if (lastRecord) {
        const lastDate = new Date(lastRecord.checkin_date + 'T00:00:00');
        const todayDate = new Date(today + 'T00:00:00');
        const diffDays = Math.round((todayDate - lastDate) / 86400000);
        if (diffDays === 1) {
          consecutive = lastRecord.consecutive_days + 1;
        }
      }
      const points = 1 + consecutive; // 奖励积分 = 1 + 连续天数
      db.run('INSERT INTO checkin_records (user_id, checkin_date, consecutive_days, points_earned) VALUES (?, ?, ?, ?)', [req.session.user.id, today, consecutive, points], (err3) => {
        if (err3) return res.json({ ok: false, msg: '签到失败' });
        // 更新用户积分
        db.run('UPDATE users SET total_points = COALESCE(total_points, 0) + ? WHERE id = ?', [points, req.session.user.id]);
        // 每连续7天额外送一张随机优惠券
        if (consecutive % 7 === 0) {
          db.get(`SELECT id FROM coupons WHERE is_active = 1
            AND (max_uses <= 0 OR used_count < max_uses)
            AND datetime(expires_at) > datetime('now','localtime')
            ORDER BY RANDOM() LIMIT 1`, (err4, bonusCoupon) => {
            if (bonusCoupon) {
              db.run('INSERT INTO user_coupons (user_id, coupon_id) VALUES (?, ?)', [req.session.user.id, bonusCoupon.id], () => {
                db.run('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', [bonusCoupon.id]);
                res.json({ ok: true, msg: '签到成功', points, consecutiveDays: consecutive, bonus: '获得一张随机优惠券' });
              });
            } else {
              res.json({ ok: true, msg: '签到成功', points, consecutiveDays: consecutive, bonus: null });
            }
          });
        } else {
          res.json({ ok: true, msg: '签到成功', points, consecutiveDays: consecutive, bonus: null });
        }
      });
    });
  });
});

// ===================== 定时自动发放优惠券系统 =====================
// 创建发放记录表
db.run(`CREATE TABLE IF NOT EXISTS coupon_distribution_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dist_time TEXT NOT NULL,
  dist_type TEXT NOT NULL DEFAULT 'auto',
  coupon_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  reason TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_cdl_time ON coupon_distribution_log (dist_time)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_cdl_user ON coupon_distribution_log (user_id)`);

// 确保系统自动发放用的优惠券存在
function ensureAutoCoupons() {
  const now = new Date();
  const future = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString(); // 30天后过期
  const autoCoupons = [
    { code: 'AUTO5', discount: 5, desc: '系统自动发放 · 满减券', max_uses: 99999 },
    { code: 'AUTO10', discount: 10, desc: '系统自动发放 · 回馈券', max_uses: 99999 },
    { code: 'AUTO3', discount: 3, desc: '系统自动发放 · 体验券', max_uses: 99999 },
    { code: 'AUTO20', discount: 20, desc: '系统自动发放 · 大额券', max_uses: 99999 }
  ];
  autoCoupons.forEach(c => {
    db.get("SELECT id FROM coupons WHERE code = ?", [c.code], (err, row) => {
      if (!row) {
        db.run("INSERT INTO coupons (code, discount, owner_id, max_uses, used_count, expires_at, is_active) VALUES (?, ?, 0, ?, 0, ?, 1)", [c.code, c.discount, c.max_uses, future]);
      }
    });
  });
}
ensureAutoCoupons();

// 记录上次发放的小时，防止重复发放
let lastDistributedHour = {};

// 定时发放优惠券：每5分钟检查一次
setInterval(() => {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const distHourKey = now.toISOString().slice(0, 10) + '-' + hour;

  // 每天 8:00, 12:00, 18:00, 20:00 发放（在整点过5分钟内检查）
  const distHours = [8, 12, 18, 20];
  if (!distHours.includes(hour) || minute > 5) return;
  if (lastDistributedHour[distHourKey]) return; // 已发放过
  lastDistributedHour[distHourKey] = true;

  console.log('[' + now.toLocaleString() + '] 开始定时发放优惠券...');

  // 1. 获取活跃用户：最近7天有购买记录的用户
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  db.all(`SELECT DISTINCT u.id, u.username,
    COALESCE(u.total_points, 0) as points,
    (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as order_count,
    (SELECT COALESCE(SUM(price), 0) FROM orders WHERE user_id = u.id) as total_spent
    FROM users u
    WHERE u.id > 0
    AND (u.id IN (SELECT DISTINCT user_id FROM orders WHERE created_at >= ?))
    ORDER BY total_spent DESC`, [sevenDaysAgo], (err, activeUsers) => {
    if (err || !activeUsers || activeUsers.length === 0) {
      console.log('  没有活跃用户，跳过发放');
      return;
    }

    // 2. 获取可用的自动发放优惠券
    db.all(`SELECT * FROM coupons WHERE code LIKE 'AUTO%' AND is_active = 1
      AND datetime(expires_at) > datetime('now','localtime')
      ORDER BY discount ASC`, (err2, availableCoupons) => {
      if (err2 || !availableCoupons || availableCoupons.length === 0) {
        console.log('  没有可用的自动发放优惠券');
        return;
      }

      let distributed = 0;
      activeUsers.forEach(user => {
        // 根据用户活跃度选择不同面额的优惠券
        let chosenCoupon = availableCoupons[0]; // 默认最低面额
        if (user.total_spent > 500) {
          // 高消费用户：大额券
          const big = availableCoupons.find(c => c.code === 'AUTO20');
          if (big) chosenCoupon = big;
        } else if (user.total_spent > 100 || user.order_count >= 3) {
          // 中等活跃用户：中等面额
          const mid = availableCoupons.find(c => c.code === 'AUTO10');
          if (mid) chosenCoupon = mid;
        } else if (user.order_count > 0) {
          const mid = availableCoupons.find(c => c.code === 'AUTO5');
          if (mid) chosenCoupon = mid;
        }
        // 新用户（无消费）：AUTO3

        // 检查是否已领过同类券
        db.get('SELECT id FROM coupon_distribution_log WHERE user_id = ? AND coupon_id = ? AND dist_time LIKE ?', [user.id, chosenCoupon.id, now.toISOString().slice(0, 10) + '%'], (err3, existing) => {
          if (existing) return;

          // 发放优惠券
          db.run('INSERT INTO user_coupons (user_id, coupon_id) VALUES (?, ?)', [user.id, chosenCoupon.id], function(err4) {
            if (err4) return;
            db.run('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', [chosenCoupon.id]);
            db.run('INSERT INTO coupon_distribution_log (dist_time, dist_type, coupon_id, user_id, reason) VALUES (?, ?, ?, ?, ?)',
              [now.toISOString(), 'auto', chosenCoupon.id, user.id, '基于活跃度自动发放'], function() {
              distributed++;

              // 通过Socket.IO通知在线用户
              let reasonText = '系统根据您的活跃度发放了一张 ¥' + chosenCoupon.discount + ' 优惠券 🎫';
              if (user.total_spent > 500) reasonText = '感谢您对我们的支持！系统赠送 ¥' + chosenCoupon.discount + ' 大额优惠券 🎉';
              else if (user.order_count >= 3) reasonText = '老用户回馈！系统赠送 ¥' + chosenCoupon.discount + ' 优惠券 🎫';
              else if (user.order_count > 0) reasonText = '感谢您的购买！系统赠送 ¥' + chosenCoupon.discount + ' 优惠券 🎫';

              // 通知所有该用户的在线连接
              for (let [sid, u] of onlineUsers) {
                if (u.id == user.id) {
                  io.to(sid).emit('couponReceived', {
                    coupon_id: chosenCoupon.id,
                    discount: chosenCoupon.discount,
                    reason: reasonText,
                    expires_at: chosenCoupon.expires_at
                  });
                }
              }
            });
          });
        });
      });
      console.log('  本次发放 ' + distributed + ' 张优惠券');
    });
  });
}, 300000); // 每5分钟检查一次

// ===================== 7. 游戏系统 =====================

// ---------- 黑杰克游戏引擎 ----------
function createDeckBJ(numDecks = 6) {
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const deck = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit, rank });
      }
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValueBJ(rank) {
  if (rank === 'A') return 11;
  if (['J','Q','K'].includes(rank)) return 10;
  return parseInt(rank);
}

function handValueBJ(hand) {
  let total = 0, aces = 0;
  for (const c of hand) {
    if (c.rank === 'A') aces++;
    total += cardValueBJ(c.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function handIsBJ(hand) {
  return hand.length === 2 && handValueBJ(hand) === 21;
}

function handToString(hand) {
  return hand.map(c => c.rank + c.suit).join(' ');
}

// 游戏中黑杰克会话（内存）
const blackjackSessions = new Map();

// ---------- 幸运大转盘 ----------
const wheelSegments = [
  { name: '500 金币',  type: 'balance', value: 500, weight: 1,  color: '#FFD700' },
  { name: '100 金币',  type: 'balance', value: 100, weight: 4,  color: '#FF6B6B' },
  { name: '50 金币',   type: 'balance', value: 50,  weight: 10, color: '#4ECDC4' },
  { name: '20 金币',   type: 'balance', value: 20,  weight: 20, color: '#45B7D1' },
  { name: '10 金币',   type: 'balance', value: 10,  weight: 25, color: '#96CEB4' },
  { name: '20 积分',   type: 'points',  value: 20,  weight: 8,  color: '#DDA0DD' },
  { name: '10 积分',   type: 'points',  value: 10,  weight: 15, color: '#F0E68C' },
  { name: '5 积分',    type: 'points',  value: 5,   weight: 20, color: '#FFA07A' },
  { name: '10元优惠券', type: 'coupon',  value: 10,  weight: 3,  color: '#98D8C8' },
  { name: '5元优惠券',  type: 'coupon',  value: 5,   weight: 6,  color: '#F7DC6F' },
  { name: '再来一次',  type: 'retry',   value: 0,   weight: 12, color: '#BB8FCE' },
  { name: '谢谢参与',  type: 'none',    value: 0,   weight: 30, color: '#ABB2B9' },
];

function weightedPick(segments) {
  const totalWeight = segments.reduce((s, seg) => s + seg.weight, 0);
  let r = Math.random() * totalWeight;
  for (let i = 0; i < segments.length; i++) {
    r -= segments[i].weight;
    if (r <= 0) return { index: i, segment: segments[i] };
  }
  return { index: segments.length - 1, segment: segments[segments.length - 1] };
}

// ---------- 游戏中心首页 ----------
app.get('/games', isAuth, (req, res) => {
  db.get(`SELECT * FROM user_game_stats WHERE user_id = ?`, [req.session.user.id], (err, stats) => {
    res.render('games', {
      user: req.session.user,
      csrfToken: req.csrfToken(),
      stats: stats || { blackjack_games: 0, blackjack_wins: 0, blackjack_net: 0, wheel_spins: 0, blackjack_points: 0 }
    });
  });
});

// ---------- 黑杰克页面 ----------
app.get('/games/blackjack', isAuth, (req, res) => {
  db.get(`SELECT * FROM user_game_stats WHERE user_id = ?`, [req.session.user.id], (err, stats) => {
    res.render('games_blackjack', {
      user: req.session.user,
      csrfToken: req.csrfToken(),
      stats: stats || { blackjack_games: 0, blackjack_wins: 0, blackjack_losses: 0, blackjack_pushes: 0, blackjack_net: 0, blackjack_points: 0 }
    });
  });
});

// ---------- 黑杰克API：开始新一局 ----------
app.post('/api/games/blackjack/start', isAuth, (req, res) => {
  const bet = parseFloat(req.body.bet);
  if (!bet || bet < 10) return res.json({ ok: false, msg: '最低下注 10 金币' });
  if (bet > req.session.user.balance) return res.json({ ok: false, msg: '余额不足' });

  // 如果已有会话，检查是否已完成
  const existing = blackjackSessions.get(req.session.user.id);
  if (existing && existing.phase !== 'settled') {
    return res.json({ ok: false, msg: '请先完成当前对局' });
  }

  // 扣款
  const newBalance = req.session.user.balance - bet;
  db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, req.session.user.id], (err) => {
    if (err) return res.json({ ok: false, msg: '扣款失败' });
    req.session.user.balance = newBalance;

    // 发牌
    const deck = createDeckBJ();
    const playerHand = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];

    let phase = 'playing';
    let canDouble = true;
    let canHit = true;
    let canStand = true;
    let result = null;
    let payout = 0;

    // 检查是否为黑杰克
    const playerHasBJ = handIsBJ(playerHand);
    const dealerHasBJ = handIsBJ(dealerHand);

    if (playerHasBJ && dealerHasBJ) {
      phase = 'settled';
      result = 'push';
      payout = bet;
      canDouble = false; canHit = false; canStand = false;
      // 退还赌注
      db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [bet, req.session.user.id], () => {
        req.session.user.balance = newBalance + bet;
      });
    } else if (playerHasBJ) {
      phase = 'settled';
      result = 'blackjack';
      payout = bet + Math.floor(bet * 1.5); // 3:2
      canDouble = false; canHit = false; canStand = false;
      db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, req.session.user.id], () => {
        req.session.user.balance = newBalance + payout;
      });
    }

    const session = {
      deck, playerHand, dealerHand, bet, phase, canDouble, canHit, canStand, result, payout
    };
    blackjackSessions.set(req.session.user.id, session);

    res.json({
      ok: true,
      playerHand: session.playerHand,
      dealerHand: [session.dealerHand[0], { suit: '?', rank: '?' }],
      dealerUpcard: session.dealerHand[0],
      playerValue: handValueBJ(session.playerHand),
      phase: session.phase,
      result: session.result,
      payout: session.payout,
      bet: session.bet,
      canDouble: session.canDouble,
      canHit: session.canHit,
      canStand: session.canStand,
      balance: req.session.user.balance
    });
  });
});

// ---------- 黑杰克API：要牌 ----------
app.post('/api/games/blackjack/hit', isAuth, (req, res) => {
  const session = blackjackSessions.get(req.session.user.id);
  if (!session || session.phase !== 'playing') return res.json({ ok: false, msg: '没有进行中的对局' });
  if (!session.canHit) return res.json({ ok: false, msg: '无法继续要牌' });

  session.playerHand.push(session.deck.pop());
  session.canDouble = false;

  const value = handValueBJ(session.playerHand);
  if (value > 21) {
    // 爆牌，庄家赢
    session.phase = 'settled';
    session.result = 'lose';
    session.payout = 0;
    session.canHit = false;
    session.canStand = false;
    recordBlackjackResult(req.session.user.id, session);
  }

  res.json({
    ok: true,
    playerHand: session.playerHand,
    playerValue: handValueBJ(session.playerHand),
    phase: session.phase,
    result: session.result,
    payout: session.payout,
    canDouble: session.canDouble,
    canHit: session.canHit,
    canStand: session.canStand,
    balance: req.session.user.balance
  });
});

// ---------- 黑杰克API：停牌 ----------
app.post('/api/games/blackjack/stand', isAuth, (req, res) => {
  const session = blackjackSessions.get(req.session.user.id);
  if (!session || session.phase !== 'playing') return res.json({ ok: false, msg: '没有进行中的对局' });
  if (!session.canStand) return res.json({ ok: false, msg: '无法停牌' });

  session.phase = 'dealer_turn';
  session.canHit = false;
  session.canStand = false;
  session.canDouble = false;

  // 庄家翻牌：17点以下必须继续要牌（软17也要牌）
  while (handValueBJ(session.dealerHand) < 17) {
    session.dealerHand.push(session.deck.pop());
  }

  const playerVal = handValueBJ(session.playerHand);
  const dealerVal = handValueBJ(session.dealerHand);

  session.phase = 'settled';
  if (dealerVal > 21) {
    session.result = 'win';
    session.payout = session.bet * 2;
  } else if (playerVal > dealerVal) {
    session.result = 'win';
    session.payout = session.bet * 2;
  } else if (playerVal === dealerVal) {
    session.result = 'push';
    session.payout = session.bet;
  } else {
    session.result = 'lose';
    session.payout = 0;
  }

  // 结算：当前余额 = originalBalance - bet，加上 payout 后得到最终余额
  const currentBalance = req.session.user.balance;
  const finalBalance = currentBalance + session.payout;

  if (session.payout > 0) {
    db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [session.payout, req.session.user.id], () => {
      req.session.user.balance = finalBalance;
    });
  }

  recordBlackjackResult(req.session.user.id, session);

  res.json({
    ok: true,
    playerHand: session.playerHand,
    dealerHand: session.dealerHand,
    playerValue: playerVal,
    dealerValue: dealerVal,
    phase: session.phase,
    result: session.result,
    payout: session.payout,
    balance: finalBalance
  });
});

// ---------- 黑杰克API：加倍 ----------
app.post('/api/games/blackjack/double', isAuth, (req, res) => {
  const session = blackjackSessions.get(req.session.user.id);
  if (!session || session.phase !== 'playing') return res.json({ ok: false, msg: '没有进行中的对局' });
  if (!session.canDouble) return res.json({ ok: false, msg: '无法加倍' });

  // 检查余额是否足够加倍
  if (req.session.user.balance < session.bet) return res.json({ ok: false, msg: '余额不足，无法加倍' });

  db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [session.bet, req.session.user.id], () => {
    req.session.user.balance -= session.bet;
    session.bet *= 2;
    session.canDouble = false;
    session.canHit = false;

    // 加倍只发一张牌
    session.playerHand.push(session.deck.pop());
    const value = handValueBJ(session.playerHand);

    if (value > 21) {
      session.phase = 'settled';
      session.result = 'lose';
      session.payout = 0;
      recordBlackjackResult(req.session.user.id, session);
    } else {
      // 自动停牌，庄家翻牌
      session.phase = 'dealer_turn';
      while (handValueBJ(session.dealerHand) < 17) {
        session.dealerHand.push(session.deck.pop());
      }

      const playerVal = handValueBJ(session.playerHand);
      const dealerVal = handValueBJ(session.dealerHand);
      session.phase = 'settled';

      if (dealerVal > 21) {
        session.result = 'win';
        session.payout = session.bet * 2;
      } else if (playerVal > dealerVal) {
        session.result = 'win';
        session.payout = session.bet * 2;
      } else if (playerVal === dealerVal) {
        session.result = 'push';
        session.payout = session.bet;
      } else {
        session.result = 'lose';
        session.payout = 0;
      }
    }

    // 计算最终余额（同步）
    const doubleFinalBalance = req.session.user.balance + session.payout;

    if (session.payout > 0) {
      db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [session.payout, req.session.user.id], () => {
        req.session.user.balance = doubleFinalBalance;
      });
    }

    res.json({
      ok: true,
      playerHand: session.playerHand,
      dealerHand: session.dealerHand,
      playerValue: handValueBJ(session.playerHand),
      dealerValue: handValueBJ(session.dealerHand),
      phase: session.phase,
      result: session.result,
      payout: session.payout,
      bet: session.bet,
      balance: doubleFinalBalance
    });
  });
});

// ---------- 黑杰克结果记录 ----------
function recordBlackjackResult(userId, session) {
  db.run(`INSERT INTO game_blackjack_records (user_id, bet_amount, result, payout, player_hands, dealer_hand)
    VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, session.bet, session.result, session.payout,
      JSON.stringify(session.playerHand), JSON.stringify(session.dealerHand)]
  );

  db.get(`SELECT id FROM user_game_stats WHERE user_id = ?`, [userId], (err, row) => {
    if (row) {
      let updates = 'blackjack_games = blackjack_games + 1, updated_at = datetime(\'now\',\'localtime\')';
      if (session.result === 'win') updates += ', blackjack_wins = blackjack_wins + 1';
      else if (session.result === 'lose') updates += ', blackjack_losses = blackjack_losses + 1';
      else if (session.result === 'push') updates += ', blackjack_pushes = blackjack_pushes + 1';
      else if (session.result === 'blackjack') updates += ', blackjack_wins = blackjack_wins + 1';
      const netChange = session.payout - session.bet;
      updates += `, blackjack_net = blackjack_net + ${netChange}`;
      // 每赢一局加1积分
      if (session.result === 'win' || session.result === 'blackjack') {
        updates += ', blackjack_points = blackjack_points + 1';
      }
      db.run(`UPDATE user_game_stats SET ${updates} WHERE user_id = ?`, [userId]);
    } else {
      const wins = (session.result === 'win' || session.result === 'blackjack') ? 1 : 0;
      const losses = (session.result === 'lose') ? 1 : 0;
      const pushes = (session.result === 'push') ? 1 : 0;
      const netChange = session.payout - session.bet;
      db.run(`INSERT INTO user_game_stats (user_id, blackjack_games, blackjack_wins, blackjack_losses, blackjack_pushes, blackjack_net, blackjack_points)
        VALUES (?, 1, ?, ?, ?, ?, ?)`, [userId, wins, losses, pushes, netChange, wins]);
    }
  });
}

// ---------- 幸运大转盘页面 ----------
app.get('/games/wheel', isAuth, (req, res) => {
  db.get(`SELECT * FROM user_game_stats WHERE user_id = ?`, [req.session.user.id], (err, stats) => {
    // 检查今日是否已转
    const today = new Date().toISOString().slice(0, 10);
    db.get(`SELECT COUNT(*) as cnt FROM game_wheel_records WHERE user_id = ? AND date(created_at) = ?`,
      [req.session.user.id, today], (err2, row) => {
      res.render('games_wheel', {
        user: req.session.user,
        csrfToken: req.csrfToken(),
        stats: stats || { wheel_spins: 0, blackjack_points: 0 },
        todaySpun: row ? row.cnt > 0 : false,
        segments: wheelSegments
      });
    });
  });
});

// ---------- 幸运大转盘API ----------
app.post('/api/games/wheel/spin', isAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  db.get(`SELECT COUNT(*) as cnt FROM game_wheel_records WHERE user_id = ? AND date(created_at) = ?`,
    [req.session.user.id, today], (err, row) => {
    if (row && row.cnt > 0) return res.json({ ok: false, msg: '今日已转过了，明天再来吧！' });

    const pick = weightedPick(wheelSegments);
    const seg = pick.segment;

    // 发放奖励
    let payout = 0;
    const doReward = (callback) => {
      if (seg.type === 'balance') {
        db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [seg.value, req.session.user.id], () => {
          req.session.user.balance += seg.value;
          payout = seg.value;
          callback();
        });
      } else if (seg.type === 'points') {
        db.run('UPDATE users SET total_points = COALESCE(total_points, 0) + ? WHERE id = ?', [seg.value, req.session.user.id], () => {
          callback();
        });
      } else if (seg.type === 'coupon') {
        // 创建一张优惠券并发给用户
        const code = 'WHEEL' + Date.now().toString(36).toUpperCase();
        const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
        db.run('INSERT INTO coupons (code, discount, owner_id, max_uses, used_count, expires_at, is_active) VALUES (?, ?, 0, 99999, 0, ?, 1)',
          [code, seg.value, future], function(errC) {
          if (errC) { callback(); return; }
          db.run('INSERT INTO user_coupons (user_id, coupon_id) VALUES (?, ?)', [req.session.user.id, this.lastID], () => {
            callback();
          });
        });
      } else if (seg.type === 'retry') {
        // 再来一次 - 直接成功，不增加次数
        callback();
      } else {
        callback();
      }
    };

    doReward(() => {
      // 记录转盘结果
      if (seg.type !== 'retry') {
        db.run('INSERT INTO game_wheel_records (user_id, prize_name, prize_type, prize_value) VALUES (?, ?, ?, ?)',
          [req.session.user.id, seg.name, seg.type, seg.value]);

        db.get(`SELECT id FROM user_game_stats WHERE user_id = ?`, [req.session.user.id], (err2, statRow) => {
          if (statRow) {
            db.run('UPDATE user_game_stats SET wheel_spins = wheel_spins + 1, updated_at = datetime(\'now\',\'localtime\') WHERE user_id = ?',
              [req.session.user.id]);
          } else {
            db.run('INSERT INTO user_game_stats (user_id, wheel_spins) VALUES (?, 1)', [req.session.user.id]);
          }
        });
      }

      // 额外积分奖励：每转一次得1积分
      if (seg.type !== 'retry' && seg.type !== 'none') {
        db.run('UPDATE users SET total_points = COALESCE(total_points, 0) + 1 WHERE id = ?', [req.session.user.id]);
      }

      res.json({
        ok: true,
        index: pick.index,
        segment: seg,
        canRetry: seg.type === 'retry',
        balance: req.session.user.balance
      });
    });
  });
});

// ---------- 黑杰克历史记录 ----------
app.get('/api/games/blackjack/history', isAuth, (req, res) => {
  db.all(`SELECT * FROM game_blackjack_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
    [req.session.user.id], (err, records) => {
    res.json({ ok: true, records: records || [] });
  });
});

// ===================== 骰子游戏 =====================
const diceSessions = new Map();

app.get('/games/dice', isAuth, (req, res) => {
  res.render('games_dice', { user: req.session.user, csrfToken: req.csrfToken() });
});

app.post('/api/games/dice/roll', isAuth, (req, res) => {
  const bet = parseFloat(req.body.bet);
  const guess = parseInt(req.body.guess);
  if (!bet || bet < 10) return res.json({ ok: false, msg: '最低下注 10 金币' });
  if (guess < 1 || guess > 6) return res.json({ ok: false, msg: '请猜 1-6 之间的数字' });
  if (bet > req.session.user.balance) return res.json({ ok: false, msg: '余额不足' });

  const newBalance = req.session.user.balance - bet;
  db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, req.session.user.id], (err) => {
    if (err) return res.json({ ok: false, msg: '扣款失败' });
    req.session.user.balance = newBalance;

    const roll = Math.floor(Math.random() * 6) + 1;
    const win = guess === roll;
    const payout = win ? bet * 5 : 0;

    if (win) {
      db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, req.session.user.id], () => {
        req.session.user.balance = newBalance + payout;
      });
    }

    // 游戏记录
    db.run('INSERT INTO game_blackjack_records (user_id, bet_amount, result, payout, player_hands, dealer_hand) VALUES (?, ?, ?, ?, ?, ?)',
      [req.session.user.id, bet, win ? 'win' : 'lose', payout, JSON.stringify([{ rank: guess + '', suit: '🎲' }]), JSON.stringify([{ rank: roll + '', suit: '🎲' }])]);

    // 奖励积分
    if (win) {
      db.run('UPDATE users SET total_points = COALESCE(total_points, 0) + 1 WHERE id = ?', [req.session.user.id]);
    }

    res.json({ ok: true, roll, guess, win, payout, balance: req.session.user.balance });
  });
});

// ===================== 老虎机 =====================
const SLOT_SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '🔔', '💎', '7️⃣'];
const SLOT_PAYOUTS = {
  '7️⃣7️⃣7️⃣': 50, '💎💎💎': 20, '🔔🔔🔔': 10,
  '🍇🍇🍇': 5, '🍊🍊🍊': 3, '🍋🍋🍋': 2, '🍒🍒🍒': 1.5
};

app.get('/games/slot', isAuth, (req, res) => {
  res.render('games_slot', { user: req.session.user, csrfToken: req.csrfToken(), symbols: SLOT_SYMBOLS });
});

app.post('/api/games/slot/spin', isAuth, (req, res) => {
  const bet = parseFloat(req.body.bet);
  if (!bet || bet < 10) return res.json({ ok: false, msg: '最低下注 10 金币' });
  if (bet > req.session.user.balance) return res.json({ ok: false, msg: '余额不足' });

  const newBalance = req.session.user.balance - bet;
  db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, req.session.user.id], (err) => {
    if (err) return res.json({ ok: false, msg: '扣款失败' });
    req.session.user.balance = newBalance;

    const reels = [
      SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
      SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
      SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]
    ];

    const combo = reels.join('');
    const multiplier = SLOT_PAYOUTS[combo] || (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2] ? 0.5 : 0);
    const win = multiplier > 0;
    const payout = win ? Math.floor(bet * multiplier) : 0;

    if (payout > 0) {
      db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, req.session.user.id], () => {
        req.session.user.balance = newBalance + payout;
      });
    }

    db.run('INSERT INTO game_blackjack_records (user_id, bet_amount, result, payout, player_hands, dealer_hand) VALUES (?, ?, ?, ?, ?, ?)',
      [req.session.user.id, bet, win ? 'win' : 'lose', payout, JSON.stringify([{ rank: combo, suit: '🎰' }]), JSON.stringify([{ rank: combo, suit: '🎰' }])]);

    if (win) {
      db.run('UPDATE users SET total_points = COALESCE(total_points, 0) + 1 WHERE id = ?', [req.session.user.id]);
    }

    res.json({ ok: true, reels, combo, multiplier, win, payout, balance: req.session.user.balance });
  });
});

// ===================== 猜数字游戏 =====================
const guessSessions = new Map();

app.get('/games/guess', isAuth, (req, res) => {
  res.render('games_guess', { user: req.session.user, csrfToken: req.csrfToken() });
});

app.post('/api/games/guess/start', isAuth, (req, res) => {
  const bet = parseFloat(req.body.bet);
  if (!bet || bet < 10) return res.json({ ok: false, msg: '最低下注 10 金币' });
  if (bet > req.session.user.balance) return res.json({ ok: false, msg: '余额不足' });

  const newBalance = req.session.user.balance - bet;
  db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, req.session.user.id], (err) => {
    if (err) return res.json({ ok: false, msg: '扣款失败' });
    req.session.user.balance = newBalance;

    const secret = Math.floor(Math.random() * 100) + 1;
    guessSessions.set(req.session.user.id, { secret, attempts: 0, maxAttempts: 5, bet, done: false });

    res.json({ ok: true, attempts: 0, maxAttempts: 5, balance: req.session.user.balance });
  });
});

app.post('/api/games/guess/play', isAuth, (req, res) => {
  const session = guessSessions.get(req.session.user.id);
  if (!session) return res.json({ ok: false, msg: '请先开始新游戏' });
  if (session.done) return res.json({ ok: false, msg: '游戏已结束，请开始新游戏' });

  const guess = parseInt(req.body.guess);
  if (isNaN(guess) || guess < 1 || guess > 100) return res.json({ ok: false, msg: '请输入 1-100 之间的数字' });

  session.attempts++;
  let hint = '';
  let win = false;

  if (guess === session.secret) {
    win = true;
    session.done = true;
    const payout = session.bet * 3;
    db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, req.session.user.id], () => {
      req.session.user.balance = (req.session.user.balance || 0) + payout;
    });
    db.run('UPDATE users SET total_points = COALESCE(total_points, 0) + 1 WHERE id = ?', [req.session.user.id]);
  } else if (session.attempts >= session.maxAttempts) {
    session.done = true;
    hint = guess < session.secret ? '小了' : '大了';
  } else {
    hint = guess < session.secret ? '小了，再试试' : '大了，再试试';
  }

  res.json({
    ok: true,
    guess,
    hint,
    win,
    secret: session.done ? session.secret : null,
    attempts: session.attempts,
    maxAttempts: session.maxAttempts,
    remaining: session.maxAttempts - session.attempts,
    done: session.done,
    balance: req.session.user.balance
  });
});

// ===================== 棋类联机 =====================
app.get('/games/chess', isAuth, (req, res) => {
  res.render('games_chess', { user: req.session.user, csrfToken: req.csrfToken() });
});
app.get('/games/gomoku', isAuth, (req, res) => {
  res.render('games_gomoku', { user: req.session.user, csrfToken: req.csrfToken() });
});
app.get('/games/go', isAuth, (req, res) => {
  res.render('games_go', { user: req.session.user, csrfToken: req.csrfToken() });
});

// ===================== AI 你画我猜 =====================
app.get('/games/draw', isAuth, (req, res) => {
  res.render('games_draw', { user: req.session.user, csrfToken: req.csrfToken() });
});

// ===================== FPS 战术竞技场 =====================
app.get('/games/fps', isAuth, (req, res) => {
  res.render('games_fps', { user: req.session.user, csrfToken: req.csrfToken() });
});

// FPS 保存战绩
app.post('/api/games/fps/save', isAuth, (req, res) => {
  const { score, kills, deaths, headshots, accuracy, wave_reached, difficulty, match_type } = req.body;
  db.run(`INSERT INTO game_fps_match_records (user_id, match_type, difficulty, score, kills, deaths, headshots, accuracy, wave_reached) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.session.user.id, match_type || 'campaign', difficulty || 'normal', score || 0, kills || 0, deaths || 0, headshots || 0, accuracy || 0, wave_reached || 0]);
  db.run(`INSERT INTO game_fps_stats (user_id, games_played, kills, deaths, headshots, highest_wave, highest_score, total_score)
    VALUES (1, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
    games_played = games_played + 1, kills = kills + ?, deaths = deaths + ?, headshots = headshots + ?,
    highest_wave = MAX(highest_wave, ?), highest_score = MAX(highest_score, ?), total_score = total_score + ?,
    updated_at = datetime('now','localtime')`,
    [kills || 0, deaths || 0, headshots || 0, wave_reached || 0, score || 0, score || 0,
     kills || 0, deaths || 0, headshots || 0, wave_reached || 0, score || 0, score || 0]);
  res.json({ ok: true });
});

// FPS 多人对战房间列表
app.get('/api/games/fps/rooms', isAuth, (req, res) => {
  const fpsRooms = req.app.locals.fpsRooms || {};
  const rooms = Object.values(fpsRooms).filter(r => r.state === 'waiting').map(r => ({
    id: r.id, name: r.name, playerCount: r.players.length, maxPlayers: r.maxPlayers, gameMode: r.gameMode, hasPassword: !!r.password
  }));
  res.json(rooms);
});

// ===================== Go 游戏API =====================
app.get('/api/go/rating', isAuth, (req, res) => {
  db.get(`SELECT rating, rd, volatility, games_played, wins, losses, draws, streak FROM game_glicko2_ratings WHERE game_type = 'go' AND season = (SELECT COALESCE(MAX(season), 1) FROM game_glicko2_ratings WHERE game_type = 'go') AND user_id = ?`,
    [req.session.user.id], (err, row) => {
    if (err || !row) {
      return res.json({ rating: 1500, rd: 350, volatility: 0.06, games_played: 0, wins: 0, losses: 0, draws: 0, streak: 0, tier: '初学', tierColor: '#8B7355' });
    }
    row.tier = glicko2.getTier(row.rating);
    row.tierColor = glicko2.getTierColor(row.tier);
    res.json(row);
  });
});

app.get('/api/chess/rating', isAuth, (req, res) => {
  db.get(`SELECT rating, rd, volatility, games_played, wins, losses, draws, streak FROM game_glicko2_ratings WHERE game_type = 'chess' AND season = (SELECT COALESCE(MAX(season), 1) FROM game_glicko2_ratings WHERE game_type = 'chess') AND user_id = ?`,
    [req.session.user.id], (err, row) => {
    if (err || !row) {
      return res.json({ rating: 1500, rd: 350, volatility: 0.06, games_played: 0, wins: 0, losses: 0, draws: 0, streak: 0, tier: '初学', tierColor: '#8B7355' });
    }
    row.tier = glicko2.getTier(row.rating);
    row.tierColor = glicko2.getTierColor(row.tier);
    res.json(row);
  });
});

// 挂载台风模拟预测模块（必须在 isAuth 和 csrf 之前）
app.use('/typhoon', typhoonApp);

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.code === 'EBADCSRFTOKEN') return res.status(403).send('表单已过期，请刷新重试');
  console.error(err);
  res.status(500).send('服务器内部错误');
});

// 全局错误捕获 - 防止崩溃信息泄露到前端
process.on('uncaughtException', (err) => {
  console.error('未捕获异常:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('未处理Promise拒绝:', reason);
});

httpServer.listen(3000, () => {
  console.log('http://localhost:3000');
}).on('error', (err) => {
  console.error('服务器启动失败:', err);
  process.exit(1);
});