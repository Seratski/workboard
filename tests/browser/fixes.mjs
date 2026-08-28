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
const p = await b.newPage({ viewport:{width:1400,height:950} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto('http://127.0.0.1:8777/test.html'); await p.waitForTimeout(700);
let pass=0,fail=0;
const step=async(n,f)=>{try{const r=await f();if(r===false){fail++;console.log('FAIL '+n);}else{pass++;console.log('OK   '+n+(r!==true&&r!==undefined?' :: '+r:''));}}catch(e){fail++;console.log('FAIL '+n+' :: '+e.message);}};
const writes=()=>p.evaluate(()=>window.__WB_WRITES);
const clearW=()=>p.evaluate(()=>{window.__WB_WRITES=[];});

console.log('=== FIX 1: rich formatting survives a save ===');
// existing HTML note loads as HTML into the editor
await p.evaluate(()=>openRichEditor('t2')); await p.waitForTimeout(400);
await step('HTML note loads as markup, not escaped text', async()=>{
  const h=await p.locator('#richBody').innerHTML();
  return h.includes('<h1>')&&h.includes('<b>')&&h.includes('<li>') ? h.slice(0,48)+'…' : false;});
await step('toolbar H1 button present', async()=> await p.locator('.rich-tb-btn', {hasText:'H1'}).count()>0);

// type + bold, then save, and inspect what hits the database
await clearW();
await p.evaluate(()=>{document.getElementById('richBody').innerHTML='<h2>Section</h2><p>plain then <b>bold</b></p><ul><li>a</li></ul>';});
await p.evaluate(()=>saveRichTask()); await p.waitForTimeout(600);
await step('save writes richHtml:true', async()=>{
  const w=(await writes()).filter(x=>x.op==='update'); return w.length&&w[w.length-1].data.richHtml===true;});
await step('save stores HTML in richBody', async()=>{
  const w=(await writes()).filter(x=>x.op==='update'); const rb=w[w.length-1].data.richBody;
  return rb.includes('<h2>')&&rb.includes('<b>')&&rb.includes('<li>') ? rb : false;});
await step('note holds the plain-text preview', async()=>{
  const w=(await writes()).filter(x=>x.op==='update'); const n=w[w.length-1].data.note;
  return (!n.includes('<')&&n.includes('Section')&&n.includes('bold')) ? JSON.stringify(n) : false;});

// detail modal rendering
await p.waitForTimeout(300);
await p.evaluate(()=>{closeRichEditor();openDetail('t2');}); await p.waitForTimeout(400);
await step('HTML body rendered with is-html class', async()=> await p.locator('.detail-rich-body.is-html').count()===1);
await step('formatting visible as real elements (not escaped text)', async()=>{
  const h=await p.locator('.detail-rich-body').innerHTML();
  const t=await p.locator('.detail-rich-body').innerText();
  // the stub only emits one snapshot, so this reads the fixture body, which is what matters:
  // headings, bold and lists must render as elements and not leak as literal text
  return (h.includes('<h1>')&&h.includes('<b>')&&h.includes('<li>')&&!t.includes('<h1>'))
    ? 'h1+b+li rendered, no tags in text' : false;});
await p.evaluate(()=>closeDetail()); await p.waitForTimeout(200);

// old plain-text note must not be treated as HTML
await p.evaluate(()=>openDetail('t1')); await p.waitForTimeout(400);
await step('plain note still renders as plain (no is-html)', async()=>
  (await p.locator('.detail-rich-body.is-html').count())===0 && (await p.locator('.detail-rich-body').count())===1);
await step('URL in plain note still linkified', async()=>
  (await p.locator('.detail-rich-body a').count())>0);
await p.evaluate(()=>closeDetail()); await p.waitForTimeout(200);

// URLs inside an HTML body linkified via text nodes
await p.evaluate(()=>{window.__DATA.tasks.find(t=>t.id==='t2').richBody='<p>see https://example.com/z now</p>';
  window.__DATA.tasks.find(t=>t.id==='t2').richHtml=true; startListeners&&0;});
await p.evaluate(()=>openDetail('t2')); await p.waitForTimeout(300);
await step('URL inside HTML body linkified without breaking tags', async()=>{
  const h=await p.locator('.detail-rich-body').innerHTML();
  return h.includes('<a ')&&h.includes('<p>')?'anchor inside <p>':false;});
await p.evaluate(()=>closeDetail()); await p.waitForTimeout(200);

// search must not match tag names
await p.fill('#searchInput','href'); await p.waitForTimeout(300);
await step('search does not match HTML tag/attr names', async()=> (await p.locator('[id^="tc-"]').count())===0);
await p.fill('#searchInput','example.com'); await p.waitForTimeout(300);
await step('search does match text inside an HTML body', async()=> (await p.locator('[id^="tc-"]').count())>0);
await p.fill('#searchInput',''); await p.waitForTimeout(300);

console.log('\n=== FIX 2: autosave actually saves ===');
// existing note -> Firestore
await clearW();
await p.evaluate(()=>openRichEditor('t1')); await p.waitForTimeout(300);
await p.evaluate(()=>{document.getElementById('richBody').innerHTML='<p>edited by autosave</p>';richAutoSave();});
await step('status shows Saving… immediately', async()=> (await p.locator('#richSaveStatus').innerText()).trim());
await p.waitForTimeout(1800);
await step('autosave wrote to Firestore', async()=>{
  const w=(await writes()).filter(x=>x.op==='update'&&x.id==='t1'); return w.length>0 ? w.length+' update(s)' : false;});
await step('status now says Saved to board', async()=> (await p.locator('#richSaveStatus').innerText()).trim());
await step('autosave did not append a history entry', async()=>{
  const w=(await writes()).filter(x=>x.op==='update'&&x.id==='t1'); return !('history' in w[w.length-1].data);});
await step('autosave keeps existing title when field emptied', async()=>{
  await p.evaluate(()=>{document.getElementById('richTitle').value='';richAutoSave();});
  await p.waitForTimeout(1700);
  const w=(await writes()).filter(x=>x.op==='update'&&x.id==='t1');
  return !('title' in w[w.length-1].data);});
await p.evaluate(()=>closeRichEditor()); await p.waitForTimeout(400);

// new note -> localStorage only
await p.evaluate(()=>{try{localStorage.removeItem('wb_rich_draft');}catch(e){}});
await clearW();
await p.evaluate(()=>openRichEditor(null)); await p.waitForTimeout(300);
await p.evaluate(()=>{document.getElementById('richTitle').value='Brand new thing';
  document.getElementById('richBody').innerHTML='<p>draft <b>body</b></p>';richAutoSave();});
await p.waitForTimeout(1800);
await step('new note NOT written to Firestore', async()=> (await writes()).filter(x=>x.op==='add').length===0);
await step('new note stored in localStorage', async()=>{
  const d=await p.evaluate(()=>localStorage.getItem('wb_rich_draft'));
  return d && JSON.parse(d).title==='Brand new thing' ? 'draft present' : false;});
await step('status says Draft saved locally', async()=> (await p.locator('#richSaveStatus').innerText()).trim());

// leave without saving, reopen -> restored
await p.evaluate(()=>closeRichEditor()); await p.waitForTimeout(400);
await p.evaluate(()=>openRichEditor(null)); await p.waitForTimeout(500);
await step('draft restored on reopen', async()=>
  (await p.locator('#richTitle').inputValue())==='Brand new thing');
await step('restored body keeps formatting', async()=>
  (await p.locator('#richBody').innerHTML()).includes('<b>'));
await step('status tells you it was restored', async()=> (await p.locator('#richTaskStatus').innerText()).trim());

// explicit save clears the draft
await clearW();
await p.evaluate(()=>saveRichTask()); await p.waitForTimeout(700);
await step('explicit save creates the task', async()=> (await writes()).filter(x=>x.op==='add').length===1);
await step('localStorage draft cleared after save', async()=>
  (await p.evaluate(()=>localStorage.getItem('wb_rich_draft')))===null);
await step('saved task carries richHtml + HTML body', async()=>{
  const a=(await writes()).filter(x=>x.op==='add')[0];
  return a.data.richHtml===true && a.data.richBody.includes('<b>');});

// discard clears the draft too
await p.evaluate(()=>openRichEditor(null)); await p.waitForTimeout(300);
await p.evaluate(()=>{document.getElementById('richTitle').value='to discard';richAutoSave();});
await p.waitForTimeout(1700);
p.once('dialog',d=>d.accept());
await p.evaluate(()=>deleteRichDraft()); await p.waitForTimeout(500);
await step('discard clears the local draft', async()=>
  (await p.evaluate(()=>localStorage.getItem('wb_rich_draft')))===null);

console.log('\n'+pass+' passed, '+fail+' failed');
console.log('page errors: '+(errs.length?JSON.stringify(errs.slice(0,5)):'none'));
await b.close();
process.exit(fail?1:0);
