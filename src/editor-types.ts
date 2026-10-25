import type { TimelineEdit, Track } from '../electron/timeline'
export type MediaItem = ImportedMedia & { id: string; kind: Track }
export type Snapshot = { media: MediaItem[]; edit: TimelineEdit }
