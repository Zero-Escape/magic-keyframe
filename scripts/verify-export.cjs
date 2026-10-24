const assert=require('node:assert/strict')
const {mkdirSync}=require('node:fs')
const {spawnSync}=require('node:child_process')
const ffmpeg=require('ffmpeg-static'), ffprobe=require('ffprobe-static').path
const {buildExportFilter}=require('../dist-electron/export-filter.js')
const root='.test-output/'
mkdirSync(root,{recursive:true})
function run(args){const r=spawnSync(ffmpeg,['-y','-v','error',...args],{encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stderr);return r.stdout}
run(['-f','lavfi','-i','testsrc2=size=640x360:rate=30000/1001','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','4','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv422p10le','-profile:v','high422','-c:a','pcm_s16be',root+'media-check-source.mov'])
run(['-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','4','-c:a','pcm_s16le',root+'media-check-external.wav'])
run(['-i',root+'media-check-source.mov','-vf','scale=-2:360,format=yuv420p','-c:v','libx264','-preset','ultrafast','-c:a','aac',root+'media-check-proxy.mp4'])
const segments=[{start:0,end:2},{start:3,end:4}], edits=[{start:.25,end:.75},{start:1.25,end:2},{start:3,end:4}]
function render(name,tracks,offset=.2){const filter=buildExportFilter(segments,offset,true,true,tracks);run(['-i',root+'media-check-source.mov','-i',root+'media-check-external.wav','-filter_complex',filter,'-map','[vout]','-map','[aout]','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',root+name+'.mp4']);return root+name+'.mp4'}
function samples(file){const r=spawnSync(ffmpeg,['-v','error','-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{maxBuffer:10000000});assert.equal(r.status,0);return new Float32Array(r.stdout.buffer,r.stdout.byteOffset,r.stdout.byteLength/4)}
function rms(data,time){let sum=0,n=0;for(let i=Math.round(time*48000);i<Math.round((time+.05)*48000);i++){sum+=data[i]*data[i];n++}return Math.sqrt(sum/n)}
const cut=render('media-check-cuts',{videoMuted:true,audioMuted:false,audioSegments:edits})
const data=samples(cut)
for(const time of [.1,1.1,2.05])assert.ok(rms(data,time)<.002,`expected silence at ${time}`)
for(const time of [.6,1.6,2.5])assert.ok(rms(data,time)>.02,`expected audio at ${time}`)
const silent=render('media-check-silent',{videoMuted:true,audioMuted:true,videoHidden:true,audioSegments:edits})
assert.ok(rms(samples(silent),.6)<.0001)
const pixels=spawnSync(ffmpeg,['-v','error','-i',silent,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{maxBuffer:5000000});assert.equal(pixels.status,0);assert.ok(pixels.stdout.every(value=>value<=2),'hidden video should be black')
const mix=render('media-check-mix',{videoMuted:false,audioMuted:false,audioSegments:edits})
assert.ok(rms(samples(mix),.1)>.02,'camera audio should remain in external-audio gaps')
const camera=render('media-check-camera',{videoMuted:false,audioMuted:true,audioSegments:edits})
assert.ok(rms(samples(camera),.6)>.02)
const empty=render('media-check-empty-audio',{videoMuted:true,audioMuted:false,audioSegments:[]})
assert.ok(rms(samples(empty),.6)<.0001)
const negative=render('media-check-negative',{videoMuted:true,audioMuted:false,audioSegments:edits},-.2)
assert.ok(rms(samples(negative),.2)>.02)
const probe=spawnSync(ffprobe,['-v','error','-show_entries','format=duration:stream=codec_name,pix_fmt,sample_rate,channels','-of','compact',cut],{encoding:'utf8'});console.log(probe.stdout.trim());console.log('PASS: external-audio cuts preserve silence and alignment; positive/negative offsets; camera/external mix; independent mute; hidden black video; 8-bit output.')
