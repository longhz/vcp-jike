/**
 * jike-setup.js - 即刻账号扫码登录工具
 * 
 * 用法: node jike-setup.js
 * 
 * 首次使用需要扫码登录，之后 token 保存在 tokens.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

const PLUGIN_DIR = __dirname;
const TOKENS_PATH = path.join(PLUGIN_DIR, 'tokens.json');
const API_BASE = 'https://api.ruguoapp.com';
const WEB_ORIGIN = 'https://web.okjike.com';

const log = (...args) => console.error('[jike-setup]', new Date().toISOString(), ...args);

const expandPath = (p) => p.replace(/^~/, process.env.HOME || '/root');

const ensureDir = (filePath) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const jikeRequest = (options, body = null) => {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path, API_BASE);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Origin': WEB_ORIGIN,
        'Referer': WEB_ORIGIN + '/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        ...options.headers,
      },
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
};

const saveTokens = (tokens) => {
  ensureDir(expandPath(TOKENS_PATH));
  fs.writeFileSync(expandPath(TOKENS_PATH), JSON.stringify(tokens, null, 2));
  log('Token 已保存到:', expandPath(TOKENS_PATH));
};

const loadTokens = () => {
  try {
    const content = fs.readFileSync(expandPath(TOKENS_PATH), 'utf-8');
    return JSON.parse(content);
  } catch { return null; }
};

// 获取当前用户（检查登录态）
const checkCurrentUser = async () => {
  const tokens = loadTokens();
  if (!tokens || !tokens.access_token) return null;
  try {
    const res = await jikeRequest({
      method: 'GET',
      path: '/1.0/users/profile?username=',
      headers: { 'x-jike-access-token': tokens.access_token },
    });
    const user = res.data?.user;
    if (user?.username) {
      return { username: user.username, nickname: user.nickname || user.screenName };
    }
  } catch {}
  return null;
};

// 1. 创建 session，获取二维码 UUID
const createSession = async () => {
  const res = await jikeRequest({ method: 'POST', path: '/sessions.create' });
  if (res.status !== 200 || !res.data?.uuid) {
    throw new Error('获取二维码失败: ' + JSON.stringify(res.data));
  }
  return res.data.uuid;
};

// 2. 生成二维码图片 URL
const getQRUrl = (uuid) =>
  `https://www.okjike.com/account/scan?uuid=${uuid}`;

// 3. 生成二维码图片并显示
const displayQRCode = (url) => {
  const imgPath = path.join(PLUGIN_DIR, 'qrcode.png');
  const pyScript = path.join(PLUGIN_DIR, '_qr_gen.py');
  // 写入临时脚本（避免 shell 转义问题）
  fs.writeFileSync(pyScript, `import qrcode\nimg = qrcode.make(${JSON.stringify(url)})\nimg.save(${JSON.stringify(imgPath)})\n`);
  execSync(`python3 ${pyScript}`, { cwd: PLUGIN_DIR });
  fs.unlinkSync(pyScript); // 清理

  // 用 base64 打印到终端（部分终端可显示）
  const buf = fs.readFileSync(imgPath);
  const b64 = buf.toString('base64');
  const lines = [];
  for (let i = 0; i < b64.length; i += 256) {
    lines.push(b64.slice(i, i + 256));
  }
  console.log('\n  二维码图片已生成: ' + imgPath);
  console.log('  终端显示有限，请用上方链接或直接扫描该图片\n');
  lines.forEach(l => console.log('  ' + l));
  console.log('\n');
};

// 5. 轮询等待扫码确认
// 二维码有效期约 30 秒，5s 间隔最多 6 次（30s）
const waitForConfirmation = async (uuid) => {
  const maxAttempts = 6;
  for (let i = 0; i < maxAttempts; i++) {
    // 等待 5 秒（首次等待让二维码有充分时间展示）
    await new Promise(r => setTimeout(r, 5000));

    const res = await jikeRequest({
      method: 'GET',
      path: `/sessions.wait_for_confirmation?uuid=${uuid}`,
    });

    if (res.status === 200 && res.data?.confirmed && res.data['x-jike-access-token']) {
      return {
        access_token: res.data['x-jike-access-token'],
        refresh_token: res.data['x-jike-refresh-token'] || '',
      };
    }
    if (res.status === 404) {
      throw new Error('二维码已过期（30秒内未扫码），请重新运行。');
    }

    log(`等待扫码中... (${(i + 1) * 5}s / ${maxAttempts * 5}s) 二维码约 30 秒过期`);
  }
  throw new Error('扫码超时，请重新运行。');
};

const main = async () => {
  log('即刻账号登录工具启动...');

  // 检查已登录
  const current = await checkCurrentUser();
  if (current) {
    log(`当前已登录: ${current.nickname || current.username} (@${current.username})`);
    log('如需重新登录，请先删除 tokens.json');
    log('路径:', expandPath(TOKENS_PATH));
    process.exit(0);
  }

  log('未登录，开始扫码登录...');

  // 1. 获取二维码
  log('请求二维码...');
  const uuid = await createSession();
  log(`二维码 UUID: ${uuid}`);

  console.log('\n========================================');
  console.log('  即刻扫码登录');
  console.log('========================================');
  console.log('  请用即刻 App 扫码，或点击链接确认：');
  console.log('');
  console.log('  ' + getQRUrl(uuid));
  console.log('');
  console.log('  在即刻 App 中搜索"扫一扫"，扫描上方二维码');
  console.log('');
  console.log('  二维码 UUID: ' + uuid);
  console.log('========================================\n');

  // 生成二维码图片
  displayQRCode(getQRUrl(uuid));

  // 4. 等待扫码
  log('等待扫码确认...');
  try {
    const tokens = await waitForConfirmation(uuid);
    log('扫码成功，获取 token...');

    // 5. 获取用户信息并保存
    const userRes = await jikeRequest({
      method: 'GET',
      path: '/1.0/users/profile?username=',
      headers: { 'x-jike-access-token': tokens.access_token },
    });
    const username = userRes.data?.user?.username || '';

    const finalTokens = { ...tokens, username };
    saveTokens(finalTokens);

    console.log('\n========================================');
    console.log('  登录成功！');
    console.log('========================================');
    console.log('  Token 文件:', expandPath(TOKENS_PATH));
    console.log('  用户:', username);
    console.log('');
    console.log('  现在可以在 VCPToolBox 中使用 JikeScraper 插件了。');
    console.log('  重启 vcp-main: pm2 restart vcp-main');
    console.log('========================================');

  } catch (e) {
    console.error('登录失败:', e.message);
    process.exit(1);
  }
};

main();
