import { generateBookMark } from "./utils";
import { sleep } from "./batch";

export type NoteRecord = {
  bookId: string;
  title: string;
  author?: string;
  coverUrl?: string;
  rating?: string | number;
  publisher?: string;
  isbn?: string;
  binding?: string;
  publishYear?: number;
  originalPublishYear?: number;
  myRating?: string | number;
  finishTime?: number;
  startTime?: number;
  readingTime?: number;
  chapterUid?: number;
  chapterTitle?: string;
  range?: string;
  markText?: string;
  reviewText?: string;
  createdAt?: number | string;
  style?: number;
};

export type ExportedBook = {
  bookId: string;
  title: string;
  markdown: string;
  coverUrl?: string;
  author?: string;
  rating?: string | number;
  publisher?: string;
  binding?: string;
  publishYear?: number;
  originalPublishYear?: number;
  myRating?: string | number;
  notes: NoteRecord[];
  finishTime?: number;
  startTime?: number;
  readingTime?: number;
  isbn?: string;
};

export type ExportFormat = "markdown" | "json" | "csv";

export class ExportRequestError extends Error {
  status?: number;
  shouldRetry: boolean;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
    this.shouldRetry = status === 429 || (typeof status === "number" && status >= 500);
  }
}

async function fetchJson(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new ExportRequestError(`Request failed with status ${response.status}`, response.status);
  }
  return response.json();
}

function isRetryableError(error: unknown) {
  if (error instanceof ExportRequestError) return error.shouldRetry;
  return true;
}

function normalizeCoverUrl(raw?: string) {
  if (!raw) return undefined;
  return raw.replace("s_", "t6_");
}

function normalizeText(value: any) {
  if (typeof value !== "string") return value;
  return value.replace(/[\u2028\u2029]/g, "\n");
}

function toYear(value: any) {
  if (!value) return undefined;
  const date = new Date(typeof value === "string" ? value.replace(" ", "T") : value * 1000);
  const year = date.getFullYear();
  return Number.isFinite(year) ? year : undefined;
}

function buildBookMeta(bookId: string, markBook: any, infoBook: any) {
  const combined = { ...(infoBook || {}), ...(markBook || {}) };
  return {
    bookId,
    title: normalizeText(markBook?.title || infoBook?.title || bookId),
    author: normalizeText(combined.author),
    cover: combined.cover,
    rating:
      combined.rating ??
      combined.score ??
      combined.newRating ??
      combined.star ??
      (typeof combined.ratingDetail?.recent !== "undefined" ? combined.ratingDetail.recent : ""),
    myRating:
      combined.myRating ??
      combined.newRatingDetail?.myRating ??
      combined.ratingDetail?.myRating ??
      "",
    isbn: combined.isbn || combined.isbn13 || "",
    publisher: normalizeText(combined.publisher || combined.publish || ""),
    binding: normalizeText(combined.format || ""),
    publishYear: toYear(combined.publishTime),
    originalPublishYear: toYear(combined.originalPublishTime) || toYear(combined.publishTime),
  };
}

function findChapterTitle(chapters: any[] | undefined, chapterUid: number | undefined) {
  if (!chapters || typeof chapterUid === "undefined") return "";
  const target = chapters.find((c) => c.chapterUid === chapterUid);
  return target?.title || "";
}

function buildNoteRecords(
  markData: any,
  reviewData: any,
  progressData: any,
  meta: ReturnType<typeof buildBookMeta>,
): NoteRecord[] {
  const chapters = Array.isArray(markData?.chapters) ? markData.chapters : [];
  const progress = progressData?.book || {};

  const reviewMap = new Map<string, string>();
  (reviewData?.reviews || []).forEach((item: any) => {
    const review = item?.review || item;
    if (!review || review.type !== 1 || !review.range) return;
    const key = `${review.chapterUid}-${review.range}`;
    reviewMap.set(key, review.content || review.abstract || "");
  });

  const updated = Array.isArray(markData?.updated) ? markData.updated : [];
  return updated
    .filter((mark: any) => mark?.type === 1)
    .map((mark: any) => {
      const key = `${mark.chapterUid}-${mark.range}`;
      return {
        bookId: mark.bookId || meta.bookId,
        title: meta.title,
        author: normalizeText(meta.author),
        coverUrl: normalizeCoverUrl(meta.cover),
        rating: meta.rating,
        publisher: meta.publisher,
        isbn: meta.isbn,
        chapterUid: mark.chapterUid,
        chapterTitle: findChapterTitle(chapters, mark.chapterUid),
        range: mark.range,
        markText: normalizeText(mark.markText || mark.abstract || ""),
        reviewText: normalizeText(reviewMap.get(key) || ""),
        createdAt: mark.createTime || "",
        style: mark.style,
        readingTime: progress.readingTime,
        startTime: progress.startReadingTime,
        finishTime: progress.finishTime,
      };
    });
}

