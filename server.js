const express = require('express');
const multer = require('multer');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(express.static('public'));
app.use(express.json({ limit: '5mb' }));

// ── LUAOBFUSCATOR.COM API ─────────────────────────────────────────────────────
async function luaObfuscatorCom(code, preset = 'Chaotic Evil') {
  const API = 'https://luaobfuscator.com/api/obfuscator';
  const API_KEY = process.env.LUA_OBF_KEY || 'test';

  const uploadRes = await fetch(`${API}/newscript`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': API_KEY },
    body: code,
  });
  if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
  const uploadData = await uploadRes.json();
  if (!uploadData.sessionId) throw new Error(uploadData.message || 'No sessionId');

  const config = buildConfig(preset);
  const obfRes = await fetch(`${API}/obfuscate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': API_KEY,
      'sessionId': uploadData.sessionId,
    },
    body: JSON.stringify(config),
  });
  if (!obfRes.ok) throw new Error(`Obfuscate failed: ${obfRes.status}`);
  const obfData = await obfRes.json();
  if (!obfData.code) throw new Error(obfData.message || 'No output code');

  return obfData.code;
}

function buildConfig(preset) {
  const presets = {
    'Basic': {
      Minify: true,
      Strings: true,
    },
    'Chaotic Good': {
      Minify: true,
      Strings: true,
      MBAv1: true,
      CFF: true,
      Literals: true,
    },
    'Chaotic Evil': {
      Minify: true,
      Strings: true,
      MBAv1: true,
      CFF: true,
      Literals: true,
      TableIndirection: true,
      EncFunc: true,
      DecSwizzle: true,
    },
    'Dystropic': {
      Minify: true,
      Strings: true,
      MBAv1: true,
      CFF: true,
      Literals: true,
      TableIndirection: true,
      EncFunc: true,
      DecSwizzle: true,
      JunkIf: true,
      ReverseIf: true,
    },
  };
  return presets[preset] || presets['Chaotic Evil'];
}

// ── ROUTE ─────────────────────────────────────────────────────────────────────
app.post('/obfuscate', upload.single('file'), async (req, res) => {
  try {
    let code = '';
    if (req.file) {
      code = fs.readFileSync(req.file.path, 'utf8');
      fs.unlinkSync(req.file.path);
    } else if (req.body && req.body.code) {
      code = req.body.code;
    } else {
      return res.status(400).json({ error: 'No code provided' });
    }
    if (code.length > 500000)
      return res.status(400).json({ error: 'Code too large (max 500KB)' });

    const preset = (req.body && req.body.preset) || 'Chaotic Evil';
    const result = await luaObfuscatorCom(code, preset);

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
