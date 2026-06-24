function encode(buffer) {
  const bytes = buffer;
  const len = bytes.length;
  if (len % 4 !== 0) throw new Error('Buffer must be multiple of 4');
  let result = '';
  for (let i = 0; i < len; i += 4) {
    let word = 0;
    for (let j = 0; j < 4; j++) {
      word = (word << 8) | bytes[i + j];
    }
    const digits = [];
    let tmp = word;
    for (let k = 0; k < 5; k++) {
      digits.push(tmp % 55);
      tmp = Math.floor(tmp / 55);
    }
    digits.reverse();
    for (const d of digits) {
      result += String.fromCharCode(33 + d);
    }
  }
  return result;
}

module.exports = { encode };
