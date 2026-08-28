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
const toast=()=>p.locator('#toast').innerText();

// capture what the export anchor would download
await p.evaluate(()=>{ window.__DL=null;
  HTMLAnchorElement.prototype.click=function(){ window.__DL={href:this.href,name:this.download}; }; });

console.log('=== export ===');
await p.evaluate(()=>exportData()); await p.waitForTimeout(600);
const dl = await p.evaluate(()=>window.__DL);
await step('download triggered', async()=> !!dl && dl.name);
const payload = JSON.parse(decodeURIComponent(dl.href.replace(/^data:application\/json;charset=utf-8,/,'')));
await step('envelope is versioned', async()=> payload.workboard===2 ? 'v'+payload.workboard : 'unexpected v'+payload.workboard);
await step('exportedAt present', async()=> typeof payload.exportedAt==='string' && payload.exportedAt.length>10);
await step('tasks included', async()=> payload.tasks.length);
await step('trash included (the old export omitted it)', async()=> payload.trash.length===1 && payload.trash[0].title==='Deleted thing');
await step('meta lists included', async()=> payload.meta.sites.length>0 && payload.meta.persons.length>0);
await step('defaults included', async()=> typeof payload.meta.settings.defaultLabel==='string');
await step('today list included', async()=> Array.isArray(payload.meta.todayFocus));
await step('filename uses the local date', async()=> /^workboard-backup-\d{4}-\d{2}-\d{2}\.json$/.test(dl.name) ? dl.name : false);

console.log('\n=== rejecting bad files ===');
await p.locator('#importFileInput').setInputFiles(fixture('broken.json')); await p.waitForTimeout(500);
await step('invalid JSON refused, no overlay', async()=> (await p.locator('#importOverlay').isVisible())===false);
await step('and it says why', async()=> (await toast()).slice(0,60));
await p.locator('#importFileInput').setInputFiles(fixture('junk.json')); await p.waitForTimeout(500);
await step('valid JSON that is not a backup refused', async()=> (await p.locator('#importOverlay').isVisible())===false);
await step('message names the missing field', async()=> (await toast()).includes('tasks'));

console.log('\n=== preview, merge mode ===');
await p.locator('#importFileInput').setInputFiles(fixture('v1.json')); await p.waitForTimeout(600);
await step('preview overlay opens', async()=> await p.locator('#importOverlay').isVisible());
await step('file name and export date shown', async()=> (await p.locator('#importSub').innerText()).replace(/\s+/g,' '));
await step('three preview sections', async()=> await p.locator('#importBody .merge-field').count()===3);
const rows = async()=> (await p.locator('#importBody .imp-row').allInnerTexts()).map(t=>t.replace(/\s+/g,' ').trim());
await step('merge section numbers', async()=> {
  const r=await rows();
  const add=r.find(x=>x.includes('added')), skip=r.find(x=>x.includes('left alone'));
  return `${add} / ${skip}`;});
await step('replace section warns about deletions', async()=>
  (await p.locator('#importBody .imp-danger').count())>0);
await step('id-less task flagged', async()=>
  (await p.locator('#importBody .imp-warn').innerText()).includes('no id'));

console.log('\n=== run merge ===');
await clearW();
await p.locator('#importMergeBtn').click(); await p.waitForTimeout(1400);
const mw = await writes();
await step('only the unknown tasks were written', async()=>{
  const sets=mw.filter(x=>x.op==='set'&&x.coll==='tasks').map(x=>x.id);
  const adds=mw.filter(x=>x.op==='add'&&x.coll==='tasks').length;
  return (sets.length===1 && sets[0]==='brandnew' && adds===1) ? `set:${sets.join(',')} add:${adds}` : `set:${sets.join(',')} add:${adds}`;});
await step('existing tasks untouched', async()=>
  !mw.some(x=>x.op==='set'&&x.coll==='tasks'&&(x.id==='t1'||x.id==='t2')));
await step('nothing deleted in merge mode', async()=> !mw.some(x=>x.op==='delete'));
await step('restored task keeps its original createdAt when the file has one', async()=>{
  const w=mw.find(x=>x.op==='set'&&x.id==='brandnew');
  if(!w||!w.data) return false;
  // brandnew has no createdAt in the fixture, so it must be stamped fresh
  const fresh = w.data.createdAt==='__ts__';
  // and its id must not be written into the document body
  return (fresh && w.data.id===undefined) ? 'stamped fresh, id stripped' : JSON.stringify(w.data.createdAt);});
