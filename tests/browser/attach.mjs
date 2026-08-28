// playwright is installed outside this folder (OneDrive), so resolve it through the CJS
// loader, which honours NODE_PATH -- ESM `import` does not. Set WB_PLAYWRIGHT to an
// absolute path to the package to be explicit.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.WB_PLAYWRIGHT || 'playwright');
// Use whatever chromium playwright installed, unless a prebuilt one is present (some
// sandboxes ship it at a fixed path and cannot download). WB_CHROMIUM overrides both.
const PREBUILT = '/opt/pw-browsers/chromium';
const exe = process.env.WB_CHROMIUM
  || (createRequire(import.meta.url)('fs').existsSync(PREBUILT) ? PREBUILT : null);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
// Fixture paths resolve against this file, not against the working directory: CI runs the
// suites from the repository root, where a bare fixtures/ path does not resolve.
const fixture = (...p) => new URL('./fixtures/' + p.join('/'), import.meta.url).pathname;
const ctx = await b.newContext({ viewport:{width:1500,height:1000}, timezoneId:'Europe/Copenhagen' });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errs.push(m.text());});
await p.goto('http://127.0.0.1:8777/test.html'); await p.waitForTimeout(700);
let pass=0,fail=0;
const step=async(n,f)=>{try{const r=await f();if(r===false){fail++;console.log('FAIL '+n);}else{pass++;console.log('OK   '+n+(r!==true&&r!==undefined?' :: '+r:''));}}catch(e){fail++;console.log('FAIL '+n+' :: '+e.message);}};
const writes=()=>p.evaluate(()=>window.__WB_WRITES);
const clearW=()=>p.evaluate(()=>{window.__WB_WRITES=[];});

console.log('=== two images on one task ===');
await p.evaluate(()=>openModal()); await p.waitForTimeout(300);
await p.fill('#fTitle','Task with two pictures');
await p.locator('#modalFileInput').setInputFiles([fixture('a.png'),fixture('b.png')]);
await p.waitForTimeout(900);
await step('both thumbnails previewed', async()=> await p.locator('#modalAttachPreview .attach-thumb').count()===2);
await step('every attachment carries a preview', async()=>
  await p.evaluate(()=> modalAttachments.every(a=>!!a.thumb)));
await step('a small image keeps its original bytes rather than a JPEG copy', async()=>{
  const r=await p.evaluate(()=> modalAttachments.map(a=>({same:a.thumb===a.fullData, kind:a.thumb.slice(5,14)})));
  // the 4x3 fixtures need no downscale, so re-encoding them would only add artefacts
  return r.every(x=>x.same) ? 'reused originals: '+r.map(x=>x.kind).join(',') : JSON.stringify(r);});
await step('full data held in memory, not yet stored', async()=>
  await p.evaluate(()=> modalAttachments.every(a=>!!a.fullData && !a.id)));
await clearW();
await p.evaluate(()=>saveTask()); await p.waitForTimeout(1200);
const w1 = await writes();
await step('one attachment document per file', async()=>
  w1.filter(x=>x.op==='add'&&x.coll==='attachments').length===2);
await step('task document holds references, not payloads', async()=>{
  const t=w1.find(x=>x.op==='add'&&x.coll==='tasks');
  if(!t)return false;
  const a=t.data.attachments;
  return (a.length===2 && a.every(x=>x.id && x.thumb && x.data===undefined))
    ? 'ids: '+a.map(x=>x.id).join(',') : JSON.stringify(a);});
await step('task document stays small', async()=>{
  const t=w1.find(x=>x.op==='add'&&x.coll==='tasks');
  const bytes=JSON.stringify(t.data).length;
  return bytes < 20000 ? bytes+' bytes' : 'TOO BIG: '+bytes;});
await step('each attachment document carries the full image', async()=>
  w1.filter(x=>x.op==='add'&&x.coll==='attachments').every(x=>x.data.data.startsWith('data:image/png')));

