export type HTMLDivElementWithEntry = HTMLDivElement & { entry?: TableEntry }

export type TableEntry = {
  x: number
  y: number
  z: number
  status: number
  url: string
  headers: Record<string, string>
  startOrder: number
  startedDateTime: string
  time: number
  statistics?: TileStatistics
  tile?: Blob
  endOrder: unknown
  extra: { isPending: boolean; isValid: boolean; isEmpty: boolean }
  tileSize?: number
}

export type TileStatistics = {
  layersCount: number
  featuresCount: number
  byLayers: Record<string, { featuresCount?: number }>
}

export type DevToolsMessage =
  | { type: 'CLEAR' }
  | { type: 'PENDING_ENTRY'; entry: TableEntry }
  | { type: 'FINISHED_ENTRY'; entry: TableEntry }
  | { type: 'REMOVED_ENTRY'; entry: TableEntry }
  | { type: 'REDRAW_ENTRIES'; entries: TableEntry[] }
