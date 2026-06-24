const express = require('express');
const multer = require('multer');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const packer = require('./obfuscator/packer');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use(express.json());

const GLOBAL_KEYWORDS = [
  'game', 'workspace', 'Players', 'ReplicatedStorage', 'Lighting',
  'task', 'spawn', 'delay', 'wait', 'tick', 'time', 'elapsedTime',
  'Instance', 'TweenService', 'Color3', 'Vector2', 'Vector3', 'UDim2', 'UDim',
  'CFrame', 'Enum', 'math', 'os', 'table', 'string', 'coroutine',
  'pcall', 'xpcall', 'require', 'loadstring', 'getgenv', 'getfenv', 'setfenv',
  'rawget', 'rawset', 'rawequal', 'rawlen',
  'Networking', 'CollectionService', 'PlayerStateClient',
  'RaycastParams', 'Random', 'ColorSequence', 'ColorSequenceKeypoint',
  'Faces', 'Axes', 'BrickColor', 'CatalogSearchParams', 'DebuggerManager',
  'NumberRange', 'NumberSequence', 'NumberSequenceKeypoint',
  'OverlapParams', 'Path', 'PathWaypoint', 'PhysicalProperties',
  'Random', 'Ray', 'RaycastParams', 'Rect', 'Region3',
  'Region3int16', 'SharedTable', 'TweenInfo', 'UDim', 'UDim2',
  'Vector2', 'Vector3', 'Vector3int16', 'DateTime', 'DockWidgetPluginGui',
  'Faces', 'Axes', 'BrickColor', 'CatalogSearchParams'
];

function lightObfuscate(code) {
  const keyByte = crypto.randomBytes(1).readUInt8(0);
  const strings = [];
  const stringRegex = /(["'])(?:(?=(\\?))\2.)*?\1/g;
  let match;
  while ((match = stringRegex.exec(code)) !== null) strings.push(match[0]);
  const unique = [...new Set(strings)];
  const allMappings = {};
  let idx = 1;
  const stringMap = new Map();
  unique.forEach(s => {
    const content = s.slice(1, -1);
    if (content.length <= 4) {
      const enc = [...content].map(c => String.fromCharCode(c.charCodeAt(0) ^ keyByte)).join('');
      allMappings[idx] = enc;
      stringMap.set(s, { idx });
      idx++;
    } else {
      const chunks = [];
      for (let i = 0; i < content.length; i += 4) chunks.push(content.substring(i, i + 4));
      const idxes = [];
      chunks.forEach(chunk => {
        const enc = [...chunk].map(c => String.fromCharCode(c.charCodeAt(0) ^ keyByte)).join('');
        allMappings[idx] = enc;
        idxes.push(idx);
        idx++;
      });
      stringMap.set(s, { idxes });
    }
  });

  const usedGlobals = [];
  for (const kw of GLOBAL_KEYWORDS) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('\\b' + escaped + '\\b', 'g').test(code)) usedGlobals.push(kw);
  }
  const globalMap = {};
  usedGlobals.forEach(kw => {
    const enc = [...kw].map(c => String.fromCharCode(c.charCodeAt(0) ^ keyByte)).join('');
    allMappings[idx] = enc;
    globalMap[kw] = idx;
    idx++;
  });

  let tableCode = 'local _S={}\n';
  for (const [i, enc] of Object.entries(allMappings)) {
    tableCode += `_S[${i}]="${enc}"\n`;
  }

  let newCode = code;
  for (const [orig, info] of stringMap) {
    if (info.idx) {
      const repl = `(_S[${info.idx}]:gsub(".",function(c)return string.char(string.byte(c)~${keyByte})end))`;
      newCode = newCode.split(orig).join(repl);
    } else {
      const repl = '(' + info.idxes.map(i => `(_S[${i}]:gsub(".",function(c)return string.char(string.byte(c)~${keyByte})end))`).join('..') + ')';
      newCode = newCode.split(orig).join(repl);
    }
  }

  for (const [kw, idx] of Object.entries(globalMap).sort((a,b) => b[0].length - a[0].length)) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('\\b' + escaped + '\\b', 'g');
    newCode = newCode.replace(regex, `_G[_S[${idx}]:gsub(".",function(c)return string.char(string.byte(c)~${keyByte})end())]`);
  }

  const localDeclRegex = /local\s+(?:function\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
  const declaredLocals = new Set();
  let declMatch;
  while ((declMatch = localDeclRegex.exec(newCode)) !== null) declaredLocals.add(declMatch[1]);
  const renameMap = {};
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  for (const name of declaredLocals) {
    let newName;
    do {
      newName = Array.from({length: 10 + Math.floor(Math.random() * 6)}, () => alphabet[Math.floor(Math.random() * 26)]).join('');
    } while (Object.values(renameMap).includes(newName) || GLOBAL_KEYWORDS.includes(newName));
    renameMap[name] = newName;
  }
  for (const [oldName, newName] of Object.entries(renameMap)) {
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    newCode = newCode.replace(new RegExp('\\b' + escaped + '\\b', 'g'), newName);
  }

  const antiDebug = `
local __dbg = debug
if __dbg then
 __dbg.setmetatable = nil
 __dbg.getmetatable = nil
 __dbg.getfenv = nil
 __dbg.setfenv = nil
 __dbg.getinfo = nil
 __dbg.getlocal = nil
 __dbg.setlocal = nil
 __dbg.getupvalue = nil
 __dbg.setupvalue = nil
 __dbg.sethook = function() end
 __dbg.gethook = function() end
end
local __hook = hookfunction or hookfunc
if __hook then
 __hook(print, function() end)
 __hook(warn, function() end)
 __hook(error, function() end)
end
`;
  return antiDebug + tableCode + '\n' + newCode + '\n-- Junk: ' + Math.random().toString(36).substring(2,10);
}

