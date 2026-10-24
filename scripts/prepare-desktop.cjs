const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const expectedHash = '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00'
const url = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz'
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex')
const exists = (file) => fs.access(file).then(() => true, () => false)
function install(script) {
  const result = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Desktop dependency setup failed: ${path.basename(script)}`)
}
async function main() {
  // These direct installers also work when npm's optional lifecycle-script approval
  // has left Electron/FFmpeg packages present but their binaries uninstalled.
  const electronDir = path.dirname(require.resolve('electron/package.json'))
  if (!await exists(path.join(electronDir, 'path.txt'))) install(path.join(electronDir, 'install.js'))
  if (process.platform !== 'win32') {
    const nativeFfmpeg = require('ffmpeg-static')
    if (!nativeFfmpeg || !await exists(nativeFfmpeg)) install(require.resolve('ffmpeg-static/install.js'))
  }
  const output = path.join(root, 'assets', 'ffmpeg-win64.exe')
  if (await exists(output) && hash(await fs.readFile(output)) === expectedHash) {
    console.log('Desktop media binary ready (Windows FFmpeg 6.1.1).')
    return
  }
  console.log('Downloading Windows FFmpeg 6.1.1…')
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw new Error(`Media download failed: HTTP ${response.status}`)
  const binary = zlib.gunzipSync(Buffer.from(await response.arrayBuffer()), { maxOutputLength: 128 * 1024 * 1024 })
  if (hash(binary) !== expectedHash) throw new Error('Windows FFmpeg checksum mismatch; downloaded binary was not installed')
  await fs.mkdir(path.dirname(output), { recursive: true })
  const pending = `${output}.${process.pid}.download`
  await fs.writeFile(pending, binary)
  await fs.rename(pending, output)
  console.log('Windows FFmpeg downloaded and SHA-256 verified.')
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
