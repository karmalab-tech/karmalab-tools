import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadApiKey } from './apiKey.js';
import {
  extractOutputUrl,
  friendlyErrorMessage,
  getPrediction,
  pollPrediction,
} from './replicate.js';
import { isActiveItem, newRunId, runCounts, runTabTitle, serializeRun, uiStatus } from './runs.js';
import { useUnloadGuard } from './useUnloadGuard.js';

// Everything the generation tools share about a run: the item list, its
// persistence, recovering an unfinished run on load, the history of finished
// runs, the tab title and the close-the-tab warning. Each tool keeps its own
// inputs and its own runner loop, and calls in here for the rest.
//
//   const gen = useGenerationRun({ storage, pollOptions: VIDEO_POLL });
//   gen.startRun({ title, items });   // begins a run (archives the last one)
//   gen.updateItem(id, patch);        // as each prediction progresses
//   gen.finishRun();                  // the runner is done
//   gen.continueRun();                // reopen the finished run to add to it
//   gen.removeItem(id);               // drop one item from the run
//
// Options:
//   storage       — a createToolStorage(namespace) instance (one per tool)
//   pollOptions   — poll profile for resumed predictions (VIDEO_POLL for video)
//   guard         — also warn on tab close while this is true (the video chain
//                   waiting on a review still has state to lose)
//   missingOutput — error text when a prediction succeeds with no output
//   restoreHint   — appended to the notice once a recovered run settles
//   onNotice      — (text, isError) => void, for the tool's own hint line
export function useGenerationRun({
  storage,
  pollOptions,
  guard = false,
  missingOutput = 'No output returned by the model.',
  restoreHint = '',
  onNotice,
} = {}) {
  const [items, setItems] = useState([]);
  // { id, title, createdAt, finishedAt, origin: 'live' | 'history' }
  const [run, setRun] = useState(null);
  const [history, setHistory] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Set when a runner says it is done; the archive itself waits for the last
  // item updates to land, so what goes to history is the final state.
  const [finishRequested, setFinishRequested] = useState(false);

  const itemsRef = useRef(items);
  const runRef = useRef(run);
  const stoppedRef = useRef(false);
  const noticeRef = useRef(onNotice);
  const loadedRef = useRef(false);

  itemsRef.current = items;
  runRef.current = run;
  noticeRef.current = onNotice;

  const notify = useCallback((text, isError = false) => {
    noticeRef.current?.(text, isError);
  }, []);

  useEffect(() => {
    stoppedRef.current = false;
    return () => {
      stoppedRef.current = true;
    };
  }, []);

  const updateItem = useCallback((id, patch) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const appendItems = useCallback((newItems) => {
    setItems((prev) => [...prev, ...newItems]);
  }, []);

  // Drop one item from the run on screen — the Image Chain Studio deleting a
  // step that failed. Taking the last one leaves no run at all, so it is
  // cleared from storage as well; otherwise the empty run would come back on
  // the next load, or sit in the history list with nothing in it.
  const removeItem = useCallback(
    (id) => {
      const remaining = itemsRef.current.filter((it) => it.id !== id);
      if (!remaining.length) {
        const current = runRef.current;
        if (current?.origin === 'history') storage.removeHistoryRun(current.id);
        else if (current) storage.clearCurrentRun();
        runRef.current = null;
        setRun(null);
      }
      itemsRef.current = remaining;
      setItems(remaining);
    },
    [storage]
  );

  // Persist on every change. A live run is the one to recover on reload; a run
  // opened from history is written back in place, since refreshing it can move
  // items on (a prediction that was still going when the run was archived).
  useEffect(() => {
    const current = runRef.current;
    if (!current || !items.length) return;
    const payload = serializeRun(current, items);
    if (current.origin === 'history') storage.updateHistoryRun(payload);
    else storage.saveCurrentRun(payload);
  }, [items, run, storage]);

  // Move the run on screen into history. Called once its items have settled,
  // and before another run takes its place.
  const archive = useCallback(() => {
    const current = runRef.current;
    const currentItems = itemsRef.current;
    if (!current || current.origin === 'history' || !currentItems.length) return;
    const finishedAt = Date.now();
    storage.archiveRun(serializeRun({ ...current, finishedAt }, currentItems));
    setHistory(storage.loadHistory());
    setRun((prev) =>
      prev && prev.id === current.id ? { ...prev, origin: 'history', finishedAt } : prev
    );
  }, [storage]);

  // A run is finished when nothing is in flight any more. Items that never got
  // as far as a prediction (a cancelled batch leaves some behind) would keep it
  // open forever, so they are closed out here.
  const requestFinish = useCallback(() => {
    setItems((prev) =>
      prev.map((it) =>
        isActiveItem(it) && !it.predictionId
          ? { ...it, status: 'failed', error: it.error || 'Stopped before it started.' }
          : it
      )
    );
    setFinishRequested(true);
  }, []);

  useEffect(() => {
    if (!finishRequested) return;
    if (items.some(isActiveItem)) return;
    setFinishRequested(false);
    archive();
  }, [archive, finishRequested, items]);

  const finalize = useCallback(
    (itemId, data) => {
      const outputUrl = extractOutputUrl(data.output);
      updateItem(
        itemId,
        outputUrl
          ? { status: 'succeeded', outputUrl, error: null }
          : { status: 'failed', error: missingOutput }
      );
      return outputUrl ? 'succeeded' : 'failed';
    },
    [missingOutput, updateItem]
  );

  // Bring one item back in line with Replicate: fetch it once, and if it is
  // still going, keep polling until it lands. Returns its final status.
  const refreshItem = useCallback(
    async (item, key) => {
      if (!item.predictionId) {
        // Queued in the UI but never created upstream — the tab closed first.
        updateItem(item.id, { status: 'failed', error: 'Interrupted when the tab closed.' });
        return 'failed';
      }
      const id = item.predictionId;
      try {
        const data = await getPrediction(id, key);
        if (stoppedRef.current) return item.status;
        if (data.status === 'succeeded') return finalize(item.id, data);
        if (data.status === 'failed' || data.status === 'canceled') {
          updateItem(item.id, {
            status: 'failed',
            error: data.error || `Prediction ${data.status}`,
          });
          return 'failed';
        }
        updateItem(item.id, { status: uiStatus(data.status), error: null });
        const finalData = await pollPrediction(id, key, () => stoppedRef.current, pollOptions);
        if (stoppedRef.current) return 'running';
        return finalize(item.id, finalData);
      } catch (err) {
        if (stoppedRef.current) return 'running';
        updateItem(item.id, { status: 'failed', error: friendlyErrorMessage(err) });
        return 'failed';
      }
    },
    [finalize, pollOptions, updateItem]
  );

  // Refresh a whole run's statuses. Succeeded items are already final, so only
  // the rest cost a request — failed ones included, since a UI cancel can leave
  // one marked failed while the prediction went on to finish on Replicate.
  const refreshRun = useCallback(
    async ({ storedItems, restored, hint = '' }) => {
      const stale = storedItems.filter((it) => it.status !== 'succeeded');
      if (!stale.length) return;
      const key = loadApiKey().trim();
      if (!key) {
        notify('Add your Replicate API token to refresh this generation.', true);
        return;
      }
      setRefreshing(true);
      notify(
        restored
          ? 'Picked up the generation that was running when the tab closed — refreshing it…'
          : 'Loaded a generation from history — refreshing its status…'
      );
      const statuses = await Promise.all(stale.map((it) => refreshItem(it, key)));
      if (stoppedRef.current) return;
      setRefreshing(false);
      const succeeded =
        storedItems.length - stale.length + statuses.filter((s) => s === 'succeeded').length;
      notify([`${succeeded} of ${storedItems.length} finished.`, hint].filter(Boolean).join(' '));
      if (restored) requestFinish();
    },
    [notify, refreshItem, requestFinish]
  );

  // On open: load the history list, and if a run was still going when the tab
  // closed, put it back on screen and resume it. A run that had already landed
  // just moves to history.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setHistory(storage.loadHistory());
    const stored = storage.loadCurrentRun();
    if (!stored) return;

    if (!stored.items.some(isActiveItem)) {
      storage.archiveRun(stored);
      setHistory(storage.loadHistory());
      return;
    }

    setRun({
      id: stored.id,
      title: stored.title,
      createdAt: stored.createdAt,
      finishedAt: null,
      origin: 'live',
    });
    setItems(stored.items);
    refreshRun({ storedItems: stored.items, restored: true, hint: restoreHint });
    // Once per mount — `loadedRef` above, not an empty dependency list, so the
    // deps stay honest.
  }, [refreshRun, restoreHint, storage]);

  const startRun = useCallback(
    ({ title, items: initialItems = [] }) => {
      archive();
      const meta = {
        id: newRunId(),
        title: title || 'Generation',
        createdAt: Date.now(),
        finishedAt: null,
        origin: 'live',
      };
      runRef.current = meta;
      itemsRef.current = initialItems;
      setRun(meta);
      setItems(initialItems);
      return meta.id;
    },
    [archive]
  );

  // Take the run on screen back off the shelf so more items can be added to it:
  // the Image Chain Studio continuing a finished chain from its last image. The
  // run keeps its id, so archiving it again replaces its history entry rather
  // than leaving a shorter copy behind, and it goes back to being the run a
  // reload recovers.
  const continueRun = useCallback(() => {
    const current = runRef.current;
    if (!current || current.origin === 'live') return;
    const meta = { ...current, origin: 'live', finishedAt: null };
    runRef.current = meta;
    setRun(meta);
  }, []);

  // Open a finished run: show its items again and refresh them, so anything
  // that moved on since it was archived comes back with its current state.
  //
  // Swapping the view while something is in flight stops this tab from tracking
  // it, so that is asked about first. It is not lost either way: the run is
  // archived with its prediction ids, and reopening it from history refreshes it
  // and picks the polling back up.
  const openHistoryRun = useCallback(
    (runId) => {
      const entry = storage.loadHistory().find((r) => r.id === runId);
      if (!entry) return;
      if (runRef.current?.origin === 'live' && itemsRef.current.some(isActiveItem)) {
        const ok = window.confirm(
          'Something is still generating here. Opening an older generation stops tracking it in ' +
            'this tab — it keeps running on Replicate and stays in History, where you can open it ' +
            'again to pick it back up. Continue?'
        );
        if (!ok) return;
      }
      archive();
      const meta = {
        id: entry.id,
        title: entry.title,
        createdAt: entry.createdAt,
        finishedAt: entry.finishedAt,
        origin: 'history',
      };
      runRef.current = meta;
      itemsRef.current = entry.items;
      setRun(meta);
      setItems(entry.items);
      setHistoryOpen(false);
      refreshRun({ storedItems: entry.items, restored: false });
    },
    [archive, refreshRun, storage]
  );

  const clearHistory = useCallback(() => {
    storage.clearHistory();
    setHistory([]);
    setHistoryOpen(false);
  }, [storage]);

  const counts = useMemo(() => runCounts(items), [items]);
  const hasActive = counts.active > 0;

  // Closing the tab loses the polling that tracks the run (and, in the video
  // chain, the frame that links one clip to the next) — warn first.
  useUnloadGuard(hasActive || guard);
  useRunTabTitle(counts);

  return {
    items,
    setItems,
    updateItem,
    appendItems,
    removeItem,
    run,
    counts,
    hasActive,
    refreshing,
    history,
    startRun,
    finishRun: requestFinish,
    continueRun,
    viewingHistory: run?.origin === 'history',
    openHistory: () => setHistoryOpen(true),
    historyModal: {
      open: historyOpen,
      runs: history,
      currentRunId: run?.id || null,
      onSelect: openHistoryRun,
      onClose: () => setHistoryOpen(false),
      onClear: clearHistory,
    },
  };
}

// Mirror the run's progress in the browser tab, so a user waiting on another
// tab sees it move and sees when it lands. The page's own <title> is the base,
// and the finished marker clears once the tab is looked at again.
export function useRunTabTitle(counts) {
  const baseTitleRef = useRef('');
  const wasActiveRef = useRef(false);
  const [showDone, setShowDone] = useState(false);

  if (!baseTitleRef.current) baseTitleRef.current = document.title;

  useEffect(() => {
    if (counts.active > 0) {
      wasActiveRef.current = true;
      setShowDone(false);
    } else if (wasActiveRef.current) {
      wasActiveRef.current = false;
      setShowDone(true);
    }
  }, [counts.active]);

  useEffect(() => {
    const base = baseTitleRef.current;
    document.title = runTabTitle(base, counts, showDone);
    return () => {
      document.title = base;
    };
  }, [counts, showDone]);

  useEffect(() => {
    if (!showDone) return;
    const onVisible = () => document.visibilityState === 'visible' && setShowDone(false);
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [showDone]);
}
