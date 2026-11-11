import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
export const dateOnly = (date = new Date()) => date.toISOString().slice(0, 10);
const offsetDate = (n, base = new Date()) => dateOnly(new Date(Date.parse(dateOnly(base)) + n * 86400000));
export function priority(employee, today = dateOnly()) {
  const latest = employee.checkins.at(-1);
  const reasons = [];
  if (latest) {
    if (!latest.tools) reasons.push('Не хватает доступов или инструментов');
    if (!latest.clarity) reasons.push('Непонятны задачи');
    if (!latest.support) reasons.push('Не к кому обратиться за помощью');
    if (latest.mood === 'bad') reasons.push('Тяжело на новом месте');
  }
  const overdue = employee.actions.some(a => !a.completedAt && a.dueDate < today);
  if (overdue) reasons.push('Просрочена договорённость о помощи');
  if (reasons.length) return { level: 'urgent', label: 'Нужна помощь', reasons };
  const since = latest ? latest.createdAt.slice(0, 10) : employee.startDate;
  if ((Date.parse(today) - Date.parse(since)) / 86400000 >= 7) reasons.push('Нет обратной связи 7 дней или дольше');
  if (!latest) reasons.push('Ещё нет первого ответа');
  if (latest?.mood === 'neutral') reasons.push('Стоит уточнить, как проходит адаптация');
  return reasons.length ? { level: 'attention', label: 'Связаться', reasons } : { level: 'ok', label: 'Без сигналов', reasons: ['В последнем ответе нет препятствий'] };
}

