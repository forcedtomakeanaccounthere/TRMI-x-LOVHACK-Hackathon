const { execFileSync } = require('child_process');
const fs = require('fs');
const GH = 'C:\\Program Files\\GitHub CLI\\gh.exe';
let out = '';
try {
  out += execFileSync(GH, ['api', 'repos/forcedtomakeanaccounthere/TRMI-x-LOVHACK-Hackathon/pulls?state=all&head=forcedtomakeanaccounthere:fix/greptile-race-test'], { encoding: 'utf8' });
} catch (e) { out += 'ERR ' + (e.stderr || e.message); }
fs.writeFileSync(__dirname + '\\prs.txt', out);
console.log('done');
