const DB_NAME = 'devtools-mapbox-vector-tile-store'
const STORE_NAME = 'tiles'
const DB_VERSION = 2

export class TileStore {
  private readonly inspectedTabId: string | undefined
  private readonly db: Promise<IDBDatabase>

  constructor(inspectedTabId?: string) {
    this.inspectedTabId = inspectedTabId
    this.db = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result
        if (db.objectStoreNames.contains(STORE_NAME)) {
          db.deleteObjectStore(STORE_NAME)
        }
        db.createObjectStore(STORE_NAME)
      }

      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => db.close()
        resolve(db)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async set(requestHash: string, blob: Blob): Promise<void> {
    const inspectedTabId = this.inspectedTabId
    if (!inspectedTabId) throw new Error('TileStore: inspectedTabId required for set()')
    const db = await this.db
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(blob, [inspectedTabId, requestHash])
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async get(requestHash: string): Promise<Blob | undefined> {
    const inspectedTabId = this.inspectedTabId
    if (!inspectedTabId) throw new Error('TileStore: inspectedTabId required for get()')
    const db = await this.db
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const request = tx.objectStore(STORE_NAME).get([inspectedTabId, requestHash])
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error)
    })
  }

  async delete(requestHash: string): Promise<void> {
    const inspectedTabId = this.inspectedTabId
    if (!inspectedTabId) throw new Error('TileStore: inspectedTabId required for delete()')
    const db = await this.db
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete([inspectedTabId, requestHash])
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async clearForTab(tabId: string): Promise<void> {
    const db = await this.db
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const range = IDBKeyRange.bound([tabId], [tabId, '\uffff'])
      const request = tx.objectStore(STORE_NAME).openCursor(range)
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async clear(): Promise<void> {
    const db = await this.db
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}
