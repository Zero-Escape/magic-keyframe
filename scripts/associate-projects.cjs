// Optional, per-user Windows association for a source checkout. No administrator rights.
const path = require('node:path')
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
if (process.platform !== 'win32') { console.error('Project association is Windows-only.'); process.exit(1) }
const root = path.resolve(__dirname, '..')
const electron = require('electron')
if (!fs.existsSync(electron)) { console.error('Run npm start once before registering projects.'); process.exit(1) }
const registry = 'HKCU\\Software\\Classes'
const command = `"${electron}" "${root}" "%1"`
const entries = [
  [`${registry}\\.mkproj`, '', 'MagicKeyframe.Project'],
  [`${registry}\\MagicKeyframe.Project`, '', 'Magic Keyframe Project'],
  [`${registry}\\MagicKeyframe.Project\\DefaultIcon`, '', `"${electron}",0`],
  [`${registry}\\MagicKeyframe.Project\\shell\\open\\command`, '', command],
]
for (const [key, name, value] of entries) {
  const result = spawnSync('reg.exe', ['add', key, name ? '/v' : '/ve', ...(name ? [name] : []), '/t', 'REG_SZ', '/d', value, '/f'], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) { console.error(result.stderr || result.stdout || 'Could not register project files.'); process.exit(1) }
}
// Tell Explorer its associations changed. Windows may still ask the user to choose
// their preferred app; do not modify protected UserChoice registry settings.
spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class MKNotify { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e, uint f, IntPtr a, IntPtr b); }\'; [MKNotify]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)'], { windowsHide: true })
console.log('Registered .mkproj files for this checkout. Keep this folder in place. If Windows asks, choose Magic Keyframe/Electron as the app for .mkproj.')
