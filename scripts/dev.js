// Dev runner that boots both backend (Node.js) and frontend (React/Vite) concurrently
const { spawn } = require('child_process');
const path = require('path');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

console.log('\x1b[36m%s\x1b[0m', '=======================================================');
console.log('\x1b[32m%s\x1b[0m', '⚡ STARTING ENTERPRISE POS & INVENTORY MANAGEMENT SAAS');
console.log('\x1b[36m%s\x1b[0m', '  Backend:  Node.js + Express (Port 5000)');
console.log('\x1b[36m%s\x1b[0m', '  Frontend: React + Vite + UI-UX Pro Max (Port 5173)');
console.log('\x1b[36m%s\x1b[0m', '=======================================================\n');

function runService(name, dir, color) {
  const proc = spawn(npmCmd, ['run', 'dev'], {
    cwd: path.resolve(__dirname, '..', dir),
    stdio: 'pipe',
    shell: true
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.log(`${color}[${name}]\x1b[0m ${line}`);
      }
    });
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.error(`${color}[${name} ERR]\x1b[0m ${line}`);
      }
    });
  });

  proc.on('close', (code) => {
    console.log(`${color}[${name}]\x1b[0m exited with code ${code}`);
  });

  return proc;
}

const backendProc = runService('BACKEND', 'backend', '\x1b[34m');
const frontendProc = runService('FRONTEND', 'frontend', '\x1b[35m');

process.on('SIGINT', () => {
  console.log('\nShutting down dev servers...');
  backendProc.kill();
  frontendProc.kill();
  process.exit();
});
