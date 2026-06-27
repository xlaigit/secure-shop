const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const csurf = require('csurf');
const bcrypt = require('bcrypt');
const validator = require('validator');
const { v4: uuidv4 } = require('uuid');
const { db } = require('./database');
const multer = require('multer');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');

const app = express();
app.use(express.static('public'));

app.use((req, res, next) => {
  const blocked = ['.db', '.env', '.git', 'node_modules', 'package.json', 'server.js', 'database.js'];
  if (blocked.some(ext => req.path.includes(ext))) return res.status(404).send('Not Found');
  next();
});

app.use(helmet());
app.use(helmet.contentSecurityPolicy({ directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'"] } }));

// 全局限流 - WAF白名单
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1'
});
app.use(globalLimiter);

const loginLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10, message: '登录尝试过多，请5分钟后再试' });
const adminLoginLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 5, message: '后台登录尝试过多，请1分钟后再试' });

const storage = multer.diskStorage({ destination: 'public/uploads/', filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname) });
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(session({ secret: 'change-this', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'strict', secure: false } }));

const csrfProtection = csurf({ cookie: false });
app.use(csrfProtection);
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
  res.locals.user = req.session.user || null;
  next();
});

app.set('view engine', 'ejs');

function sanitize(str) { return typeof str === 'string' ? validator.escape(validator.trim(str)) : ''; }

function isAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  db.get('SELECT balance FROM users WHERE id = ?', [req.session.user.id], (err, row) => {
    if (err || !row) { req.session.destroy(); return res.redirect('/login'); }
    req.session.user.balance = row.balance;
    next();
  });
}

function isAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.isAdmin) return res.status(403).send('无权访问');
  next();
}

// ========== 前台 ==========
app.get('/', (req, res) => res.redirect('/shop'));
app.get('/register', (req, res) => res.render('register'));
app.post('/register', (req, res) => {
  const u = sanitize(req.body.username || ''), p = req.body.password || '';
  if (!validator.isLength(u, { min: 3, max: 20 }) || !validator.isAlphanumeric(u)) return res.status(400).send('用户名须为3-20位字母数字');
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
        req.session.user = { id: user.id, username: user.username, balance: user.balance, isAdmin: !!user.is_admin };
        return res.redirect(user.is_admin ? '/admin/dashboard' : '/shop');
      }
      res.status(401).send('用户名或密码错误');
    });
  });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });
app.get('/shop', isAuth, (req, res) => db.all('SELECT * FROM products', (err, products) => res.render('shop', { products, balance: req.session.user.balance })));

app.post('/buy', isAuth, (req, res) => {
  const pid = req.body.product_id;
  if (!validator.isInt(pid)) return res.status(400).send('非法商品ID');
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.get('SELECT * FROM products WHERE id = ?', [pid], (err, product) => {
      if (err || !product) { db.run('ROLLBACK'); return res.status(404).send('商品不存在'); }
      db.get('SELECT balance FROM users WHERE id = ?', [req.session.user.id], (err, user) => {
        if (err || !user || user.balance < product.price) { db.run('ROLLBACK'); return res.status(400).send('余额不足'); }
        const nb = user.balance - product.price;
        db.run('UPDATE users SET balance = ? WHERE id = ?', [nb, req.session.user.id], (err) => {
          if (err) { db.run('ROLLBACK'); return res.status(500).send('扣款失败'); }
          const oid = uuidv4();
          db.run('INSERT INTO orders (id, user_id, product_id, price) VALUES (?, ?, ?, ?)', [oid, req.session.user.id, pid, product.price], (err) => {
            if (err) { db.run('ROLLBACK'); return res.status(500).send('订单失败'); }
            db.run('COMMIT');
            req.session.user.balance = nb;
            res.redirect('/orders');
          });
        });
      });
    });
  });
});

app.get('/orders', isAuth, (req, res) => {
  db.all('SELECT orders.id, products.name as product_name, orders.price, orders.created_at FROM orders JOIN products ON orders.product_id = products.id WHERE orders.user_id = ? ORDER BY orders.created_at DESC', [req.session.user.id], (err, rows) => res.render('orders', { orders: rows, balance: req.session.user.balance }));
});

