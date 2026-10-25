export type ExportSettings = {
  resolution: '1080p' | '2160p'; fps: number; quality: number; maxMbps: number
  audioKbps: number; encoder: 'auto' | 'cpu' | 'nvidia'; resource: 'low' | 'balanced'
}
export const defaultExportSettings: ExportSettings = { resolution: '1080p', fps: 0, quality: 20, maxMbps: 12, audioKbps: 192, encoder: 'auto', resource: 'low' }
export type ExportProgress = {
  id: string; phase: 'preparing' | 'rendering' | 'finalizing' | 'done' | 'canceled' | 'error'
  percent?: number; elapsed: number; etaSeconds?: number; message: string
  piece?: number; pieces?: number; encoder?: string; warning?: string
}
export function validateExportSettings(value: unknown): ExportSettings {
  const s = value as ExportSettings
  if (!s || !['1080p', '2160p'].includes(s.resolution) || ![0, 24, 25, 29.97, 30, 50, 59.94, 60].includes(s.fps) || !Number.isInteger(s.quality) || s.quality < 16 || s.quality > 28 || !Number.isFinite(s.maxMbps) || s.maxMbps < 2 || s.maxMbps > 100 || ![128, 192, 256, 320].includes(s.audioKbps) || !['auto', 'cpu', 'nvidia'].includes(s.encoder) || !['low', 'balanced'].includes(s.resource)) throw new Error('Invalid export settings.')
  return { ...s }
}
