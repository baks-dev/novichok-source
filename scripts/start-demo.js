// Запуск конечной командой: отдельный процесс продолжает обслуживать локальный демостенд.
import { spawn } from 'node:child_process';
import { openSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
const log = openSync(new URL('../data/server.log', import.meta.url), 'a');
const child = spawn(process.execPath, ['server.js'], { cwd: root, detached: true, stdio: ['ignore', log, log] });
child.unref();
writeFileSync(new URL('../data/server.pid', import.meta.url), String(child.pid));
console.log(`Демо запущено отдельным процессом PID ${child.pid}. Адрес: http://127.0.0.1:3000. Лог: data/server.log`);
