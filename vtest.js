const { spawnSync } = require('child_process');
const fs = require('fs');
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const ROOT = 'C:\\Users\\Arnav Ranjan\\trmi\\forcedtomakeanaccounthere.trmi-x-lovhack-hackathon\\.trmi\\worktrees\\arnav-greptile-fix';
const VITEST = ROOT + '\\node_modules\\vitest\\vitest.mjs';
const r = spawnSync(NODE, [VITEST, 'run', '--root', ROOT + '\\apps\\backend', '--project', 'unit', '--reporter=dot', 'test/unit/rooms.test.ts'], {
  cwd: ROOT,
  encoding: 'utf8',
  env: { ...process.env, FORCE_COLOR: '0' },
  timeout: 120000,
});
fs.writeFileSync(__dirname + '\\vtest.txt', 'status=' + r.status + '\n' + (r.stdout || '') + '\n' + (r.stderr || ''));
console.log('done');
