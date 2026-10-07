import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function createTestPdf() {
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const green = rgb(0.03, 0.42, 0.3);
  const titles = [
    "Classroom Notes",
    "A little space to think",
    "Make it your own",
  ];
  titles.forEach((title, i) => {
    const page = pdf.addPage([595, 842]);
    page.drawRectangle({ x: 0, y: 818, width: 595, height: 24, color: green });
    page.drawText("TEACHER PDF / WORKBOOK", {
      x: 55,
      y: 754,
      size: 11,
      font: regular,
      color: green,
    });
    page.drawText(title, {
      x: 55,
      y: 632,
      size: i ? 30 : 42,
      font: bold,
      color: green,
    });
    page.drawText("A simple toolkit for your next great lesson.", {
      x: 55,
      y: 590,
      size: 15,
      font: regular,
    });
    const lines =
      i === 0
        ? [
            "Read. Write. Share.",
            "Your documents, all in one place.",
            "Rotate pages, add a signature, and save your work.",
          ]
        : i === 1
          ? [
              "01   What did we learn today?",
              "02   Which idea would you like to explore?",
              "03   Write a question for the next class.",
            ]
          : [
              "Try a pen or highlighter in presentation mode.",
              "Add a text note anywhere on the page.",
              "Private information? Cover it before sharing.",
            ];
    lines.forEach((line, n) =>
      page.drawText(line, { x: 55, y: 476 - n * 70, size: 14, font: regular }),
    );
    page.drawText(
      `SAMPLE DOCUMENT                                      ${i + 1} / 3`,
      { x: 55, y: 55, size: 10, font: regular, color: green },
    );
  });
  return pdf.save();
}
