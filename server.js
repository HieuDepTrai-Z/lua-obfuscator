const express = require('express');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(express.static('public'));
app.use(express.json({ limit: '5mb' }));

// ── NAME GENERATOR ───────────────────────────────────────────────────────────
const used_names = new Set();
function uname(len = 10) {
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const chars = lower + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let n;
  do {
    n = lower[Math.floor(Math.random() * 26)];
    for (let i = 1; i < len; i++) n += chars[Math.floor(Math.random() * chars.length)];
  } while (used_names.has(n));
  used_names.add(n);
  return n;
}
function clearNames() { used_names.clear(); }

// ── LIGHT MODE ───────────────────────────────────────────────────────────────
function lightObfuscate(code) {
  clearNames();
  const KEY_LEN = 16;
  const key = crypto.randomBytes(KEY_LEN);
  const pool = [];
  const stringMap = new Map();

  const strRegex = /(["'])(?:(?=(\\?))\2[\s\S])*?\1/g;
  let m;
  const found = new Set();
  while ((m = strRegex.exec(code)) !== null) found.add(m[0]);

  for (const orig of found) {
    const inner = orig.slice(1, -1)
      .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
      .replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\\'/g, "'");
    const enc = [...Buffer.from(inner, 'utf8')].map((b, i) => b ^ key[i % KEY_LEN]);
    stringMap.set(orig, pool.length);
    pool.push(enc.join(','));
  }

  const _K = uname(), _P = uname(), _D = uname();

  const header = [
    `-- [[ Orange Hub Obfuscator v2 ]]`,
    `local ${_K}={${[...key].join(',')}}`,
    `local ${_P}={${pool.map(e => `{${e}}`).join(',')}}`,
    `local function ${_D}(i)`,
    `  local t=${_P}[i];local r={}`,
    `  for j=1,#t do r[j]=string.char(t[j]~${_K}[(j-1)%${KEY_LEN}+1])end`,
    `  return table.concat(r)`,
    `end`,
  ].join('\n');

  // Longest first — tránh string ngắn corrupt string dài có cùng prefix
  const sortedPairs = [...stringMap.entries()].sort((a, b) => b[0].length - a[0].length);

  let newCode = code;
  for (const [orig, idx] of sortedPairs) {
    newCode = newCode.split(orig).join(`${_D}(${idx + 1})`);
  }

  return header + '\n' + newCode;
}

// ── HEAVY MODE ───────────────────────────────────────────────────────────────
function heavyObfuscate(code) {
  clearNames();

  const k1   = crypto.randomBytes(32);
  const k2   = crypto.randomBytes(16);
  const k3   = crypto.randomBytes(8);
  const salt = crypto.randomBytes(4);

  const dk1 = Buffer.alloc(32), dk2 = Buffer.alloc(16), dk3 = Buffer.alloc(8);
  for (let i = 0; i < 32; i++) dk1[i] = (k1[i] ^ salt[i % 4] ^ ((i + 1) * 7))  & 0xFF;
  for (let i = 0; i < 16; i++) dk2[i] = (k2[i] ^ salt[i % 4] ^ ((i + 1) * 13)) & 0xFF;
  for (let i = 0; i <  8; i++) dk3[i] = (k3[i] ^ salt[i % 4] ^ ((i + 1) * 31)) & 0xFF;

  const raw = Buffer.from(code, 'utf8');
  const enc = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i++) {
    let b = raw[i];
    b = (b ^ dk3[i % 8])  & 0xFF;
    b = (b ^ dk2[i % 16]) & 0xFF;
    b = (b ^ dk1[i % 32]) & 0xFF;
    enc[i] = b;
  }

  const CHUNK = 64;
  const chunks = [];
  for (let i = 0; i < enc.length; i += CHUNK)
    chunks.push([...enc.slice(i, i + CHUNK)].join(','));

  const V = {
    chunks: uname(), k1r: uname(), k2r: uname(), k3r: uname(),
    salt: uname(), dk1: uname(), dk2: uname(), dk3: uname(),
    res: uname(), pos: uname(), dec: uname(), fn: uname(),
    ls: uname(), env: uname(6),
    chunk: uname(6), i: uname(4), j: uname(4), b: uname(4),
  };

  return [
    `-- [[ Orange Hub Obfuscator v2 Heavy ]]`,
    `local ${V.chunks}={${chunks.map(c => `{${c}}`).join(',')}}`,
    `local ${V.k1r}={${[...k1].join(',')}}`,
    `local ${V.k2r}={${[...k2].join(',')}}`,
    `local ${V.k3r}={${[...k3].join(',')}}`,
    `local ${V.salt}={${[...salt].join(',')}}`,
    `local ${V.dk1},${V.dk2},${V.dk3}={},{},{}`,
    `for ${V.i}=1,32 do ${V.dk1}[${V.i}]=(${V.k1r}[${V.i}]~${V.salt}[(${V.i}-1)%4+1]~(${V.i}*7%256))%256 end`,
    `for ${V.i}=1,16 do ${V.dk2}[${V.i}]=(${V.k2r}[${V.i}]~${V.salt}[(${V.i}-1)%4+1]~(${V.i}*13%256))%256 end`,
    `for ${V.i}=1,8  do ${V.dk3}[${V.i}]=(${V.k3r}[${V.i}]~${V.salt}[(${V.i}-1)%4+1]~(${V.i}*31%256))%256 end`,
    `local ${V.res}={}`,
    `local ${V.pos}=0`,
    `for ${V.i}=1,#${V.chunks} do`,
    `  local ${V.chunk}=${V.chunks}[${V.i}]`,
    `  for ${V.j}=1,#${V.chunk} do`,
    `    ${V.pos}=${V.pos}+1`,
    `    local ${V.b}=${V.chunk}[${V.j}]`,
    `    ${V.b}=(${V.b}~${V.dk1}[(${V.pos}-1)%32+1])%256`,
    `    ${V.b}=(${V.b}~${V.dk2}[(${V.pos}-1)%16+1])%256`,
    `    ${V.b}=(${V.b}~${V.dk3}[(${V.pos}-1)%8+1])%256`,
    `    ${V.res}[${V.pos}]=string.char(${V.b})`,
    `  end`,
    `end`,
    `local ${V.dec}=table.concat(${V.res})`,
    `${V.res}=nil ${V.chunks}=nil`,
    `${V.dk1}=nil ${V.dk2}=nil ${V.dk3}=nil`,
    `-- Resolve loadstring từ executor env (Delta/Synapse/Krnl)`,
    `local ${V.env}=getfenv and getfenv(0) or _G`,
    `local ${V.ls}=${V.env}.loadstring or ${V.env}.load or loadstring or load`,
    `if not ${V.ls} then ${V.ls}=rawget(${V.env},"loadstring") or rawget(${V.env},"load") end`,
    `if not ${V.ls} then return end`,
    `local ${V.fn}=${V.ls}(${V.dec})`,
    `${V.dec}=nil`,
    `if not ${V.fn} then return end`,
    `-- Inject executor env vào decoded fn để loadstring/game/... hoạt động bên trong`,
    `if setfenv then pcall(setfenv,${V.fn},${V.env}) end`,
    `return ${V.fn}()`,
  ].join('\n');
}

// ── DUMP MODE ────────────────────────────────────────────────────────────────
function dumpCode(code, format = 'hex') {
  const raw = Buffer.from(code, 'utf8');

  if (format === 'base64') {
    const b64 = raw.toString('base64');
    const lines = [`-- [[ Orange Hub Dump - Base64 ]] size=${raw.length} bytes`];
    for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
    return lines.join('\n');
  }

  if (format === 'escaped') {
    const esc = [...raw].map(b => `\\${b.toString(8).padStart(3, '0')}`).join('');
    return [
      `-- [[ Orange Hub Dump - Escaped ]] size=${raw.length} bytes`,
      `local _src="${esc}"`,
    ].join('\n');
  }

  // hex — xxd style: offset + hex + ascii
  const lines = [`-- [[ Orange Hub Dump ]] size=${raw.length} bytes`];
  for (let i = 0; i < raw.length; i += 16) {
    const slice = raw.slice(i, i + 16);
    const offset = i.toString(16).padStart(8, '0');
    const hex = [...slice].map(b => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const ascii = [...slice].map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${offset}  ${hex}  |${ascii}|`);
  }
  lines.push(`\n-- Raw bytes as Lua table:`);
  lines.push(`local _dump={${[...raw].join(',')}}`);
  return lines.join('\n');
}

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.post('/obfuscate', upload.single('file'), (req, res) => {
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

    const mode = (req.body && req.body.mode) || 'light';
    const result = mode === 'heavy' ? heavyObfuscate(code) : lightObfuscate(code);
    res.json({
      obfuscated: result,
      mode,
      originalSize: Buffer.byteLength(code, 'utf8'),
      obfuscatedSize: Buffer.byteLength(result, 'utf8'),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/dump', upload.single('file'), (req, res) => {
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

    const format = (req.body && req.body.format) || 'hex'; // 'hex' | 'base64' | 'escaped'
    const result = dumpCode(code, format);
    res.json({ dump: result, format, size: Buffer.byteLength(code, 'utf8') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Running on port ' + PORT));
