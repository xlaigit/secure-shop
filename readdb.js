const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
// 完整绝对路径，数据库文件名 shop.db
const DB_FILE = "D:\\肖宇帆\\HTML项目\\data\\shop.db";

// 判断文件是否存在，防止自动新建空白0kb数据库
if (!fs.existsSync(DB_FILE)) {
    console.error(`❌ 找不到数据库文件：${DB_FILE}`);
    console.log("检查data文件夹内是否存在shop.db");
    process.exit(1);
}

// 只读模式打开，不会修改数据库
const db = new sqlite3.Database(DB_FILE, sqlite3.OPEN_READONLY, err => {
    if (err) {
        console.error("❌ 数据库打开失败：", err.message);
        process.exit();
    }
    console.log("✅ 成功以只读模式连接 shop.db");
});

// 全字段中文翻译对照表
const fieldDict = {
    id:"序号ID",order_id:"订单编号",warehouse_id:"仓库ID",carrier:"快递公司",speed:"配送档次",
    tracking_number:"物流单号",weight:"重量",estimate_hours:"预计配送小时",shipped_at:"发货时间",
    deliver_at:"预计送达时间",status:"状态",signed_at:"签收时间",return_reason:"退回原因",shipping_fee:"运费",
    shop_id:"店铺ID",name:"名称",address:"地址",city:"城市",created_at:"创建时间",update_time:"更新时间",
    user_id:"用户ID",appeal_type:"申诉类型",content:"内容",admin_reply:"管理员回复",title:"标题",
    type:"消息类型",is_read:"是否已读(0否1是)",reporter_id:"举报人ID",target_type:"举报目标类型",
    target_id:"目标编号",target_name:"目标名称",reason:"原因",description:"详细描述",admin_note:"管理员备注",
    action_taken:"处理结果",product_id:"商品ID",rating:"评分",comment:"评价文字",owner_id:"店主ID",
    is_banned:"是否封禁",warning_until:"警告截止时间",from_user:"发送人ID",to_user:"接收人ID",
    message:"消息内容",time:"消息时间",friend_id:"好友ID",username:"用户名",password:"密码bcrypt哈希",
    balance:"账户余额",is_admin:"是否管理员",avatar:"头像地址",ban_until:"封禁截止时间",online:"是否在线",
    price:"价格",stock:"库存",dir_id:"父文件夹ID",file_name:"文件名",file_path:"服务器文件路径",
    file_size:"文件大小",mime_type:"文件类型",enc_key:"加密后的AES文件密钥",enc_iv:"AES CBC向量IV",
    dir_name:"文件夹名称",parent_dir_id:"上级文件夹ID"
};

// 获取全部数据表循环打印
db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
    if (err) {
        console.error("读取表列表失败：", err);
        db.close();
        return;
    }
    let index = 0;
    function readNextTable() {
        if (index >= tables.length) {
            db.close();
            console.log("\n✅ 全部数据表查询完成，数据库已关闭");
            return;
        }
        const tableName = tables[index].name;
        index++;
        console.log("\n========================================");
        console.log(`【数据表：${tableName}】`);
        db.all(`SELECT * FROM [${tableName}]`, [], (err, rows) => {
            if (err) {
                console.log(`读取${tableName}失败：`, err.message);
                readNextTable();
                return;
            }
            if (rows.length === 0) {
                console.log("（本表无任何数据）");
                readNextTable();
                return;
            }
            // 字段自动翻译成中文输出
            rows.forEach(row => {
                const translateRow = {};
                for (const key in row) {
                    translateRow[fieldDict[key] ?? key] = row[key];
                }
                console.log(translateRow);
            });
            readNextTable();
        });
    }
    readNextTable();
})