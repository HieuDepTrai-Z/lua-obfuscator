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

const ALLOWED_PRESETS = ['Minify', 'Weak', 'Medium', 'Strong'];

function obfuscate(code, preset = 'Medium') {
  if (!ALLOWED_PRESETS.includes(preset)) {
    throw new Error(`Invalid preset. Allowed: ${ALLOWED_PRESETS.join(', ')}`);
  }

  const id = randomUUID();
  const inputFile = path.join('uploads', `${id}_in.lua`);
  const outputFile = path.join('uploads', `${id}_out.lua`);

  try {
    fs.writeFileSync(inputFile, code);

    // execFileSync: tham số truyền dạng mảng, KHÔNG qua shell
    // => ký tự đặc biệt (; & | ` $()) không bị diễn giải
    execFileSync('lua5.3', [
      'obfuscator/prometheus/cli.lua',
      '--preset', preset,
      inputFile,
      outputFile
    ], { timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });

    return fs.readFileSync(outputFile, 'utf8');
  } catch (e) {
    // log stderr thật để debug thay vì message chung chung
    const stderr = e.stderr ? e.stderr.toString() : e.message;
    throw new Error(`Obfuscation failed: ${stderr}`);
  } finally {
    if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
  }
}

app.post('/obfuscate', upload.single('file'), (req, res) => {
  try {
    let code = '';
    if (req.file) {
      code = fs.readFileSync(req.file.path, 'utf8');
      fs.unlinkSync(req.file.path);
    } else if (req.body?.code) {
      code = req.body.code;
    } else {
      return res.status(400).json({ error: 'No code provided' });
    }

    if (code.length > 500000)
      return res.status(400).json({ error: 'Code too large (max 500KB)' });

    const preset = req.body?.preset || 'Medium';
    const result = obfuscate(code, preset);

    res.json({
      obfuscated: result,
      preset,
      originalSize: Buffer.byteLength(code, 'utf8'),
      obfuscatedSize: Buffer.byteLength(result, 'utf8'),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Running on port ' + PORT));
