const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const ENCRYPTION_KEY = 'my-secret-key-32chars!!';
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

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
    avatar TEXT DEFAULT ''
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    price REAL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    product_id INTEGER,
    price REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.get(`SELECT COUNT(*) as count FROM products`, (err, row) => {
    if (row && row.count === 0) {
      const stmt = db.prepare(`INSERT INTO products (name, price) VALUES (?, ?)`);
      stmt.run('笔记本电脑', 2999.0);
      stmt.run('无线耳机', 199.0);
      stmt.run('机械键盘', 399.0);
      stmt.finalize();
    }
  });

  const adminPassword = bcrypt.hashSync('admin123', 12);
  db.run(`INSERT OR IGNORE INTO users (username, password, balance, is_admin) VALUES (?, ?, 0.0, 1)`, ['admin', adminPassword]);
});

module.exports = { db, encrypt, decrypt };