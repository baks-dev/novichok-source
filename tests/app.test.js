import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, priority } from '../server.js';
const now = () => new Date('2026-11-11T12:00:00Z');
async function start(dbPath=':memory:') {
  const app=createApp({dbPath,now});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${app.server.address().port}`;
  return {...app,url,close:async()=>{await new Promise(r=>app.server.close(r));app.db.close();}};
}
async function post(app,path,body) {return fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
const dashboard=async app=>(await fetch(app.url+'/api/dashboard')).json();
test('Демо: восемь новичков, прозрачные приоритеты и текущая дата',async()=>{
  const app=await start();try {
    const data=await dashboard(app);assert.equal(data.employees.length,8);assert.equal(data.today,'2026-11-11');
    assert.equal(data.employees[0].day,13);assert.equal(data.employees[0].priority.level,'urgent');
    assert.equal(data.employees[2].priority.level,'ok');assert.equal(data.employees[3].priority.level,'attention');
  } finally {await app.close();}
});
test('Основной сценарий: ответ → помощь → результат → подтверждение новичком; сохранность после перезапуска',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'novichok-'));let app=await start(join(dir,'test.sqlite'));
  try {
    let r=await post(app,'/api/employees/3/checkins',{mood:'bad',clarity:true,tools:false,support:true,comment:'Нет доступа'});assert.equal(r.status,201);
    assert.equal((await dashboard(app)).employees[2].priority.level,'urgent');
    r=await post(app,'/api/employees/3/actions',{text:'Выдать доступ',owner:'Руководитель',dueDate:'2026-11-12'});assert.equal(r.status,201);
    let employee=(await dashboard(app)).employees[2];const id=employee.actions[0].id;
    assert.equal((await post(app,`/api/actions/${id}/complete`,{result:''})).status,400);
    assert.equal((await post(app,`/api/actions/${id}/complete`,{result:'Доступ выдан и проверен'})).status,200);
    assert.equal((await post(app,`/api/actions/${id}/complete`,{result:'Повтор'})).status,409);
    assert.equal((await dashboard(app)).employees[2].priority.level,'urgent','Закрытие задачи не скрывает сигнал новичка');
    await post(app,'/api/employees/3/checkins',{mood:'good',clarity:true,tools:true,support:true,comment:'Теперь работает'});
    await app.close();app=await start(join(dir,'test.sqlite'));
    employee=(await dashboard(app)).employees[2];assert
.equal(employee.priority.level,'ok');assert.equal(employee.checkins.length,3);assert.equal(employee.actions[0].result,'Доступ выдан и проверен');
  } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('Валидация: обязательные ответы, лимиты, сроки, неизвестные сущности',async()=>{
 const app=await start();try {
  for(const body of [{},{mood:'good',clarity:'true',tools:true,support:true},{mood:'bad',clarity:true,tools:true,support:true,comment:'x'.repeat(1501)}]) assert.equal((await post(app,'/api/employees/1/checkins',body)).status,400);
  for(const dueDate of ['2026-11-10','2026-02-30','not-a-date']) assert.equal((await post(app,'/api/employees/1/actions',{text:'Помощь',owner:'Ирина',dueDate})).status,400);
  assert.equal((await post(app,'/api/employees/99/checkins',{})).status,404);
  assert.equal((await post(app,'/api/actions/999/complete',{result:'Ок'})).status,404);
  assert.equal((await fetch(app.url+'/api/employees/1/checkins',{method:'POST',body:'{'})).status,400);
  assert.equal((await fetch(app.url+'/api/employees/1/checkins',{method:'POST',body:'x'.repeat(17000)})).status,413);
 } finally {await app.close();}
});
test('Правила: семь дней без ответа и просрочка',()=>{
 const e={startDate:'2026-11-01',checkins:[{createdAt:'2026-11-04T10:00:00Z',mood:'good',clarity:true,tools:true,support:true}],actions:[]};
 assert.equal(priority(e,'2026-11-10').level,'ok');assert.equal(priority(e,'2026-11-11').level,'attention');
 e.actions=[{dueDate:'2026-11-10',completedAt:null}];assert.equal(priority(e,'2026-11-11').level,'urgent');
});
test('Очередь включает 90-й день, но исключает 91-й и будущие приёмы',async()=>{
 const app=await start();try {
  app.db.prepare('UPDATE employees SET startDate=? WHERE id=1').run('2026-08-14');
  app.db.prepare('UPDATE employees SET startDate=? WHERE id=2').run('2026-08-13');
  app.db.prepare('UPDATE employees SET startDate=? WHERE id=3').run('2026-11-12');
  const data=await dashboard(app);
  assert.equal(data.employees.find(e=>e.id===1).day,90);
  assert.equal(data.employees.some(e=>e.id===2),false);
  assert.equal(data.employees.some(e=>e.id===3),false);
 } finally {await app.close();}
});
test('Статика и заголовки безопасности; пути вне allowlist недоступны',async()=>{
 const app=await start();try {
  const response=await fetch(app.url);assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(await response.text(),/НОВИЧОК/);
  assert.equal((await fetch(app.url+'/server.js')).status,404);
 } finally {await app.close();}
});
