// Partes de la File System Access API que aún no están en lib.dom.

type FsaPermissionMode = 'read' | 'readwrite'
type FsaStartIn = 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | FileSystemHandle

interface FileSystemHandle {
  queryPermission(desc?: { mode?: FsaPermissionMode }): Promise<PermissionState>
  requestPermission(desc?: { mode?: FsaPermissionMode }): Promise<PermissionState>
}

interface Window {
  showDirectoryPicker(options?: { id?: string; mode?: FsaPermissionMode; startIn?: FsaStartIn }): Promise<FileSystemDirectoryHandle>
}
