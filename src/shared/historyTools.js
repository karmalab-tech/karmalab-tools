// The tools that keep a run history, by storage namespace — what the shared
// history list needs to label a run with the tool that made it and to send
// someone to that tool when they pick it.
//
// Video Effects makes nothing on Replicate and has no runs, so it isn't here;
// the Chat Box Studio is, though it is not offered in the tools sidebar. A test
// checks every `path` is a real route, so a tool moved in `server/routes.js`
// can't leave a history entry that opens nowhere.

export const HISTORY_TOOLS = {
  batchImageStudio: { label: 'Batch Images', path: '/' },
  imageChainStudio: { label: 'Image Chain', path: '/image-chain' },
  batchVideoStudio: { label: 'Batch Videos', path: '/batch-videos' },
  continuousVideoStudio: { label: 'Video Chain', path: '/video-chain' },
  chatBoxStudio: { label: 'Chat Box', path: '/prompt' },
};

export const historyToolLabel = (namespace) => HISTORY_TOOLS[namespace]?.label || '';

// Where a run from another tool is opened: that tool's page, told which run to
// show. The hash is read by `useGenerationRun` on load.
export const historyRunUrl = (namespace, runId) => {
  const path = HISTORY_TOOLS[namespace]?.path;
  return path ? `${path}#history=${encodeURIComponent(runId)}` : '';
};

export function parseHistoryHash(hash) {
  const match = /^#history=(.+)$/.exec(hash || '');
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}
