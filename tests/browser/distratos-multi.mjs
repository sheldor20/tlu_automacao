// Run only against the isolated local harness described in docs/distratos-multi-review.md.
// All application requests are intercepted; no business data or external API is used.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';
import { calculateDistrato, distratoTerm } from '../../lib/distratos.ts';
import { renderDistratoPdf } from '../../lib/distratos-pdf.ts';
const base = process.env.DISTRATOS_TEST_URL || 'http://127.0.0.1:3137';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Use somente o harness local.');
const actor = '11111111-1111-4111-8111-111111111111';
const contracts = [
  {id:'20|033|0007',buyerName:'Pessoa Fictícia',contract_number:'0007',block:'007',lot:'003'},
  {id:'20|033|7',buyerName:'Pessoa Fictícia',contract_number:'7',block:'007',lot:'003'},
  {id:'20|033|8',buyerName:'Titular Fictício A / Titular Fictício B',contract_number:'8',block:'007',lot:'003'},
  {id:'20|033|9',buyerName:'Outra Pessoa Fictícia',contract_number:'9',block:'008',lot:'004'},
];
const [a,b,c,d] = contracts.map(c=>c.id);
let canWrite=true, failId='', delayId='', delayedSaleId='', storedBeforeFailure=false;
let release;
let assertions=0;
const posts=[], documents=new Map(), unexpected=[], errors=[], pdfRequests=[];
const evidence=resolve(process.env.DISTRATOS_EVIDENCE_DIR||'.local/distratos-multi-evidence');
await mkdir(evidence,{recursive:true});
const downloads=await mkdtemp(resolve(evidence,'downloads-'));
function unit(id){
 const contract=contracts.find(c=>c.id===id);
 assert.ok(contract,'exact contract ID');
 return {contractId:id,contractNumber:contract.contract_number,companyId:'20',companyName:'Empresa Fictícia',workKey:'20|033',workCode:'033',workName:'Jardim São José Fictício',block:contract.block,lot:contract.lot,buyerName:contract.buyerName,synchronizedAt:'2026-10-23T10:00:00Z',paidInstallments:{count:id===a?2:id===b?3:0,reason:'Contagem sintética confirmada.'},receipts:[{id:`receipt:${id}`,date:'2025-01-10',amount:id===a?40000:id===b?500:20000,description:'Parcela fictícia'}]};
}
function makeDocument(input){
 const selected=unit(input.contractId);
 const property={id:'imovel',date:input.saleDate,original:input.saleValue,corrected:input.saleValue,factor:1,indices:[]};
 const receipts=selected.receipts.map(r=>({id:r.id,date:r.date,original:r.amount,corrected:r.amount,factor:1,indices:[]}));
 const calculation=calculateDistrato(input,property,receipts);
 return {id:input.requestId,created_by:actor,created_at:'2026-11-04T12:00:00Z',input,unit:selected,calculation,correction:{source:'fixture',index:'INPC',interest:0,referenceDate:input.correctionDate,availableThrough:'09/2026',values:[property,...receipts]},...distratoTerm(input,selected,calculation)};
}
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-first-run','--disable-background-networking']});
const page=await browser.newPage();
const downloadSession=await page.createCDPSession();
await downloadSession.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
page.on('pageerror',e=>errors.push(e.message));
await page.setRequestInterception(true);
page.on('request',async request=>{
 try {
 const url=new URL(request.url());
 const json=(body,status=200)=>request.respond({status,contentType:'application/json',body:JSON.stringify(body)});
 if(url.hostname==='navigation-test.invalid')return request.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'},body:'{}'});
 if(url.origin===new URL(base).origin && url.pathname.startsWith('/api/distratos')){
   if(request.method()==='POST'){
    const input=JSON.parse(request.postData());posts.push(input);
    if(!canWrite)return json({error:'Acesso somente leitura'},403);
    if(input.contractId===delayId)await new Promise(resolve=>{release=resolve;});
    if(input.contractId===failId&&!storedBeforeFailure)return json({error:'Falha sintética de fonte'},503);
    let generated=documents.get(input.requestId);
    if(!generated){generated=makeDocument(input);documents.set(input.requestId,generated);}
    if(input.contractId===failId&&storedBeforeFailure)return json({error:'Resposta perdida após gravação sintética'},503);
    return json({document:generated});
   }
   assert.equal(request.method(),'GET');
   if(url.pathname.endsWith('/sale')){
    const id=url.searchParams.get('contractId');
    if(id===delayedSaleId)await new Promise(resolve=>setTimeout(resolve,600));
    if(id===d)return json({saleDate:null,saleValue:null,source:'fonte fictícia sem venda confirmada'});
    return json({saleDate:id===a?'2022-01-21':'2023-04-10',saleValue:id===a?74000:125000,source:'fonte fictícia'});
   }
   if(url.searchParams.has('contractId')){
    const id=url.searchParams.get('contractId');return json({unit:unit(id),sourceRevision:'a'.repeat(64),history:[...documents.values()].filter(x=>x.unit.contractId===id),canWrite});
   }
   if(url.searchParams.has('workKey')){
    assert.equal(url.searchParams.get('workKey'),'20|033');
    return json({contracts:[...contracts,contracts[2]],canWrite}); // shared/duplicate contract record
   }
   if(url.pathname==='/api/distratos')return json({works:[{key:'20|033',company_id:'20',work_id:'033',name:'Jardim São José Fictício'}],companies:[{id:'20',name:'Empresa Fictícia'}],canWrite});
   const doc=documents.get(decodeURIComponent(url.pathname.split('/').at(-1)));
   if(url.searchParams.has('pdf')){
    if(!doc)return json({error:'Documento inexistente'},404);
    pdfRequests.push({documentId:doc.id,contractId:doc.unit.contractId});
    return request.respond({status:200,contentType:'application/pdf',body:Buffer.from(renderDistratoPdf(doc))});
   }
   return doc?json({document:doc}):json({error:'Documento inexistente'},404);
 }
 if(url.origin===new URL(base).origin && !url.pathname.startsWith('/api/'))return request.continue();
 if(['data:','blob:'].includes(url.protocol))return request.continue();
 unexpected.push(request.url());return request.abort();
 }catch(error){errors.push(error.message);try{await request.abort();}catch{}}
});
await page.evaluateOnNewDocument(actor=>{
 window.__qaDownloads=[];
 const click=HTMLAnchorElement.prototype.click;
 HTMLAnchorElement.prototype.click=function(){
  if(this.download&&this.href.startsWith('blob:')){
   const record={name:this.download,bytes:null};window.__qaDownloads.push(record);
   void fetch(this.href).then(r=>r.arrayBuffer()).then(bytes=>{record.bytes=Array.from(new Uint8Array(bytes));});
  }
  return click.call(this);
 };
 const payload={sub:actor,exp:Math.floor(Date.now()/1000)+86400,role:'authenticated'};
 const accessToken=`${btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))}.${btoa(JSON.stringify(payload))}.local-fixture`;
 localStorage.setItem('sb-navigation-test-auth-token',JSON.stringify({access_token:accessToken,refresh_token:'fixture',expires_at:payload.exp,expires_in:86400,token_type:'bearer',user:{id:actor,aud:'authenticated',role:'authenticated',email:'ficticio@example.test',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}}));
},actor);
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);assertions++;};
const panel=id=>`[data-contract-id="${id}"]`;
const checkbox=id=>`.distrato-contract-options input[value="${id}"]`;
const batch='.distrato-consolidated .distrato-actions button:first-child';
const combo=i=>`.distrato-select:nth-child(${i}) input[role="combobox"]`;
async function choose(i,term){await page.locator(combo(i)).fill(term);await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');}
async function setup(){await page.goto(base+'/distratos',{waitUntil:'networkidle0'});await choose(1,'sao jose');await page.waitForFunction(s=>!document.querySelector(s).disabled,{},combo(2));await choose(2,'007');await choose(3,'003');}
async function select(id){await page.locator(checkbox(id)).click();if(await page.$eval(checkbox(id),e=>e.checked)){await page.waitForSelector(panel(id)+' form');await page.waitForFunction(s=>!document.querySelector(s+' input[type="date"]').disabled,{},panel(id));}}
async function field(id,label){return page.$eval(panel(id),(el,label)=>{const f=[...el.querySelectorAll('label.field')].find(x=>x.querySelector('.field-label')?.textContent===label);const input=f.querySelector('input,textarea');return {value:input.value,readOnly:input.readOnly,disabled:input.matches(':disabled')};},label);}
async function fill(id,label,value){const element=await page.evaluateHandle((selector,label)=>[...document.querySelector(selector).querySelectorAll('label.field')].find(x=>x.querySelector('.field-label')?.textContent===label).querySelector('input,textarea'),panel(id),label);await element.asElement().click({clickCount:3});await page.keyboard.press('Backspace');await element.asElement().type(value);await element.dispose();}
async function complete(id,regime='com_lei'){await page.locator(`${panel(id)} input[value="${regime}"]`).click();await fill(id,'Intermediação e corretagem (R$)','0');await fill(id,'IPTU e tributos municipais (R$)','0');}
async function generate(){await page.waitForFunction(s=>!document.querySelector(s).disabled,{},batch);await page.locator(batch).click();await page.waitForFunction(()=>!document.querySelector('.distrato-consolidated')?.textContent.includes('Parar após contrato atual'));}
async function summary(){return page.$eval('.distrato-consolidated',e=>e.innerText);}
async function downloaded(name){
 await page.waitForFunction(name=>window.__qaDownloads.some(d=>d.name===name&&d.bytes),{},name);
 const bytes=Buffer.from(await page.evaluate(name=>window.__qaDownloads.find(d=>d.name===name&&d.bytes).bytes,name));
 let native=false;
 for(let attempt=0;attempt<100&&!native;attempt++){
  for(const file of await readdir(downloads)){if(!file.endsWith('.crdownload')&&(await readFile(resolve(downloads,file))).equals(bytes)){native=true;break;}}
  if(!native)await new Promise(resolve=>setTimeout(resolve,50));
 }
 check(native,true,`native browser download matches ${name}`);
 return bytes;
}
function pdfText(bytes){return [...bytes.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map(match=>{try{return inflateSync(Buffer.from(match[1],'latin1')).toString('latin1');}catch{return match[1];}}).join('\n');}
try{
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  await page.setViewport({width,height,deviceScaleFactor:1});await setup();
  check(await page.$$eval('.distrato-contract-options input',els=>els.length),3,`${name}: duplicate/shared contract collapsed`);
  await page.focus(checkbox(a));await page.keyboard.press('Space');await page.waitForSelector(panel(a)+' form');await page.waitForNetworkIdle();
  await select(b);
  check(await page.$$eval('article.distrato-contract',els=>els.length),2,'same names with distinct IDs');
  check((await field(a,'Valor original de venda (R$)')).value,'74000','first original value');
  check((await field(b,'Valor original de venda (R$)')).value,'125000','second original value');
  check((await field(a,'Meses de fruição')).value,'2','first paid count');check((await field(b,'Meses de fruição')).value,'3','second paid count');
  check((await field(a,'Meses de fruição')).readOnly,true,'confirmed count read only');
  check((await field(a,'Intermediação e corretagem (R$)')).value,'','missing cost not zero');
  check(await page.$eval(`[data-summary-contract="${a}"] td:nth-child(2)`,e=>e.innerText.includes('74.000,00')),true,'source value before generation');
  check(await page.$eval(`[data-summary-contract="${a}"] td:nth-child(3)`,e=>e.innerText.includes('40.000,00')),true,'nominal payments from selected source');
  await complete(a);await complete(b,'sem_lei');await generate();
  check((await summary()).includes('Todos os contratos selecionados estão incluídos.'),true,'complete summary');
  check(await page.$$eval('.distrato-result',els=>els.length),2,'individual results');
  const latestA=posts.filter(p=>p.contractId===a).at(-1),latestB=posts.filter(p=>p.contractId===b).at(-1);
  check(latestA.saleValue,74000,'POST own value A');check(latestB.saleValue,125000,'POST own value B');
  check(latestA.regime,'com_lei','independent radio groups A');check(latestB.regime,'sem_lei','independent radio groups B');
  check((await summary()).includes('31.490,00'),true,'sum individual refunds without offset');
  await page.locator('::-p-text(Exportar resumo CSV)').click();
  const csv=await downloaded('distratos-consolidado.csv');
  await writeFile(resolve(evidence,`${name}-summary.csv`),csv);
  check(csv.toString().includes('"74000,00";"fonte fictícia"'),true,'CSV retains source sale');
  check(csv.toString().includes('20|033|0007')&&csv.toString().includes('20|033|7'),true,'CSV exact selected IDs');
  check(csv.toString().includes('20|033|8'),false,'CSV excludes unselected contract');
  check(csv.toString().split('\r\n').length,4,'CSV header, two contracts and total');
  for(const [id,other] of [[a,b],[b,a]]){
   await page.locator(`${panel(id)} .distrato-result button`).click();
   const expected=posts.filter(p=>p.contractId===id).at(-1);
   const bytes=await downloaded(`distrato-${expected.requestId}.pdf`);
   const pdf=await PDFDocument.load(bytes),text=pdfText(bytes);
   check(pdf.getPageCount()>=3,true,'individual PDF has calculation, payments and term');
   check(text.includes(`Registro ${expected.requestId}`),true,'PDF references its own document');
   check(text.includes(`Contrato ${unit(id).contractNumber}`),true,'PDF identifies its own contract');
   check(text.includes(`Registro ${posts.filter(p=>p.contractId===other).at(-1).requestId}`),false,'PDF excludes other contract snapshot');
   await writeFile(resolve(evidence,`${name}-contract-${unit(id).contractNumber}.pdf`),bytes);
  }
  await page.$eval('.distrato-consolidated',el=>el.scrollIntoView({block:'start'}));
  await page.screenshot({path:resolve(evidence,`${name}-summary.png`)});
  if(name==='mobile'){
   await page.$eval('.distrato-consolidated .distrato-table',el=>{el.scrollLeft=el.scrollWidth;});
   await page.screenshot({path:resolve(evidence,'mobile-values.png')});
  }
  const before=posts.length;await generate();check(posts.length,before,'repeat no second POST for confirmed docs');
  await select(a);check((await summary()).includes('31.490,00'),false,'removal removes previous total');
  await page.evaluate(()=>{window.__qaDownloads=[];});await page.locator('::-p-text(Exportar resumo CSV)').click();
  const remaining=(await downloaded('distratos-consolidado.csv')).toString();
  check(remaining.includes('20|033|0007'),false,'CSV removes deselected contract');
  check(remaining.split('\r\n').length,3,'CSV contains only remaining contract and total');
  await select(a);check((await field(a,'Intermediação e corretagem (R$)')).value,'','reselection has no stale inputs');
  check((await summary()).includes('Resumo parcial'),true,'old/history doc not current summary');
  await complete(a);await generate();check(posts.length,before,'reselection same input recovers document');
  await fill(a,'Intermediação e corretagem (R$)','5');check((await summary()).includes('Resumo parcial'),true,'edit invalidates current document');
  await fill(a,'Valor original de venda (R$)','75000');await generate();
  check(await page.$eval(`[data-summary-contract="${a}"] td:nth-child(2)`,e=>e.innerText.includes('74.000,00')),true,'manual base change preserves consulted origin');
  check(await page.$eval(`[data-summary-contract="${a}"] td:nth-child(4)`,e=>e.innerText.includes('75.000,00')),true,'calculation base explicitly distinct from origin');
  await choose(2,'008');await choose(3,'004');await page.waitForSelector(panel(d)+' form');await page.waitForNetworkIdle();
  check(await page.$$eval('article.distrato-contract',els=>els.map(e=>e.dataset.contractId)),[d],'lot change clears others');
  check((await field(d,'Intermediação e corretagem (R$)')).value,'','lot change clears costs');
  check(await page.$eval(`[data-summary-contract="${d}"] td:nth-child(2)`,e=>e.innerText.includes('Não confirmado')),true,'absent sale is not confirmed zero');
  await select(d);check(await page.$$eval('article.distrato-contract',els=>els.length),0,'no selection no stale panels');
  check(await page.$('.distrato-consolidated'),null,'no selection no previous summary');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`${name}: no page overflow`);
 }
 // Partial failure, uncertain response and retry, with a new fingerprint.
 await setup();await select(a);await select(b);await select(c);for(const id of [a,b,c]){await complete(id);await fill(id,'Intermediação e corretagem (R$)','12');}
 failId=b;storedBeforeFailure=true;await generate();
 check((await summary()).includes('falha'),true,'partial failure shown');check((await summary()).includes('Resumo parcial'),true,'partial summary identified');
 const writes=documents.size, failedRequest=posts.filter(p=>p.contractId===b).at(-1).requestId;
 failId='';await generate();check(documents.size,writes,'uncertain server result recovered without duplicate');check(posts.filter(p=>p.contractId===b).at(-1).requestId,failedRequest,'retry uses same request UUID');
 // Stop after current contract, then resume remaining contracts.
 for(const id of [a,b,c])await fill(id,'Intermediação e corretagem (R$)','19');
 delayId=a;const beforeCancel=posts.length;await page.locator(batch).click();
 const deadline=Date.now()+30000;while(!release&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(release,'in-flight request started before cancellation');
 await page.locator('::-p-text(Parar após contrato atual)').click();release();release=undefined;delayId='';
 await page.waitForFunction(()=>!document.querySelector('.distrato-consolidated')?.textContent.includes('Parar após contrato atual'));
 check(posts.length,beforeCancel+1,'cancel prevents next requests');check((await summary()).includes('não iniciado'),true,'cancelled contracts explicit');
 await generate();check(posts.length,beforeCancel+3,'resume generates only remaining contracts');
 // Late source response after removal must not contaminate a different selection.
 await setup();delayedSaleId=a;await page.locator(checkbox(a)).click();await page.waitForSelector(panel(a)+' form');await select(a);await select(b);await page.waitForNetworkIdle({idleTime:800});
 check(await page.$(panel(a)),null,'late removed contract stays absent');check((await field(b,'Valor original de venda (R$)')).value,'125000','late response cannot overwrite active contract');delayedSaleId='';
 // Readers retain history access but cannot create documents.
 canWrite=false;const beforeReader=posts.length;await setup();await select(a);check(await page.$eval(batch,e=>e.disabled),true,'reader batch disabled');check(await page.$eval(panel(a)+' button[type="submit"]',e=>e.disabled),true,'reader individual disabled');check((await field(a,'Intermediação e corretagem (R$)')).disabled,true,'reader fields disabled');
 await page.locator(panel(a)+' .distrato-history button').click();await page.waitForSelector(panel(a)+' .distrato-result');check((await summary()).includes('Resumo parcial'),true,'historical doc does not enter current summary');check(posts.length,beforeReader,'reader did not POST');
 check(unexpected,[],'no external/business requests');check(errors,[],'no runtime errors');
 check(new Set(pdfRequests.map(r=>r.contractId)).size,2,'PDF downloads belong only to selected contracts');
 const result={status:'passed',assertions,syntheticPosts:posts.length,syntheticDocuments:documents.size,pdfDownloads:pdfRequests.length,viewports:['1440x1000','390x844'],externalRequests:unexpected.length,evidence,downloads};
 await writeFile(resolve(evidence,'browser-result.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
}finally{if(release)release();await browser.close();}
