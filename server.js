const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { execSync } = require('child_process');
const { randomUUID } = require('crypto');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(express.static('public'));
app.use(express.json({ limit: '5mb' }));

function obfuscate(code, preset = 'Medium') {
  const id = randomUUID();
  const inputFile = `uploads/${id}_in.lua`;
  const outputFile = `uploads/${id}_out.lua`;

  try {
    fs.writeFileSync(inputFile, code);
    execSync(
      `lua5.3 obfuscator/prometheus/cli.lua --preset ${preset} ${inputFile} ${outputFile}`,
      { timeout: 30000 }
    );
    return fs.readFileSync(outputFile, 'utf8');
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
