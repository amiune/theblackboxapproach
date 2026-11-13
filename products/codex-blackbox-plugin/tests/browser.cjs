/* Observable offline behavior. Playwright is a development dependency only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
if (!process.argv[2]) throw Error('Pass a node_modules directory containing Playwright.');
const {chromium} = require(path.join(process.argv[2], 'playwright'));
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'blackbox-browser-'));
const template = fs.readFileSync(path.join(root, 'skills/blackbox-project/assets/visualizer.html'), 'utf8');
const original = JSON.parse(fs.readFileSync(path.join(root, 'demos/orderflow/model.json'), 'utf8'));
const results = [], errors = [], requests = [];
let browser, context;
const uri = file => pathToFileURL(file).href;
async function test(name, fn) {
  try { await fn(); results.push({name,status:'passed'}); console.log(`PASS ${name}`); }
  catch (error) { results.push({name,status:'failed',message:error.message}); throw error; }
}
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))); }
async function load(page, file) { await page.goto(uri(file)); await page.locator('#project-title').waitFor(); await settle(page); }
async function demo(page, name='orderflow') { await load(page,path.join(root,'demos',name,'index.html')); }
const processNode=(page,id)=>page.locator(`.process-node[data-entity="${id}"]`);
async function clickProcess(page,id){await processNode(page,id).click();await settle(page);await settle(page);}
async function more(page){if(!await page.locator('#more-menu').evaluate(node=>node.open))await page.getByLabel('More options',{exact:true}).click();await settle(page);}
async function about(page){await more(page);await page.locator('#about-button').click();await settle(page);}
async function find(page){await more(page);await page.locator('#find-button').click();await settle(page);}
async function fitted(page) {
  await settle(page);
  assert(await page.evaluate(()=>{
    const area=document.getElementById('graph-board').getBoundingClientRect();
    return [...document.querySelectorAll('.diagram-node .node-shape')].every(card=>{
      const b=card.getBoundingClientRect();return Number.isFinite(b.x)&&b.left>=area.left-2&&b.right<=area.right+2&&b.top>=area.top-2&&b.bottom<=area.bottom+2;
    });
  }),'All visible diagram nodes must fit');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Unexpected horizontal page overflow');
}
function variant(name,model){const encoded=JSON.stringify(model).replace(/</g,'\\u003c');const html=template.replace(/(<script id="project-model" type="application\/json">)[\s\S]*?(<\/script>)/,(_,a,b)=>a+encoded+b);const file=path.join(temporary,`${name}.html`);fs.writeFileSync(file,html);return file;}
function fieldModel(){return{format:'codex-blackbox',version:1,project:{name:'Nested data',rootBox:'root'},boxes:[{id:'root',label:'Root',children:['leaf'],inputs:[{name:'parent',dataStructure:'Parent'}],outputs:[]},{id:'leaf',label:'Leaf',children:[]}],dataStructures:[{id:'Parent',label:'Parent',fields:[{name:'child',type:'Child',dataStructure:'Child'},{name:'title',type:'string'}]},{id:'Child',label:'Child',fields:[{name:'parent',type:'Parent',dataStructure:'Parent'}]}],decisions:[],edges:[]};}

(async()=>{
  try{
    browser=await chromium.launch({headless:true,executablePath:process.argv[3]||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,offline:true,serviceWorkers:'block'});
    context.on('page',page=>{page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});});
    const page=await context.newPage();page.setDefaultTimeout(8000);
    const card=page.locator('#detail-card');
    await test('Startup shows only one root input/process/output diagram',async()=>{
      await demo(page);assert.equal(await page.locator('.process-node').count(),1);assert.equal(await page.locator('.boundary-node').count(),2);
      assert.equal(await processNode(page,'checkout').count(),0);assert(await card.isHidden());assert(await page.locator('#navigation').isHidden());
      assert.equal(await page.locator('#card-content > *').count(),0);assert.equal(await page.locator('#about-content > *').count(),0);
      assert(await page.locator('#find-dialog').isHidden());assert.equal(await page.locator('.sidebar,.inspector,[role="tablist"],.numbers').count(),0);
      const visible=await page.locator('body').innerText();for(const hidden of ['Synthetic source','Decisions & ownership','source coverage','AI origin','Mixed'])assert(!visible.includes(hidden));
      await fitted(page);
    });
    await test('Process clicks reveal one level and leaf clicks open only a compact card',async()=>{
      await clickProcess(page,'orderflow');assert.equal(await page.locator('.process-node').count(),2);
      assert.equal(await processNode(page,'inventory').count(),0);assert(await page.locator('#back').isVisible());
      await clickProcess(page,'orders');assert.equal(await page.locator('.process-node').count(),4);assert.equal(await processNode(page,'checkout').count(),0);
      await clickProcess(page,'notifications');assert(await card.isVisible());assert.equal(await page.locator('#card-title').textContent(),original.boxes.find(b=>b.id==='notifications').label);
      assert.equal(await page.locator('.process-node').count(),4);assert.equal(await card.locator('details[open]').count(),0);
      assert(!((await card.innerText()).includes('I propose')));await fitted(page);
    });
    await test('Back and breadcrumbs restore the actual parent level',async()=>{
      await page.locator('#card-close').click();await settle(page);await settle(page);await page.locator('#back').click();await settle(page);await settle(page);
      assert.equal(await page.locator('.process-node').count(),2);assert(await processNode(page,'orders').isVisible());
      await clickProcess(page,'checkout');assert.equal(await page.locator('.process-node').count(),1);assert(await processNode(page,'validation').isVisible());
      await page.locator('#breadcrumbs').getByRole('button',{name:'Orderflow system',exact:true}).click();await settle(page);await settle(page);
      assert.equal(await page.locator('.process-node').count(),2);await page.locator('#back').click();await settle(page);await settle(page);
      assert.equal(await page.locator('.process-node').count(),1);assert(await processNode(page,'orderflow').isVisible());assert(await page.locator('#navigation').isHidden());
    });
    await test('Returning to a parent preserves its camera',async()=>{
      await clickProcess(page,'orderflow');await page.locator('#graph').focus();await page.keyboard.press('+');await page.keyboard.press('ArrowLeft');
      const before=await page.locator('#scene').getAttribute('transform');await clickProcess(page,'orders');await page.locator('#back').click();await settle(page);await settle(page);
      assert.equal(await page.locator('#scene').getAttribute('transform'),before);
    });
    await test('Data cards reveal fields before per-field ownership and evidence',async()=>{
      await demo(page);await page.locator('[data-part="inputs"]').click();await settle(page);await settle(page);
      assert.equal(await page.locator('#card-title').textContent(),'Order request');assert.equal(await card.locator('.field').count(),2);
      assert.equal(await card.locator('details[open]').count(),0);assert(!((await card.innerText()).includes('Reject an empty order')));
      const field=card.locator('[data-field="items"]');await field.locator(':scope > summary').click();await settle(page);
      await field.locator('[data-section$=":decisions"] > summary').click();await settle(page);
      assert.match(await field.innerText(),/User/);assert.match(await field.innerText(),/Reject an empty order/);
      assert(!((await field.innerText()).includes('Require at least one')));
      await field.getByText('Decision evidence',{exact:true}).click();await settle(page);assert.match(await field.innerText(),/Require at least one order item/);
      assert.equal(await page.locator('.process-node').count(),1);
    });
    await test('AI decision evidence and user approval are independent disclosures',async()=>{
      await demo(page);await clickProcess(page,'orderflow');await clickProcess(page,'orders');await clickProcess(page,'notifications');
      const ownership=card.locator('[data-section="notifications:decisions"]');await ownership.locator(':scope > summary').click();await settle(page);
      assert(await ownership.locator('.badge.ai_defined').first().isVisible());assert(!((await ownership.innerText()).includes('Yes, use')));
      assert(!((await ownership.innerText()).includes('I propose')));
      await ownership.getByText('User approval',{exact:true}).click();await settle(page);assert.match(await ownership.innerText(),/approved/);assert.match(await ownership.innerText(),/Yes, use the local in-memory outbox/);
      assert(await ownership.locator('.badge.ai_defined').first().isVisible());assert(!((await ownership.innerText()).includes('I propose')));
      await ownership.getByText('Decision evidence',{exact:true}).click();await settle(page);assert.match(await ownership.innerText(),/I propose a local in-memory outbox/);
    });
    await test('Sources and implementation open independently and stay closed by default',async()=>{
      await demo(page);await clickProcess(page,'orderflow');await clickProcess(page,'orders');await clickProcess(page,'notifications');
      const source=card.locator('[data-section="notifications:sources"]'),implementation=card.locator('[data-section="notifications:implementation"]');
      assert.equal(await card.locator('.source').count(),0);await source.locator(':scope > summary').click();await settle(page);assert.match(await source.innerText(),/src\/notifications.js:4/);
      assert.equal(await implementation.getAttribute('open'),null);await source.locator(':scope > summary').click();await settle(page);await implementation.locator(':scope > summary').click();await settle(page);
      assert.match(await implementation.innerText(),/sendConfirmation/);assert.equal(await source.getAttribute('open'),null);
    });
    await test('Nested type cards have local Back and cyclic references stay finite',async()=>{
      await load(page,variant('fields',fieldModel()));await page.locator('[data-part="inputs"]').click();await settle(page);await settle(page);
      const child=card.locator('[data-field="child"]');assert.equal(await child.getByRole('button',{name:'Open Child'}).count(),0);
      await child.locator(':scope > summary').click();await settle(page);await child.getByRole('button',{name:'Open Child'}).click();await settle(page);
      assert.equal(await page.locator('#card-title').textContent(),'Child');assert(await page.locator('#card-back').isVisible());
      await card.locator('[data-field="parent"] > summary').click();await settle(page);await card.getByRole('button',{name:'Open Parent',exact:true}).click();await settle(page);assert.equal(await page.locator('#card-title').textContent(),'Parent');
      await card.locator('[data-field="child"] > summary').click();await settle(page);await card.getByRole('button',{name:'Open Child',exact:true}).click();await settle(page);assert.equal(await page.locator('#card-title').textContent(),'Child');
      await page.locator('#card-back').click();await settle(page);assert.equal(await page.locator('#card-title').textContent(),'Parent');
      assert.equal(await card.locator('.field').count(),2);assert(await card.locator('[data-field="child"]').getAttribute('open')!==null);
      assert.equal(await page.locator('.process-node').count(),1);
    });
    await test('Search and ownership/evidence filters are available only through More',async()=>{
      await demo(page);assert(await page.locator('#search').isHidden());await find(page);
      await page.locator('#owner-filter').selectOption('ai_defined');assert(await page.locator('.search-result[data-id="notifications"]').isVisible());assert.equal(await page.locator('.search-result[data-id="validation"]').count(),0);
      await page.locator('#search').fill('no matching entity anywhere');assert.match(await page.locator('#search-results').innerText(),/No matching items/);
      await page.locator('#search').fill('');await page.locator('#owner-filter').selectOption('all');await page.locator('#evidence-filter').selectOption('proposed');assert.equal(await page.locator('.search-result').count(),0);
      await page.locator('#evidence-filter').selectOption('all');await page.locator('#search').fill('Order request');await page.locator('.search-result[data-id="OrderRequest"]').click();await settle(page);
      assert(await page.locator('#find-dialog').isHidden());assert.equal(await page.locator('#card-title').textContent(),'Order request');assert.equal(await page.locator('.process-node').count(),1);
    });
    await test('Process cycles, shared children, and missing definitions remain navigable',async()=>{
      const model={format:'codex-blackbox',version:1,project:{name:'Cycles',rootBox:'a'},boxes:[{id:'a',label:'A',children:['b','c','missing']},{id:'b',label:'B',children:['c']},{id:'c',label:'C',children:['a']},{id:'d',label:'Disconnected',children:[]}],edges:[],dataStructures:[]};
      await load(page,variant('cycles',model));await clickProcess(page,'a');assert.equal(await page.locator('.process-node').count(),3);
      await clickProcess(page,'b');await clickProcess(page,'c');await clickProcess(page,'a');assert.equal(await page.locator('.process-node').count(),3);
      assert.equal(await processNode(page,'c').count(),1);await clickProcess(page,'missing');assert.match(await card.innerText(),/no definition/);await page.locator('#card-close').click();await settle(page);
      await find(page);await page.locator('#search').fill('Disconnected');await page.locator('.search-result[data-id="d"]').click();await settle(page);assert.equal(await page.locator('#card-title').textContent(),'Disconnected');
    });
    await test('Empty signatures and data-only snapshots do not invent behavior',async()=>{
      const empty={format:'codex-blackbox',version:1,project:{name:'Empty'},boxes:[],dataStructures:[{id:'type',label:'Available data',fields:[]}],edges:[]};
      await load(page,variant('empty',empty));assert(await page.locator('#empty-state').isVisible());await find(page);await page.locator('.search-result[data-id="type"]').click();await settle(page);assert.match(await card.innerText(),/No fields are documented/);
      const model={...empty,project:{name:'Leaf',rootBox:'leaf'},boxes:[{id:'leaf',label:'Leaf',children:[],inputs:[],outputs:[]}]};
      await load(page,variant('empty-signatures',model));await page.locator('[data-part="inputs"]').click();await settle(page);assert.match(await card.innerText(),/No signature is documented/);await page.locator('#card-close').click();await settle(page);await clickProcess(page,'leaf');
      await card.locator('[data-section="leaf:decisions"] > summary').click();await settle(page);assert.match(await card.innerText(),/Unknown/);assert.match(await card.innerText(),/No decision evidence/);
    });
    await test('Untrusted text stays text and malformed records remain inspectable',async()=>{
      const model=structuredClone(original);model.project.name='</script><img src=x onerror="window.__xss=1">';model.boxes[0].label='<svg onload="window.__xss=2">';model.boxes.push({...model.boxes[0]});model.edges.push({source:'missing',target:'orderflow',type:'calls'});
      await load(page,variant('unsafe',model));assert.equal(await page.evaluate(()=>window.__xss),undefined);assert.equal(await page.locator('img').count(),0);assert.equal(await page.locator('.process-node').count(),1);
      await about(page);await page.getByText('Notes and unresolved references',{exact:true}).click();await settle(page);assert.match(await page.locator('#about-content').innerText(),/Duplicate entity/);assert.match(await page.locator('#about-content').innerText(),/Unresolved relationship/);await page.locator('#close-about').click();await settle(page);
    });
    await test('Existing YAML provenance, state, and coverage are preserved behind disclosures',async()=>{
      await demo(page,'quote-engine');assert.equal(await page.locator('.process-node').count(),1);assert(!((await page.locator('body').innerText()).includes('partial')));
      await clickProcess(page,'quote_order');assert.equal(await page.locator('.process-node').count(),2);await page.locator('#scope-details').click();await settle(page);
      await card.locator('[data-section="quote_order:decisions"] > summary').click();await settle(page);assert.match(await card.innerText(),/AI/);assert.match(await card.innerText(),/partial/);
      await card.locator('[data-section="quote_order:sources"] > summary').click();await settle(page);assert.match(await card.innerText(),/blackboxes\/boxes\/quote_order.yaml:6/);
      await page.locator('#card-close').click();await settle(page);await about(page);assert(!((await page.locator('#about-content').innerText()).includes('project chats')));
      await page.getByText('Project history',{exact:true}).click();await settle(page);assert.match(await page.locator('#about-content').innerText(),/unavailable/);await page.getByText('Coverage',{exact:true}).click();await settle(page);assert.match(await page.locator('#about-content').innerText(),/coverage is complete/);await page.locator('#close-about').click();await settle(page);
    });
    await test('Keyboard activation, Escape, focus restoration, zoom and pan work',async()=>{
      await demo(page);await processNode(page,'orderflow').focus();await page.keyboard.press('Enter');await settle(page);
      await processNode(page,'orders').focus();await page.keyboard.press('Space');await settle(page);
      await processNode(page,'notifications').focus();await page.keyboard.press('Enter');await settle(page);assert(await card.isVisible());
      await page.keyboard.press('Escape');await settle(page);assert(await card.isHidden());assert.equal(await page.evaluate(()=>document.activeElement.dataset.focusKey),'process:notifications');
      const graph=page.locator('#graph');await graph.focus();const before=await page.locator('#scene').getAttribute('transform');await page.keyboard.press('+');assert.notEqual(await page.locator('#scene').getAttribute('transform'),before);
      const box=await graph.boundingBox();await page.mouse.move(box.x+15,box.y+15);await page.mouse.down();await page.mouse.move(box.x+70,box.y+50);await page.mouse.up();assert.notEqual(await page.locator('#scene').getAttribute('transform'),before);
      await more(page);await page.locator('#fit').click();await settle(page);await fitted(page);
    });
    await test('Desktop and mobile views are readable and cards stay within the viewport',async()=>{
      const media=path.join(root,'release/media');fs.mkdirSync(media,{recursive:true});await demo(page);await fitted(page);
      await page.screenshot({path:path.join(media,'process-desktop.png'),fullPage:true});await clickProcess(page,'orderflow');await page.screenshot({path:path.join(media,'children-desktop.png'),fullPage:true});
      await page.locator('#back').click();await settle(page);await page.locator('[data-part="inputs"]').click();await settle(page);await settle(page);await page.screenshot({path:path.join(media,'data-desktop.png'),fullPage:true});
      for(const width of [820,390]){await page.setViewportSize({width,height:900});await demo(page);await fitted(page);}
      await page.screenshot({path:path.join(media,'process-mobile.png'),fullPage:true});await page.locator('[data-part="inputs"]').click();await settle(page);await settle(page);
      const box=await card.boundingBox();assert(box.x>=0&&box.x+box.width<=390&&box.y>=0&&box.y+box.height<=900);await page.screenshot({path:path.join(media,'data-mobile.png'),fullPage:true});
    });
    await test('Exploration preserves the embedded model and never requests the network',async()=>{
      await page.setViewportSize({width:1440,height:1000});await demo(page);await clickProcess(page,'orderflow');await clickProcess(page,'orders');await clickProcess(page,'notifications');
      assert.deepEqual(await page.locator('#project-model').evaluate(node=>JSON.parse(node.textContent)),original);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    });
    console.log(`Passed ${results.length} browser scenarios; no remote requests or JavaScript errors.`);
  }catch(error){console.error(error.stack);process.exitCode=1;}
  finally{
    fs.mkdirSync(path.join(root,'release'),{recursive:true});fs.writeFileSync(path.join(root,'release/browser-checks.json'),JSON.stringify({status:process.exitCode?'failed':'passed',tests:results,errors,remoteRequests:requests},null,2)+'\n');
    if(context)await context.close();if(browser)await browser.close();fs.rmSync(temporary,{recursive:true,force:true});
  }
})();
