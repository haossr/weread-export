<script>
  import { onDestroy } from "svelte";
  import { batchRun, sleep } from "./batch";
  import {
    downloadCombinedExport,
    downloadGoodreadsCsv,
    exportBookAsMarkdown,
  } from "./exporter";

  export let userVid;

  const BATCH_OPTIONS = { concurrency: 2, delayMs: 1500 };
  const RETRY_SCHEDULE = [1000, 3000, 7000];
  const BULK_RETRIES = 2;
  const REQUEST_RETRY_DELAYS = RETRY_SCHEDULE.slice(0, 2);
  const EXPORT_FORMATS = [
    { value: "markdown", label: "Markdown (.md)" },
    { value: "json", label: "JSON (.json)" },
    { value: "csv", label: "CSV (.csv)" },
  ];

  let books = [];
  let selectedBookIds = [];
  let bulkWorking = false;
  let progress = { done: 0, total: 0, failed: [] };
  let retryCount = 0;
  let failedListUrl = "";
  let selectAllCheckbox;
  let exportFormat = "markdown";
  let exportReadingWorking = false;

  $: totalBooks = books.length;
  $: hasSelection = selectedBookIds.length > 0;
  $: allSelected = totalBooks > 0 && selectedBookIds.length === totalBooks;
  $: selectionIndeterminate = hasSelection && !allSelected;
  $: if (selectAllCheckbox) {
    selectAllCheckbox.indeterminate = selectionIndeterminate;
  }

  function getNoteBooks() {
    fetch("https://weread.qq.com/api/user/notebook")
      .then((response) => response.json())
      .then((data) => {
        const list = Array.isArray(data?.books) ? data.books.map((val) => val.book) : [];
        books = list;
        selectedBookIds = [];
      })
      .catch((error) => console.error("获取书单失败", error));
  }
  getNoteBooks();
  $: progressPercent =
    progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  function toggleSelectAll(event) {
    if (!books.length || bulkWorking) return;
    const checked = event.target.checked;
    selectedBookIds = checked ? books.map((book) => book.bookId) : [];
  }

  function toggleSelectBook(bookId) {
    if (bulkWorking) return;
    if (selectedBookIds.includes(bookId)) {
      selectedBookIds = selectedBookIds.filter((id) => id !== bookId);
    } else {
      selectedBookIds = [...selectedBookIds, bookId];
    }
  }

  function resetFailedList() {
    if (failedListUrl) {
      URL.revokeObjectURL(failedListUrl);
      failedListUrl = "";
    }
  }

  function createFailedList(ids) {
    resetFailedList();
    if (!ids.length) return;
    const content = ids.map((id) => `${getTitleById(id)} (${id})`).join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    failedListUrl = URL.createObjectURL(blob);
  }

  function getTitleById(bookId) {
    const target = books.find((book) => book.bookId === bookId);
    return target?.title || bookId;
  }

  async function handleBulkExport() {
    if (!hasSelection || bulkWorking) return;

    bulkWorking = true;
    retryCount = 0;
    resetFailedList();
    progress = { done: 0, total: selectedBookIds.length, failed: [] };

    let pending = [...selectedBookIds];
    let finalFailed = [];
    let combinedSuccess = [];

    try {
      for (let attempt = 0; attempt <= BULK_RETRIES && pending.length; attempt++) {
        const failedThisRound = [];
        await batchRun(
          pending,
          async (bookId) => {
            try {
              const exported = await exportBookAsMarkdown(
                bookId,
                userVid,
                REQUEST_RETRY_DELAYS,
              );
              combinedSuccess = [...combinedSuccess, exported];
              progress = { ...progress, done: progress.done + 1 };
            } catch (error) {
              console.error("导出失败", bookId, error);
              failedThisRound.push(bookId);
            }
          },
          { concurrency: BATCH_OPTIONS.concurrency, delayMs: BATCH_OPTIONS.delayMs },
        );

        if (!failedThisRound.length) {
          finalFailed = [];
          break;
        }

        if (attempt >= BULK_RETRIES) {
          finalFailed = failedThisRound;
          break;
        }

        pending = failedThisRound;
        retryCount = attempt + 1;
        progress = { ...progress, failed: pending };
        const waitMs = RETRY_SCHEDULE[Math.min(attempt, RETRY_SCHEDULE.length - 1)] || 0;
        if (waitMs) {
          await sleep(waitMs);
        }
      }

      if (finalFailed.length) {
        progress = { ...progress, failed: finalFailed };
        createFailedList(finalFailed);
      } else {
        progress = { ...progress, failed: [] };
        if (combinedSuccess.length) {
          downloadCombinedExport(combinedSuccess, exportFormat);
        }
      }
    } finally {
      bulkWorking = false;
    }
  }

  onDestroy(resetFailedList);

  async function handleExportReadingRecords() {
    if (bulkWorking || exportReadingWorking) return;
    const targetIds = books.map((b) => b.bookId).filter(Boolean);
    if (!targetIds.length) return;

    exportReadingWorking = true;
    retryCount = 0;
    resetFailedList();
    progress = { done: 0, total: targetIds.length, failed: [] };

    let pending = [...targetIds];
    let finalFailed = [];
    let combinedSuccess = [];

    try {
      for (let attempt = 0; attempt <= BULK_RETRIES && pending.length; attempt++) {
        const failedThisRound = [];
        await batchRun(
          pending,
          async (bookId) => {
            try {
              const exported = await exportBookAsMarkdown(
                bookId,
                userVid,
                REQUEST_RETRY_DELAYS,
              );
              combinedSuccess = [...combinedSuccess, exported];
              progress = { ...progress, done: progress.done + 1 };
            } catch (error) {
              console.error("导出失败", bookId, error);
              failedThisRound.push(bookId);
            }
          },
          { concurrency: BATCH_OPTIONS.concurrency, delayMs: BATCH_OPTIONS.delayMs },
        );

        if (!failedThisRound.length) {
          finalFailed = [];
          break;
        }

        if (attempt >= BULK_RETRIES) {
          finalFailed = failedThisRound;
          break;
        }

        pending = failedThisRound;
        retryCount = attempt + 1;
        progress = { ...progress, failed: pending };
        const waitMs = RETRY_SCHEDULE[Math.min(attempt, RETRY_SCHEDULE.length - 1)] || 0;
        if (waitMs) {
          await sleep(waitMs);
        }
      }

      if (finalFailed.length) {
        progress = { ...progress, failed: finalFailed };
        createFailedList(finalFailed);
      } else {
        progress = { ...progress, failed: [] };
        if (combinedSuccess.length) {
          downloadGoodreadsCsv(combinedSuccess);
        }
      }
    } finally {
      bulkWorking = false;
      exportReadingWorking = false;
    }
  }
