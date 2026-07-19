import { afterEach, describe, expect, it } from "vitest";
import { processWithGrobid } from "./parsers/grobid";
import { validateUploadContent } from "./validation";

describe("Phase 8 upload validation", () => {
  afterEach(() => { delete process.env.GROBID_URL; });

  it("accepts a real PDF signature and rejects a claimed PDF without one", () => {
    expect(validateUploadContent(Buffer.from("%PDF-1.7"), "application/pdf").valid).toBe(true);
    expect(validateUploadContent(Buffer.from("not a PDF"), "application/pdf").valid).toBe(false);
  });

  it("requires EPUB magic plus its required manifest markers", () => {
    const epub = Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.from("mimetypeapplication/epub+zip"), Buffer.from("META-INF/container.xml")]);
    expect(validateUploadContent(epub, "application/epub+zip").valid).toBe(true);
    expect(validateUploadContent(Buffer.from("PK\x03\x04"), "application/epub+zip").valid).toBe(false);
  });

  it("treats an unset GROBID URL as disabled rather than a processing error", async () => {
    await expect(processWithGrobid(Buffer.from("private PDF bytes"))).resolves.toBeNull();
  });
});
