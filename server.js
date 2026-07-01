const express = require('express');
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

const app = express();
app.set('trust proxy', 1);
const httpServer = http.createServer(app);
const io = socketio(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(express.static('public'));
app.use(helmet({ contentSecurityPolicy: false }));

// 登录与注册限流
const loginLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 20 });
const registerLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10 });

// 服务器启动时重置所有用户为离线状态
db.run('UPDATE users SET online = 0');

// 在线用户列表
const onlineUsers = new Map();
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
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
const chatUpload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

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
  secret: 'change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: false }
}));

const csrfProtection = csurf({ cookie: false });
app.use((req, res, next) => {
  if (['/chat/upload', '/upload', '/appeal'].includes(req.path) || req.path.startsWith('/refund/apply') || req.path.startsWith('/admin/refunds/')) return next();
  csrfProtection(req, res, next);
});
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
  res.locals.user = req.session.user || null;
  next();
});

app.set('view engine', 'ejs');

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

app.get('/shop', isAuth, (req, res) => {
  db.all(`SELECT p.*, s.name as shop_name, s.warning_until as shop_warning,
    (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id) as avg_rating,
    (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id) as review_count
    FROM products p LEFT JOIN shops s ON p.shop_id = s.id WHERE p.shop_id = 0 OR (s.is_banned = 0 AND (s.warning_until IS NULL OR s.warning_until = '')) ORDER BY p.shop_id = 0, p.id`, (err, products) => {
    if (err) return res.status(500).send('服务器错误');
    res.render('shop', { products, balance: req.session.user.balance, warningActive: req.session.user.warningActive, warningUntil: req.session.user.warningUntil });
  });
});

app.post('/buy', isAuth, (req, res) => {
  const pid = req.body.product_id;
  if (!validator.isInt(pid)) return res.status(400).send('非法商品ID');
  
  db.get('SELECT p.*, s.owner_id FROM products p LEFT JOIN shops s ON p.shop_id = s.id WHERE p.id = ?', [pid], (err, product) => {
    if (err || !product) return res.status(404).send('商品不存在');
    if (product.stock <= 0) return res.status(400).send('库存不足');
    
    db.get('SELECT balance FROM users WHERE id = ?', [req.session.user.id], (err, user) => {
      if (err || !user || user.balance < product.price) return res.status(400).send('余额不足');
      
      const nb = user.balance - product.price;
      const taxRate = 0.05; // 5%的税率
      const tax = Math.round(product.price * taxRate * 100) / 100;
      const amountToSeller = Math.round((product.price - tax) * 100) / 100;
      
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // 扣除用户余额
        db.run('UPDATE users SET balance = ? WHERE id = ?', [nb, req.session.user.id], (err) => {
          if (err) { db.run('ROLLBACK'); return res.status(500).send('扣款失败'); }
        });
        
        // 如果商品属于店铺，给商家打款
        if (product.shop_id > 0 && product.owner_id) {
          db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amountToSeller, product.owner_id], (err) => {
            if (err) { db.run('ROLLBACK'); return res.status(500).send('打款失败'); }
          });
        }
        
        // 更新商品库存
        db.run('UPDATE products SET stock = stock - 1 WHERE id = ?', [pid], (err) => {
          if (err) { db.run('ROLLBACK'); return res.status(500).send('更新库存失败'); }
        });
        
        // 创建订单（使用原有的订单字段，避免表结构修改）
        const oid = uuidv4();
        db.run('INSERT INTO orders (id, user_id, product_id, price) VALUES (?, ?, ?, ?)', 
          [oid, req.session.user.id, pid, product.price], (err) => {
          if (err) { db.run('ROLLBACK'); return res.status(500).send('创建订单失败'); }
          
          // 如果需要记录税款，可以创建单独的交易记录表
          if (product.shop_id > 0 && product.owner_id) {
            db.run('INSERT INTO transactions (order_id, from_user_id, to_user_id, amount, tax) VALUES (?, ?, ?, ?, ?)', 
              [oid, req.session.user.id, product.owner_id, amountToSeller, tax], (err) => {
              if (err) console.error('记录交易失败:', err);
            });
          }
          
          db.run('COMMIT');
          req.session.user.balance = nb;
          res.redirect('/orders');
        });
      });
    });
  });
});

