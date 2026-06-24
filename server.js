const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use(express.json({ limit: '5mb' }));

// ─── Danh sách global Roblox cần bảo toàn ───────────────────────────────────
const ROBLOX_GLOBALS = new Set([
  'game','workspace','script','plugin','shared',
  'Players','ReplicatedStorage','ReplicatedFirst','ServerStorage','ServerScriptService',
  'Lighting','StarterGui','StarterPack','StarterPlayer','Teams','SoundService',
  'RunService','TweenService','UserInputService','ContextActionService','PathfindingService',
  'CollectionService','HttpService','MarketplaceService','BadgeService','DataStoreService',
  'task','spawn','delay','wait','tick','time','elapsedTime','os','math','table','string',
  'coroutine','bit32','utf8','select','pairs','ipairs','next','pcall','xpcall',
  'require','loadstring','rawget','rawset','rawequal','rawlen','setmetatable','getmetatable',
  'tostring','tonumber','type','typeof','assert','error','warn','print','unpack',
  'Instance','Enum','CFrame','Vector2','Vector3','Vector3int16','UDim','UDim2',
  'Color3','BrickColor','Ray','RaycastParams','OverlapParams','Region3','Region3int16',
  'NumberRange','NumberSequence','NumberSequenceKeypoint','ColorSequence','ColorSequenceKeypoint',
  'TweenInfo','PhysicalProperties','Rect','Random','DateTime','Axes','Faces',
  'getgenv','getsenv','getfenv','setfenv','hookfunction','hookfunc','newcclosure',
  'checkcaller','iscclosure','islclosure','debug','getrenv','getreg',
  'Networking','PlayerStateClient','SharedTable','_G','_ENV',
  'true','false','nil','and','or','not','do','end','if','then','else','elseif',
  'for','while','repeat','until','return','break','local','function','in'
]);

// ─── Helper ──────────────────────────────────────────────────────────────────
function randName(len = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  // bắt đầu bằng chữ thường để tránh conflict
  let s = chars[Math.floor(Math.random() * 26)];
  for (let i = 1; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function xorBytes(buf, key) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length];
  return out;
}

// Encode bytes → Lua string literal an toàn (escape tất cả)
function toLuaByteString(buf) {
  let s = '"';
  for (let i = 0; i < buf.length; i++) {
    s += '\\' + buf[i];
  }
  s += '"';
  return s;
}

// Key array → Lua table literal
function toLuaKeyTable(buf) {
  return '{' + [...buf].join(',') + '}';
}

