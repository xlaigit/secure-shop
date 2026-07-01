const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const db = new sqlite3.Database('./data/shop.db');

// 汉化映射表
const TABLE_NAMES = {
  users: '用户',
  products: '商品',
  orders: '订单',
  friends: '好友',
  private_messages: '私信',
  shops: '店铺',
  reviews: '评价',
  reports: '举报',
  notifications: '通知',
  appeals: '申诉',
  sqlite_sequence: '序列号'
};

const FIELD_NAMES = {
  id: 'ID',
  username: '用户名',
  password: '密码(哈希)',
  balance: '余额',
  is_admin: '管理员',
  avatar: '头像',
  is_banned: '已封禁',
  reputation: '信誉分',
  warning_until: '警告截止',
  ban_until: '封禁截止',
  online: '在线',
  shop_id: '店铺ID',
  name: '名称',
  price: '价格',
  stock: '库存',
  user_id: '用户ID',
  product_id: '商品ID',
  created_at: '创建时间',
  friend_id: '好友ID',
  status: '状态',
  from_user: '发送者',
  to_user: '消息',
  message: '内容',
  time: '时间',
  owner_id: '所有者ID',
  description: '描述',
  rating: '评分',
  comment: '评论',
  reporter_id: '举报人ID',
  target_type: '目标类型',
  target_id: '目标ID',
  target_name: '目标名称',
  reason: '原因',
  admin_note: '管理员备注',
  action_taken: '处理措施',
  title: '标题',
  content: '内容',
  type: '类型',
  is_read: '已读',
  appeal_type: '申诉类型',
  admin_reply: '管理员回复'
};

const STATUS_MAP = {
  pending: '待处理',
  accepted: '已通过',
  rejected: '已驳回',
  resolved: '已处理',
  ban: '封禁',
  warning: '警告',
  info: '信息',
  report: '举报',
  appeal: '申诉'
};

function translateRow(table, row) {
  const newRow = {};
  for (const key in row) {
    const chineseKey = FIELD_NAMES[key] || key;
    let value = row[key];
    // 翻译状态
    if (key === 'status' && STATUS_MAP[value]) {
      value = STATUS_MAP[value];
    } else if (key === 'type' && STATUS_MAP[value]) {
      value = STATUS_MAP[value];
    } else if (key === 'is_admin' || key === 'is_banned' || key === 'online' || key === 'is_read') {
      value = value === 1 ? '是' : '否';
    } else if (key === 'appeal_type') {
      const typeMap = { ban: '账号封禁', shop_ban: '店铺封禁', warning: '警告', other: '其他' };
      value = typeMap[value] || value;
    }
    newRow[chineseKey] = value;
  }
  return newRow;
}

let html = `<html><head><meta charset="UTF-8"><title>数据库报告</title>
<style>body{font-family:Arial;margin:20px}h2{color:#333}table{border-collapse:collapse;width:100%;margin-bottom:30px}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#4CAF50;color:white}tr:nth-child(even){background:#f2f2f2}</style></head><body>`;

db.serialize(() => {
  db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (err, tables) => {
    if (err) throw err;
    let count = 0;
    tables.forEach(t => {
      const tableName = t.name;
      if (tableName === 'sqlite_sequence') return; // 跳过
      const chineseName = TABLE_NAMES[tableName] || tableName;
      db.all(`SELECT * FROM ${tableName}`, (err, rows) => {
        if (err) throw err;
        console.log(`\n========== ${chineseName}（${tableName}）==========`);
        
        // 生成HTML
        html += `<h2>${chineseName}（${tableName}）</h2>`;
        if (rows.length === 0) {
          html += '<p>无数据</p>';
          return;
        }
        const sample = translateRow(tableName, rows[0]);
        const headers = Object.keys(sample);
        html += '<table><tr>';
        headers.forEach(h => html += `<th>${h}</th>`);
        html += '</tr>';
        
        rows.forEach(row => {
          const translated = translateRow(tableName, row);
          console.log(JSON.stringify(translated, null, 2));
          html += '<tr>';
          headers.forEach(h => html += `<td>${translated[h]}</td>`);
          html += '</tr>';
        });
        html += '</table>';
        
        count++;
        if (count === tables.length - 1) { // 减去 sqlite_sequence
          html += '</body></html>';
          fs.writeFileSync('数据库报告.html', html);
          console.log('\n✅ 汉化报告已生成：数据库报告.html');
        }
      });
    });
  });
});