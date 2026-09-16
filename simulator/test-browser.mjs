import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'

const browser = await chromium.launch({headless:true, channel:'chrome'})
const page = await browser.newPage()
try {
  await page.goto(process.env.LINK_TEST_URL ?? 'http://127.0.0.1:5180/')
  const result = await page.evaluate(async () => {
    const {createSimulator} = await import('/src/simulator/index.ts')
    const wait = ms => new Promise(resolve=>setTimeout(resolve,ms))
    const errors=[], logs=[], states=[]
    let frameCount=0, latestFrame
    const simulator=createSimulator({
      onFrame:frame=>{frameCount++;latestFrame=frame},
      onLog:log=>logs.push(log.message), onError:message=>errors.push(message),
      onState:state=>states.push(state),
    })
    async function until(predicate) {
      const deadline=performance.now()+5000
      while(!predicate()) {if(performance.now()>deadline) throw new Error('Timed out: '+JSON.stringify({states,errors,logs}));await wait(10)}
    }
    const source=`-- ryz-app/1
local board=require('ryzobee')
local ui=require('ui')
local generation=ui.mount({id='test',background=0x0000,objects={
{id='tap',kind='button',x=10,y=10,width=220,height=220,text='TAP',font='title_24',foreground=0xffff,background=0xfb40}}})
local count=0
while true do
 local event=ui.poll()
 if event and event.id=='tap' then count=count+1; print('TAPPED '..count); ui.update(generation,{{id='tap',background=0x07e0,text='DONE'}}) end
 board.sleep_ms(10)
end`
    await simulator.run(source)
    await until(()=>frameCount>0 || errors.length>0)
    if(errors.length) return {errors,states,logs}
    const before=Array.from(latestFrame.pixels.slice(4*240*100+4*100,4*240*100+4*100+4))
    simulator.pointer({x:120,y:120,pressed:true}); await wait(40)
    simulator.pointer({x:120,y:120,pressed:false})
    await until(()=>logs.some(text=>text.includes('TAPPED 1')))
    await wait(50)
    const after=Array.from(latestFrame.pixels.slice(4*240*100+4*100,4*240*100+4*100+4))
    // A cancelled pointer must never turn into a click at a clamped coordinate.
    simulator.pointer({x:120,y:120,pressed:true});await wait(20)
    simulator.pointer({x:-1,y:-1,pressed:false});await wait(50)
    const cancelDidNotClick=!logs.some(text=>text.includes('TAPPED 2'))
    // Queue overflow and merged moves cannot violate the firmware input ABI.
    for(let i=0;i<200;i++) simulator.pointer({x:120,y:120,pressed:i%2===0})
    await wait(150)
    let started=performance.now();await simulator.stop();const touchStopMs=performance.now()-started
    await simulator.run('-- ryz-app/1\nwhile true do end')
    await until(()=>states.at(-1)==='running');await wait(60)
    started=performance.now();await simulator.stop();const loopStopMs=performance.now()-started
    await simulator.run("-- ryz-app/1\nlocal b=require('ryzobee');b.sleep_ms(5000)")
    await until(()=>states.at(-1)==='running');await wait(60)
    started=performance.now();await simulator.stop();const sleepStopMs=performance.now()-started
    await simulator.run("-- ryz-app/1\nwhile true do print('LOG FLOOD') end")
    await until(()=>states.at(-1)==='running');await wait(200)
    started=performance.now();await simulator.stop();const floodStopMs=performance.now()-started
    const framesBeforeFlood=frameCount
    await simulator.run("-- ryz-app/1\nlocal d=require('display');while true do d.clear(0xf800);d.show() end")
    await until(()=>states.at(-1)==='running');await wait(250)
    started=performance.now();await simulator.stop();const frameFloodStopMs=performance.now()-started
    const framesDuringFlood=frameCount-framesBeforeFlood
    const framesBeforeCanvas=frameCount
    await simulator.run("-- ryz-app/1\nlocal d=require('display');d.clear(0xf800);d.text(10,10,'HELLO',0xffff,2);d.show();d.clear(0x07e0)")
    await until(()=>states.at(-1)==='idle' && frameCount>framesBeforeCanvas)
    const unpresentedNotShown=latestFrame.pixels[0]===255 && latestFrame.pixels[1]===0
    if(errors.length) throw new Error('Unexpected runtime failure: '+JSON.stringify(errors))
    await simulator.run('-- ryz-app/1\nlocal = invalid')
    await until(()=>errors.length>0)
    const syntaxError=errors.at(-1)
    errors.length=0
    await simulator.run("-- ryz-app/1\nprint('RERUN OK')")
    await until(()=>logs.some(text=>text.includes('RERUN OK')))
    simulator.dispose()
    return {errors,frameCount,before,after,cancelDidNotClick,unpresentedNotShown,touchStopMs,loopStopMs,sleepStopMs,floodStopMs,frameFloodStopMs,framesDuringFlood,syntaxError,
      rerun:logs.some(text=>text.includes('RERUN OK')),boundedFlood:logs.some(text=>text.includes('已省略'))}
  })
  console.log(JSON.stringify(result,null,2))
  assert.deepEqual(result.errors,[])
  assert.ok(result.frameCount>2)
  assert.notDeepEqual(result.before,result.after)
  assert.ok(result.cancelDidNotClick && result.rerun)
  assert.ok(result.unpresentedNotShown)
  assert.match(result.syntaxError,/main.lua:2:.*expected near/)
  assert.ok(result.boundedFlood)
  assert.ok(result.framesDuringFlood>0 && result.framesDuringFlood<30)
  for(const key of ['touchStopMs','loopStopMs','sleepStopMs','floodStopMs','frameFloodStopMs']) assert.ok(result[key]<500,`${key}: ${result[key]}`)
} finally {await browser.close()}
