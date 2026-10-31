const { execFileSync } = require('child_process');
const fs = require('fs');
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const ROOT = 'C:\\Users\\Arnav Ranjan\\trmi\\forcedtomakeanaccounthere.trmi-x-lovhack-hackathon\\.trmi\\worktrees\\arnav-2tcvrr';
function run(args) { try { return { ok: true, s: execFileSync(GIT, args, { encoding: 'utf8', cwd: ROOT }) }; } catch (e) { return { ok: false, s: (e.stderr || '') + (e.stdout || '') }; } }
let out = 'CHECKOUT: ' + JSON.stringify(run(['checkout', '-B', 'fix/greptile-race-test', 'origin/fix/greptile-race-test'])) + '\n';
out += 'BRANCH: ' + JSON.stringify(run(['branch', '--show-current'])) + '\n';
out += 'HEAD: ' + JSON.stringify(run(['rev-parse', 'HEAD'])) + '\n';
fs.writeFileSync(__dirname + '\\co.txt', out);
console.log('done');