</script>

<div class="mdui-toolbar mdui-appbar mdui-appbar-fixed mdui-color-theme">
  <span class="mdui-typo-title">导出笔记</span>
  <div class="mdui-toolbar-spacer" />
  <div class="toolbar-actions">
    <label class="format-select">
      <span>格式</span>
      <select
        class="mdui-select"
        bind:value={exportFormat}
        disabled={bulkWorking || exportReadingWorking}
      >
        {#each EXPORT_FORMATS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>
    <label class="mdui-checkbox select-all">
      <input
        type="checkbox"
        bind:this={selectAllCheckbox}
        checked={allSelected}
        disabled={!books.length || bulkWorking || exportReadingWorking}
        on:change={toggleSelectAll}
      />
      <i class="mdui-checkbox-icon" />
      <span>全选</span>
    </label>
    <button class="mdui-btn" on:click={handleExportReadingRecords} disabled={!books.length || bulkWorking || exportReadingWorking}>
      {exportReadingWorking ? "导出中..." : "导出阅读记录"}
    </button>
    <button class="mdui-btn mdui-color-theme" on:click={handleBulkExport} disabled={!hasSelection || bulkWorking || exportReadingWorking}>
      {bulkWorking ? "导出中..." : "导出笔记"}
    </button>
  </div>
</div>

<div class="page-content">
  {#if progress.total}
    <div class="progress-card">
      <div class="progress-header">
        <div class="progress-title">进度 {progress.done} / {progress.total}</div>
        <div class="progress-meta">重试 {retryCount} · 并发 {BATCH_OPTIONS.concurrency} · 间隔 {BATCH_OPTIONS.delayMs}ms</div>
      </div>
      <div class="progress-bar">
        <div class="progress-bar__fill" style={`width: ${progressPercent}%`}>
          <span class="progress-bar__text">{progressPercent}%</span>
        </div>
      </div>
      {#if progress.failed.length}
        <div class="progress-line warning">
          失败 {progress.failed.length} 本
          {#if failedListUrl}
            <a class="failed-link" href={failedListUrl} download="failed_list.txt">下载失败列表</a>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <div class="mdui-container book-list-wrap">
    {#each books as book (book.bookId)}
      <div
        class={`mdui-card mdui-col book-card ${selectedBookIds.includes(book.bookId) ? "selected" : ""}`}
        on:click={() => toggleSelectBook(book.bookId)}
      >
        <div class="mdui-card-media">
          <img src={book.cover.replace("s_", "t6_")} alt="cover" />
          <div class="mdui-card-media-covered card-checkbox">
            <label class="mdui-checkbox" on:click|stopPropagation={() => toggleSelectBook(book.bookId)}>
              <input
                type="checkbox"
                checked={selectedBookIds.includes(book.bookId)}
                disabled={bulkWorking}
              />
              <i class="mdui-checkbox-icon" />
            </label>
          </div>
        </div>
        <div class="mdui-card-actions">
          <div class="mdui-typo-body-2 text-omit">{book.title}</div>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .mdui-toolbar {
    flex-wrap: wrap;
    row-gap: 8px;
  }

  .mdui-toolbar .mdui-toolbar-spacer {
    flex: 1 1 auto;
  }

  .toolbar-actions .mdui-btn {
    min-width: 112px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 6px;
  }

  .page-content {
    padding-top: 76px;
  }

  .format-select {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #fff;
    font-size: 13px;
    font-weight: 500;
  }

  .format-select select {
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.5);
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
    font-weight: 500;
    font-size: 13px;
    letter-spacing: 0.1px;
    backdrop-filter: blur(6px);
    box-shadow: 0 6px 16px rgba(36, 160, 237, 0.28);
  }

  .format-select select:focus {
    outline: 2px solid #fff;
    outline-offset: 1px;
  }

  .select-all {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #fff;
    font-size: 13px;
    font-weight: 500;
  }

  .text-omit {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  .progress-card {
    padding: 12px 20px 10px;
    color: #2a2f37;
    background: #f7fbff;
    border: 1px solid #e2effa;
    border-radius: 10px;
    box-shadow: 0 4px 12px rgba(36, 160, 237, 0.08);
    margin: 8px 16px;
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
    margin-bottom: 6px;
  }

  .progress-title {
    font-weight: 600;
  }

  .progress-meta {
    font-size: 12px;
    color: #5a6672;
  }

  .progress-line {
    margin-top: 6px;
    font-size: 13px;
  }

  .progress-bar {
    width: 100%;
    height: 12px;
    background: #d9ebf9;
    border-radius: 999px;
    overflow: hidden;
    margin-top: 4px;
    position: relative;
  }

  .progress-bar__fill {
    height: 100%;
    background: linear-gradient(90deg, #24a0ed, #5cc4ff);
    transition: width 0.25s ease;
    display: flex;
    align-items: center;
    padding-left: 8px;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.06);
  }

  .warning {
    color: #b00020;
  }

  .failed-link {
    margin-left: 6px;
  }

  .book-card {
    padding-top: 8px;
    cursor: pointer;
    transition: box-shadow 0.15s ease, transform 0.15s ease;
  }

  .book-card.selected {
    box-shadow: 0 0 0 2px #24a0ed;
    transform: translateY(-2px);
  }

  .mdui-card img {
    height: 100%;
    object-fit: cover;
    min-height: 200px;
  }

  .card-checkbox {
    display: flex;
    justify-content: flex-end;
    padding: 8px;
  }

  .mdui-container {
    width: 100%;
    padding: 12px 20px 20px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    grid-row-gap: 20px;
    grid-column-gap: 20px;
    box-sizing: border-box;
    overflow-x: hidden;
  }
</style>