app.get('/orders', isAuth, (req, res) => {
  db.all('SELECT orders.id, orders.product_id, products.name as product_name, orders.price, orders.created_at, orders.status FROM orders JOIN products ON orders.product_id = products.id WHERE orders.user_id = ? ORDER BY orders.created_at DESC', [req.session.user.id], (err, rows) => {
    if (err) return res.status(500).send('服务器错误');
    res.render('orders', { orders: rows, warningActive: req.session.user.warningActive, warningUntil: req.session.user.warningUntil });
  });
});

// 账单功能
app.get('/billing', isAuth, (req, res) => {
  // 获取用户的所有交易记录（订单+退款）
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
    
    // 计算统计信息
    const stats = {
      totalOrders: 0,
      totalSpent: 0,
      totalRefunds: 0,
      refundedAmount: 0
    };
    
    transactions.forEach(t => {
      if (t.type === 'order') {
        stats.totalOrders++;
        stats.totalSpent += parseFloat(t.amount);
      } else if (t.type === 'refund' && t.status === 'approved') {
        stats.totalRefunds++;
        stats.refundedAmount += parseFloat(t.amount);
      }
    });
    
    res.render('billing', { transactions, stats });
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

app.get('/profile', isAuth, (req, res) => res.render('profile', { msg: null }));
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
    db.all('SELECT * FROM products WHERE shop_id = ?', [shop.id], (err, products) => {
      res.render('shop_manage', { shop, products, shopWarning, warningUntil: shop.warning_until });
    });
  });
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
    db.run('INSERT INTO products (shop_id, name, price, stock) VALUES (?, ?, ?, ?)', [shop.id, name, price, stock], (err) => {
      if (err) return res.status(500).send('添加失败');
      res.redirect('/shop/manage');
    });
  });
});

app.post('/shop/product/delete/:id', isAuth, (req, res) => {
  db.get('SELECT id FROM shops WHERE owner_id = ?', [req.session.user.id], (err, shop) => {
    if (err || !shop) return res.status(400).send('无权限');
    db.run('DELETE FROM products WHERE id = ? AND shop_id = ?', [req.params.id, shop.id], (err) => {
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
      db.all('SELECT reviews.*, users.username FROM reviews JOIN users ON reviews.user_id = users.id WHERE product_id = ? ORDER BY created_at DESC', [req.params.productId], (err, reviews) => {
        res.render('reviews', { product, reviews });
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
      if (ok) { req.session.user = { id: admin.id, username: admin.username, isAdmin: true }; return res.redirect('/admin/dashboard'); }
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
  db.get('SELECT COUNT(*) AS n FROM users', (err1, u) => {
    db.get('SELECT COUNT(*) AS n FROM products', (err2, p) => {
      db.get('SELECT COUNT(*) AS n FROM orders', (err3, o) => {
        db.get("SELECT COUNT(*) AS n FROM reports WHERE status = 'pending'", (err4, r) => {
          db.get("SELECT COUNT(*) AS n FROM appeals WHERE status = 'pending' OR status IS NULL", (err5, ap) => {
            res.render('admin_dashboard', {
              user: req.session.user,
              userCount: u?.n || 0,
              productCount: p?.n || 0,
              orderCount: o?.n || 0,
              pendingReports: r?.n || 0,
              pendingAppeals: ap?.n || 0
            });
          });
        });
      });
    });
  });
});

app.get('/admin/products', (req, res) => db.all('SELECT * FROM products', (err, products) => res.render('admin_products', { products })));
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

// 初始化退款表（首次运行时执行）
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
  io.on('connection', (socket) => {
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
        io.emit('onlineUsers', Array.from(onlineUsers.values()));
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
      io.emit('onlineUsers', Array.from(onlineUsers.values()));
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

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.code === 'EBADCSRFTOKEN') return res.status(403).send('表单已过期，请刷新重试');
  console.error(err);
  res.status(500).send('服务器内部错误');
});

httpServer.listen(3000, () => {
  console.log('http://localhost:3000');
}).on('error', (err) => {
  console.error('服务器启动失败:', err);
  process.exit(1);
});