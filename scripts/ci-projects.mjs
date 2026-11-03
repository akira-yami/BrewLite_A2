import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const projects = ['apps/api', 'apps/web'];
const action = process.argv[2];
const stages = ['lint', 'test', 'build'];
if (!['validate', 'install', ...stages].includes(action)) {
  console.error('Usage: node scripts/ci-projects.mjs validate|install|lint|test|build');
  process.exit(1);
}

for (const project of projects) {
  const manifest = `${project}/package.json`;
  const lock = `${project}/package-lock.json`;
  if (!existsSync(manifest) || !existsSync(lock)) {
    console.error(`::error::${project} needs package.json and package-lock.json before CI can run.`);
    process.exit(1);
  }
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch (error) {
    console.error(`::error::Invalid ${manifest}: ${error.message}`);
    process.exit(1);
  }
  for (const stage of stages) {
    if (typeof pkg.scripts?.[stage] !== 'string' || !pkg.scripts[stage].trim()) {
      console.error(`::error::${manifest} needs a non-empty ${stage} script.`);
      process.exit(1);
    }
  }
}

if (action !== 'validate') {
  for (const project of projects) {
    console.log(`CI ${action}: ${project}`);
    const args = action === 'install' ? ['ci'] : ['run', action];
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      cwd: project, stdio: 'inherit', shell: process.platform === 'win32',
    });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
