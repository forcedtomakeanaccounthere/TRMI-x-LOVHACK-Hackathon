const { execFileSync } = require('child_process');
const fs = require('fs');
const GH = 'C:\\Program Files\\GitHub CLI\\gh.exe';
let out = '=== REVIEWS ===\n';
try { out += execFileSync(GH, ['api', 'repos/forcedtomakeanaccounthere/TRMI-x-LOVHACK-Hackathon/pulls/14/reviews'], { encoding: 'utf8' }); } catch (e) { out += 'ERR ' + (e.stderr || e.message); }
out += '\n=== COMMENTS ===\n';
try { out += execFileSync(GH, ['api', 'repos/forcedtomakeanaccounthere/TRMI-x-LOVHACK-Hackathon/pulls/14/comments'], { encoding: 'utf8' }); } catch (e) { out += 'ERR ' + (e.stderr || e.message); }
fs.writeFileSync(__dirname + '\\rev.txt', out);
console.log('done');
