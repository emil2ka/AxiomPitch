export const maxPdfBytes = 30 * 1024 * 1024;
export const maxPdfPages = 60;

export class PdfRejected extends Error {}

/**
 * Checks the file itself: signature, size and a page count parsed by PDF.js.
 * Nothing the client claims about the file is trusted.
 */
export async function inspectPdf(bytes: Uint8Array) {
  if (bytes.length === 0) throw new PdfRejected("Файл пустой.");
  if (bytes.length > maxPdfBytes)
    throw new PdfRejected("PDF больше 30 МБ. Сожми файл или раздели его.");
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  if (!head.includes("%PDF-")) throw new PdfRejected("Это не PDF.");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // PDF.js detaches the buffer it parses, so it gets a copy.
  const task = getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    disableFontFace: true,
    useSystemFonts: false,
  });
  try {
    const doc = await task.promise;
    if (doc.numPages < 1) throw new PdfRejected("В PDF нет страниц.");
    if (doc.numPages > maxPdfPages)
      throw new PdfRejected(
        `В PDF ${doc.numPages} страниц, а можно не больше ${maxPdfPages}.`,
      );
    return { pageCount: doc.numPages };
  } catch (error) {
    if (error instanceof PdfRejected) throw error;
    if (error instanceof Error && error.name === "PasswordException")
      throw new PdfRejected("PDF защищён паролем. Сохрани копию без пароля.");
    throw new PdfRejected("Не удалось прочитать PDF. Файл повреждён?");
  } finally {
    await task.destroy();
  }
}
