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
const errs=[];
p.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
p.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
await p.goto('file:///tmp/wbtest/test.html');
await p.waitForTimeout(700);

const step = async (name, fn) => { try { const r = await fn(); console.log(`OK   ${name}${r!==undefined?' :: '+r:''}`); return r; } catch(e){ console.log(`FAIL ${name} :: ${e.message}`); } };

await step('app shell visible', async()=> await p.locator('#appShell').isVisible());
await step('task rows rendered', async()=> await p.locator('[id^="tc-"]').count());

// open the first task's detail modal
await p.locator('#tc-t1').click();
await p.waitForTimeout(300);
await step('detail modal open', async()=> await p.locator('#detailOverlay').isVisible());
await step('Merge button visible', async()=> await p.locator('#detailMergeBtn').isVisible());
await step('Merge button label', async()=> (await p.locator('#detailMergeBtn').innerText()).trim());

// click Merge
await p.locator('#detailMergeBtn').click();
await p.waitForTimeout(300);
await step('picker overlay open', async()=> await p.locator('#mergePickerOverlay').isVisible());
await step('primary name shown', async()=> await p.locator('#mergePrimaryName').innerText());
const rows = p.locator('#mergePickerList .merge-pick-row');
await step('candidate rows', async()=> await rows.count());
await step('row order (unfinished newest first, done last)', async()=>
  (await rows.evaluateAll(els=>els.map(e=>e.getAttribute('data-tid')))).join(' > '));
await step('current task excluded from list', async()=>
  !(await rows.evaluateAll(els=>els.map(e=>e.getAttribute('data-tid')))).includes('t1'));
await step('count note', async()=> (await p.locator('#mergePickerList .merge-note').last().innerText()).trim());
await p.screenshot({ path:'shot1-picker.png' });

// search filter
await p.fill('#mergePickerSearch','duplicate');
await p.waitForTimeout(250);
await step('search narrows list', async()=> await rows.count());
await p.fill('#mergePickerSearch','');
await p.waitForTimeout(250);

// pick t2
await p.locator('#mergePickerList .merge-pick-row[data-tid="t2"]').click();
await p.waitForTimeout(350);
await step('preview overlay open', async()=> await p.locator('#mergePreviewOverlay').isVisible());
await step('picker closed', async()=> await p.locator('#mergePickerOverlay').isVisible()===false);
await step('field groups', async()=> await p.locator('#mergePreviewBody .merge-field').count());
await step('field labels', async()=>
  (await p.locator('#mergePreviewBody .merge-field-label').evaluateAll(e=>e.map(x=>x.innerText.split('\n')[0].trim()))).join(' | '));
await step('BOTH option selected by default', async()=>
  await p.locator('#mergePreviewBody .merge-opt.on').nth(3).innerText().then(t=>t.replace(/\s+/g,' ').slice(0,70)));
await step('default tag present', async()=> await p.locator('.merge-default-tag').count());
await step('size line', async()=> (await p.locator('.merge-size').innerText()).trim());
await step('union stats', async()=>
  (await p.locator('.merge-union-stat').evaluateAll(e=>e.map(x=>x.innerText))).join(', '));
await step('confirm button enabled', async()=> !(await p.locator('#mergeConfirmBtn').isDisabled()));
await p.screenshot({ path:'shot2-preview.png', fullPage:true });

// click the "keep only B" radio for notes and confirm state flips
const notesOpts = p.locator('#mergePreviewBody .merge-field').nth(3).locator('.merge-opt');
await notesOpts.nth(2).click();
await p.waitForTimeout(250);
await step('clicking B selects it', async()=> await notesOpts.nth(2).evaluate(e=>e.className.includes('on')));
await step('BOTH deselected', async()=> !(await notesOpts.nth(0).evaluate(e=>e.className.includes('on'))));
await notesOpts.nth(0).click();
await p.waitForTimeout(200);

// title choice B
const titleOpts = p.locator('#mergePreviewBody .merge-field').nth(0).locator('.merge-opt');
await titleOpts.nth(1).click();
await p.waitForTimeout(200);
await step('title B selected', async()=> await titleOpts.nth(1).evaluate(e=>e.className.includes('on')));

// perform the merge
await p.locator('#mergeConfirmBtn').click();
await p.waitForTimeout(900);
await step('preview closed after merge', async()=> await p.locator('#mergePreviewOverlay').isVisible()===false);
await step('detail closed after merge', async()=> await p.locator('#detailOverlay').isVisible()===false);
await step('firestore writes performed', async()=>
  JSON.stringify(await p.evaluate(()=>window.__WB_WRITES)));
await p.screenshot({ path:'shot3-after.png' });

// Escape closes picker
await p.locator('#tc-t1').click(); await p.waitForTimeout(250);
await p.locator('#detailMergeBtn').click(); await p.waitForTimeout(250);
await p.keyboard.press('Escape'); await p.waitForTimeout(250);
await step('Escape closes picker, detail stays open', async()=>
  (await p.locator('#mergePickerOverlay').isVisible()===false) && (await p.locator('#detailOverlay').isVisible()===true));

console.log('\nconsole errors: '+(errs.length?JSON.stringify(errs.slice(0,6)):'none'));
await b.close();
