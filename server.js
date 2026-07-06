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
const url = require('url');

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
const io = socketio(httpServer, { cors: { origin: ['http://localhost:3000', 'http://127.0.0.1:3000'], methods: ['GET', 'POST'] } });

app.use(express.static('public'));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "ws:", "wss:"],
      frameSrc: ["'self'"]
    }
  }
}));

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
  if (/(union\s+select|select\s+.+\s+from|or\s+1\s*=\s*1|drop\s+table|sleep\s*\()/i.test(raw)) return 'SQL注入';
  if (/(\.\.\/|%2e%2e|\/etc\/passwd|\.\/\.\.)/i.test(raw)) return '路径遍历';
  return null;
}

function pushAttackLog(req, atk) {
  attackLog.push({
    time: new Date().toLocaleTimeString(),
    ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
    method: req.method,
    url: req.originalUrl || req.url || '',
    atk,
    ua: (req.get('user-agent') || '').substring(0, 120)
  });
  if (attackLog.length > MAX_ATTACK_LOG) attackLog.shift();
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
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
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
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: false }
}));

const csrfProtection = csurf({ cookie: false });
app.use((req, res, next) => {
if (['/chat/upload', '/upload', '/appeal', '/friend/group', '/track', '/prompt-generator', '/prompt-generator/publish', '/prompt-generator/download'].includes(req.path) || req.path.startsWith('/refund/apply') || req.path.startsWith('/admin/refunds/') || req.path.startsWith('/admin/flash') || req.path.startsWith('/admin/coupons') || req.path.startsWith('/shop/manage') || req.path.startsWith('/shop/coupons') || req.path.startsWith('/shop/product') || req.path.startsWith('/redeem') || req.path.startsWith('/shop/ship') || req.path.startsWith('/shop/warehouses') || req.path.startsWith('/admin/users/balance') || req.path.startsWith('/admin/login') || req.path.startsWith('/login') || req.path.startsWith('/register') || req.path.startsWith('/orders/') && (req.path.includes('/track') || req.path.includes('/sign') || req.path.includes('/return')) || req.path.startsWith('/admin/ai-artworks') || req.path.startsWith('/admin/announcements') || req.path.startsWith('/ai-image/') || req.path.startsWith('/api/') || req.path.startsWith('/socket.io') || req.path.startsWith('/profile')) return next();
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
    admins.forEach(a => db.run('INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)', [a.id, title, content, type]));
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
      res.redirect('/login');
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
          req.session.regenerate(() => {
            req.session.user = {
              id: user.id, username: user.username,
              balance: 0, reputation: user.reputation,
              warningActive: false, warningUntil: null,
              isAdmin: false, isBanned: true,
              shopId: null, shopName: ''
            };
            res.render('banned', { username: user.username, banUntil: user.ban_until, appealSent: false, reason: '', shopBanned: false });
          });
          return;
        }
        // regenerate 彻底销毁旧 session，防止旧状态残留
        req.session.regenerate(() => {
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
          db.get('SELECT id, name, is_banned, warning_until FROM shops WHERE owner_id = ?', [user.id], (err2, shop) => {
            if (!err2 && shop) {
              req.session.user.shopId = shop.id;
              req.session.user.shopName = shop.name;
              req.session.user.shop = shop;
            }
            db.run('UPDATE users SET online = 1 WHERE id = ?', [user.id]);
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

app.get('/shop', isAuth, (req, res) => {
  db.all(`SELECT p.*, s.name as shop_name,
    COALESCE(r.avg_rating, 0) as avg_rating,
    COALESCE(r.review_count, 0) as review_count
    FROM products p
    LEFT JOIN shops s ON p.shop_id = s.id
    LEFT JOIN (
      SELECT product_id, ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as review_count
      FROM reviews GROUP BY product_id
    ) r ON r.product_id = p.id
    ORDER BY p.id DESC`, (err, products) => {
    if (err) return res.status(500).send('服务器错误');
    db.all(`SELECT f.*, p.name, p.price as original_price 
      FROM flash_sales f JOIN products p ON f.product_id = p.id 
      WHERE f.is_active = 1 AND f.stock > 0 
      AND datetime(f.start_time) <= datetime('now','localtime') 
      AND datetime(f.end_time) > datetime('now','localtime')`, (err2, flashSales) => {
      db.all(`SELECT s.*, o.price, p.name as product_name
        FROM shipments s JOIN orders o ON s.order_id = o.id 
        JOIN products p ON o.product_id = p.id
        WHERE o.user_id = ? AND s.status IN ('shipped','delivered')
        ORDER BY s.shipped_at DESC LIMIT 5`, [req.session.user.id], (err3, shipments) => {
        db.all('SELECT * FROM announcements WHERE is_active = 1 ORDER BY id DESC', (err4, announcements) => {
        res.render('shop', { 
          products, flashSales, shipments: shipments || [],
          announcements: announcements || [],
          balance: req.session.user.balance, 
          warningActive: req.session.user.warningActive, 
          warningUntil: req.session.user.warningUntil 
        });
        });
      }); 
      });
    });
  });

app.post('/buy', isAuth, (req, res) => {
  const pid = req.body.product_id;
  if (!validator.isInt(pid)) return res.status(400).send('非法商品ID');
  
  db.get('SELECT p.*, s.owner_id FROM products p LEFT JOIN shops s ON p.shop_id = s.id WHERE p.id = ?', [pid], (err, product) => {
    if (err || !product) return res.status(404).send('商品不存在');
    if (product.stock <= 0) return res.status(400).send('库存不足');

    db.get(`SELECT flash_price FROM flash_sales 
      WHERE product_id = ? AND is_active = 1 AND stock > 0 
      AND datetime(start_time) <= datetime('now','localtime') 
      AND datetime(end_time) > datetime('now','localtime')`, [product.id], (err, flash) => {
      const finalPrice = flash ? flash.flash_price : product.price;

    const couponCode = (req.body.coupon || '').trim().toUpperCase();
    let couponDiscount = 0;
    let couponId = null;
    const applyCoupon = function(cb) {
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
    
    db.get('SELECT balance FROM users WHERE id = ?', [req.session.user.id], (err, user) => {
      if (err || !user || user.balance < discPrice) return res.status(400).send('余额不足');
      
      const nb = user.balance - discPrice;
      const taxRate = 0.05;
      const tax = Math.round(discPrice * taxRate * 100) / 100;
      const amountToSeller = Math.round((discPrice - tax) * 100) / 100;
      
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.run('UPDATE users SET balance = ? WHERE id = ?', [nb, req.session.user.id], (err) => {
          if (err) { db.run('ROLLBACK'); return res.status(500).send('扣款失败'); }
        });
        
        if (product.shop_id > 0 && product.owner_id) {
          db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amountToSeller, product.owner_id], (err) => {
            if (err) { db.run('ROLLBACK'); return res.status(500).send('打款失败'); }
          });
        }
        
        db.run('UPDATE products SET stock = stock - 1 WHERE id = ?', [pid], (err) => {
          if (err) { db.run('ROLLBACK'); return res.status(500).send('更新库存失败'); }
        });
        
        const oid = uuidv4();
        db.run('INSERT INTO orders (id, user_id, product_id, price) VALUES (?, ?, ?, ?)', 
          [oid, req.session.user.id, pid, discPrice], (err) => {
          if (err) { db.run('ROLLBACK'); return res.status(500).send('创建订单失败'); }
          
          if (product.shop_id > 0 && product.owner_id) {
            db.run('INSERT INTO transactions (order_id, from_user_id, to_user_id, amount, tax) VALUES (?, ?, ?, ?, ?)', 
              [oid, req.session.user.id, product.owner_id, amountToSeller, tax], (err) => {
              if (err) console.error('记录交易失败:', err);
            });
          }

          db.run('UPDATE flash_sales SET stock = stock - 1 WHERE product_id = ? AND stock > 0', [product.id], function() {
            if (this.changes > 0) {
              db.get('SELECT stock FROM flash_sales WHERE product_id = ?', [product.id], (e, fs) => {
                if (!e) io.emit('flashStockUpdate', { productId: product.id, stock: fs ? fs.stock : 0 });
              });
            }
          });
          if (couponId) db.run('UPDATE user_coupons SET used = 1 WHERE coupon_id = ? AND user_id = ?', [couponId, req.session.user.id]);

          db.run('COMMIT');
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
        });
      });
    });
    }); // applyCoupon
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
        
        // 恢复订单状态
        db.run('UPDATE orders SET status = NULL WHERE id = ?', [refund.order_id]);
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
    db.run('UPDATE users SET avatar = ? WHERE id = ?', ['/uploads/' + req.file.filename, req.session.user.id], (err) => {
      res.render('profile', { msg: err ? '保存失败' : '头像更新成功！' });
    });
  });
});

// ========== 聊天室 ==========
const chatHistory = [];
app.get('/chat', isAuth, (req, res) => res.render('chat', { username: req.session.user.username, groupMembers: req.session.groupMembers || [] }));
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
  const friends = req.body.friends;
  if (!Array.isArray(friends) || friends.length < 1) {
    return res.send('请至少选择一个好友');
  }
  // 检查好友关系
  let ok = true;
  friends.forEach(id => {
    if (!req.session.friends || !req.session.friends.includes(parseInt(id))) ok = false;
  });
  if (!ok) return res.send('只能邀请好友');
  // 加上自己
  const all = [...friends.map(x => parseInt(x)), req.session.user.id];
  const name = all.map(id => {
    const u = req.session.allUsers?.find(x => x.id == id);
    return u ? u.username : '用户' + id;
  }).join(', ');
  // 创建房间
  const roomId = 'group_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  // 保存到 session 跳转
  req.session.groupRoom = { id: roomId, name: name, members: all };
  res.redirect('/chat/group/' + roomId);
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
            res.render('shop_manage', { shop, products, orders: orders || [], warehouses: whs || [], images: images || [], shopWarning, warningUntil: shop.warning_until });
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
    db.run('INSERT INTO products (shop_id, name, price, stock, shipping_policy) VALUES (?, ?, ?, ?, ?)', [shop.id, name, price, stock, parseInt(req.body.shipping_policy) || 0], (err) => {
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
                res.render('admin_dashboard', {
                  user: req.session.user,
                  userCount: u?.n || 0,
                  productCount: p?.n || 0,
                  orderCount: o?.n || 0,
                  pendingReports: r?.n || 0,
                  pendingAppeals: ap?.n || 0,
                  todayUV: uv?.n || 0,
                  todayPV: pv?.n || 0
                });
              });
            });
          });
        });
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
  const { product_id, flash_price, stock, start_time, end_time } = req.body;
  db.run('INSERT INTO flash_sales (product_id, flash_price, stock, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
    [product_id, flash_price, stock, start_time, end_time], () => res.redirect('/admin/flash'));
});