// ─── LIGHT MODE ──────────────────────────────────────────────────────────────
// XOR với key 4 bytes (mạnh hơn 1 byte), chia string thành chunks
// rename local vars, string pool
function lightObfuscate(code) {
  const KEY_LEN = 8;
  const key = crypto.randomBytes(KEY_LEN);

  // 1. Thu thập tất cả string literals
  const stringMap = new Map(); // original → pool index
  const pool = []; // mảng encoded strings
  let poolIdx = 0;

  const strRegex = /(["'])(?:(?=(\\?))\2[\s\S])*?\1/g;
  let m;
  const foundStrings = new Set();
  while ((m = strRegex.exec(code)) !== null) foundStrings.add(m[0]);

  for (const orig of foundStrings) {
    const inner = orig.slice(1, -1)
      .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
      .replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\\'/g, "'");
    const encBuf = Buffer.alloc(inner.length);
    for (let i = 0; i < inner.length; i++)
      encBuf[i] = inner.charCodeAt(i) ^ key[i % KEY_LEN];
    const encArr = [...encBuf].join(',');
    stringMap.set(orig, poolIdx);
    pool.push(encArr);
    poolIdx++;
  }

  // 2. Tên biến pool & key
  const _P = randName(), _K = randName(), _D = randName();

  // 3. Tạo pool code
  let poolCode = `local ${_K}={${[...key].join(',')}}\n`;
  poolCode += `local ${_P}={`;
  poolCode += pool.map(e => `{${e}}`).join(',');
  poolCode += `}\n`;
  // Hàm decode
  poolCode += `local function ${_D}(i)local t=${_P}[i]local r={}for j=1,#t do r[j]=string.char(t[j]~${_K}[(j-1)%${KEY_LEN}+1])end return table.concat(r)end\n`;

  // 4. Thay thế strings trong code
  let newCode = code;
  for (const [orig, idx] of stringMap) {
    newCode = newCode.split(orig).join(`${_D}(${idx + 1})`);
  }

  // 5. Rename local variables (không rename globals Roblox)
  const localRe = /\blocal\s+(?:function\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
  const declared = new Set();
  let dm;
  while ((dm = localRe.exec(newCode)) !== null) {
    if (!ROBLOX_GLOBALS.has(dm[1])) declared.add(dm[1]);
  }
  const renameMap = {};
  const used = new Set([_P, _K, _D]);
  for (const name of declared) {
    let n;
    do { n = randName(randInt(8, 14)); } while (used.has(n));
    renameMap[name] = n;
    used.add(n);
  }
  // Sort by length desc để tránh partial replace
  const sorted = Object.entries(renameMap).sort((a, b) => b[0].length - a[0].length);
  for (const [oldN, newN] of sorted) {
    const esc = oldN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    newCode = newCode.replace(new RegExp('\\b' + esc + '\\b', 'g'), newN);
  }

  // 6. Junk code nhẹ
  const junk = `local ${randName()}=math.floor(math.random()*${randInt(100,999)})if false then end\n`;

  return `-- Obfuscated by Orange Hub Obfuscator\n${junk}${poolCode}\n${newCode}`;
}

// ─── HEAVY MODE (Roblox-compatible) ─────────────────────────────────────────
// Triple-layer XOR, key derivation động, chunked decode (không dùng table.unpack)
// để tránh stack overflow với script lớn
function heavyObfuscate(code) {
  // Layer 1: key 32 bytes
  const k1 = crypto.randomBytes(32);
  // Layer 2: key 16 bytes
  const k2 = crypto.randomBytes(16);
  // Layer 3: key 8 bytes  
  const k3 = crypto.randomBytes(8);
  // Salt cho key derivation
  const salt = crypto.randomBytes(4);

  // Encode code → bytes
  let buf = Buffer.from(code, 'utf8');
  // Áp dụng 3 lớp XOR
  buf = xorBytes(buf, k3);
  buf = xorBytes(buf, k2);
  buf = xorBytes(buf, k1);

  // Chia thành chunks 80 bytes mỗi chunk → tránh stack overflow
  const CHUNK = 80;
  const chunks = [];
  for (let i = 0; i < buf.length; i += CHUNK) {
    chunks.push([...buf.slice(i, i + CHUNK)].join(','));
  }

  // Checksum đơn giản: XOR tất cả bytes
  let checksum = 0;
  for (let i = 0; i < buf.length; i++) checksum = (checksum ^ buf[i]) & 0xFF;

  // Tên biến random
  const _chunks = randName(), _k1 = randName(), _k2 = randName(), _k3 = randName();
  const _salt = randName(), _dec = randName(), _res = randName();
  const _i = randName(4), _j = randName(4), _b = randName(4);
  const _cs = randName(), _fn = randName(), _co = randName();
  const _ok = randName(4), _r = randName(4);

  // Key derivation: trộn salt vào key lúc runtime
  // k_final[i] = k[i] XOR salt[i%4] XOR (i*7 & 0xFF)
  const saltArr = [...salt];

  const luaChunks = chunks.map(c => `{${c}}`).join(',\n');

  const loader = `-- Obfuscated by Orange Hub Obfuscator
local ${_chunks}={
${luaChunks}
}
local ${_k1}_raw={${[...k1].join(',')}}
local ${_k2}_raw={${[...k2].join(',')}}
local ${_k3}_raw={${[...k3].join(',')}}
local ${_salt}={${saltArr.join(',')}}

-- Key derivation động
local ${_k1}={}
for ${_i}=1,#${_k1}_raw do
  ${_k1}[${_i}]=(${_k1}_raw[${_i}]~${_salt}[(${_i}-1)%4+1]~((${_i}*7)%256))%256
end
local ${_k2}={}
for ${_i}=1,#${_k2}_raw do
  ${_k2}[${_i}]=(${_k2}_raw[${_i}]~${_salt}[(${_i}-1)%4+1]~((${_i}*13)%256))%256
end
local ${_k3}={}
for ${_i}=1,#${_k3}_raw do
  ${_k3}[${_i}]=(${_k3}_raw[${_i}]~${_salt}[(${_i}-1)%4+1]~((${_i}*31)%256))%256
end

-- Decode từng chunk, tránh table.unpack (stack overflow)
local ${_res}={}
local ${_b}=0
for ${_i}=1,#${_chunks} do
  local chunk=${_chunks}[${_i}]
  for ${_j}=1,#chunk do
    ${_b}=${_b}+1
    local byte=chunk[${_j}]
    -- layer 3 reverse
    byte=byte~${_k3}[(${_b}-1)%8+1]
    -- layer 2 reverse  
    byte=byte~${_k2}[(${_b}-1)%16+1]
    -- layer 1 reverse
    byte=byte~${_k1}[(${_b}-1)%32+1]
    ${_res}[${_b}]=string.char(byte)
  end
end

-- Verify checksum
local ${_cs}=0
for ${_i}=1,#${_res} do
  ${_cs}=(${_cs}~string.byte(${_res}[${_i}]))%256
end
if ${_cs}~=${checksum} then return end

local ${_dec}=table.concat(${_res})
${_res}=nil

-- Anti-debug (Roblox safe)
local __dbg=debug
if __dbg then
  __dbg.sethook=function()end
  __dbg.getinfo=nil
  __dbg.getlocal=nil
  __dbg.setlocal=nil
  __dbg.getupvalue=nil
  __dbg.setupvalue=nil
end

-- Junk loops
local ${randName(5)}=0
for ${_i}=1,100 do ${randName(4)}=_i end
local ${randName(6)}=math.huge
if ${randName(6)}~=math.huge then return end

local ${_fn},__err=loadstring(${_dec})
if not ${_fn} then return end
${_dec}=nil

-- Wrap trong coroutine để catch lỗi
local ${_co}=coroutine.create(${_fn})
local ${_ok},${_r}=coroutine.resume(${_co})
if ${_ok} then return ${_r} end
`;

  return loader;
}

// ─── API ─────────────────────────────────────────────────────────────────────
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

    if (code.length > 500000) {
      return res.status(400).json({ error: 'Code too large (max 500KB)' });
    }

    const mode = (req.body && req.body.mode) || 'light';
    let result;
    if (mode === 'heavy') {
      result = heavyObfuscate(code);
    } else {
      result = lightObfuscate(code);
    }
    res.json({ obfuscated: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tạo thư mục uploads nếu chưa có
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Running on port ' + PORT));
