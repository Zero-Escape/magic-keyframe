import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
// Per-user only. Do not modify Windows' protected UserChoice preference.
export async function associateProjects(executable: string) {
  if (process.platform !== 'win32') throw new Error('Project file association is Windows-only.')
  const root = 'HKCU\\Software\\Classes', id = 'MagicKeyframe.Project'
  const entries: [string, string | null, string][] = [
    [`${root}\\${id}`, null, 'Magic Keyframe Project'],
    [`${root}\\${id}\\DefaultIcon`, null, `"${executable}",0`],
    [`${root}\\${id}\\shell\\open\\command`, null, `"${executable}" "%1"`],
    [`${root}\\.mkproj\\OpenWithProgids`, id, ''],
    [`${root}\\.mkproj`, null, id],
  ]
  for (const [key, name, value] of entries) await run('reg.exe', ['add', key, ...(name === null ? ['/ve'] : ['/v', name]), '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true })
}
