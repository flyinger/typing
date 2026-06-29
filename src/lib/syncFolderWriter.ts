import type { SyncFolderExport, SyncFolderFile } from "./syncFolder";

export interface WritableFileSystemWritable {
  write(data: string): Promise<void> | void;
  close(): Promise<void> | void;
}

export interface WritableFileSystemFileHandle {
  kind?: "file";
  getFile?: () => Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<WritableFileSystemWritable>;
}

export interface WritableFileSystemDirectoryHandle {
  kind?: "directory";
  name?: string;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<WritableFileSystemDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<WritableFileSystemFileHandle>;
  entries?: () => AsyncIterableIterator<[string, FileSystemAccessHandle]>;
}

export interface SyncFolderWriteResult {
  filesWritten: number;
  bytesWritten: number;
  rootPath: string;
  paths: string[];
}

export interface SyncFolderReadResult {
  filesRead: number;
  bytesRead: number;
  rootPath: string;
  files: Array<Pick<SyncFolderFile, "path" | "content">>;
}

export interface SyncFolderReadOptions {
  maxDepth?: number;
  maxFiles?: number;
  maxBytes?: number;
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<WritableFileSystemDirectoryHandle>;
};

type FileSystemAccessHandle = WritableFileSystemDirectoryHandle | WritableFileSystemFileHandle;

interface PlannedFile {
  file: SyncFolderFile;
  relativeParts: string[];
}

const encoder = new TextEncoder();

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickWritableDirectory(): Promise<WritableFileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error("当前浏览器不支持直接写入本地目录。");
  }
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    throw new Error("当前浏览器不支持直接写入本地目录。");
  }
  return picker.call(window, { mode: "readwrite" });
}

export async function pickReadableDirectory(): Promise<WritableFileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error("当前浏览器不支持直接读取本地目录。");
  }
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    throw new Error("当前浏览器不支持直接读取本地目录。");
  }
  return picker.call(window, { mode: "read" });
}

export async function writeSyncFolderExportToDirectory(
  folderExport: SyncFolderExport,
  directoryHandle: WritableFileSystemDirectoryHandle,
): Promise<SyncFolderWriteResult> {
  const plannedFiles = orderPlannedFilesForWrite(
    folderExport.files.map((file) => planFile(file, folderExport.manifest.root)),
    folderExport.manifest.root,
  );
  const rootDirectory =
    directoryHandle.name === folderExport.manifest.root
      ? directoryHandle
      : await directoryHandle.getDirectoryHandle(folderExport.manifest.root, { create: true });
  let bytesWritten = 0;
  const paths: string[] = [];

  for (const planned of plannedFiles) {
    const fileName = planned.relativeParts[planned.relativeParts.length - 1];
    const directoryParts = planned.relativeParts.slice(0, -1);
    const targetDirectory = await getNestedDirectory(rootDirectory, directoryParts);
    const fileHandle = await targetDirectory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(planned.file.content);
    await writable.close();
    bytesWritten += encoder.encode(planned.file.content).length;
    paths.push(planned.file.path);
  }

  return {
    filesWritten: paths.length,
    bytesWritten,
    rootPath: directoryHandle.name === folderExport.manifest.root
      ? folderExport.manifest.root
      : `${directoryHandle.name ? `${directoryHandle.name}/` : ""}${folderExport.manifest.root}`,
    paths,
  };
}

export async function readSyncFolderFilesFromDirectory(
  directoryHandle: WritableFileSystemDirectoryHandle,
  options: SyncFolderReadOptions = {},
): Promise<SyncFolderReadResult> {
  const rootName = "TypingLab";
  const rootDirectory = await getSyncRootDirectory(directoryHandle, rootName);
  const maxDepth = options.maxDepth ?? 4;
  const maxFiles = options.maxFiles ?? 2000;
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
  const files: Array<Pick<SyncFolderFile, "path" | "content">> = [];
  let bytesRead = 0;

  await collectSyncFolderFiles(rootDirectory, rootName, [], {
    files,
    maxDepth,
    maxFiles,
    maxBytes,
    onBytesRead(bytes) {
      bytesRead += bytes;
      if (bytesRead > maxBytes) {
        throw new Error("同步目录文件过大，请改用同步目录清单或拆分材料后再导入。");
      }
    },
  });

  if (!files.some((file) => file.path === `${rootName}/manifest.json`)) {
    throw new Error("所选同步目录缺少 TypingLab/manifest.json。");
  }

  files.sort((left, right) => syncFileOrder(left.path) - syncFileOrder(right.path) || left.path.localeCompare(right.path));

  return {
    filesRead: files.length,
    bytesRead,
    rootPath: directoryHandle.name === rootName ? rootName : `${directoryHandle.name ? `${directoryHandle.name}/` : ""}${rootName}`,
    files,
  };
}

