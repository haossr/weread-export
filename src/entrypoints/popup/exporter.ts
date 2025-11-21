import { generateBookMark } from "./utils";
import { sleep } from "./batch";

export type ExportedBook = {
  bookId: string;
  title: string;
  markdown: string;
};

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
      return { bookId, title, markdown };
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

export function downloadMarkdownFile(title: string, markdown: string) {
  const fileName = `${sanitizeFileName(title)}.md`;
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

export async function copyMarkdownToClipboard(markdown: string) {
  if (!navigator.clipboard) {
    throw new Error("当前环境不支持写入剪贴板");
  }
  await navigator.clipboard.writeText(markdown);
}
