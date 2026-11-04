const fs=require('fs');const vm=require('vm');const assert=require('assert/strict');
const source=fs.readFileSync('app/services/mtpAccessRecovery.js','utf8').replace(/^import[\s\S]*?;\n/gm,'').replaceAll('export const ','const ');
const {createMtpAccessRecovery}=vm.runInNewContext(source+'\n({createMtpAccessRecovery});',{execFile:()=>{},promisify:()=>{},setTimeout,process:{env:{}},join:require('path').join,homedir:()=>'/home/test'});
async function run(){
 let state='mtp,adb';const toggles=[];let failOff=false;
 const mock=async(_,args)=>{
  if(args[0]==='devices')return{stdout:'List of devices attached\nS1 device usb:1 model:A\nS2 device usb:2 model:B\n'};
  assert.equal(args[1],'S1','must never target another phone');
  if(args.includes('get-state'))return{stdout:'device\n'};
  if(args.includes('getprop'))return{stdout:args.at(-1)==='sys.usb.config'?'mtp,adb':state};
  if(args.includes('setFunctions')){
   const off=args.at(-1)==='setFunctions';toggles.push(off?'off':'on');state=off?'adb':'mtp,adb';
   if(off){const e=new Error(failOff?'Permission Denial':'error: closed');e.code=failOff?1:255;throw e;}
   return{stdout:''};
  }
  throw Error('Unexpected command');
 };
 let clock=0;const recover=createMtpAccessRecovery({run:mock,pause:async ms=>{clock+=ms},now:()=>clock,locateAdb:()=>'/adb'});
 await recover({serial:'S1'},()=>{});assert.deepEqual(toggles,['off','on']);assert.equal(state,'mtp,adb');
 toggles.length=0;failOff=true;await assert.rejects(recover({serial:'S1'},()=>{}));assert.deepEqual(toggles,['off','on'],'restore MTP even on failed off stage');
 toggles.length=0;await assert.rejects(recover({serial:'not-authorized'},()=>{}));assert.equal(toggles.length,0);
 await assert.rejects(recover({serial:''},()=>{}));assert.equal(toggles.length,0);
 console.log('PASS: exact wired ADB serial; disconnect tolerated; MTP restored on failure; unauthorized targets rejected');
}
run().catch(e=>{console.error(e);process.exitCode=1});
