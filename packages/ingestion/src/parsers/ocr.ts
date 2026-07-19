
export interface OcrPageResult { pageIndex: number; text: string; confidence: number | null; }

type OcrWorker = {
  recognize(image: Buffer): Promise<{ data: { text: string; confidence?: number } }>;
  terminate(): Promise<void>;
};
type OcrModule = { createWorker(language?: string): Promise<OcrWorker> };
type CanvasModule = { createCanvas(width: number, height: number): { getContext(kind: "2d"): unknown; toBuffer(type: "image/png"): Buffer } };

type PdfLike = { getPage(index: number): Promise<unknown> };
type PageLike = {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: unknown): { promise: Promise<void> };
};

/** OCR only pages whose PDF text layer is genuinely sparse. Pages are rendered
 * and recognized one-at-a-time to cap memory; an unavailable worker resolves
 * to no OCR results so the caller records the normal structure-limited state. */
export async function ocrLowTextPages(pdf: PdfLike, pageTexts: string[]): Promise<OcrPageResult[]> {
  const maxPages = Math.max(0, Number(process.env.OCR_MAX_PAGES ?? 12));
  const language = process.env.OCR_LANGUAGE ?? "eng";
  const sparse = pageTexts.map((text, pageIndex) => ({ text, pageIndex })).filter(({ text }) => text.trim().length < 40).slice(0, maxPages);
  if (!sparse.length) return [];
  const results: OcrPageResult[] = [];
  let worker: OcrWorker | null = null;
  try {
    // Kept dynamic because tesseract.js ships without a reliable declaration
    // in every supported distribution; the installed dependency is still used
    // at runtime and unavailable OCR remains a safe degradation.
    const module = await (Function("return import('tesseract.js')")() as Promise<OcrModule>);
    const canvasModule = await (Function("return import('@napi-rs/canvas')")() as Promise<CanvasModule>);
    worker = await module.createWorker(language);
    for (const candidate of sparse) {
      const page = await pdf.getPage(candidate.pageIndex + 1) as PageLike;
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const recognized = await worker.recognize(canvas.toBuffer("image/png"));
      const text = recognized.data.text.trim();
      if (text) results.push({ pageIndex: candidate.pageIndex, text, confidence: recognized.data.confidence ?? null });
    }
  } catch {
    // OCR is an enhancement. A missing language model/native renderer must
    // not discard the page boundaries or turn an otherwise readable PDF bad.
    return results;
  } finally {
    await worker?.terminate().catch(() => undefined);
  }
  return results;
}
