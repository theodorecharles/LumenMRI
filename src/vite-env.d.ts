/// <reference types="vite/client" />

interface HTMLInputElement {
  webkitdirectory: boolean
}

interface Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
}
