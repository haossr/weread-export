import { generateBookMark } from "./utils";
import { sleep } from "./batch";

export type NoteRecord = {
  bookId: string;
  title: string;
  author?: string;
  coverUrl?: string;
  rating?: string | number;
  chapterUid?: number;
  chapterTitle?: string;
  range?: string;
  markText?: string;
  reviewText?: string;
  createdAt?: number | string;
  style?: number;
  readingTime?: number;
  startTime?: number;
  finishTime?: number;
};

export type ExportedBook = {
  bookId: string;
  title: string;
  markdown: string;
  coverUrl?: string;
  author?: string;
  rating?: string | number;
  notes: NoteRecord[];
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

function findChapterTitle(chapters: any[] | undefined, chapterUid: number | undefined) {
  if (!chapters || typeof chapterUid === "undefined") return "";
  const target = chapters.find((c) => c.chapterUid === chapterUid);
  return target?.title || "";
}

function buildNoteRecords(markData: any, reviewData: any, progressData: any): NoteRecord[] {
  const book = markData?.book || {};
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
        bookId: mark.bookId || book.bookId,
        title: book.title,
        author: book.author,
        coverUrl: normalizeCoverUrl(book.cover),
        rating: book.rating ?? book.score ?? "",
        chapterUid: mark.chapterUid,
        chapterTitle: findChapterTitle(chapters, mark.chapterUid),
        range: mark.range,
        markText: mark.markText || mark.abstract || "",
        reviewText: reviewMap.get(key) || "",
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
  ];

  let attempt = 0;
  while (true) {
    try {
      const [markData, reviewData, progressData] = await Promise.all(urls.map(fetchJson));
      const markdown = generateBookMark(markData, reviewData, progressData);
      const title = markData?.book?.title || bookId;
      const coverUrl = normalizeCoverUrl(markData?.book?.cover);
      const markdownWithCover = coverUrl
        ? `![${title} 封面](${coverUrl})\n\n${markdown}`
        : markdown;
      const notes = buildNoteRecords(markData, reviewData, progressData);
      return {
        bookId,
        title,
        markdown: markdownWithCover,
        coverUrl,
        author: markData?.book?.author,
        rating: markData?.book?.rating ?? markData?.book?.score ?? "",
        notes,
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
    notes: item.notes || [],
  }));

  if (format === "json") {
    const content = JSON.stringify(safeItems, null, 2);
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
    safeItems.forEach((item) => {
      const notes = item.notes && item.notes.length ? item.notes : [{ markdown: item.markdown }];
      notes.forEach((note: NoteRecord | any) => {
        rows.push(
          [
            note.bookId || item.bookId,
            item.title,
            item.author || "",
            item.rating || "",
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
    const sections = safeItems.map((item) => {
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