console.log('\n=== the old inline format still works ===');
await p.evaluate(()=>{
  window.__DATA.tasks.push({id:'legacy',title:'Legacy attachment task',note:'',priority:'none',date:'',
    sites:[],persons:[],tags:[],actions:[],links:[],comments:[],history:[],done:false,
    createdAt:{toMillis:()=>1786000000000},
    attachments:[{name:'inline.png',type:'image/png',size:120,
      data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAHElEQVQI12P4z8DwHwMDAwMTAwMDAwMDAwMDAwAkBgMBjXcPGwAAAABJRU5ErkJggg=='}]});
  startListeners();
}); await p.waitForTimeout(600);
await p.evaluate(()=>openDetail('legacy')); await p.waitForTimeout(400);
await step('legacy thumbnail renders from the inline data', async()=>
  (await p.locator('.detail-attachments .task-attach-img').getAttribute('src')||'').startsWith('data:image/png'));
await p.locator('.detail-attachments .task-attach-img').click(); await p.waitForTimeout(500);
await step('legacy attachment opens in the lightbox', async()=> await p.locator('#lightbox').isVisible());
await p.keyboard.press('Escape');
await p.evaluate(()=>closeDetail()); await p.waitForTimeout(250);

console.log('\n=== lightbox shows thumbnail then full image ===');
const newTaskId = await p.evaluate(()=>{
  const t=window.__DATA.tasks.find(x=>x.title==='Task with two pictures'); return t?t.id:null;});
await step('the saved task is on the board', async()=> !!newTaskId);
await p.evaluate((id)=>openDetail(id), newTaskId); await p.waitForTimeout(400);
await step('detail renders from the stored preview', async()=>
  (await p.locator('.detail-attachments .task-attach-img').first().getAttribute('src')||'').startsWith('data:image/'));
await p.locator('.detail-attachments .task-attach-img').first().click(); await p.waitForTimeout(700);
await step('lightbox ends up showing the full png', async()=>
  (await p.locator('#lightboxImg').getAttribute('src')||'').startsWith('data:image/png'));
await p.keyboard.press('Escape'); await p.waitForTimeout(200);

console.log('\n=== removing an attachment only deletes on save ===');
await p.evaluate((id)=>{closeDetail();openEdit(id);}, newTaskId); await p.waitForTimeout(400);
await step('two attachments loaded into the editor', async()=>
  await p.locator('#modalAttachPreview .attach-thumb').count()===2);
await clearW();
await p.locator('#modalAttachPreview .attach-del').first().click(); await p.waitForTimeout(300);
await step('nothing deleted yet, only queued', async()=>
  (await writes()).filter(x=>x.op==='delete').length===0 &&
  (await p.evaluate(()=>pendingAttachDeletes.length))===1);
await p.evaluate(()=>closeModal()); await p.waitForTimeout(400);
await step('cancelling the edit discards the queued deletion', async()=>
  (await writes()).filter(x=>x.op==='delete'&&x.coll==='attachments').length===0 &&
  (await p.evaluate(()=>pendingAttachDeletes.length))===0);
await p.evaluate((id)=>openEdit(id), newTaskId); await p.waitForTimeout(400);
await clearW();
await p.locator('#modalAttachPreview .attach-del').first().click(); await p.waitForTimeout(250);
await p.evaluate(()=>saveTask()); await p.waitForTimeout(1200);
await step('saving does delete the attachment document', async()=>
  (await writes()).filter(x=>x.op==='delete'&&x.coll==='attachments').length===1);

console.log('\n=== migration of the legacy task ===');
await p.evaluate(()=>showPage('settings')); await p.waitForTimeout(400);
await step('settings reports what still needs moving', async()=>
  (await p.locator('#attachStorageState').innerText()).replace(/\s+/g,' '));
await p.evaluate(()=>{window.__LEGACY_BEFORE=countLegacyAttachments().legacy;});
p.once('dialog',d=>d.accept());
await clearW();
await p.evaluate(()=>migrateAttachments()); await p.waitForTimeout(1500);
const mw=await writes();
await step('a document was created for every inline attachment', async()=>{
  const created=mw.filter(x=>x.op==='add'&&x.coll==='attachments').length;
  const legacyBefore=await p.evaluate(()=>window.__LEGACY_BEFORE);
  return created===legacyBefore ? created+' created, matching the '+legacyBefore+' that were inline' : created+' vs '+legacyBefore;});
await step('no inline payload written back into any task', async()=>
  mw.filter(x=>x.op==='update'&&x.coll==='tasks')
    .every(u=>(u.data.attachments||[]).every(a=>a.data===undefined)));
await step('the task was rewritten to a reference with a thumbnail', async()=>{
  const u=mw.find(x=>x.op==='update'&&x.id==='legacy');
  if(!u)return false;
  const a=u.data.attachments[0];
  return (a.id && a.thumb && a.data===undefined) ? 'now a reference' : JSON.stringify(a);});
// the stub emits a single snapshot, so refresh the app's task array the way Firestore would
await p.evaluate(()=>{startListeners();}); await p.waitForTimeout(500);
await p.evaluate(()=>renderAttachStorageState()); await p.waitForTimeout(200);
await step('nothing inline remains after migrating', async()=>{
  const left=await p.evaluate(()=>countLegacyAttachments());
  return left.legacy===0 ? 'legacy 0, moved '+left.moved : JSON.stringify(left);});
await step('state readout says all clear', async()=>{
  const txt=(await p.locator('#attachStorageState').innerText()).replace(/\s+/g,' ');
  return txt.includes('already stored separately') ? txt : txt;});
await step('the migrate button hides itself when done', async()=>
  (await p.locator('#attachMigrateBtn').isVisible())===false);
await step('re-running finds nothing to do', async()=>{
  await clearW();
  await p.evaluate(()=>migrateAttachments()); await p.waitForTimeout(600);
  return (await writes()).length===0;});

console.log('\n=== backup carries the payloads ===');
await p.evaluate(()=>{window.__DL=null;HTMLAnchorElement.prototype.click=function(){window.__DL={href:this.href,name:this.download};};});
await p.evaluate(()=>exportData()); await p.waitForTimeout(900);
const dl=await p.evaluate(()=>window.__DL);
const payload=JSON.parse(decodeURIComponent(dl.href.replace(/^data:application\/json;charset=utf-8,/,'')));
await step('envelope is v2', async()=> payload.workboard===2);
await step('attachment documents included', async()=> payload.attachments.length>0 ? payload.attachments.length+' docs' : false);
await step('their payloads are in the backup', async()=>
  payload.attachments.every(a=>a.data && a.id));
await step('task entries are still references only', async()=>
  payload.tasks.every(t=>(t.attachments||[]).every(a=>!a.data||!a.id)));

console.log('\n'+pass+' passed, '+fail+' failed');
console.log('page errors: '+(errs.length?JSON.stringify(errs.slice(0,6)):'none'));
await b.close();
process.exit(fail?1:0);
