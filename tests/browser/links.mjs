import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
// Use whatever chromium playwright installed, unless a prebuilt one is present (some
// sandboxes ship it at a fixed path and cannot download). WB_CHROMIUM overrides both.
const PREBUILT = '/opt/pw-browsers/chromium';
const exe = process.env.WB_CHROMIUM
  || (createRequire(import.meta.url)('fs').existsSync(PREBUILT) ? PREBUILT : null);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const p = await b.newPage({ viewport:{width:1400,height:1000} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:8777/test.html'); await p.waitForTimeout(700);
let pass=0,fail=0;
const step=async(n,f)=>{try{const r=await f();
  if(r===true){pass++;console.log('OK   '+n);}
  else if(typeof r==='string'){pass++;console.log('OK   '+n+' :: '+r);}
  else {fail++;console.log('FAIL '+n+(r&&r!==false?' :: '+JSON.stringify(r):''));}
}catch(e){fail++;console.log('FAIL '+n+' :: '+e.message);}};
const T = async (fn,arg) => (arg===undefined ? p.evaluate(fn) : p.evaluate(fn,arg));

// An OWA deeplink of the real shape and length -- percent-encoded, & separators -- but
// with an invented ItemID. This repository is public; a real message id does not go in it.
const OWA = 'https://outlook.office365.com/owa/?ItemID=DKRYfmt07ELSZgnu18FM%2Fov29GNUbipw3AHOVcjqx4BIPWdkry5CJQXelsz6DKRYfmt07ELSZgnu18FMTahov29GNUbipw3AHOVcjqx4BIPWdkry5CJQXelsz6DKRYfmt07ELSZgnu18FMTahov29GN%3D&exvsurl=1&viewmodel=ReadMessageItem';

await p.evaluate(()=>{
  const ts=ms=>({toMillis:()=>ms});
  const base=(id,o)=>Object.assign({id,title:id,note:'',priority:'none',date:'',sites:[],persons:[],
    tags:[],actions:[],links:[],attachments:[],comments:[],history:[],done:false,createdAt:ts(1787000000000)},o);
  window.__DATA.tasks.push(base('lk1',{title:'Returflow thread'}));
  window.__DATA.tasks.push(base('lk2',{title:'Has links already',
    links:[{name:'Sheet',url:'https://example.com/sheet'},
           {name:'Mail from Anna',url:'https://outlook.office365.com/owa/?ItemID=XYZ&exvsurl=1'}]}));
  startListeners();
});
await p.waitForTimeout(500);

console.log('=== recognising an Outlook mail link ===');
await step('the real OWA deeplink is recognised as mail', async()=>
  await T(u=>isMailLink(u)===true, OWA));
await step('outlook.office.com is recognised', async()=>
  await T(()=>isMailLink('https://outlook.office.com/mail/inbox/id/AAQk')===true));
await step('outlook.com is recognised', async()=>
  await T(()=>isMailLink('https://outlook.com/mail/0/inbox')===true));
await step('outlook.live.com is recognised', async()=>
  await T(()=>isMailLink('https://outlook.live.com/mail/0/')===true));
await step('an ordinary link is not mail', async()=>
  await T(()=>isMailLink('https://example.com/outlook-tips')===false));
await step('a look-alike host is not mail', async()=>
  await T(()=>isMailLink('https://outlook.office365.com.evil.example/owa/?ItemID=1')===false));
await step('a host that merely starts the same is not mail', async()=>
  await T(()=>isMailLink('https://outlook.office365.company.example/x')===false));
await step('a genuine subdomain still is mail', async()=>
  await T(()=>isMailLink('https://nam.outlook.office365.com/owa/?ItemID=1')===true));
await step('the host with no path is still mail', async()=>
  await T(()=>isMailLink('https://outlook.office365.com')===true));
await step('empty and null do not throw', async()=>
  await T(()=>isMailLink('')===false&&isMailLink(null)===false&&isMailLink(undefined)===false));
await step('mail links get the envelope icon, others the chain', async()=>
  await T(u=>linkIcon({url:u})==='\uD83D\uDCE7'&&linkIcon({url:'https://x.dk'})==='\uD83D\uDD17', OWA));

console.log('\n=== parsing what gets pasted ===');
const parse = async (raw, name) => T(([r,n])=>parseLinkInput(r,n), [raw, name===undefined?null:name]);
await step('a bare OWA URL is kept intact, character for character', async()=>{
  const r = await parse(OWA);
  return r && r.url===OWA ? 'unchanged, '+r.url.length+' chars' : {r};});
await step('and is labelled "Mail" when no name is given', async()=>{
  const r = await parse(OWA);
  return r.name==='Mail' ? r.name : {r};});
await step('"Label | URL" in one paste splits correctly', async()=>{
  const r = await parse('Anna \u00b7 Returflow SOP | '+OWA);
  return r.name==='Anna \u00b7 Returflow SOP'&&r.url===OWA ? r.name : {r};});
await step('a tab separator works too', async()=>{
  const r = await parse('Anna\t'+OWA);
  return r.name==='Anna'&&r.url===OWA ? true : {r};});
await step('a newline separator works too', async()=>{
  const r = await parse('Anna\n'+OWA);
  return r.name==='Anna'&&r.url===OWA ? true : {r};});
await step('an explicit name wins over the fallback', async()=>{
  const r = await parse(OWA, 'Kundesag 4412');
  return r.name==='Kundesag 4412' ? r.name : {r};});
await step('a label inside the paste beats the name field', async()=>{
  const r = await parse('From the paste | https://example.com', 'From the field');
  return r.name==='From the paste' ? r.name : {r};});
await step('a bare host gets https://', async()=>{
  const r = await parse('power.dk/kampagne');
  return r.url==='https://power.dk/kampagne' ? r.url : {r};});
await step('an ordinary URL with no label is named by its URL', async()=>{
  const r = await parse('https://example.com/a');
  return r.name==='https://example.com/a' ? true : {r};});
await step('http is left as http, not upgraded silently', async()=>{
  const r = await parse('http://intranet.local/page');
  return r.url==='http://intranet.local/page' ? r.url : {r};});
await step('mailto is allowed', async()=>{
  const r = await parse('mailto:anna@example.com');
  return r&&r.url==='mailto:anna@example.com' ? true : {r};});
await step('javascript: is refused', async()=>
  (await parse('javascript:alert(1)'))===null);
await step('data: is refused', async()=>
  (await parse('data:text/html,<script>alert(1)</script>'))===null);
await step('file: is refused', async()=>
  (await parse('file:///C:/Windows/win.ini'))===null);
await step('a labelled javascript: URL is refused too', async()=>
  (await parse('Harmless label | javascript:alert(1)'))===null);
await step('empty input is refused', async()=>
  (await parse('   '))===null && (await parse(''))===null);
await step('control characters are stripped, not stored', async()=>{
  const r = await parse('https://example.com/a\u0000\u001f');
  return r&&r.url==='https://example.com/a' ? true : {r};});
await step('a very long label is capped', async()=>{
  const r = await parse('x'.repeat(400)+' | https://example.com');
  return r.name.length===120 ? r.name.length+' chars' : {len:r.name.length};});
await step('trailing text after the URL is dropped', async()=>{
  const r = await parse('https://example.com/a some trailing words');
  return r.url==='https://example.com/a' ? r.url : {r};});
await step('no separator needed: text in front of the URL becomes the label', async()=>{
  const r = await parse('Anna \u00b7 Returflow SOP  '+OWA);
  return r.name==='Anna \u00b7 Returflow SOP'&&r.url===OWA ? r.name : {r};});
await step('text with no URL in it at all is refused, not guessed at', async()=>
  (await parse('Husk at ringe til Anna om returflowet'))===null);
await step('a pipe inside a URL does not split it', async()=>{
  const r = await parse('https://example.com/a?x=1|2');
  return r&&r.url==='https://example.com/a?x=1|2' ? r.url : {r};});
await step('a label ending in a colon is kept as the label', async()=>{
  const r = await parse('Se mailen her: '+OWA);
  return r.name==='Se mailen her:'&&r.url===OWA ? r.name : {r};});
await step('mailto with no address is refused', async()=>
  (await parse('mailto:'))===null);

console.log('\n=== the detail modal now has a Links section ===');
await p.evaluate(()=>openDetail('lk1')); await p.waitForTimeout(350);
await step('the section is there even with no links', async()=>
  await T(()=>document.getElementById('detailBody').innerHTML.includes('detail-section-label">Links')));
await step('the add field is there', async()=>
  await T(()=>!!document.getElementById('detailLinkInput')));
await step('it explains the mail recognition and the Label | URL form', async()=>{
  const h = await T(()=>document.getElementById('detailBody').innerText);
  return /Mail/.test(h)&&/Label \| URL/.test(h) ? true : {h:h.slice(-200)};});

console.log('\n=== pasting a mail link onto an open task ===');
await step('pasting the OWA URL and pressing Enter stores it', async()=>{
  await p.fill('#detailLinkInput', OWA);
  await p.press('#detailLinkInput','Enter');
  await p.waitForTimeout(500);
  const w = await T(()=>window.__WB_WRITES.filter(x=>x.coll==='tasks'&&x.id==='lk1').pop());
  return w&&w.data.links&&w.data.links[0].url===OWA ? 'stored, '+w.data.links[0].url.length+' chars intact' : {w};});
await step('it is labelled Mail', async()=>{
  const w = await T(()=>window.__WB_WRITES.filter(x=>x.coll==='tasks'&&x.id==='lk1').pop());
  return w.data.links[0].name==='Mail' ? true : {w};});
await step('the modal re-renders with the link showing', async()=>{
  const h = await T(()=>document.getElementById('detailBody').innerHTML);
  return h.includes('detail-link-btn')&&h.includes('\uD83D\uDCE7') ? true : {h:h.slice(0,300)};});
// getAttribute returns the decoded value, so check the markup itself for the escaping.
await step('the markup escapes the ampersands inside the href', async()=>{
  const html = await T(()=>{const a=document.querySelector('#detailBody .detail-link-btn');
    return a?a.outerHTML:null;});
  return html.includes('&amp;exvsurl=1')&&!/[^&]&exvsurl/.test(html)
    ? 'href=&quot;...&amp;exvsurl=1...&quot;' : {html:html.slice(0,220)};});
await step('and the browser resolves it back to the exact URL', async()=>{
  const live = await T(()=>{const a=document.querySelector('#detailBody .detail-link-btn');return a?a.href:null;});
  return live===OWA ? 'round-trips exactly' : {live};});
await step('it opens in a new tab with noopener', async()=>{
  const a = await T(()=>{const el=document.querySelector('#detailBody .detail-link-btn');
    return {target:el.target,rel:el.rel};});
  return a.target==='_blank'&&/noopener/.test(a.rel) ? true : {a};});
await step('the add field is cleared for the next paste', async()=>
  await T(()=>document.getElementById('detailLinkInput').value===''));
await step('the same URL twice is refused rather than duplicated', async()=>{
  await p.fill('#detailLinkInput', OWA);
  const before = await T(()=>window.__WB_WRITES.length);
  await p.click('#detailBody .detail-addlink button'); await p.waitForTimeout(400);
  const after = await T(()=>({n:window.__WB_WRITES.length,toast:document.getElementById('toast').textContent}));
  return after.n===before&&/already/i.test(after.toast) ? after.toast : {before,after};});
await step('rubbish is refused with a message and no write', async()=>{
  await p.fill('#detailLinkInput','javascript:alert(1)');
  const before = await T(()=>window.__WB_WRITES.length);
  await p.click('#detailBody .detail-addlink button'); await p.waitForTimeout(400);
  const after = await T(()=>({n:window.__WB_WRITES.length,toast:document.getElementById('toast').textContent}));
  return after.n===before&&/not a link/i.test(after.toast) ? after.toast : {before,after};});
await step('a labelled paste keeps the label', async()=>{
  await p.fill('#detailLinkInput','Anna \u00b7 Returflow | https://outlook.office.com/mail/x/id/QQ');
  await p.press('#detailLinkInput','Enter'); await p.waitForTimeout(500);
  const w = await T(()=>window.__WB_WRITES.filter(x=>x.coll==='tasks'&&x.id==='lk1').pop());
  const l=w.data.links[w.data.links.length-1];
  const mail=await T(u=>isMailLink(u), l.url);
  return l.name==='Anna \u00b7 Returflow'&&mail===true ? l.name+' (recognised as mail)' : {l,mail};});

console.log('\n=== removing a link again ===');
await step('the ✕ removes just that one', async()=>{
  const before = await T(()=>tasks.find(t=>t.id==='lk1').links.length);
  await p.click('#detailBody .detail-link-row .detail-link-del'); await p.waitForTimeout(500);
  const w = await T(()=>window.__WB_WRITES.filter(x=>x.coll==='tasks'&&x.id==='lk1').pop());
  return w.data.links.length===before-1 ? before+' -> '+w.data.links.length : {before,w};});
await step('the remaining link is the one that was not removed', async()=>{
  const w = await T(()=>window.__WB_WRITES.filter(x=>x.coll==='tasks'&&x.id==='lk1').pop());
  return w.data.links.length===1&&w.data.links[0].name==='Anna \u00b7 Returflow' ? w.data.links[0].name : {w};});
await p.evaluate(()=>closeDetail());

console.log('\n=== where mail links show up ===');
await step('a mail link on a task row gets the envelope and its own colour', async()=>
  await T(()=>{document.getElementById('searchInput').value='Has links already';
    renderTasks();
    const h=document.getElementById('taskList').innerHTML;
    document.getElementById('searchInput').value='';renderTasks();
    return h.includes('task-link-chip is-mail')&&h.includes('\uD83D\uDCE7 Mail from Anna');}));
await step('an ordinary link on the same task keeps the chain icon', async()=>
  await T(()=>{document.getElementById('searchInput').value='Has links already';
    renderTasks();
    const h=document.getElementById('taskList').innerHTML;
    document.getElementById('searchInput').value='';renderTasks();
    return h.includes('\uD83D\uDD17 Sheet');}));
await step('the edit modal lists them with the right icons', async()=>{
  await p.evaluate(()=>openEdit('lk2')); await p.waitForTimeout(350);
  const h = await T(()=>document.getElementById('modalLinksList').innerHTML);
  await p.evaluate(()=>closeModal());
  return h.includes('\uD83D\uDCE7 Mail from Anna')&&h.includes('\uD83D\uDD17 Sheet') ? true : {h};});

console.log('\n=== escHtml is now attribute-safe ===');
await step('a double quote is escaped', async()=>
  await T(()=>escHtml('a"b')==='a&quot;b'));
await step('a single quote is escaped', async()=>
  await T(()=>escHtml("a'b")==='a&#39;b'));
await step('the ampersand still comes first, so nothing is double-escaped', async()=>
  await T(()=>escHtml('&quot;')==='&amp;quot;'));
await step('a URL crafted to break out of an href cannot', async()=>{
  const r = await T(()=>{
    const nasty='https://example.com/" onmouseover="alert(1)';
    const d=document.createElement('div');
    d.innerHTML='<a href="'+escHtml(nasty)+'">x</a>';
    const a=d.querySelector('a');
    return {attrs:Array.from(a.attributes).map(x=>x.name),href:a.getAttribute('href')};});
  return r.attrs.length===1&&r.attrs[0]==='href' ? 'only href survived' : {r};});

console.log('\n=== nothing broke ===');
await step('the page raised no uncaught errors', async()=>
  errs.length===0?true:errs.join(' | '));

console.log('\n'+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);