function heavyObfuscate(code) {
  if (!/\bgame\b/i.test(code)) {
    const tmpFile = path.join(__dirname, 'uploads', `temp_${Date.now()}.lua`);
    const outFile = tmpFile + '.out';
    fs.writeFileSync(tmpFile, code);
    try {
      try { execFileSync('luajit', ['-b', '-s', tmpFile, outFile], { timeout: 5000 }); }
      catch { execFileSync('luac5.1', ['-s', '-o', outFile, tmpFile], { timeout: 5000 }); }
      const bytecode = fs.readFileSync(outFile);
      const buf = Buffer.from(bytecode);
      const paddingLength = (4 - (buf.length % 4)) % 4;
      const padded = Buffer.concat([buf, Buffer.alloc(paddingLength)]);
      const encoded = packer.encode(padded);
      const checksum = crypto.createHash('sha256').update(encoded).digest('hex').substring(0,8);
      const finalData = checksum + encoded;
      const loader = `return(function(...)
local function B(S)
 local b,l,uc,f=string.byte,string.sub,bit32.bxor,math.floor
 S=l(S,9)
 S=l(S,'z','!!!!!'):gsub('[%s\r\n]','')
 local R={}
 local j=1
 while j<=#S do
  local L=#S-j+1
  local Y=(L>=5)and 5 or L
  local RS=0
  if Y==5 then
   local Y,U,lc,pS,Lj=b(S,j,j+4)
   RS=(Y-33)*0x31C84B1+(U-33)*0x95EED+(lc-33)*0x1C39+(pS-33)*0x55+(Lj-33)
  else
   for k=0,Y-1 do RS=RS*0x55+(b(S,j+k)-33) end
   for k=1,5-Y do RS=RS*0x55+0x54 end
  end
  local yr=f(RS/0x1000000)%0x100
  local nh=f(RS/0x10000)%0x100
  local lc=f(RS/0x100)%0x100
  local rb=RS%0x100
  if Y==5 then R[#R+1]=string.char(yr,nh,lc,rb)
  else
   if Y>=2 then R[#R+1]=string.char(yr) end
   if Y>=3 then R[#R+1]=string.char(nh) end
   if Y>=4 then R[#R+1]=string.char(lc) end
  end
  j=j+Y
 end
 return table.concat(R)
end
local S=[[${finalData}]]
if #S<9 then return end
local h=string.sub(S,1,8)
if h~="${checksum}" then return end
local d=debug
if d then
 d.setmetatable=nil; d.getmetatable=nil; d.getfenv=nil; d.setfenv=nil
 d.getinfo=nil; d.getlocal=nil; d.setlocal=nil; d.getupvalue=nil; d.setupvalue=nil
 d.sethook=function()end; d.gethook=function()end
end
local raw=setmetatable({},{__index=function()end,__newindex=function()end,__metatable="locked"})
local f=loadstring(B(S))
if not f then return end
local env={}
setmetatable(env,{__index=_G,__newindex=function()end})
local co=coroutine.create(f)
local ok,res=coroutine.resume(co,env)
if ok then return res end
return nil
end)()`;
      return loader;
    } catch (err) {
      throw new Error('Compilation failed: ' + err.message);
    } finally {
      try { fs.unlinkSync(tmpFile); fs.unlinkSync(outFile); } catch(e) {}
    }
  }

  // ---------- Roblox heavy mode (table of bytes, no base64) ----------
  const key1 = crypto.randomBytes(16);
  const key2 = crypto.randomBytes(8);
  const key3 = crypto.randomBytes(4);

  const buf1 = Buffer.alloc(code.length);
  for (let i = 0; i < code.length; i++) buf1[i] = code.charCodeAt(i) ^ key1[i % 16];
  const buf2 = Buffer.alloc(buf1.length);
  for (let i = 0; i < buf1.length; i++) buf2[i] = buf1[i] ^ key2[i % 8];
  const buf3 = Buffer.alloc(buf2.length);
  for (let i = 0; i < buf2.length; i++) buf3[i] = buf2[i] ^ key3[i % 4];

  const dataBytes = [...buf3]; // mảng số nguyên 0-255
  const dataStr = '{' + dataBytes.join(',') + '}';

  const k1 = [...key1], k2 = [...key2], k3 = [...key3];

  const loader = `
return(function(...)
local __b, __c, __f, __bx = string.byte, string.char, math.floor, bit32.bxor

local __data = ${dataStr}
local __k1 = {${k1.join(',')}}
local __k2 = {${k2.join(',')}}
local __k3 = {${k3.join(',')}}

local __len = #__data
local __a = {}
for i = 1, __len do __a[i] = __data[i] end

for i = 1, __len do __a[i] = __a[i] ~ __k3[(i-1)%4+1] end
for i = 1, __len do __a[i] = __a[i] ~ __k2[(i-1)%8+1] end
for i = 1, __len do __a[i] = __a[i] ~ __k1[(i-1)%16+1] end

local __dec = __c(table.unpack(__a))

-- Anti-debug & junk -----------------------------------------------
local __dbg = debug
if __dbg then
 __dbg.setmetatable = nil; __dbg.getmetatable = nil; __dbg.getfenv = nil
 __dbg.setfenv = nil; __dbg.getinfo = nil; __dbg.getlocal = nil
 __dbg.setlocal = nil; __dbg.getupvalue = nil; __dbg.setupvalue = nil
 __dbg.sethook = function() end; __dbg.gethook = function() end
end
local __hk = hookfunction or hookfunc
if __hk then
 __hk(print, function() end)
 __hk(warn, function() end)
 __hk(error, function() end)
end

local __j1 = 0; for i = 1, 150 do __j1 = __j1 + i end; if __j1 ~= 11325 then return end
local __j2 = {}; for i = 1, 10 do __j2[i] = math.random() end; __j2 = nil
local __j3 = 0; repeat __j3 = __j3 + 1 until __j3 > 10

local __f, __err = loadstring(__dec)
if not __f then return nil end
local __env = {}
setmetatable(__env, {__index = _G, __newindex = function() end})
local __co = coroutine.create(__f)
local __ok, __res = coroutine.resume(__co, __env)
if __ok then return __res end
return nil
end)()`;

  return loader;
}

app.post('/obfuscate', upload.single('file'), (req, res) => {
  try {
    let code = '';
    if (req.file) {
      code = fs.readFileSync(req.file.path, 'utf8');
      fs.unlinkSync(req.file.path);
    } else if (req.body.code) {
      code = req.body.code;
    } else {
      return res.status(400).json({error: 'No code'});
    }
    const mode = req.body.mode || 'light';
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Running on ' + PORT));
