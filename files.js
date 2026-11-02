/* 文件解析：全部在浏览器本地完成，文件不上传
 * txt/md  → 原生读取
 * docx    → 零依赖解析（浏览器原生 DecompressionStream 解 zip）
 * pdf     → 按需加载 pdf.js（unpkg）
 * 图片     → 按需加载 tesseract.js 做本地 OCR（unpkg）
 */
(function () {
  /* jsdelivr 在国内经常连不上，全部改走 unpkg（已实测可达）
     这三个地址必须显式指定，否则 tesseract 会回落到它默认的 jsdelivr */
  const CDN = {
    pdfjs: "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js",
    pdfWorker: "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js",
    tesseract: "https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js",
    tessWorker: "https://unpkg.com/tesseract.js@5.1.1/dist/worker.min.js",
    tessCore: "https://unpkg.com/tesseract.js-core@5.1.0",
    // langPath 规则：${langPath}/${lang}.traineddata.gz，一个路径只对应一种语言
    langPath: "https://unpkg.com/@tesseract.js-data/chi_sim@1.0.0/4.0.0_best_int",
    lang: "chi_sim"
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("加载失败：" + src));
      document.head.appendChild(s);
    });
  }

  // ---------- docx：自己拆 zip，不依赖任何库 ----------
  function findEOCD(dv, len) {
    for (let i = len - 22; i >= Math.max(0, len - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  async function inflateRaw(u8) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("这个浏览器不支持原生解压，请改用 .txt 或手动复制。");
    }
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return await new Response(stream).arrayBuffer();
  }

  async function docxText(buf) {
    const dv = new DataView(buf);
    const eocd = findEOCD(dv, buf.byteLength);
    if (eocd < 0) throw new Error("这个文件不是有效的 .docx（zip 结构读不出来）。");

    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder("utf-8");
    let entry = null;

    for (let n = 0; n < count; n++) {
      if (off + 46 > buf.byteLength || dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const compSize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const cmtLen = dv.getUint16(off + 32, true);
      const localOff = dv.getUint32(off + 42, true);
      const name = dec.decode(new Uint8Array(buf, off + 46, nameLen));
      if (name === "word/document.xml") {
        entry = { method: method, compSize: compSize, localOff: localOff };
        break;
      }
      off += 46 + nameLen + extraLen + cmtLen;
    }
    if (!entry) throw new Error("没找到 word/document.xml，可能是 .doc（老格式）不是 .docx。老格式请先另存为 .docx。");

    const lOff = entry.localOff;
    if (dv.getUint32(lOff, true) !== 0x04034b50) throw new Error("docx 本地文件头损坏。");
    const lNameLen = dv.getUint16(lOff + 26, true);
    const lExtraLen = dv.getUint16(lOff + 28, true);
    const start = lOff + 30 + lNameLen + lExtraLen;

    let size = entry.compSize;
    if (!size) size = buf.byteLength - start; // 流式写入的情况，兜底
    const raw = new Uint8Array(buf, start, Math.min(size, buf.byteLength - start));

    let xml;
    if (entry.method === 0) {
      xml = dec.decode(raw);
    } else {
      xml = dec.decode(await inflateRaw(raw));
    }

    let text = xml
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<w:br[^>]*\/?>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "");
    text = text
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
    text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
    if (!text) throw new Error("docx 里没读到文字（可能是纯图片简历，请用图片上传或手动粘贴）。");
    return text;
  }

  // ---------- pdf ----------
  let pdfReady = null;
  async function pdfText(buf) {
    if (!window.pdfjsLib) {
      pdfReady = pdfReady || loadScript(CDN.pdfjs);
      await pdfReady;
      if (!window.pdfjsLib) throw new Error("pdf.js 没加载上来。");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    }
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    let out = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let lastY = null;
      tc.items.forEach(it => {
        if (lastY !== null && Math.abs(it.transform[5] - lastY) > 2) out += "\n";
        out += it.str;
        lastY = it.transform[5];
      });
      out += "\n";
    }
    doc.destroy && doc.destroy();
    out = out.trim();
    if (!out) throw new Error("这个 PDF 里没有可选中的文字（多半是扫描件或图片版）。请用「图片上传」走本地识别，或手动复制。");
    return out;
  }

  // ---------- 图片 OCR（中文，本地跑，不上传） ----------
  let tessReady = null;
  async function imageText(file, onProgress) {
    if (!window.Tesseract) {
      tessReady = tessReady || loadScript(CDN.tesseract);
      await tessReady;
      if (!window.Tesseract) throw new Error("识别库没加载上来，检查下网络。");
    }
    const worker = await window.Tesseract.createWorker(CDN.lang, 1, {
      workerPath: CDN.tessWorker,
      corePath: CDN.tessCore,
      langPath: CDN.langPath,
      gzip: true,
      logger: m => {
        if (onProgress && m.status) onProgress(m.status, m.progress || 0);
      },
      errorHandler: () => {}
    });
    try {
      const r = await worker.recognize(file);
      const t = (r && r.data && r.data.text || "").trim();
      if (!t) throw new Error("没识别出文字。图片可能太模糊，或者字太小。");
      return t;
    } finally {
      try { await worker.terminate(); } catch (e) {}
    }
  }

  // ---------- 入口 ----------
  const IMG = /^image\/(png|jpeg|jpg|webp|bmp)$/i;

  async function readAny(file, onProgress) {
    const name = (file.name || "").toLowerCase();
    const p = onProgress || function () {};

    if (/\.(txt|md|markdown|csv|json)$/.test(name) || /^text\//.test(file.type)) {
      p("读取文本", .5);
      const t = await file.text();
      if (!t.trim()) throw new Error("文件是空的。");
      return { text: t, kind: "文本" };
    }

    if (/\.docx$/.test(name)) {
      p("解析 docx", .5);
      const t = await docxText(await file.arrayBuffer());
      return { text: t, kind: "docx" };
    }

    if (/\.doc$/.test(name)) {
      throw new Error(".doc 是老格式，浏览器读不了。用 Word 另存为 .docx 再传。");
    }

    if (/\.pdf$/.test(name) || file.type === "application/pdf") {
      p("加载 PDF 解析库", .2);
      const t = await pdfText(await file.arrayBuffer());
      return { text: t, kind: "PDF" };
    }

    if (IMG.test(file.type) || /\.(png|jpe?g|webp|bmp)$/.test(name)) {
      p("下载识别引擎（约 6MB，仅首次，之后浏览器会缓存）", .03);
      const t = await imageText(file, (st, pr) => {
        const label = /recogni/i.test(st) ? "识别文字中" : "准备识别引擎";
        p(label + " " + Math.round(pr * 100) + "%", pr);
      });
      return {
        text: t,
        kind: "图片识别",
        warn: "文字来自本地识别，可能有错字。中文没问题，英文单词和数字请对照原图检查一遍——尤其是成绩、日期、公司名。"
      };
    }

    throw new Error("不支持的格式：" + (name || file.type) + "。支持 txt / md / docx / pdf / 图片。");
  }

  window.RD_FILES = { readAny: readAny, CDN: CDN };
})();
