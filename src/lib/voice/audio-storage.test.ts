/**
 * src/lib/voice/audio-storage.test.ts
 *
 * Unit tests for the pluggable TTS audio-storage backend (Phase 6f hardening).
 *
 * Tests cover:
 *   - saveTtsAudio writes to public/tts/<uuid>.<ext> and returns /tts/<file>
 *   - saveTtsAudio defaults to the .mp3 extension
 *   - saveTtsAudio honours a custom extension
 *   - cleanupTtsAudio deletes ONLY files older than maxAgeMs (keeps fresh ones)
 *   - cleanupTtsAudio returns { deleted: 0 } when the directory is missing
 *   - cleanupTtsAudio skips subdirectories (non-files)
 *
 * All filesystem access is mocked — no real disk I/O, no network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock fs/promises ──────────────────────────────────────────────────────────
const {
  mockWriteFile,
  mockMkdir,
  mockReaddir,
  mockStat,
  mockUnlink,
} = vi.hoisted(() => ({
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockReaddir: vi.fn(),
  mockStat: vi.fn(),
  mockUnlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("fs/promises", () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  readdir: mockReaddir,
  stat: mockStat,
  unlink: mockUnlink,
}));

// Deterministic UUIDs for asserting file names.
vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return {
    ...actual,
    randomUUID: vi.fn().mockReturnValue("test-uuid-1234"),
  };
});

import { saveTtsAudio, cleanupTtsAudio } from "./audio-storage";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a fake fs.Stats-like object for a file with the given mtime. */
function fileStat(mtimeMs: number) {
  return { isFile: () => true, mtimeMs };
}

/** Build a fake fs.Stats-like object for a directory. */
function dirStat() {
  return { isFile: () => false, mtimeMs: 0 };
}

// ── saveTtsAudio ────────────────────────────────────────────────────────────

describe("saveTtsAudio — local disk (default backend)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TTS_STORAGE; // ensure default (local) backend
  });

  it("writes to public/tts/<uuid>.mp3 and returns /tts/<uuid>.mp3", async () => {
    const url = await saveTtsAudio(Buffer.from("fake-mp3"));

    expect(url).toBe("/tts/test-uuid-1234.mp3");
    expect(mockMkdir).toHaveBeenCalledOnce();
    expect(mockWriteFile).toHaveBeenCalledOnce();

    const [filePath] = mockWriteFile.mock.calls[0] as [string];
    expect(filePath).toContain("public");
    expect(filePath).toContain("test-uuid-1234.mp3");
  });

  it("defaults to the mp3 extension when none is given", async () => {
    const url = await saveTtsAudio(Buffer.from("bytes"));
    expect(url).toMatch(/^\/tts\/[^/]+\.mp3$/);
  });

  it("honours a custom extension", async () => {
    const url = await saveTtsAudio(Buffer.from("bytes"), "wav");
    expect(url).toBe("/tts/test-uuid-1234.wav");
  });

  it("returns a URL under the /tts/ prefix", async () => {
    const url = await saveTtsAudio(Buffer.from("bytes"));
    expect(url.startsWith("/tts/")).toBe(true);
  });
});

// ── cleanupTtsAudio ───────────────────────────────────────────────────────────

describe("cleanupTtsAudio — TTL sweep", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes only files older than maxAgeMs, keeping fresh ones", async () => {
    const now = Date.now();
    const maxAgeMs = 24 * 60 * 60 * 1000; // 24h

    mockReaddir.mockResolvedValue(["old.mp3", "fresh.mp3"]);
    mockStat.mockImplementation(async (p: string) => {
      if (p.includes("old.mp3")) {
        return fileStat(now - maxAgeMs - 60_000); // just over 24h → stale
      }
      return fileStat(now - 60_000); // 1 min old → keep
    });

    const result = await cleanupTtsAudio(maxAgeMs);

    expect(result.deleted).toBe(1);
    expect(mockUnlink).toHaveBeenCalledOnce();
    const [deletedPath] = mockUnlink.mock.calls[0] as [string];
    expect(deletedPath).toContain("old.mp3");
    // fresh file must NOT be touched
    expect(mockUnlink).not.toHaveBeenCalledWith(
      expect.stringContaining("fresh.mp3"),
    );
  });

  it("returns { deleted: 0 } when the directory is missing", async () => {
    mockReaddir.mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    const result = await cleanupTtsAudio();

    expect(result.deleted).toBe(0);
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("skips subdirectories (non-files)", async () => {
    const now = Date.now();
    mockReaddir.mockResolvedValue(["nested"]);
    mockStat.mockResolvedValue(dirStat());

    const result = await cleanupTtsAudio(1); // cutoff essentially "now"

    // a directory older than the cutoff must still be skipped
    void now;
    expect(result.deleted).toBe(0);
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("continues past a file that fails to stat/unlink", async () => {
    const now = Date.now();
    mockReaddir.mockResolvedValue(["broken.mp3", "old.mp3"]);
    mockStat.mockImplementation(async (p: string) => {
      if (p.includes("broken.mp3")) {
        throw new Error("stat failed");
      }
      return fileStat(now - 48 * 60 * 60 * 1000); // 48h old → stale
    });

    const result = await cleanupTtsAudio(24 * 60 * 60 * 1000);

    expect(result.deleted).toBe(1);
    const [deletedPath] = mockUnlink.mock.calls[0] as [string];
    expect(deletedPath).toContain("old.mp3");
  });
});
