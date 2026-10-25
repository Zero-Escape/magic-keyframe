import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile, stat, unlink, rename } from 'node:fs/promises'
import { writeProject, type Project } from './project-file.js'
export type RecoveryInfo = { file: string; projectPath?: string; created: number; title: string; session: string }
const keyFor = (source: string | undefined, session: string) => createHash('sha1').update(source ? path.resolve(source).toLowerCase() : session).digest('hex').slice(0, 20)
async function writeAutosave(folder: string, project: Project, projectPath: string | undefined, session: string) {
  await mkdir(folder, { recursive: true })
  const key = keyFor(projectPath, session), created = Date.now(), file = path.join(folder, `${key}-${created}.mkproj`)
  await writeProject(file, project)
  const info: RecoveryInfo = { file, projectPath, created, session, title: projectPath ? path.basename(projectPath) : 'Untitled project' }
  const temporary = `${file}.json.tmp`
  await writeFile(temporary, JSON.stringify(info)); await rename(temporary, `${file}.json`)
  const older = (await readdir(folder)).filter((name) => name.startsWith(`${key}-`) && name.endsWith('.mkproj')).sort().reverse().slice(10)
  await Promise.all(older.flatMap((name) => [unlink(path.join(folder, name)).catch(() => {}), unlink(path.join(folder, `${name}.json`)).catch(() => {})]))
  return created
}
export async function recoveryList(folder: string): Promise<RecoveryInfo[]> {
  await mkdir(folder, { recursive: true })
  const latest = new Map<string, RecoveryInfo>()
  for (const name of await readdir(folder)) {
    if (!name.endsWith('.mkproj.json')) continue
    try {
      const info: RecoveryInfo = JSON.parse(await readFile(path.join(folder, name), 'utf8'))
      info.file = path.join(folder, name.slice(0, -5))
      if (!await stat(info.file).catch(() => null)) continue
      const key = name.split('-')[0]
      const saved = info.projectPath ? await stat(info.projectPath).catch(() => null) : null
      if (saved && saved.mtimeMs >= info.created) continue
      if (!latest.has(key) || latest.get(key)!.created < info.created) latest.set(key, info)
    } catch { /* Interrupted metadata files are not offered as valid recoveries. */ }
  }
  return [...latest.values()].sort((a, b) => b.created - a.created)
}
async function clearRecovery(folder: string, projectPath: string | undefined, session: string) {
  const key = keyFor(projectPath, session)
  const names = await readdir(folder).catch(() => [] as string[])
  await Promise.all(names.filter((name) => name.startsWith(`${key}-`)).map((name) => unlink(path.join(folder, name)).catch(() => {})))
}
export async function recoveryInfo(folder: string, file: string): Promise<RecoveryInfo> {
  if (path.dirname(path.resolve(file)) !== path.resolve(folder) || !file.endsWith('.mkproj')) throw new Error('Invalid recovery file.')
  return JSON.parse(await readFile(`${file}.json`, 'utf8'))
}

const queues = new Map<string, Promise<unknown>>()
function serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (queues.get(key) || Promise.resolve()).catch(() => {}).then(operation)
  queues.set(key, result)
  void result.finally(() => { if (queues.get(key) === result) queues.delete(key) }).catch(() => {})
  return result
}
export function autosave(folder: string, project: Project, source: string | undefined, session: string) {
  return serial(keyFor(source, session), () => writeAutosave(folder, project, source, session))
}
export function discardRecovery(folder: string, source: string | undefined, session: string) {
  return serial(keyFor(source, session), () => clearRecovery(folder, source, session))
}
