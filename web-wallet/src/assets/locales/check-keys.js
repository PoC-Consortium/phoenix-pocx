const fs = require('fs');

const en = Object.keys(JSON.parse(fs.readFileSync('en.json'))).sort();
const files = fs.readdirSync('.').filter(f => f.endsWith('.json') && f !== 'en.json');

let ok = true;
files.forEach(f => {
  const keys = Object.keys(JSON.parse(fs.readFileSync(f))).sort();
  const miss = en.filter(k => !keys.includes(k));
  const extra = keys.filter(k => !en.includes(k));
  if (miss.length || extra.length) {
    ok = false;
    console.log(f + ':');
    if (miss.length) console.log('  Missing:', miss.join(', '));
    if (extra.length) console.log('  Extra:', extra.join(', '));
  }
});
if (ok) console.log('All ' + files.length + ' files match en.json keys!');
else console.log('\nTotal keys in en.json:', en.length);