export async function exportBookAsMarkdown(
  bookId: string,
  userVid: string,
  retryDelays: number[] = [],
): Promise<ExportedBook> {
  const urls = [
    `https://weread.qq.com/web/book/bookmarklist?bookId=${bookId}`,
    `https://weread.qq.com/web/review/list?bookId=${bookId}&mine=1&listType=11&maxIdx=0&count=0&listMode=2&synckey=0&userVid=${userVid}`,
    `https://weread.qq.com/web/book/getProgress?bookId=${bookId}`,
    `https://weread.qq.com/web/book/info?bookId=${bookId}`,
  ];

  let attempt = 0;
  while (true) {
    try {
      const [markData, reviewData, progressData, infoData] = await Promise.all(
        urls.map(fetchJson),
      );
      const meta = buildBookMeta(bookId, markData?.book, infoData);
      const markdown = normalizeText(generateBookMark(markData, reviewData, progressData));
      const title = meta.title;
      const coverUrl = normalizeCoverUrl(meta.cover);
      const markdownWithCover = coverUrl
        ? `![${title} 封面](${coverUrl})\n\n${markdown}`
        : markdown;
      const notes = buildNoteRecords(markData, reviewData, progressData, meta);
      return {
        bookId,
        title,
        markdown: markdownWithCover,
        coverUrl,
        author: meta.author,
        rating: meta.rating,
        publisher: meta.publisher,
        isbn: meta.isbn,
        binding: meta.binding,
        publishYear: meta.publishYear,
        originalPublishYear: meta.originalPublishYear,
        myRating: meta.myRating,
        notes,
        finishTime: progressData?.book?.finishTime,
        startTime: progressData?.book?.startReadingTime,
        readingTime: progressData?.book?.readingTime,
      };
    } catch (error) {
      const shouldRetry = attempt < retryDelays.length && isRetryableError(error);
      if (!shouldRetry) throw error;
      const waitMs = retryDelays[Math.min(attempt, retryDelays.length - 1)] || 0;
      if (waitMs) {
        await sleep(waitMs);
      }
      attempt++;
    }
  }
}

