interface LegacyFileEntry {
  isFile: boolean
  isDirectory: boolean
  file: (callback: (file: File) => void, error?: (error: DOMException) => void) => void
  createReader: () => {
    readEntries: (
      callback: (entries: LegacyFileEntry[]) => void,
      error?: (error: DOMException) => void,
    ) => void
  }
}

async function walkHandle(handle: FileSystemDirectoryHandle): Promise<File[]> {
  const files: File[] = []
  const iterable = handle as FileSystemDirectoryHandle & {
    values: () => AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>
  }
  for await (const entry of iterable.values()) {
    if (entry.kind === 'file') files.push(await entry.getFile())
    else files.push(...(await walkHandle(entry)))
  }
  return files
}

export async function chooseDirectory(): Promise<File[] | null> {
  if (!window.showDirectoryPicker) return null
  try {
    return await walkHandle(await window.showDirectoryPicker())
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return []
    throw error
  }
}

function readLegacyDirectory(entry: LegacyFileEntry): Promise<LegacyFileEntry[]> {
  return new Promise((resolve, reject) => {
    const reader = entry.createReader()
    const allEntries: LegacyFileEntry[] = []
    const readBatch = () => {
      reader.readEntries((entries) => {
        if (!entries.length) resolve(allEntries)
        else {
          allEntries.push(...entries)
          readBatch()
        }
      }, reject)
    }
    readBatch()
  })
}

async function fileFromLegacyEntry(entry: LegacyFileEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve, reject) => entry.file((file) => resolve([file]), reject))
  }
  if (!entry.isDirectory) return []
  const children = await readLegacyDirectory(entry)
  return (await Promise.all(children.map(fileFromLegacyEntry))).flat()
}

export async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const entries: LegacyFileEntry[] = []
  for (const item of [...dataTransfer.items]) {
    const entry = (
      item as unknown as { webkitGetAsEntry?: () => LegacyFileEntry | null }
    ).webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }

  if (!entries.length) return [...dataTransfer.files]
  return (await Promise.all(entries.map(fileFromLegacyEntry))).flat()
}
