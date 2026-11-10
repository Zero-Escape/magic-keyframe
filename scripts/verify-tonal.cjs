// Actual FFmpeg pixels + studio graph + project disk round trip, not UI mocks.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
const ffmpeg = require('ffmpeg-static'), ffprobe = require('ffprobe-static').path
const { effects, videoProcessing } = require('../dist-electron/effects.js')
const { emptyEdit } = require('../dist-electron/timeline.js')
const { buildStudioExport } = require('../dist-electron/studio-export.js')
const { validateProject, writeProject, readProject } = require('../dist-electron/project-file.js')
const root = '.test-output/tonal'
fs.mkdirSync(root, { recursive: true })
function run(args, input) {
  const r = spawnSync(ffmpeg, ['-y', '-v', 'error', '-threads', '2', '-filter_complex_threads', '1', '-filter_threads', '1', ...args], { input, maxBuffer: 8000000 })
  assert.equal(r.status, 0, r.stderr.toString()); return r.stdout
}
const pixels = Buffer.alloc(256 * 16 * 6)
for (let y = 0; y < 16; y++) for (let x = 0; x < 256; x++) for (let c = 0; c < 3; c++) pixels.writeUInt16LE(x * 257, (y * 256 + x) * 6 + c * 2)
const rawArgs = ['-f', 'rawvideo', '-pix_fmt', 'rgb48le', '-s', '256x16', '-r', '24', '-i', 'pipe:0']
function curve(shadows, highlights) {
  const result = run([...rawArgs, '-vf', [...videoProcessing(effects({ shadows, highlights }), 1), 'format=rgb48le'].join(',') || 'null', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'], pixels)
  return Array.from({ length: 256 }, (_, x) => result.readUInt16LE(x * 6) / 65535)
}
const neutral = curve(0, 0)
for (let i = 0; i < 256; i++) assert.ok(Math.abs(neutral[i] - i / 255) < .001)
for (const shadows of [-100, 0, 100]) for (const highlights of [-100, 0, 100]) {
  const out = curve(shadows, highlights)
  assert.ok(out[0] < .001 && out[255] > .995, 'black/white anchors')
  for (let i = 1; i < 256; i++) assert.ok(out[i] >= out[i - 1] - .0001, 'no inverted tonal bands')
}
const shadowUp = curve(100, 0), highlightDown = curve(0, -100)
assert.ok(shadowUp[64] - neutral[64] > .13 && shadowUp[224] - neutral[224] < .02)
assert.ok(neutral[192] - highlightDown[192] > .13 && neutral[32] - highlightDown[32] < .02)
run([...rawArgs, '-vf', 'format=yuv422p10le', '-c:v', 'libx264', '-profile:v', 'high422', '-preset', 'ultrafast', '-frames:v', '24', root + '/source.mov'], Buffer.concat(Array(24).fill(pixels)))
run(['-i', root + '/source.mov', '-vf', 'scale=768:48,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', root + '/proxy.mp4'])
const edit = emptyEdit(); edit.video.push({ id: 'v', mediaId: 'm', lane: 0, at: 0, start: 0, end: 1, effects: { shadows: 40, highlights: -40 } })
const graph = buildStudioExport(edit, [{ id: 'm', path: root + '/source.mov', audio: false, video: true }], 256, 16, 24)
run(['-i', root + '/source.mov', '-filter_complex', graph, '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', root + '/export.mp4'])
const probe = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,pix_fmt,sample_rate', '-of', 'json', root + '/export.mp4'], { encoding: 'utf8' })
assert.equal(probe.status, 0); const info = JSON.parse(probe.stdout)
assert.ok(info.streams.some(s => s.codec_name === 'h264' && s.pix_fmt === 'yuv420p'))
assert.ok(Math.abs(Number(info.format.duration) - 1) < .1)
;(async () => {
  const project = { format: 'magic-keyframe-project', version: 7, media: [{ id: 'm', kind: 'video', path: root + '/source.mov' }], edit, view: { position: 0, zoom: 100, timelineHeight: 380, sidebarWidth: 320 } }
  await writeProject(root + '/roundtrip.mkproj', project)
  const restored = await readProject(root + '/roundtrip.mkproj')
  assert.deepEqual(restored.edit.video[0].effects, { shadows: 40, highlights: -40 })
  for (const version of [3, 4, 5, 6]) assert.equal(validateProject({ ...project, version }).version, 7)
  const invalid = structuredClone(project); invalid.edit.video[0].effects.shadows = 101
  assert.throws(() => validateProject(invalid), /Invalid clip effect/)
  console.log('PASS: neutral identity; 9 real FFmpeg curves monotonic/anchored; selective shadow/highlight response; 10-bit 4:2:2 probe/proxy/studio export; project disk round trip and v3–6 migration.')
})().catch(e => { console.error(e); process.exitCode = 1 })
