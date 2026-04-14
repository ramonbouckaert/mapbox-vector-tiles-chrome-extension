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
  endOrder: number | undefined
  extra: { isPending: boolean; isValid: boolean; isEmpty: boolean }
  tileSize?: number
}

export type TileStatistics = {
  layersCount: number
  featuresCount: number
  byLayers: Record<string, { featuresCount?: number }>
}