export function createApp({ dbPath = resolve(root, 'data/novichok.sqlite'), now = () => new Date() } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, department TEXT NOT NULL, manager TEXT NOT NULL, buddy TEXT NOT NULL, startDate TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checkins (id INTEGER PRIMARY KEY, employeeId INTEGER NOT NULL REFERENCES employees(id), createdAt TEXT NOT NULL, mood TEXT NOT NULL, clarity INTEGER NOT NULL, tools INTEGER NOT NULL, support INTEGER NOT NULL, comment TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS actions (id INTEGER PRIMARY KEY, employeeId INTEGER NOT NULL REFERENCES employees(id), text TEXT NOT NULL, owner TEXT NOT NULL, dueDate TEXT NOT NULL, createdAt TEXT NOT NULL, completedAt TEXT, result TEXT);`);
  if (!db.prepare('SELECT id FROM employees LIMIT 1').get()) {
    const people = [
      ['Алексей Миронов','Комплектовщик','Склад','Ирина Волкова','Денис Орлов',12,'bad',true,false,true,'На смене нет доступа к терминалу. Прошу чужой, из-за этого не успеваю.'],
      ['Мария Лебедева','Продавец-консультант','Магазины','Олег Романов','Анна Соколова',24,'neutral',false,true,true,'Не понимаю, какие скидки могу согласовывать сама.'],
      ['Тимур Беляев','Менеджер по продажам','Продажи','Елена Лукина','Павел Громов',8,'good',true,true,true,'Первый заказ провели вместе с наставником.'],
      ['Софья Климова','Бухгалтер','Офис','Нина Горина','Алёна Зорина',41,'good',true,true,true,'С закрытием месяца разобралась, спасибо коллегам.'],
      ['Даниил Ветров','Кладовщик','Склад','Ирина Волкова','Денис Орлов',3,null,true,true,true,''],
      ['Алина Осипова','Кассир','Магазины','Олег Романов','Анна Соколова',17,'bad',true,true,false,'В вечернюю смену некому задать вопрос по возвратам.'],
      ['Роман Титов','Менеджер по продажам','Продажи','Елена Лукина','Павел Громов',65,'good',true,true,true,'Уже веду клиентов самостоятельно.'],
      ['Вера Лесная','Оператор склада','Склад','Ирина Волкова','Денис Орлов',88,'good',true,true,true,'Всё понятно, готова помогать следующему новичку.']
    ];
    db.exec('BEGIN');
    try {
      people.forEach((p, i) => {
        db.prepare('INSERT INTO employees VALUES (?,?,?,?,?,?,?)').run(i+1,...p.slice(0,5),offsetDate(-p[5], now()));
        if (p[6]) db.prepare('INSERT INTO checkins(employeeId,createdAt,mood,clarity,tools,support,comment) VALUES(?,?,?,?,?,?,?)').run(i+1,offsetDate(i===3?-10:-1,now())+'T09:00:00.000Z',p[6],+p[7],+p[8],+p[9],p[10]);
      });
      db.prepare('INSERT INTO actions(employeeId,text,owner,dueDate,createdAt) VALUES(?,?,?,?,?)').run(1,'Выдать личный доступ к ТСД и проверить вход на смене','Ирина Волкова',offsetDate(-1,now()),offsetDate(-2,now())+'T11:00:00.000Z');
      db.exec('COMMIT');
    } catch(e) { db.exec('ROLLBACK'); throw e; }
  }
  const send = (res, status, body) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };
  const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
  const error = message => Object.assign(new Error(message), {status:400});
  async function body(req) {
    let raw = ''; for await (const chunk of req) { raw += chunk; if(Buffer.byteLength(raw)>16384) throw Object.assign(new Error('Слишком большой запрос'),{status:413}); }
    try { const value = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; } catch { throw error('Ожидается JSON-объект'); }
  }
  const server = http.createServer(async (req,res) => {
    try {
      const url = new URL(req.url,'http://localhost');
      if(req.method === 'GET' && url.pathname === '/api/dashboard') {
        const today = dateOnly(now());
        const employees = db.prepare('SELECT * FROM employees').all().map(e => {
          const checkins = db.prepare('SELECT * FROM checkins WHERE employeeId=? ORDER BY createdAt,id').all(e.id).map(c=>({...c,clarity:!!c.clarity,tools:!!c.tools,support:!!c.support}));
          const actions = db.prepare('SELECT * FROM actions WHERE employeeId=? ORDER BY id').all(e.id);
          const employee = {...e,day:Math.floor((Date.parse(today)-Date.parse(e.startDate))/86400000)+1,checkins,actions};
          return {...employee,priority:priority(employee,today)};
        }).filter(e => e.day>=1 && e.day<=90);
        return send(res,200,{today,employees});
      }
      let match;
      if(req.method === 'POST' && (match = url.pathname.match(/^\/api\/employees\/(\d+)\/(checkins|actions)$/))) {
        const id = Number(match[1]);
        if(!db.prepare('SELECT id FROM employees WHERE id=?').get(id)) return send(res,404,{error:'Сотрудник не найден'});
        const b = await body(req);
        if(match[2] === 'checkins') {
          if(!['good','neutral','bad'].includes(b.mood) || ['clarity','tools','support'].some(k=>typeof b[k]!=='boolean') || (b.comment !== undefined && (typeof b.comment!=='string' || b.comment.length>1500))) throw error('Выберите настроение и ответьте на три вопроса; комментарий — до 1500 символов');
          db.prepare('INSERT INTO checkins(employeeId,createdAt,mood,clarity,tools,support,comment) VALUES(?,?,?,?,?,?,?)').run(id,now().toISOString(),b.mood,+b.clarity,+b.tools,+b.support,(b.comment||'').trim());
        } else {
          if(!text(b.text,500) || !text(b.owner,100) || typeof b.dueDate!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate) || !Number.isFinite(Date.parse(b.dueDate)) || dateOnly(new Date(b.dueDate))!==b.dueDate || b.dueDate<dateOnly(now())) throw error('Укажите действие (до 500 символов), ответственного и корректный срок не раньше сегодня');
          db.prepare('INSERT INTO actions(employeeId,text,owner,dueDate,createdAt) VALUES(?,?,?,?,?)').run(id,b.text.trim(),b.owner.trim(),b.dueDate,now().toISOString());
        }
        return send(res,201,{ok:true});
      }
      if(req.method === 'POST' && (match=url.pathname.match(/^\/api\/actions\/(\d+)\/complete$/))) {
        const b = await body(req);
        if(!text(b.result,1000)) throw error('Опишите результат помощи (до 1000 символов)');
        const action=db.prepare('SELECT * FROM actions WHERE id=?').get(Number(match[1]));
        if(!action) return send(res,404,{error:'Действие не найдено'});
        if(action.completedAt) return send(res,409,{error:'Действие уже завершено'});
        db.prepare('UPDATE actions SET completedAt=?,result=? WHERE id=?').run(now().toISOString(),b.result.trim(),action.id);
        return send(res,200,{ok:true});
      }
      if(url.pathname.startsWith('/api/')) return send(res,404,{error:'Маршрут не найден'});
      if(req.method!=='GET') return send(res,405,{error:'Метод не поддерживается'});
      const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css'};
      const file=files[url.pathname];
      if(!file) return send(res,404,{error:'Страница не найдена'});
      const content=readFileSync(resolve(root,'public',file));
      res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(file)],'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
      res.end(content);
    } catch(e) { if(!e.status) console.error(e); send(res,e.status||500,{error:e.status?e.message:'Ошибка сервера. Попробуйте ещё раз.'}); }
  });
  return {server,db};
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {server} = createApp();
  server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`НОВИЧОК: http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||3000}`));
}
