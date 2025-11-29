const { test } = require("node:test");
const assert = require("node:assert/strict");

const { batchRun, sleep } = require("../src/entrypoints/popup/batch.ts");
const {
  exportBookAsMarkdown,
  ExportRequestError,
  sanitizeFileName,
  downloadMarkdownFile,
  copyMarkdownToClipboard,
  buildCombinedExport,
  downloadCombinedExport,
  buildGoodreadsCsv,
} = require("../src/entrypoints/popup/exporter.ts");

const originalFetch = global.fetch;
const originalNavigator = global.navigator;
const originalDocument = global.document;
const originalURL = global.URL;

test("batchRun respects concurrency", async () => {
  const items = [1, 2, 3, 4, 5];
  let active = 0;
  let maxActive = 0;

  await batchRun(
    items,
    async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(5);
      active--;
    },
    { concurrency: 2, delayMs: 0 },
  );

  assert.equal(maxActive, 2);
});

test("batchRun waits between sequential runs when delay is set", async () => {
  const items = [1, 2, 3];
  const delayMs = 15;
  const startedAt = Date.now();

  await batchRun(
    items,
    async () => {},
    { concurrency: 1, delayMs },
  );

  const duration = Date.now() - startedAt;
  assert.ok(
    duration >= (items.length - 1) * delayMs,
    `duration ${duration}ms should be at least ${(items.length - 1) * delayMs}ms`,
  );
});

test("exportBookAsMarkdown returns markdown and title", async () => {
  const calls = [];
  const markData = {
    book: {
      title: "Test Book",
      author: "Author",
      cover: "https://example.com/s_cover.png",
      isbn: "ISBN-1",
      publisher: "Publisher-1",
    },
    chapters: [{ chapterUid: "1", chapterIdx: 1, title: "Ch1" }],
    updated: [
      {
        chapterUid: "1",
        type: 1,
        range: "1-2",
        abstract: "abstract",
        markText: "note content",
      },
    ],
  };
  const reviewData = { reviews: [] };
  const progressData = { book: { startReadingTime: 0, finishTime: 0, readingTime: 3600 } };
  const infoData = { publisher: "Publisher-1", isbn: "ISBN-1", rating: 95, cover: "https://example.com/info_cover.png" };

  global.fetch = async (url) => {
    calls.push(url);
    const data = [markData, reviewData, progressData, infoData][calls.length - 1];
    return {
      ok: true,
      json: async () => data,
    };
  };

  const result = await exportBookAsMarkdown("book-1", "user-vid", []);
  assert.equal(result.title, "Test Book");
  assert.ok(result.markdown.includes("Test Book"));
  assert.ok(result.markdown.startsWith("![Test Book 封面](https://example.com/t6_cover.png)"));
  assert.equal(result.coverUrl, "https://example.com/t6_cover.png");
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].chapterTitle, "Ch1");
  assert.equal(result.notes[0].markText, "note content");
  assert.equal(result.notes[0].isbn, "ISBN-1");
  assert.equal(result.notes[0].publisher, "Publisher-1");
  assert.equal(result.publisher, "Publisher-1");
  assert.equal(result.isbn, "ISBN-1");
  assert.equal(calls.length, 4);

  global.fetch = originalFetch;
});

test("exportBookAsMarkdown retries on retryable error", async () => {
  let call = 0;
  const markData = { book: { title: "Book" }, chapters: [], updated: [] };
  const reviewData = { reviews: [] };
  const progressData = { book: { startReadingTime: 0, finishTime: 0, readingTime: 0 } };
  const infoData = { publisher: "Pub", isbn: "ISBN-R" };

  global.fetch = async () => {
    const pos = call % 4;
    const attempt = Math.floor(call / 4);
    call++;
    if (attempt === 0 && pos === 0) {
      return { ok: false, status: 500 };
    }
    const payload = pos === 0 ? markData : pos === 1 ? reviewData : pos === 2 ? progressData : infoData;
    return {
      ok: true,
      json: async () => payload,
    };
  };

  const result = await exportBookAsMarkdown("book-2", "user-vid", [0]);
  assert.equal(result.bookId, "book-2");
  assert.ok(call >= 8);

  global.fetch = originalFetch;
});

test("sanitizeFileName strips illegal characters", () => {
  assert.equal(sanitizeFileName('a<>:"/\\\\|?*b'), "a_b");
  assert.equal(sanitizeFileName("   "), "导出");
});

test("buildCombinedExport outputs JSON with all books", () => {
  const items = [
    {
      bookId: "1",
      title: "A",
      markdown: "m1",
      coverUrl: "c1",
      isbn: "ISBN-A",
      publisher: "Pub-A",
      notes: [{ markText: "n1" }],
    },
    { bookId: "2", title: "B", markdown: "m2", notes: [{ markText: "n2" }] },
  ];
  const result = buildCombinedExport(items, "json");
  assert.equal(result.fileName, "weread-export.json");
  assert.equal(result.mimeType, "application/json;charset=utf-8");
  const parsed = JSON.parse(result.content);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].title, "A");
  assert.equal(parsed[1].title, "B");
  assert.equal(parsed[0].markText, "n1");
  assert.equal(parsed[0].isbn, "ISBN-A");
  assert.equal(parsed[0].publisher, "Pub-A");
});