await step('reviveTs rebuilds a real Timestamp', async()=>{
  const ms = await p.evaluate(()=>{
    const t=reviveTs({seconds:1786900000,nanoseconds:0});
    return (t && typeof t.toMillis==='function') ? t.toMillis() : -1;});
  return ms===1786900000000;});
await step('sites/persons/labels unioned, not replaced', async()=>
  mw.filter(x=>x.op==='set'&&x.coll==='meta').map(x=>x.id).join(','));
await step('trash not restored in merge mode', async()=> !mw.some(x=>x.coll==='trash'));
await step('completion report shown', async()=> (await p.locator('#importBody').innerText()).includes('Finished with no errors'));
await step('action buttons removed after finishing', async()=>
  (await p.locator('#importMergeBtn').isVisible())===false);
await p.evaluate(()=>closeImport()); await p.waitForTimeout(250);

console.log('\n=== replace mode needs two clicks ===');
await p.locator('#importFileInput').setInputFiles(fixture('v1.json')); await p.waitForTimeout(600);
await clearW();
await p.locator('#importReplaceBtn').click(); await p.waitForTimeout(300);
await step('first click only arms the button', async()=>{
  const label=await p.locator('#importReplaceBtn').innerText();
  const wrote=(await writes()).length;
  return (label.includes('Confirm')&&wrote===0) ? label.trim() : `${label}/${wrote}`;});
await p.locator('#importReplaceBtn').click(); await p.waitForTimeout(1600);
const rw = await writes();
await step('all file tasks written by id', async()=>
  rw.filter(x=>x.op==='set'&&x.coll==='tasks').map(x=>x.id).sort().join(','));
await step('a file timestamp is preserved, not restamped', async()=>{
  const w=rw.find(x=>x.op==='set'&&x.id==='t1');
  if(!w||!w.data)return false;
  const c=w.data.createdAt;
  return (c && c.seconds===1786900000) ? 'createdAt kept: '+c.seconds : 'got '+JSON.stringify(c);});
await step('a task without a file timestamp is stamped fresh', async()=>{
  const w=rw.find(x=>x.op==='set'&&x.id==='t2');
  return !!w && w.data && w.data.createdAt==='__ts__';});
await step('board-only tasks deleted', async()=>
  rw.filter(x=>x.op==='delete'&&x.coll==='tasks').map(x=>x.id).sort().join(','));
await step('defaults and today list overwritten', async()=>{
  const metas=rw.filter(x=>x.op==='set'&&x.coll==='meta').map(x=>x.id);
  return (metas.includes('settings')&&metas.includes('todayFocus')) ? metas.join(',') : metas.join(',');});
await step('trash restored in replace mode', async()=> rw.some(x=>x.coll==='trash'));
await p.evaluate(()=>closeImport()); await p.waitForTimeout(250);

console.log('\n=== old flat format still loads ===');
await p.locator('#importFileInput').setInputFiles(fixture('v0.json')); await p.waitForTimeout(600);
await step('old file accepted', async()=> await p.locator('#importOverlay').isVisible());
await step('flagged as an older format', async()=>
  (await p.locator('#importSub').innerText()).includes('older format'));
await step('its sites are still offered', async()=>
  (await p.locator('#importBody').innerText()).includes('site'));

console.log('\n=== a second import still offers its buttons ===');
await p.evaluate(()=>closeImport()); await p.waitForTimeout(200);
await p.locator('#importFileInput').setInputFiles(fixture('v1.json')); await p.waitForTimeout(600);
await step('merge button visible again after an earlier import finished', async()=>
  await p.locator('#importMergeBtn').isVisible());
await step('replace button visible and disarmed', async()=>
  (await p.locator('#importReplaceBtn').isVisible()) &&
  (await p.locator('#importReplaceBtn').innerText()).includes('Replace everything'));

console.log('\n=== escape closes the import overlay ===');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await step('overlay closed by Escape', async()=> (await p.locator('#importOverlay').isVisible())===false);

console.log('\n'+pass+' passed, '+fail+' failed');
console.log('page errors: '+(errs.length?JSON.stringify(errs.slice(0,5)):'none'));
await b.close();
process.exit(fail?1:0);
