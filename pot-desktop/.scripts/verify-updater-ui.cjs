const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { installMock } = require('./verify-screenshot-ui.cjs');
(async () => {
 const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const page=await browser.newPage({viewport:{width:650,height:500}});
  const errors=[];page.on('pageerror', e=>errors.push(e.message));
  await installMock(page,{label:'updater'});
  await page.addInitScript(()=>{
   const base=window.__TAURI_IPC__;
   const state=window.__updateTest={fail:false, installFail:true, downloads:0, installs:0, external:0, current:false};
   window.__TAURI_IPC__=async request=>{
    const done=v=>window[`_${request.callback}`]?.(v),fail=v=>window[`_${request.error}`]?.(v);
    if(request.cmd==='latest_release')return done({tag_name:state.current?'v3.0.0':'v9.0.0',draft:false,prerelease:false,body:'更新测试说明',assets:[{name:'Pot.Translate.Next_9.0.0_x64_zh-CN.msi',browser_download_url:'https://github.com/ShengjieLi-CN/Pot-Translate-Next/releases/download/v9.0.0/Pot.Translate.Next_9.0.0_x64_zh-CN.msi'}]});
    if(request.cmd==='download_update'){
     state.downloads++;
     await base({cmd:'tauri',__tauriModule:'Event',message:{cmd:'emit',event:'update-download-progress',payload:{downloaded:5*1048576,total:10*1048576}},callback:0,error:0});
     await new Promise(resolve=>{state.finish=resolve;});
     return state.fail?fail('下载中断，请重试'):done(null);
    }
    if(request.cmd==='cancel_update_download'){state.fail=true;state.finish();return done(null);}
    if(request.cmd==='install_update'){state.installs++;return state.installFail?fail('已取消管理员授权'):done(null);}
    if(request.cmd==='tauri' && request.__tauriModule==='Shell'){state.external++;return done(null);}
    return base(request);
   };
  });
  const dist=path.resolve(__dirname,'../dist');
  await page.route('http://updater.invalid/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   const file=path.resolve(dist,path.extname(pathname)?pathname.slice(1):'index.html');
   assert.ok(file.startsWith(dist+path.sep));
   await route.fulfill({body:await fs.readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream'});
  });
  await page.goto('http://updater.invalid');
  await page.getByRole('button',{name:'下载更新',exact:true}).click();
  await page.getByText(/5.0 \/ 10.0 MB/).waitFor();
  assert.equal(await page.getByRole('button',{name:'关闭',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'取消下载'}).click();
  await page.getByRole('alert').filter({hasText:'下载中断'}).waitFor();
  await page.evaluate(()=>{window.__updateTest.fail=false;});
  await page.getByRole('button',{name:'下载更新',exact:true}).click();
  await page.waitForFunction(()=>window.__updateTest.downloads===2);
  await page.evaluate(()=>window.__updateTest.finish());
  await page.getByText('安装包已下载并通过 SHA256 校验，可以安装。').waitFor();
  await page.getByRole('button',{name:'安装更新并退出应用'}).click();
  await page.getByRole('alert').filter({hasText:'已取消管理员授权'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'安装更新并退出应用'}).isEnabled(),true);
  await page.evaluate(()=>{window.__updateTest.installFail=false;});
  await page.getByRole('button',{name:'安装更新并退出应用'}).click();
  await page.waitForFunction(()=>window.__updateTest.installs===2);
  assert.equal(await page.evaluate(()=>window.__updateTest.external),0);
  // Start a fresh window to test an up-to-date installation.
  await page.reload();
  await page.evaluate(()=>{window.__updateTest.current=true;});
  await page.getByRole('button',{name:'重新检查'}).click();
  await page.getByText(/当前已是最新版本/).waitFor();
  assert.equal(await page.getByRole('button',{name:'下载更新',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: in-app progress, cancellation/retry, checksum-ready state, installation approval retry, current version and no external navigation.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
