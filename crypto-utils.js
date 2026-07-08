const crypto = require('crypto');
const fs = require('fs');

const ENC_GLOBAL_SALT = Buffer.from('CLOUDDISK_SECURE_SALT_2024', 'utf8');
const ENC_ALGO = 'aes-256-gcm';
const ENC_MAGIC = 'CLOUDENV2';
const ENC_VERSION = 1;
const PBKDF2_ITERATIONS = 600000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';
const HDR_MIN_SIZE = 40;

function parseEncFileHeader(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (stat.size < HDR_MIN_SIZE) return { valid: false, reason: '文件太小' };
  const fd = fs.openSync(filePath, 'r');
  const hdr = Buffer.alloc(HDR_MIN_SIZE);
  fs.readSync(fd, hdr, 0, HDR_MIN_SIZE, 0);
  fs.closeSync(fd);
  if (hdr.toString('utf8', 0, 8) !== ENC_MAGIC) return { valid: false, reason: '不是加密文件' };
  const version = hdr.readUInt16BE(8);
  const ivLen = hdr.readUInt8(10);
  const tagLen = hdr.readUInt8(11);
  if (ivLen !== 12 || tagLen !== 16) return { valid: false, reason: 'IV/Tag长度异常' };
  return { valid: true, version, iv: hdr.slice(12, 24), tag: hdr.slice(24, 40), cipherStart: 40 };
}

function deriveAesKey(userPassword, userSaltHex) {
  const userSalt = Buffer.from(userSaltHex || crypto.randomBytes(16).toString('hex'), 'hex');
  return crypto.pbkdf2Sync(userPassword, Buffer.concat([ENC_GLOBAL_SALT, userSalt]), PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
}

function encryptFileStream(inputPath, outputPath, aesKey) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) return reject(new Error('输入文件不存在'));
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ENC_ALGO, aesKey, iv);
    const input = fs.createReadStream(inputPath);
    const output = fs.createWriteStream(outputPath);
    const hdr = Buffer.alloc(40);
    hdr.write(ENC_MAGIC, 0, 8, 'utf8');
    hdr.writeUInt16BE(ENC_VERSION, 8);
    hdr.writeUInt8(12, 10);
    hdr.writeUInt8(16, 11);
    iv.copy(hdr, 12);
    output.write(hdr);
    let encSize = 0;
    cipher.on('data', chunk => { encSize += chunk.length; });
    input.pipe(cipher).pipe(output);
    cipher.on('final', () => {
      const tag = cipher.getAuthTag();
      tag.copy(hdr, 24);
      const fd = fs.openSync(outputPath, 'r+');
      fs.writeSync(fd, hdr, 24, 16, 24);
      fs.closeSync(fd);
      resolve({ encSize });
    });
    function cleanup() { try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch(e) {} }
    output.on('error', err => { cleanup(); reject(err); });
    input.on('error', err => { cleanup(); reject(err); });
    cipher.on('error', err => { cleanup(); reject(err); });
  });
}

function decryptToStream(filePath, aesKey, outStream) {
  return new Promise((resolve, reject) => {
    const hdr = parseEncFileHeader(filePath);
    if (!hdr || !hdr.valid) return reject(new Error('文件头验证失败: ' + (hdr ? hdr.reason : '未知')));
    const decipher = crypto.createDecipheriv(ENC_ALGO, aesKey, hdr.iv);
    decipher.setAuthTag(hdr.tag);
    const input = fs.createReadStream(filePath, { start: hdr.cipherStart, highWaterMark: 256 * 1024 });
    input.pipe(decipher).pipe(outStream);
    outStream.on('finish', resolve);
    outStream.on('error', reject);
    input.on('error', reject);
    decipher.on('error', err => reject(new Error('解密失败(密钥错误或文件被篡改): ' + err.message)));
  });
}

function decryptToBuffer(filePath, aesKey) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    decryptToStream(filePath, aesKey, { write(chunk, enc, cb) { chunks.push(chunk); total += chunk.length; cb(); }, end() { resolve(Buffer.concat(chunks, total)); } }).catch(reject);
  });
}

function decryptText(filePath, aesKey) {
  return decryptToBuffer(filePath, aesKey).then(buf => buf.toString('utf-8'));
}

module.exports = { ENC_MAGIC, ENC_ALGO, ENC_VERSION, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST, ENC_GLOBAL_SALT, HDR_MIN_SIZE, parseEncFileHeader, deriveAesKey, encryptFileStream, decryptToStream, decryptToBuffer, decryptText };