app.get('/profile', isAuth, (req, res) => res.render('profile', { msg: null }));
app.post('/upload', isAuth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.render('profile', { msg: '上传失败' });
  db.run('UPDATE users SET avatar = ? WHERE id = ?', ['/uploads/' + req.file.filename, req.session.user.id], (err) => res.render('profile', { msg: err ? '保存失败' : '头像更新成功！' }));
});
app.post('/upload-url', isAuth, (req, res) => {
  const imageUrl = req.body.imageUrl;
  if (!imageUrl) return res.render('profile', { msg: '请输入URL' });
  try {
    const urlObj = new URL(imageUrl);
    const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254', '10.', '172.16.', '192.168.'];
    if (blocked.some(h => urlObj.hostname.includes(h))) return res.render('profile', { msg: '内网地址被拦截' });
  } catch(e) { return res.render('profile', { msg: 'URL格式错误' }); }
  const fname = Date.now() + '.jpg';
  const protocol = imageUrl.startsWith('https') ? https : http;
  protocol.get(imageUrl, (response) => {
    response.pipe(fs.createWriteStream('public/uploads/' + fname)).on('finish', () => {
      db.run('UPDATE users SET avatar = ? WHERE id = ?', ['/uploads/' + fname, req.session.user.id], (err) => res.render('profile', { msg: '头像URL上传成功！' }));
    });
  }).on('error', (err) => res.render('profile', { msg: '下载失败：' + err.message }));
});

// ========== 后台 ==========
app.get('/admin/login', (req, res) => res.render('admin_login', { error: null }));
app.post('/admin/login', adminLoginLimiter, (req, res) => {
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

app.use('/admin', isAdmin);

app.get('/admin/dashboard', (req, res) => res.render('admin_dashboard'));
app.get('/admin/products', (req, res) => db.all('SELECT * FROM products', (err, products) => res.render('admin_products', { products })));
app.get('/admin/products/add', (req, res) => res.render('admin_product_form', { product: null, action: '/admin/products/add' }));
app.post('/admin/products/add', (req, res) => {
  const n = sanitize(req.body.name || ''), p = parseFloat(req.body.price);
  if (!n || isNaN(p) || p < 1) return res.status(400).send('价格最低1元');
  db.run('INSERT INTO products (name, price) VALUES (?, ?)', [n, p], (err) => res.redirect('/admin/products'));
});
app.get('/admin/products/edit/:id', (req, res) => db.get('SELECT * FROM products WHERE id = ?', [req.params.id], (err, p) => res.render('admin_product_form', { product: p, action: '/admin/products/edit/' + req.params.id })));
app.post('/admin/products/edit/:id', (req, res) => {
  const n = sanitize(req.body.name || ''), p = parseFloat(req.body.price);
  if (!n || isNaN(p) || p < 1) return res.status(400).send('价格最低1元');
  db.run('UPDATE products SET name = ?, price = ? WHERE id = ?', [n, p, req.params.id], (err) => res.redirect('/admin/products'));
});
app.post('/admin/products/delete/:id', (req, res) => db.run('DELETE FROM products WHERE id = ?', [req.params.id], (err) => res.redirect('/admin/products')));
app.get('/admin/orders', (req, res) => db.all('SELECT orders.id, users.username, products.name as product_name, orders.price, orders.created_at FROM orders JOIN users ON orders.user_id = users.id JOIN products ON orders.product_id = products.id ORDER BY orders.created_at DESC', (err, rows) => res.render('admin_orders', { orders: rows })));

app.get('/admin/users', (req, res) => db.all('SELECT id, username, balance, is_admin FROM users', (err, users) => res.render('admin_users', { users })));
app.post('/admin/users/balance/:id', (req, res) => {
  const bal = parseFloat(req.body.balance);
  if (isNaN(bal) || bal < 0) return res.status(400).send('余额不合法');
  db.run('UPDATE users SET balance = ? WHERE id = ?', [bal, req.params.id], (err) => res.redirect('/admin/users'));
});
app.post('/admin/users/delete/:id', (req, res) => {
  if (req.params.id == req.session.user.id) return res.status(400).send('不能注销自己');
  db.get('SELECT is_admin FROM users WHERE id = ?', [req.params.id], (err, user) => {
    if (err || !user) return res.status(404).send('用户不存在');
    if (user.is_admin) return res.status(400).send('不能删除管理员');
    db.run('DELETE FROM users WHERE id = ?', [req.params.id], (err) => res.redirect('/admin/users'));
  });
});

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') return res.status(403).send('表单已过期，请刷新重试');
  res.status(500).send('服务器内部错误');
});

app.listen(3000, () => console.log('http://localhost:3000\n后台: /admin/login\nadmin / admin123'));