test("buildCombinedExport outputs CSV and escapes newlines/quotes", () => {
  const items = [
    {
      bookId: "1",
      title: 'A "quote"',
      markdown: "line1\nline2",
      coverUrl: "c1",
      author: "Auth",
      rating: 5,
      isbn: "ISBN-CSV",
      publisher: "Pub-CSV",
      notes: [
        {
          chapterUid: 1,
          chapterTitle: "Ch1",
          range: "1-2",
          markText: "mk",
          reviewText: "rv",
          createdAt: 123,
          readingTime: 10,
          startTime: 1,
          finishTime: 2,
        },
      ],
    },
  ];
  const result = buildCombinedExport(items, "csv");
  assert.equal(result.fileName, "weread-export.csv");
  assert.equal(result.mimeType, "text/csv;charset=utf-8");
  assert.ok(result.content.includes('"A ""quote"""'));
  assert.ok(result.content.includes("mk"));
  assert.ok(result.content.includes("rv"));
  assert.ok(result.content.startsWith("bookId,title,author,rating,isbn,publisher,binding,publishYear,originalPublishYear,myRating,coverUrl,chapterUid"));
  assert.ok(result.content.includes("ISBN-CSV"));
  assert.ok(result.content.includes("Pub-CSV"));
});

test("buildCombinedExport outputs combined markdown with cover", () => {
  const items = [
    { bookId: "1", title: "Book1", markdown: "![Book1 封面](c1)\n\nm1", coverUrl: "c1" },
    { bookId: "2", title: "Book2", markdown: "m2" },
  ];
  const result = buildCombinedExport(items, "markdown");
  assert.equal(result.fileName, "weread-export.md");
  assert.equal(result.mimeType, "text/markdown;charset=utf-8");
  assert.ok(result.content.includes("# Book1"));
  assert.ok(result.content.includes("![Book1 封面](c1)"));
  assert.ok(result.content.includes("---"));
});

test("buildGoodreadsCsv outputs expected columns and values", () => {
  const items = [
    {
      bookId: "1",
      title: "Book1",
      author: "Author1",
      isbn: "ISBN-1",
      publisher: "Pub1",
      binding: "Paperback",
      publishYear: 2020,
      originalPublishYear: 2018,
      myRating: 5,
      rating: 4.3,
      startTime: 1609459200,
      finishTime: 1612137600,
      notes: [{ reviewText: "Nice", markText: "Good" }],
      markdown: "",
    },
  ];

  const { fileName, content, mimeType } = buildGoodreadsCsv(items);
  const lines = content.split("\n");
  assert.equal(fileName, "goodreads-export.csv");
  assert.equal(mimeType, "text/csv;charset=utf-8");
  assert.equal(lines[0].startsWith("Title,Author,ISBN,My Rating"), true);
  assert.ok(content.includes("Book1"));
  assert.ok(content.includes("Pub1"));
  assert.ok(content.includes("Paperback"));
  assert.ok(content.includes("2020"));
  assert.ok(content.includes("2018"));
  assert.ok(content.includes("read"));
  assert.ok(content.includes("Nice"));
});

test("downloadMarkdownFile uses document link and blob URLs", async () => {
  const hrefs = [];
  const downloads = [];
  const revokes = [];
  const clicks = [];

  const originalDocument = global.document;
  const originalURL = global.URL;

  global.URL = {
    createObjectURL: (blob) => {
      hrefs.push(blob);
      return "blob:mock";
    },
    revokeObjectURL: (url) => revokes.push(url),
  };

  global.document = {
    createElement: () => ({
      set href(val) {
        hrefs.push(val);
      },
      get href() {
        return hrefs[hrefs.length - 1];
      },
      set download(val) {
        downloads.push(val);
      },
      click: () => clicks.push(true),
    }),
  };

  downloadMarkdownFile("Title", "content");

  assert.equal(downloads[0], "Title.md");
  assert.ok(clicks.length === 1);
  assert.ok(revokes.includes("blob:mock"));

  global.document = originalDocument;
  global.URL = originalURL;
});

test("downloadCombinedExport triggers download for chosen format", () => {
  const hrefs = [];
  const downloads = [];
  const revokes = [];
  const clicks = [];

  global.URL = {
    createObjectURL: (blob) => {
      hrefs.push(blob);
      return "blob:combined";
    },
    revokeObjectURL: (url) => revokes.push(url),
  };

  global.document = {
    createElement: () => ({
      set href(val) {
        hrefs.push(val);
      },
      get href() {
        return hrefs[hrefs.length - 1];
      },
      set download(val) {
        downloads.push(val);
      },
      click: () => clicks.push(true),
    }),
  };

  downloadCombinedExport([{ bookId: "1", title: "T", markdown: "m" }], "json");

  assert.equal(downloads[0], "weread-export.json");
  assert.ok(clicks.length === 1);
  assert.ok(revokes.includes("blob:combined"));

  global.document = originalDocument;
  global.URL = originalURL;
});

test("copyMarkdownToClipboard writes to navigator.clipboard", async () => {
  const written = [];
  global.navigator = {
    clipboard: {
      writeText: async (text) => {
        written.push(text);
      },
    },
  };

  await copyMarkdownToClipboard("hello");
  assert.deepEqual(written, ["hello"]);

  global.navigator = originalNavigator;
});

test("exportBookAsMarkdown does not retry non-retryable status", async () => {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return { ok: false, status: 404 };
  };

  let error;
  try {
    await exportBookAsMarkdown("book-3", "user-vid", [0, 0]);
  } catch (e) {
    error = e;
  }
  assert.ok(error instanceof ExportRequestError);
  assert.equal(calls, 4); // four fetches in the first attempt (marks/reviews/progress/info)

  global.fetch = originalFetch;
});
