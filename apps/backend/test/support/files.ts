import JSZip from "jszip";

// Small, valid DOCX / PPTX / ZIP files built in code, so tests don't need binary fixtures.

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function makeZip(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

type DocxBlock = string | { heading: string } | { image: true } | { link: string; text: string };

/** A Word file. Strings are paragraphs; {heading} is a Heading 1; {image} embeds a PNG; {link} is a hyperlink. */
export function makeDocx(blocks: DocxBlock[]): Promise<Buffer> {
  const rels: string[] = [];
  const body = blocks
    .map((block, i) => {
      if (typeof block === "string") return `<w:p><w:r><w:t xml:space="preserve">${escape(block)}</w:t></w:r></w:p>`;
      if ("heading" in block) {
        return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escape(block.heading)}</w:t></w:r></w:p>`;
      }
      if ("link" in block) {
        rels.push(
          `<Relationship Id="rLink${i}" Type="${R}/hyperlink" Target="${escape(block.link)}" TargetMode="External"/>`,
        );
        return `<w:p><w:hyperlink r:id="rLink${i}"><w:r><w:t>${escape(block.text)}</w:t></w:r></w:hyperlink></w:p>`;
      }
      rels.push(`<Relationship Id="rImg${i}" Type="${R}/image" Target="media/image${i}.png"/>`);
      return (
        `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><wp:docPr id="${i + 1}" name="Picture" descr="A picture"/>` +
        `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
        `<pic:blipFill><a:blip r:embed="rImg${i}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>` +
        `</wp:inline></w:drawing></w:r></w:p>`
      );
    })
    .join("");

  const files: Record<string, string | Buffer> = {
    "[Content_Types].xml":
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels":
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml":
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="${R}" ` +
      `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
      `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}</w:body></w:document>`,
    "word/_rels/document.xml.rels":
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `${rels.join("")}</Relationships>`,
  };
  blocks.forEach((block, i) => {
    if (typeof block === "object" && "image" in block) files[`word/media/image${i}.png`] = PNG;
  });
  return makeZip(files);
}

/**
 * A PowerPoint file. Each slide is a list of paragraphs; a paragraph is a string, or a list of runs
 * joined by line breaks. `numbers` names the slide files (slide{n}.xml), to test their ordering.
 */
export function makePptx(slides: (string | string[])[][], numbers = slides.map((_, i) => i + 1)): Promise<Buffer> {
  const files: Record<string, string> = {
    "[Content_Types].xml":
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="xml" ContentType="application/xml"/></Types>`,
    "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
  };
  slides.forEach((paragraphs, i) => {
    const body = paragraphs
      .map((para) => {
        const runs = (Array.isArray(para) ? para : [para]).map((run) => `<a:r><a:rPr lang="en-US"/><a:t>${escape(run)}</a:t></a:r>`);
        return `<a:p><a:pPr algn="l"/>${runs.join("<a:br/>")}</a:p>`;
      })
      .join("");
    files[`ppt/slides/slide${numbers[i]}.xml`] =
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
      `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>` +
      `<a:bodyPr/>${body}<a:p/></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  });
  return makeZip(files);
}

/**
 * A ZIP whose central directory claims every entry unpacks to `claimedBytes`, without the data:
 * enough for a zip bomb check that reads only the directory.
 */
export async function makeClaimedSizeZip(files: Record<string, string>, claimedBytes: number) {
  const buf = await makeZip(files);
  // Central directory headers start with PK\x01\x02: the compression method is 10 bytes in and the
  // uncompressed size 24. Only deflated entries are changed; a stored one (a folder) must keep its size.
  for (let i = buf.indexOf("PK\x01\x02", 0, "latin1"); i !== -1; i = buf.indexOf("PK\x01\x02", i + 4, "latin1")) {
    if (buf.readUInt16LE(i + 10) === 8) buf.writeUInt32LE(claimedBytes, i + 24);
  }
  return buf;
}
