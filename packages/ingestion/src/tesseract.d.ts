declare module "tesseract.js" {
  export interface Worker {
    recognize(image: Buffer): Promise<{ data: { text: string; confidence?: number } }>;
    terminate(): Promise<void>;
  }
  export function createWorker(language?: string): Promise<Worker>;
}
