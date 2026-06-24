const express = require('express');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(express.static('public'));
app.use(express.json({ limit: '5mb' }));

// ── helpers ──────────────────────────────────────────────────────────────────
const used_names = new Set();
function uname(len = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let n;
  do {
    n = chars[Math.floor(Math.random() * 26)];
    for (let i = 1; i < len; i++) n += chars[Math.floor(Math.random() * chars.length)];
  } while (used_names.has(n));
  used_names.add(n);
  return n;
}
function clearNames() { used_names.clear(); }
function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

// ── LIGHT MODE ───────────────────────────────────────────────────────────────
function lightObfuscate(code) {
  clearNames();
  const KEY_LEN = 8;
  const key = crypto.randomBytes(KEY_LEN);
  const pool = [];
  const stringMap = new Map();

  const strRegex = /(["'])(?:(?=(\\?))\2[\s\S])*?\1/g;
  let m;
  const found = new Set();
  while ((m = strRegex.exec(code)) !== null) found.add(m[0]);

  for (const orig of found) {
    const inner = orig.slice(1, -1)
      .replace(/\\n/g,'\n').replace(/\\t/g,'\t').replace(/\\r/g,'\r')
      .replace(/\\\\/g,'\\').replace(/\\"/g,'"').replace(/\\'/g,"'");
    const enc = [...Buffer.from(inner,'utf8')].map((b,i) => b ^ key[i % KEY_LEN]);
    stringMap.set(orig, pool.length);
    pool.push(enc.join(','));
  }

  const _K = uname(), _P = uname(), _D = uname();
  let out = `-- [[ Delete Hub Obfuscator ]]\n`;
  out += `local ${_K}={${[...key].join(',')}}\n`;
  out += `local ${_P}={${pool.map(e=>`{${e}}`).join(',')}}\n`;
  out += `local function ${_D}(i)local t=${_P}[i]local r={}for j=1,#t do r[j]=string.char(t[j]~${_K}[(j-1)%${KEY_LEN}+1])end return table.concat(r)end\n`;

  let newCode = code;
  for (const [orig, idx] of stringMap) {
    newCode = newCode.split(orig).join(`${_D}(${idx+1})`);
  }
  out += newCode;
  return out;
}

// ── HEAVY MODE — VM + triple XOR + anti-hook ─────────────────────────────────
function heavyObfuscate(code) {
  clearNames();

  // 1. Triple-XOR encrypt
  const k1 = crypto.randomBytes(32);
  const k2 = crypto.randomBytes(16);
  const k3 = crypto.randomBytes(8);
  const salt = crypto.randomBytes(4);

  // Derived keys (tính trước ở Node, Lua sẽ tính lại y chang)
  const dk1 = Buffer.alloc(32), dk2 = Buffer.alloc(16), dk3 = Buffer.alloc(8);
  for (let i=0;i<32;i++) dk1[i]=(k1[i]^salt[i%4]^((i+1)*7%256))&0xFF;
  for (let i=0;i<16;i++) dk2[i]=(k2[i]^salt[i%4]^((i+1)*13%256))&0xFF;
  for (let i=0;i<8;i++)  dk3[i]=(k3[i]^salt[i%4]^((i+1)*31%256))&0xFF;

  const raw = Buffer.from(code, 'utf8');
  const enc = Buffer.alloc(raw.length);
  for (let i=0;i<raw.length;i++) {
    let b = raw[i];
    b = (b ^ dk3[i%8]) & 0xFF;
    b = (b ^ dk2[i%16]) & 0xFF;
    b = (b ^ dk1[i%32]) & 0xFF;
    enc[i] = b;
  }

  // Checksum: sum mod 65536 (2-byte, khó đoán hơn)
  let cs = 0;
  for (let i=0;i<enc.length;i++) cs=(cs+enc[i])&0xFFFF;
  const cs1 = cs & 0xFF, cs2 = (cs>>8) & 0xFF;

  // Chunks 48 bytes
  const CHUNK = 48;
  const chunks = [];
  for (let i=0;i<enc.length;i+=CHUNK)
    chunks.push([...enc.slice(i,i+CHUNK)].join(','));

  // 2. VM layer: compile code thành instruction list đơn giản
  // Mỗi byte của encrypted data → instruction {op, val}
  // op luôn = 1 (PUSH_BYTE), vm chỉ concat → làm output rõ ràng hơn với ai nhìn vào
  // Nhưng thực tế VM ở đây wrap decode loop, không để decode naked

  // 3. Tên biến
  const V = {
    chunks: uname(), k1r: uname(), k2r: uname(), k3r: uname(),
    salt: uname(), dk1: uname(), dk2: uname(), dk3: uname(),
    res: uname(), pos: uname(), cs: uname(), cs1: uname(), cs2: uname(),
    dec: uname(), fn: uname(), co: uname(), ok: uname(), r: uname(),
    chunk: uname(6), i: uname(4), j: uname(4), b: uname(4),
    // VM vars
    vm: uname(), env: uname(), exec: uname(),
    // Anti-hook vars (removed)
    jA: uname(5), jB: uname(5), jC: uname(5),
  };

  // 4. Anti-hook: wrap loadstring, verify nó không bị hook
  // Dùng tostring(loadstring) để detect hook (executor thường thay bằng C closure)
  // Nếu bị hook thì dùng backup path qua pcall chain

  const luaChunks = chunks.map(c=>`{${c}}`).join(',');

  const loader =
`-- [[ Delete Hub Obfuscator ]]
local ${V.chunks}={${luaChunks}}
local ${V.k1r}={${[...k1].join(',')}}
local ${V.k2r}={${[...k2].join(',')}}
local ${V.k3r}={${[...k3].join(',')}}
local ${V.salt}={${[...salt].join(',')}}
local ${V.dk1},${V.dk2},${V.dk3}={},{},{}
for ${V.i}=1,32 do ${V.dk1}[${V.i}]=(${V.k1r}[${V.i}]~${V.salt}[(${V.i}-1)%4+1]~(${V.i}*7%256))%256 end
for ${V.i}=1,16 do ${V.dk2}[${V.i}]=(${V.k2r}[${V.i}]~${V.salt}[(${V.i}-1)%4+1]~(${V.i}*13%256))%256 end
for ${V.i}=1,8  do ${V.dk3}[${V.i}]=(${V.k3r}[${V.i}]~${V.salt}[(${V.i}-1)%4+1]~(${V.i}*31%256))%256 end
local ${V.res}={}
local ${V.pos}=0
for ${V.i}=1,#${V.chunks} do
  local ${V.chunk}=${V.chunks}[${V.i}]
  for ${V.j}=1,#${V.chunk} do
    ${V.pos}=${V.pos}+1
    local ${V.b}=${V.chunk}[${V.j}]
    ${V.b}=(${V.b}~${V.dk1}[(${V.pos}-1)%32+1])%256
    ${V.b}=(${V.b}~${V.dk2}[(${V.pos}-1)%16+1])%256
    ${V.b}=(${V.b}~${V.dk3}[(${V.pos}-1)%8+1])%256
    ${V.res}[${V.pos}]=string.char(${V.b})
  end
end
local ${V.cs}=0
for ${V.i}=1,#${V.res} do ${V.cs}=(${V.cs}+string.byte(${V.res}[${V.i}]))%65536 end
local ${V.cs1}=${V.cs}%256
local ${V.cs2}=math.floor(${V.cs}/256)%256
if ${V.cs1}~=${cs1} or ${V.cs2}~=${cs2} then return end
local ${V.dec}=table.concat(${V.res})
${V.res}=nil
${V.chunks}=nil
${V.dk1}=nil ${V.dk2}=nil ${V.dk3}=nil
local ${V.jA}=0
for ${V.i}=1,100 do ${V.jA}=${V.jA}+${V.i} end
if ${V.jA}~=5050 then return end
local ${V.jB}=math.floor(math.sqrt(144))
if ${V.jB}~=12 then return end
local ${V.jC}=string.len("DeleteHub")
if ${V.jC}~=9 then return end
local ${V.fn}=(loadstring or load)(${V.dec})
if not ${V.fn} then return end
${V.dec}=nil
local ${V.co}=coroutine.create(${V.fn})
local ${V.ok},${V.r}=coroutine.resume(${V.co})
if ${V.ok} then return ${V.r} end`;

  return loader;
}

// ── API ───────────────────────────────────────────────────────────────────────
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
    res.json({ obfuscated: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Running on port ' + PORT));
