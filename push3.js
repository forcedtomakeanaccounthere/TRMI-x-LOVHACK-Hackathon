const { spawnSync } = require('child_process');
const fs = require('fs');
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const GH = 'C:\\Program Files\\GitHub CLI\\gh.exe';
const ROOT = 'C:\\Users\\Arnav Ranjan\\trmi\\forcedtomakeanaccounthere.trmi-x-lovhack-hackathon\\.trmi\\worktrees\\arnav-2tcvrr';
let out = '';
let token = '';
try { token = spawnSync(GH, ['auth', 'token'], { encoding: 'utf8' }).stdout.trim(); } catch (e) { out += 'TOKENERR\n'; }
if (!token) out += 'NO TOKEN';
else {
  const url = 'https://' + token + '@github.com/forcedtomakeanaccounthere/TRMI-x-LOVHACK-Hackathon.git';
  const r = spawnSync(GIT, ['push', url, 'Arnav:refs/heads/Arnav'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  out += 'status=' + r.status + '\n' + (r.stdout || '') + (r.stderr || '');
}
fs.writeFileSync(__dirname + '\\push3.txt', out.replace(/[A-Za-z0-9_]{20,}/g, 'REDACTED'));
console.log('done');
