const { execFileSync } = require('child_process');
const fs = require('fs');
const GH = 'C:\\Program Files\\GitHub CLI\\gh.exe';
let out = '';
try { out += 'PR: ' + execFileSync(GH, ['api', 'repos/forcedtomakeanaccounthere/TRMI-x-LOVHACK-Hackathon/pulls/14', '--jq', '{base:.base.ref,head:.head.ref,state:.state,title:.title}'], { encoding: 'utf8' }); } catch (e) { out += 'ERR ' + (e.stderr || e.message); }
out += '\nFILES:\n';
try { out += execFileSync(GH, ['api', 'repos/forcedtomakeanaccounthere/TRMI-x-LOVHACK-Hackathon/pulls/14/files', '--jq', '.[] | .filename + "  (" + .status + ")"'], { encoding: 'utf8' }); } catch (e) { out += 'ERR ' + (e.stderr || e.message); }
fs.writeFileSync(__dirname + '\\pr14files.txt', out);
console.log('done');
