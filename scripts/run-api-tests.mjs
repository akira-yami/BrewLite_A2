import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const apiDir = resolve(rootDir, 'apps/api');
const logsDir = resolve(rootDir, 'logs');
const postmanDir = resolve(rootDir, 'postman');

mkdirSync(logsDir, { recursive: true });

const collectionPath = resolve(postmanDir, 'BrewLite_API.postman_collection.json');
const environmentPath = resolve(postmanDir, 'BrewLite_Environment.postman_environment.json');
const runLogPath = resolve(logsDir, 'api-test-run.log');
const errorLogPath = resolve(logsDir, 'api-test-errors.log');
const reportJsonPath = resolve(logsDir, 'newman-report.json');

console.log('=====================================================');
console.log('   BrewLite API Test Suite & Diagnostics Runner      ');
console.log('=====================================================');
console.log(`Collection  : ${collectionPath}`);
console.log(`Environment : ${environmentPath}`);
console.log(`Logs Dir    : ${logsDir}`);
console.log('-----------------------------------------------------');

async function checkHealth(url = 'http://localhost:3001/api/v1/health') {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      return data?.success === true && data?.data?.status === 'ok';
    }
  } catch {
    return false;
  }
  return false;
}

async function waitForServer(timeoutMs = 25000) {
  const start = Date.now();
  process.stdout.write('Waiting for API server to be healthy');
  while (Date.now() - start < timeoutMs) {
    if (await checkHealth()) {
      process.stdout.write(' [READY]\n');
      return true;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 800));
  }
  process.stdout.write(' [TIMEOUT]\n');
  return false;
}

let spawnedServer = null;

function cleanup() {
  if (spawnedServer && !spawnedServer.killed) {
    console.log('\n[INFO] Stopping auto-started API server...');
    try {
      spawnedServer.kill('SIGTERM');
    } catch {}
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

try {
  let isReady = await checkHealth();

  if (!isReady) {
    console.log('[INFO] API server is not running on http://localhost:3001.');
    console.log('[INFO] Attempting to auto-start NestJS API server...');

    const distMainPath = resolve(apiDir, 'dist/main.js');
    if (!existsSync(distMainPath)) {
      console.log('[INFO] dist/main.js not found. Building NestJS project...');
      execSync('npm run build', { cwd: apiDir, stdio: 'inherit' });
    }

    spawnedServer = spawn('node', ['dist/main.js'], {
      cwd: apiDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    spawnedServer.stdout.on('data', (d) => {
      const text = d.toString();
      if (text.includes('ERROR') || text.includes('failed')) {
        process.stderr.write(text);
      }
    });
    spawnedServer.stderr.on('data', (d) => {
      process.stderr.write(d.toString());
    });

    isReady = await waitForServer(30000);
    if (!isReady) {
      throw new Error(
        'Could not start API server within 30s. Please ensure PostgreSQL is running (e.g., docker compose up -d postgres) and apps/api/.env is configured.',
      );
    }
  } else {
    console.log('[INFO] Connected to existing API server running on http://localhost:3001 [OK]');
  }

  const startTime = new Date();
  const logHeader = `[${startTime.toISOString()}] Starting BrewLite API test run...\n`;
  writeFileSync(runLogPath, logHeader, 'utf-8');

  // Newman runner: prefer local newman binary in node_modules/.bin, fallback to npx newman
  const isWin = process.platform === 'win32';
  const winNewman = resolve(apiDir, 'node_modules/.bin/newman.cmd');
  const unixNewman = resolve(apiDir, 'node_modules/.bin/newman');
  let newmanBin = 'npx --yes newman';

  if (isWin && existsSync(winNewman)) {
    newmanBin = `"${winNewman}"`;
  } else if (!isWin && existsSync(unixNewman)) {
    newmanBin = `"${unixNewman}"`;
  }

  const command = `${newmanBin} run "${collectionPath}" -e "${environmentPath}" --reporters cli,json --reporter-json-export "${reportJsonPath}"`;
  console.log('Executing Postman collection via Newman...\n');

  let output = '';
  try {
    output = execSync(command, {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    output = (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : '');
    if (!output && err.message) {
      output = err.message;
    }
  }

  appendFileSync(runLogPath, output + '\n', 'utf-8');
  console.log(output);

  if (existsSync(reportJsonPath)) {
    const report = JSON.parse(readFileSync(reportJsonPath, 'utf-8'));
    const stats = report.run.stats;
    const failures = report.run.failures || [];

    const summaryText = `
-----------------------------------------------------
TEST SUMMARY:
- Total Requests   : ${stats.requests.total} (Executed: ${stats.requests.execute || stats.requests.total}, Failed: ${stats.requests.failed})
- Total Assertions : ${stats.assertions.total} (Passed: ${stats.assertions.total - stats.assertions.failed}, Failed: ${stats.assertions.failed})
- Total Duration   : ${report.run.timings.completed - report.run.timings.started} ms
- Failures Count   : ${failures.length}
-----------------------------------------------------
`;
    console.log(summaryText);
    appendFileSync(runLogPath, summaryText + '\n', 'utf-8');

    if (failures.length > 0) {
      console.error(`[!] Found ${failures.length} failure(s). Writing details to ${errorLogPath}...`);
      let errorReport = `=====================================================\n`;
      errorReport += `BrewLite API Test Error Log - ${new Date().toISOString()}\n`;
      errorReport += `Total Failures: ${failures.length}\n`;
      errorReport += `=====================================================\n\n`;

      failures.forEach((f, idx) => {
        errorReport += `Failure #${idx + 1}:\n`;
        errorReport += `  Parent Folder: ${f.parent?.name || 'Root'}\n`;
        errorReport += `  Request Name : ${f.source?.name || 'Unknown'}\n`;
        errorReport += `  Test Name    : ${f.error?.test || 'N/A'}\n`;
        errorReport += `  Error Name   : ${f.error?.name || 'Error'}\n`;
        errorReport += `  Error Message: ${f.error?.message || 'Unknown error'}\n`;
        if (f.error?.stack) {
          errorReport += `  Stack Trace  :\n    ${f.error.stack.split('\n').join('\n    ')}\n`;
        }
        errorReport += `-----------------------------------------------------\n`;
      });

      writeFileSync(errorLogPath, errorReport, 'utf-8');
      console.log(`[!] Error log written to: ${errorLogPath}`);
      process.exit(1);
    } else {
      console.log('>>> ALL API TESTS PASSED SUCCESSFULLY! (0 failures) <<<');
      const successLog = `[${new Date().toISOString()}] ALL API TESTS PASSED! (Executed: ${stats.requests.total} requests, ${stats.assertions.total} assertions, 0 failures)\n`;
      appendFileSync(runLogPath, successLog, 'utf-8');
    }
  }
} catch (error) {
  console.error('Fatal error running API tests:', error.message);
  const fatalLog = `[${new Date().toISOString()}] FATAL ERROR:\n${error.stack || error.message}\n`;
  appendFileSync(runLogPath, fatalLog, 'utf-8');
  writeFileSync(errorLogPath, fatalLog, 'utf-8');
  process.exit(1);
} finally {
  cleanup();
}
