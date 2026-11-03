import { describe, expect, it } from "vitest";
import { ATTACH_FORMATS_LINE, VIDEO_ACCEPT, VIDEO_FORMATS_LINE, videoTypeOf } from "@/lib/videoFormats";

// (Owner, Nov 3) Recordings are MP4, WebM, MOV or M4V (the formats that play in the browser), and a wrong file names every one of them.
describe("video formats", () => {
  it("goes by the file's name, keeping a known label", () => {
    expect(videoTypeOf("clip.mp4", "")).toBe("video/mp4");
    expect(videoTypeOf("clip.MOV", "video/*")).toBe("video/quicktime");
    expect(videoTypeOf("phone.m4v", "application/octet-stream")).toBe("video/x-m4v");
    expect(videoTypeOf("recording-2026-11-03.webm", "video/mp4")).toBe("video/mp4"); // Safari's recorder makes MP4 under our .webm name
    expect(videoTypeOf("clip", "video/webm")).toBe("video/webm");
  });
  it("refuses other videos and unlabelled files", () => {
    for (const [name, type] of [["clip.mkv", "video/x-matroska"], ["clip.avi", "video/x-msvideo"], ["clip.wmv", ""], ["clip.mkv", "video/mp4"], ["clip", ""], ["clip", "video/x-flv"], ["map.png", "image/png"]]) expect(videoTypeOf(name, type), name).toBeNull();
  });
  it("names every format when refusing, and the pickers offer only these", () => {
    expect(VIDEO_FORMATS_LINE).toBe("Choose a video in MP4, WebM, MOV or M4V format (.mp4, .webm, .mov or .m4v).");
    expect(ATTACH_FORMATS_LINE).toContain("MP4, WebM, MOV or M4V");
    expect(VIDEO_ACCEPT).toBe(".mp4,video/mp4,.webm,video/webm,.mov,video/quicktime,.m4v,video/x-m4v");
  });
});
