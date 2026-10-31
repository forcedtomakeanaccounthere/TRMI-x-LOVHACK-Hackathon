const fs = require('fs');
const { execFileSync } = require('child_process');
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const ROOT = 'C:\\Users\\Arnav Ranjan\\trmi\\forcedtomakeanaccounthere.trmi-x-lovhack-hackathon\\.trmi\\worktrees\\arnav-2tcvrr';

const mine = ['applyfix.js','applyfix.out','bpkg.txt','branches.js','branches.txt','checks.js','checks.txt','chk.txt','co.txt','co2.js','co2.txt','commit.txt','fixok.txt','fjs.txt','gb.txt','gs.txt','gstatus.js','gstatus.txt','line.txt','mainstatus.js','mainstatus.txt','npminstall.js','npminstall.txt','ok.txt','ovl.txt','pkg.txt','push.txt','restore.js','roomsrc.txt','roomsrc2.txt','runout.txt','sim.js','sim.txt','stash.js','stash.txt','vcfg.txt','vfull.js','vfull.txt','vtest.txt','wt.txt','push2.js','commit2.js','gstatus.js','vtest.js','vfull.js','checks.js','co2.js','stash.js','restore.js','mainstatus.js','gstatus.js'];
let log = [];
for (const f of new Set(mine)) {
  try { fs.unlinkSync(ROOT + '\\' + f); log.push('del ' + f); } catch (e) { /* already gone */ }
}
try { execFileSync(GIT, ['checkout', '--', 'fixfile.js'], { cwd: ROOT }); log.push('restored fixfile.js'); } catch (e) { log.push('fixfile err ' + (e.stderr || e.message)); }

const SIB = 'C:\\Users\\Arnav Ranjan\\trmi\\forcedtomakeanaccounthere.trmi-x-lovhack-hackathon\\.trmi\\worktrees\\arnav-greptile-fix';
try { fs.rmSync(SIB, { recursive: true, force: true }); log.push('rm sibling dir'); } catch (e) { log.push('sibling err ' + e.message); }

fs.writeFileSync(ROOT + '\\cleanup.txt', log.join('\n'));