app.post('/admin/flash/delete/:id', isAdmin, (req, res) => {
  db.run('DELETE FROM flash_sales WHERE id = ?', [req.params.id], () => res.redirect('/admin/flash'));
});
app.get('/admin/products/add', (req, res) => res.render('admin_product_form', { product: null, action: '/admin/products/add' }));
app.post('/admin/products/add', (req, res) => {
  const n = sanitize(req.body.name || ''), p = parseFloat(req.body.price);
  if (!n || isNaN(p) || p < 1) return res.status(400).send('价格最低1元');
  db.run('INSERT INTO products (shop_id, name, price) VALUES (0, ?, ?)', [n, p], (err) => res.redirect('/admin/products'));
});
app.get('/admin/products/edit/:id', (req, res) => db.get('SELECT * FROM products WHERE id = ?', [req.params.id], (err, p) => res.render('admin_product_form', { product: p, action: '/admin/products/edit/' + req.params.id })));
app.post('/admin/products/edit/:id', (req, res) => {
  const n = sanitize(req.body.name || ''), p = parseFloat(req.body.price);
  if (!n || isNaN(p) || p < 1) return res.status(400).send('价格最低1元');
  db.run('UPDATE products SET name = ?, price = ? WHERE id = ?', [n, p, req.params.id], (err) => res.redirect('/admin/products'));
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
        onlineUsers.set(socket.id, { id: user.id, username: user.username });
        allConnections.set(socket.id, { id: user.id, username: user.username, page: user.page || '未知', ip: socket.handshake.address });
        io.emit('onlineUsers', Array.from(allConnections.values()).map(u => ({ id: u.id, username: u.username, page: u.page })));
        broadcastOnlineCount();
      }
    });

    socket.on('privateMsg', (data) => {
      const { to, message } = data;
      const fromUser = onlineUsers.get(socket.id);
      if (!fromUser) return;
      const msg = sanitize(message).substring(0, 500);
      if (!msg) return;
      db.run('INSERT INTO private_messages (from_user, to_user, message, time) VALUES (?, ?, ?, ?)', [fromUser.id, to, msg, new Date().toLocaleTimeString()], (err) => {
        if (err) {
          console.error('保存私信失败:', err);
          socket.emit('error', '发送消息失败，请重试');
          return;
        }
        for (let [sid, user] of onlineUsers) {
          if (user.id == to) {
            io.to(sid).emit('privateMsg', { from: fromUser.username, message: msg, time: new Date().toLocaleTimeString() });
            break;
          }
        }
      });
    });

    socket.on('disconnect', () => {
      onlineUsers.delete(socket.id);
      allConnections.delete(socket.id);
      io.emit('onlineUsers', Array.from(allConnections.values()).map(u => ({ id: u.id, username: u.username, page: u.page })));
      broadcastOnlineCount();
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
  const oid = req.params.id;
  db.get(`SELECT s.*, o.user_id, o.price, p.name as product_name 
    FROM shipments s JOIN orders o ON s.order_id = o.id 
    JOIN products p ON o.product_id = p.id 
    WHERE s.order_id = ?`, [oid], (err, ship) => {
    if (err || !ship) return res.status(404).send('物流信息不存在');
    if (ship.user_id !== req.session.user.id && !req.session.user.isAdmin) return res.status(403).send('无权查看');
    const now = new Date();
    const deliverAt = new Date(ship.deliver_at);
    const remainMs = deliverAt - now;
    const remainHours = remainMs > 0 ? Math.max(0, Math.floor(remainMs / 3600000)) : 0;
    const remainMinutes = remainMs > 0 ? Math.max(0, Math.floor((remainMs % 3600000) / 60000)) : 0;
    const isDelivered = remainMs <= 0 && ship.status === 'shipped';
    if (isDelivered) {
      db.run('UPDATE shipments SET status = ? WHERE id = ?', ['delivered', ship.id]);
      ship.status = 'delivered';
    }
    res.render('track', { ship, remainHours, remainMinutes, isDelivered, isAdmin: !!req.session.user.isAdmin });
  });
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