async function getNestedDirectory(
  rootDirectory: WritableFileSystemDirectoryHandle,
  directoryParts: string[],
): Promise<WritableFileSystemDirectoryHandle> {
  let current = rootDirectory;
  for (const part of directoryParts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

async function getSyncRootDirectory(
  directoryHandle: WritableFileSystemDirectoryHandle,
  rootName: string,
): Promise<WritableFileSystemDirectoryHandle> {
  if (directoryHandle.name === rootName) {
    return directoryHandle;
  }
  try {
    return await directoryHandle.getDirectoryHandle(rootName);
  } catch {
    throw new Error("所选目录下没有 TypingLab/，请选择同步父目录或直接选择 TypingLab 目录。");
  }
}

async function collectSyncFolderFiles(
  directoryHandle: WritableFileSystemDirectoryHandle,
  rootName: string,
  relativeParts: string[],
  context: {
    files: Array<Pick<SyncFolderFile, "path" | "content">>;
    maxDepth: number;
    maxFiles: number;
    maxBytes: number;
    onBytesRead: (bytes: number) => void;
  },
): Promise<void> {
  if (relativeParts.length > context.maxDepth) {
    throw new Error("同步目录层级过深，请检查 TypingLab/ 目录结构。");
  }
  if (!directoryHandle.entries) {
    throw new Error("当前浏览器不支持枚举本地同步目录。");
  }

  for await (const [name, handle] of directoryHandle.entries()) {
    assertSafePathPart(name, `${rootName}/${[...relativeParts, name].join("/")}`);
    const nextParts = [...relativeParts, name];
    const fullPath = `${rootName}/${nextParts.join("/")}`;

    if (isDirectoryHandle(handle)) {
      if (shouldEnterSyncDirectory(nextParts)) {
        await collectSyncFolderFiles(handle, rootName, nextParts, context);
      }
      continue;
    }

    if (!shouldReadSyncFolderPath(fullPath)) {
      continue;
    }
    if (context.files.length >= context.maxFiles) {
      throw new Error("同步目录文件数量过多，请检查 TypingLab/ 目录结构。");
    }
    if (!handle.getFile) {
      throw new Error(`当前浏览器无法读取文件：${fullPath}`);
    }

    const file = await handle.getFile();
    const content = await file.text();
    context.onBytesRead(encoder.encode(content).length);
    context.files.push({ path: fullPath, content });
  }
}

function planFile(file: SyncFolderFile, rootName: string): PlannedFile {
  const parts = file.path.split("/");
  if (parts[0] !== rootName || parts.length < 2) {
    throw new Error(`同步目录文件路径必须位于 ${rootName}/ 下：${file.path}`);
  }
  const relativeParts = parts.slice(1);
  for (const part of relativeParts) {
    assertSafePathPart(part, file.path);
  }
  return { file, relativeParts };
}

function orderPlannedFilesForWrite(plannedFiles: PlannedFile[], rootName: string): PlannedFile[] {
  const manifestPath = `${rootName}/manifest.json`;
  return [...plannedFiles].sort((left, right) => {
    if (left.file.path === manifestPath) return 1;
    if (right.file.path === manifestPath) return -1;
    return syncFileOrder(left.file.path) - syncFileOrder(right.file.path) || left.file.path.localeCompare(right.file.path);
  });
}

function assertSafePathPart(part: string, fullPath: string): void {
  if (!part || part === "." || part === ".." || part.includes("\\") || part.includes("\0")) {
    throw new Error(`同步目录文件路径包含不安全片段：${fullPath}`);
  }
}

function isDirectoryHandle(handle: FileSystemAccessHandle): handle is WritableFileSystemDirectoryHandle {
  return handle.kind === "directory" || "getDirectoryHandle" in handle;
}

function shouldEnterSyncDirectory(parts: string[]): boolean {
  if (parts.length !== 1) return false;
  return ["sessions", "materials", "snapshots", "exports"].includes(parts[0]);
}

function shouldReadSyncFolderPath(path: string): boolean {
  if (path === "TypingLab/manifest.json") return true;
  if (path.startsWith("TypingLab/sessions/")) return path.endsWith(".jsonl");
  if (path.startsWith("TypingLab/materials/")) return path.endsWith(".json");
  if (path.startsWith("TypingLab/snapshots/")) return path.endsWith(".json");
  if (path.startsWith("TypingLab/exports/")) return path.endsWith(".csv");
  return false;
}

function syncFileOrder(path: string): number {
  if (path === "TypingLab/manifest.json") return 0;
  if (path.startsWith("TypingLab/sessions/")) return 1;
  if (path.startsWith("TypingLab/materials/")) return 2;
  if (path.startsWith("TypingLab/snapshots/")) return 3;
  if (path.startsWith("TypingLab/exports/")) return 4;
  return 5;
}
