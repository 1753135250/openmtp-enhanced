const fs=require('fs');const vm=require('vm');const assert=require('assert/strict');
let shellRecoveries=0;
const source=fs.readFileSync('app/data/file-explorer/data-sources/FileExplorerKalamDataSource.js','utf8').replace(/^import[\s\S]*?;\n/gm,'').replace('export class','class')+'\nFileExplorerKalamDataSource;';
const Source=vm.runInNewContext(source,{recoverMtpAccess:async c=>{assert.equal(c.serial,'S1');shellRecoveries++},setMtpAccessStatus:()=>{},log:{error:()=>{}},setTimeout,Date});
async function run(){
 const denied={error:'no storage found',stderr:'ErrorNoStorage',data:null};const granted={error:null,stderr:null,data:[{Sid:1,Info:{StorageDescription:'Internal'}}]};
 const s=Object.create(Source.prototype);let calls=0;s.kalamFfi={listStorages:async()=>denied};s._recoverStorageAccess=async()=>{calls++;return granted};
 s.recoverOnNoStorage=false;await s.listStorages();assert.equal(calls,0);
 s.recoverOnNoStorage=true;const result=await s.listStorages();assert.equal(result.data[1].name,'Internal');assert.equal(calls,1);
 await s.listStorages();assert.equal(calls,1,'must not cycle USB repeatedly while waiting for permission');
 const active=Object.create(Source.prototype);active.selectedDeviceChoice={serial:'S1',vendorId:1,productId:2};let selected;
 active.kalamFfi={dispose:async()=>({}),deviceCall:async(name,key)=>{
  if(name==='ListDevices')return{data:[{key:'wrong',serial:'S2',vendorId:1,productId:2},{key:'new-usb',serial:'S1',vendorId:1,productId:2}]};
  selected=key;return{};
 },initialize:async()=>({}),listStorages:async()=>granted};
 let reads=0;active.kalamFfi.listStorages=async()=>++reads===1?{error:'LIBUSB_ERROR_NO_DEVICE',stderr:'ErrorGeneral'}:granted;
 await active._recoverStorageAccess();assert.equal(selected,'new-usb');assert.equal(active.selectedDeviceKey,'new-usb');assert.equal(shellRecoveries,1);
 console.log('PASS: recovery only after explicit refresh + no storage; one attempt; rebind same phone after USB address changes');
}
run().catch(e=>{console.error(e);process.exitCode=1});
