const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use(express.json({ limit: '5mb' }));

// lua5.1 để tương thích với Roblox/Luau
const LUA_BIN = process.env.LUA_BIN || 'lua5.1';

// Whitelist preset hợp lệ — chặn command injection
const ALLOWED_PRESETS = ['Minify', 'Weak', 'Medium', 'Strong'];

function obfuscate(code, preset = 'Medium') {
  if (!ALLOWED_PRESETS.includes(preset)) {
    throw new Error(`Invalid preset "${preset}". Allowed: ${ALLOWED_PRESETS.join(', ')}`);
  }

  const id = randomUUID();
  // Dùng đường dẫn TUYỆT ĐỐI vì sẽ đổi cwd khi chạy lua
  const inputFile = path.resolve('uploads', `${id}_in.lua`);
  const outputFile = path.resolve('uploads', `${id}_out.lua`);
  const prometheusDir = path.resolve('obfuscator/prometheus');

  try {
    fs.writeFileSync(inputFile, code);

    // execFileSync: tham số dạng mảng, KHÔNG đi qua shell => an toàn khỏi command injection
    // cwd: prometheusDir => cli.lua tự tính package.path đúng, require() các module con hoạt động
    // --out outputFile => đúng cú pháp CLI Prometheus yêu cầu (không truyền output là positional arg tự do)
    execFileSync(LUA_BIN, [
      'cli.lua',
      '--preset', preset,
      inputFile,
      '--out', outputFile
    ], {
      cwd: prometheusDir,
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    if (!fs.existsSync(outputFile)) {
      throw new Error('Obfuscator did not produce an output file');
    }

    return fs.readFileSync(outputFile, 'utf8');
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : null;
    const stdout = e.stdout ? e.stdout.toString().trim() : null;
    const detail = stderr || stdout || e.message;
    throw new Error(`Obfuscation failed: ${detail}`);
  } finally {
    if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
  }
}

app.post('/obfuscate', upload.single('file'), (req, res) => {
  let tempUploadPath = null;

  try {
    let code = '';

    if (req.file) {
      tempUploadPath = req.file.path;
      code = fs.readFileSync(req.file.path, 'utf8');
      fs.unlinkSync(req.file.path);
      tempUploadPath = null;
    } else if (req.body?.code) {
      code = req.body.code;
    } else {
      return res.status(400).json({ error: 'No code provided' });
    }

    if (typeof code !== 'string' || code.trim().length === 0) {
      return res.status(400).json({ error: 'Code is empty' });
    }

    if (Buffer.byteLength(code, 'utf8') > 500000) {
      return res.status(400).json({ error: 'Code too large (max 500KB)' });
    }

    const preset = req.body?.preset || 'Medium';

    if (!ALLOWED_PRESETS.includes(preset)) {
      return res.status(400).json({
        error: `Invalid preset. Allowed: ${ALLOWED_PRESETS.join(', ')}`
      });
    }

    const result = obfuscate(code, preset);

    res.json({
      obfuscated: result,
      preset,
      originalSize: Buffer.byteLength(code, 'utf8'),
      obfuscatedSize: Buffer.byteLength(result, 'utf8'),
    });
  } catch (e) {
    if (tempUploadPath && fs.existsSync(tempUploadPath)) {
      fs.unlinkSync(tempUploadPath);
    }
    console.error('Obfuscate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Health check — verify lua5.1 hoạt động đúng trên server
app.get('/health', (req, res) => {
  try {
    const version = execFileSync(LUA_BIN, ['-v'], { timeout: 5000 }).toString();
    res.json({ status: 'ok', luaBin: LUA_BIN, luaVersion: version.trim() });
  } catch (e) {
    res.status(500).json({
      status: 'error',
      luaBin: LUA_BIN,
      error: e.message
    });
  }
});

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Running on port ' + PORT));
