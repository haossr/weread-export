<script>
  import { onDestroy } from "svelte";
  import { batchRun, sleep } from "./batch";
  import {
    downloadCombinedExport,
    exportBookAsMarkdown,
  } from "./exporter";

  export let userVid;

  const BATCH_OPTIONS = { concurrency: 2, delayMs: 1500 };
  const RETRY_SCHEDULE = [1000, 3000, 7000];
  const BULK_RETRIES = 2;
  const REQUEST_RETRY_DELAYS = RETRY_SCHEDULE.slice(0, 2);
  const EXPORT_FORMATS = [
    { value: "markdown", label: "Markdown (.md，合并一份)" },
    { value: "json", label: "JSON (.json，合并一份)" },
    { value: "csv", label: "CSV (.csv，合并一份)" },
  ];

  let books = [];
  let selectedBookIds = [];
  let singleWorking = false;
  let bulkWorking = false;
  let progress = { done: 0, total: 0, failed: [] };
  let retryCount = 0;
  let failedListUrl = "";
  let selectAllCheckbox;
  let exportFormat = "markdown";

  $: totalBooks = books.length;
  $: hasSelection = selectedBookIds.length > 0;
  $: allSelected = totalBooks > 0 && selectedBookIds.length === totalBooks;
  $: selectionIndeterminate = hasSelection && !allSelected;
  $: if (selectAllCheckbox) {
    selectAllCheckbox.indeterminate = selectionIndeterminate;
  }
  $: singleButtonText =
    exportFormat === "markdown" ? (singleWorking ? "复制中..." : "复制选中") : singleWorking ? "导出中..." : "导出选中";

  function getNoteBooks() {
    fetch("https://weread.qq.com/api/user/notebook")
      .then((response) => response.json())
      .then((data) => {
        const list = Array.isArray(data?.books) ? data.books.map((val) => val.book) : [];
        books = list;
        selectedBookIds = list[0] ? [list[0].bookId] : [];
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

  async function exportSelectedSingle() {
    if (singleWorking || bulkWorking) return;
    if (!selectedBookIds.length) return;
    if (selectedBookIds.length > 1) {
      alert("单本导出时请只选择一本书");
      return;
    }
    const bookId = selectedBookIds[0];
    singleWorking = true;
    try {
      const exported = await exportBookAsMarkdown(
        bookId,
        userVid,
        REQUEST_RETRY_DELAYS,
      );
      if (exportFormat === "markdown") {
        downloadCombinedExport([exported], exportFormat);
        alert(`已导出 ${exported.title} 的 Markdown 文件`);
      } else {
        downloadCombinedExport([exported], exportFormat);
        alert(`已导出 ${exported.title} 的 ${exportFormat.toUpperCase()} 文件`);
      }
    } catch (error) {
      console.error("导出失败", error);
      alert("导出失败，请稍后重试");
    } finally {
      singleWorking = false;
    }
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
        disabled={singleWorking || bulkWorking}
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
        disabled={!books.length || bulkWorking}
        on:change={toggleSelectAll}
      />
      <i class="mdui-checkbox-icon" />
      <span>全选</span>
    </label>
    <button
      class="mdui-btn"
      on:click={exportSelectedSingle}
      disabled={!hasSelection || singleWorking || bulkWorking}
    >
      {singleButtonText}
    </button>
    <button class="mdui-btn mdui-color-theme" on:click={handleBulkExport} disabled={!hasSelection || bulkWorking}>
      {bulkWorking ? "批量导出中..." : "批量导出"}
    </button>
  </div>
</div>

{#if progress.total}
  <div class="progress-card">
    <div class="progress-line">进度 {progress.done} / {progress.total}</div>
    <div class="progress-line">
      重试 {retryCount} · 并发 {BATCH_OPTIONS.concurrency} · 间隔 {BATCH_OPTIONS.delayMs}ms
    </div>
    <div class="progress-bar">
      <div class="progress-bar__fill" style={`width: ${progressPercent}%`} />
    </div>
    <div class="progress-line small">已完成 {progressPercent}%</div>
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

<style>
  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .format-select {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #fff;
    font-size: 13px;
  }

  .format-select select {
    padding: 4px 6px;
    border-radius: 4px;
  }

  .select-all {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #fff;
  }

  .text-omit {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  .progress-card {
    padding: 12px 20px 4px;
    color: #555;
  }

  .progress-line {
    margin-bottom: 4px;
    font-size: 13px;
  }

  .progress-line.small {
    color: #777;
  }

  .progress-bar {
    width: 100%;
    height: 8px;
    background: #e0e0e0;
    border-radius: 6px;
    overflow: hidden;
    margin: 6px 0;
  }

  .progress-bar__fill {
    height: 100%;
    background: linear-gradient(90deg, #3f51b5, #2196f3);
    transition: width 0.2s ease;
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
    box-shadow: 0 0 0 2px #3f51b5;
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
    padding: 20px;
    padding-top: 80px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    grid-row-gap: 20px;
    grid-column-gap: 20px;
  }
</style>
