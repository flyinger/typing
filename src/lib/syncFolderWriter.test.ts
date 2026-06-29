import { describe, expect, it } from "vitest";
import { createSyncFolderExport, parseSyncFolderFiles } from "./syncFolder";
import {
  readSyncFolderFilesFromDirectory,
  writeSyncFolderExportToDirectory,
  type WritableFileSystemDirectoryHandle,
  type WritableFileSystemFileHandle,
  type WritableFileSystemWritable,
} from "./syncFolderWriter";

class MemoryWritable implements WritableFileSystemWritable {
  constructor(private readonly file: MemoryFileHandle) {}

  async write(data: string): Promise<void> {
    this.file.content = data;
  }

  async close(): Promise<void> {
    this.file.closed = true;
  }
}

class MemoryFileHandle implements WritableFileSystemFileHandle {
  readonly kind = "file";
  content = "";
  closed = false;

  async createWritable(): Promise<WritableFileSystemWritable> {
    return new MemoryWritable(this);
  }

  async getFile(): Promise<{ text(): Promise<string> }> {
    return {
      text: async () => this.content,
    };
  }
}

class MemoryDirectoryHandle implements WritableFileSystemDirectoryHandle {
  readonly kind = "directory";
  readonly directories = new Map<string, MemoryDirectoryHandle>();
  readonly files = new Map<string, MemoryFileHandle>();

  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<WritableFileSystemDirectoryHandle> {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options?.create) throw new Error(`Missing directory: ${name}`);
    const directory = new MemoryDirectoryHandle(name);
    this.directories.set(name, directory);
    return directory;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<WritableFileSystemFileHandle> {
    const existing = this.files.get(name);
    if (existing) return existing;
    if (!options?.create) throw new Error(`Missing file: ${name}`);
    const file = new MemoryFileHandle();
    this.files.set(name, file);
    return file;
  }

  async *entries(): AsyncIterableIterator<[string, MemoryDirectoryHandle | MemoryFileHandle]> {
    for (const entry of [...this.directories.entries(), ...this.files.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      yield entry;
    }
  }

  readFile(path: string): string | undefined {
    const parts = path.split("/");
    const fileName = parts[parts.length - 1];
    let directory: MemoryDirectoryHandle = this;
    for (const part of parts.slice(0, -1)) {
      const next = directory.directories.get(part);
      if (!next) return undefined;
      directory = next;
    }
    return directory.files.get(fileName)?.content;
  }
}

describe("sync folder writer", () => {
  it("writes the sync folder export into a selected parent directory", async () => {
    const folderExport = createSyncFolderExport("device/mac", [], [], [], "2026-06-26T09:00:00.000Z");
    const selectedDirectory = new MemoryDirectoryHandle("Syncthing");

    const result = await writeSyncFolderExportToDirectory(folderExport, selectedDirectory);

    expect(result).toMatchObject({
      filesWritten: folderExport.files.length,
      rootPath: "Syncthing/TypingLab",
    });
    expect(result.paths.at(-1)).toBe("TypingLab/manifest.json");
    expect(result.paths.slice(0, -1)).not.toContain("TypingLab/manifest.json");
    expect(result.bytesWritten).toBeGreaterThan(0);
    expect(selectedDirectory.directories.has("TypingLab")).toBe(true);
    expect(selectedDirectory.readFile("TypingLab/manifest.json")).toContain("\"root\": \"TypingLab\"");
    expect(selectedDirectory.readFile("TypingLab/snapshots/2026-06-26-device_mac.json")).toContain(
      "\"deviceId\": \"device/mac\"",
    );
  });

  it("does not create a nested TypingLab directory when the selected root is already TypingLab", async () => {
    const folderExport = createSyncFolderExport("device/mac", [], [], [], "2026-06-26T09:00:00.000Z");
    const selectedDirectory = new MemoryDirectoryHandle("TypingLab");

    const result = await writeSyncFolderExportToDirectory(folderExport, selectedDirectory);

    expect(result.rootPath).toBe("TypingLab");
    expect(selectedDirectory.directories.has("TypingLab")).toBe(false);
    expect(selectedDirectory.readFile("manifest.json")).toContain("\"layoutVersion\": 1");
  });

  it("writes the manifest last so partially written folders do not advertise missing new files", async () => {
    const folderExport = createSyncFolderExport("device/mac", [], [], [], "2026-06-26T09:00:00.000Z");
    const selectedDirectory = new MemoryDirectoryHandle("Syncthing");

    const result = await writeSyncFolderExportToDirectory(folderExport, selectedDirectory);

    expect(result.paths).toHaveLength(folderExport.files.length);
    expect(result.paths.at(-1)).toBe("TypingLab/manifest.json");
    expect(result.paths[0]).not.toBe("TypingLab/manifest.json");
  });

  it("rejects unsafe sync folder paths before writing files", async () => {
    const folderExport = createSyncFolderExport("device/mac", [], [], [], "2026-06-26T09:00:00.000Z");
    const selectedDirectory = new MemoryDirectoryHandle("Syncthing");

    await expect(
      writeSyncFolderExportToDirectory(
        {
          ...folderExport,
          files: [
            {
              path: "TypingLab/../bad.json",
              mediaType: "application/json",
              content: "{}",
            },
          ],
        },
        selectedDirectory,
      ),
    ).rejects.toThrow("不安全片段");
    expect(selectedDirectory.directories.has("TypingLab")).toBe(false);
  });

  it("reads a written sync folder back from a selected parent directory", async () => {
    const folderExport = createSyncFolderExport("device/mac", [], [], [], "2026-06-26T09:00:00.000Z");
    const selectedDirectory = new MemoryDirectoryHandle("Syncthing");
    await writeSyncFolderExportToDirectory(folderExport, selectedDirectory);

    const result = await readSyncFolderFilesFromDirectory(selectedDirectory);
    const parsed = parseSyncFolderFiles(result.files);

    expect(result).toMatchObject({
      filesRead: folderExport.files.length,
      rootPath: "Syncthing/TypingLab",
      files: folderExport.files.map((file) => ({ path: file.path, content: file.content })),
    });
    expect(result.bytesRead).toBeGreaterThan(0);
    expect(parsed.exportedAt).toBe("2026-06-26T09:00:00.000Z");
    expect(parsed.deviceId).toBe("device/mac");
  });

  it("reads a sync folder when the selected root is already TypingLab", async () => {
    const folderExport = createSyncFolderExport("device/mac", [], [], [], "2026-06-26T09:00:00.000Z");
    const selectedDirectory = new MemoryDirectoryHandle("TypingLab");
    await writeSyncFolderExportToDirectory(folderExport, selectedDirectory);

    const result = await readSyncFolderFilesFromDirectory(selectedDirectory);

    expect(result.rootPath).toBe("TypingLab");
    expect(result.files.map((file) => file.path)).toEqual(folderExport.files.map((file) => file.path));
  });

  it("requires a TypingLab directory or root when reading", async () => {
    const selectedDirectory = new MemoryDirectoryHandle("Documents");

    await expect(readSyncFolderFilesFromDirectory(selectedDirectory)).rejects.toThrow("所选目录下没有 TypingLab/");
  });
});