export function sanitizeFileName(name: string) {
  const safe = name.replace(/[\\/:*?"<>|]+/g, "_").trim();
  return safe || "导出";
}

function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function downloadMarkdownFile(title: string, markdown: string) {
  const fileName = `${sanitizeFileName(title)}.md`;
  downloadTextFile(fileName, markdown, "text/markdown;charset=utf-8");
}

export async function copyMarkdownToClipboard(markdown: string) {
  if (!navigator.clipboard) {
    throw new Error("当前环境不支持写入剪贴板");
  }
  await navigator.clipboard.writeText(markdown);
}

function escapeCsv(value: string) {
  const normalized = value.replace(/\r?\n/g, "\\n");
  const escaped = normalized.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function buildCombinedExport(items: ExportedBook[], format: ExportFormat) {
  const safeItems = items.map((item) => ({
    bookId: item.bookId,
    title: item.title,
    markdown: item.markdown,
    coverUrl: item.coverUrl,
    author: item.author,
    rating: item.rating,
    publisher: item.publisher,
    binding: item.binding,
    publishYear: item.publishYear,
    originalPublishYear: item.originalPublishYear,
    myRating: item.myRating,
    notes: item.notes || [],
    finishTime: item.finishTime ?? item.notes?.[0]?.finishTime ?? 0,
    startTime: item.startTime ?? item.notes?.[0]?.startTime ?? 0,
    readingTime: item.readingTime ?? item.notes?.[0]?.readingTime ?? 0,
    isbn: item.isbn,
  }));

  const sorted = [...safeItems].sort(
    (a, b) => (b.finishTime ?? 0) - (a.finishTime ?? 0),
  );

  if (format === "json") {
    const rows: any[] = [];
    sorted.forEach((item) => {
      const notes = item.notes && item.notes.length ? item.notes : [{ markdown: item.markdown }];
      notes.forEach((note: NoteRecord | any) => {
        rows.push({
          bookId: note.bookId || item.bookId,
          title: item.title,
          author: item.author || "",
          rating: item.rating || "",
          publisher: note.publisher || item.publisher || "",
          coverUrl: note.coverUrl || item.coverUrl || "",
          isbn: note.isbn || item.isbn || "",
          binding: item.binding || "",
          publishYear: item.publishYear || "",
          originalPublishYear: item.originalPublishYear || "",
          myRating: item.myRating || "",
          chapterUid: note.chapterUid ?? "",
          chapterTitle: note.chapterTitle || "",
          range: note.range || "",
          markText: note.markText || note.markdown || "",
          reviewText: note.reviewText || "",
          createdAt: note.createdAt || "",
          readingTime: note.readingTime || item.readingTime || "",
          startTime: note.startTime || item.startTime || "",
          finishTime: note.finishTime || item.finishTime || "",
        });
      });
    });
    const content = JSON.stringify(rows, null, 2);
    return {
      fileName: "weread-export.json",
      content,
      mimeType: "application/json;charset=utf-8",
    };
  }

  if (format === "csv") {
    const header = [
      "bookId",
      "title",
      "author",
      "rating",
      "isbn",
      "publisher",
      "binding",
      "publishYear",
      "originalPublishYear",
      "myRating",
      "coverUrl",
      "chapterUid",
      "chapterTitle",
      "range",
      "markText",
      "reviewText",
      "createdAt",
      "readingTime",
      "startTime",
      "finishTime",
    ];
    const rows: string[] = [];
    sorted.forEach((item) => {
      const notes = item.notes && item.notes.length ? item.notes : [{ markdown: item.markdown }];
      notes.forEach((note: NoteRecord | any) => {
        rows.push(
          [
            note.bookId || item.bookId,
            item.title,
            item.author || "",
            item.rating || "",
            note.isbn || item.isbn || "",
            note.publisher || item.publisher || "",
            item.binding || "",
            item.publishYear || "",
            item.originalPublishYear || "",
            item.myRating || "",
            note.coverUrl || item.coverUrl || "",
            note.chapterUid ?? "",
            note.chapterTitle || "",
            note.range || "",
            note.markText || note.markdown || "",
            note.reviewText || "",
            note.createdAt || "",
            note.readingTime || "",
            note.startTime || "",
            note.finishTime || "",
          ]
            .map((v) => escapeCsv(String(v ?? "")))
            .join(","),
        );
      });
    });
    const content = [header.join(","), ...rows].join("\n");
    return {
      fileName: "weread-export.csv",
      content,
      mimeType: "text/csv;charset=utf-8",
    };
  }

  if (format === "markdown") {
    const sections = sorted.map((item) => {
      return `# ${item.title}\n\n${item.markdown}`;
    });
    const content = sections.join("\n\n---\n\n");
    return {
      fileName: "weread-export.md",
      content,
      mimeType: "text/markdown;charset=utf-8",
    };
  }

  throw new Error("Unsupported format");
}

export function downloadCombinedExport(items: ExportedBook[], format: ExportFormat) {
  const { fileName, content, mimeType } = buildCombinedExport(items, format);
  downloadTextFile(fileName, content, mimeType);
}

function formatDate(ts?: number | string) {
  if (!ts) return "";
  const num = typeof ts === "string" ? Number(ts) : ts;
  const ms = Number.isFinite(num) ? Number(num) * 1000 : undefined;
  const date = ms ? new Date(ms) : new Date(ts as any);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function buildGoodreadsCsv(items: ExportedBook[]) {
  const header = [
    "Title",
    "Author",
    "ISBN",
    "My Rating",
    "Average Rating",
    "Publisher",
    "Binding",
    "Year Published",
    "Original Publication Year",
    "Date Read",
    "Date Added",
    "Shelves",
    "Bookshelves",
    "My Review",
  ];

  const rows = items.map((item) => {
    const review =
      item.notes?.map((n) => n.reviewText).filter(Boolean).join("；") ||
      item.notes?.map((n) => n.markText).filter(Boolean).join("；") ||
      "";
    const dateRead = formatDate(item.finishTime);
    const dateAdded = formatDate(item.startTime);
    const shelves = dateRead ? "read" : "";
    const bookshelves = shelves;
    return [
      item.title || "",
      item.author || "",
      item.isbn || "",
      item.myRating || "",
      item.rating || "",
      item.publisher || "",
      item.binding || "",
      item.publishYear || "",
      item.originalPublishYear || item.publishYear || "",
      dateRead,
      dateAdded,
      shelves,
      bookshelves,
      review,
    ]
      .map((v) => escapeCsv(String(v ?? "")))
      .join(",");
  });

  return {
    fileName: "goodreads-export.csv",
    content: [header.join(","), ...rows].join("\n"),
    mimeType: "text/csv;charset=utf-8",
  };
}

export function downloadGoodreadsCsv(items: ExportedBook[]) {
  const { fileName, content, mimeType } = buildGoodreadsCsv(items);
  downloadTextFile(fileName, content, mimeType);
}
