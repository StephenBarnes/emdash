import React, { useEffect, useRef, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { log } from '../lib/logger';

const SNAPSHOT_LIMIT_BYTES = 512 * 1024; // 512 KB per terminal snapshot
type SnapshotChunk = { text: string; bytes: number };
type SnapshotEntry = { chunks: SnapshotChunk[]; bytes: number };

const terminalSnapshots = new Map<string, SnapshotEntry>();
const textEncoder =
  typeof TextEncoder !== 'undefined' ? new TextEncoder() : (null as TextEncoder | null);

const encodeBytes = (text: string): number => {
  if (!text) return 0;
  if (textEncoder) return textEncoder.encode(text).length;
  // Fallback approximation if TextEncoder is unavailable
  return [...text].length;
};

const appendSnapshotChunk = (id: string, text: string) => {
  if (!text) return;
  const entry = terminalSnapshots.get(id) ?? { chunks: [], bytes: 0 };
  const chunk: SnapshotChunk = { text, bytes: encodeBytes(text) };
  if (chunk.bytes === 0) return;
  entry.chunks.push(chunk);
  entry.bytes += chunk.bytes;

  while (entry.bytes > SNAPSHOT_LIMIT_BYTES && entry.chunks.length > 1) {
    const removed = entry.chunks.shift();
    if (removed) entry.bytes -= removed.bytes;
  }

  terminalSnapshots.set(id, entry);
};

const getSnapshotText = (id: string): string => {
  const entry = terminalSnapshots.get(id);
  if (!entry) return '';
  if (entry.chunks.length === 1) return entry.chunks[0]?.text ?? '';
  return entry.chunks.map((c) => c.text).join('');
};

const clearSnapshot = (id: string) => {
  terminalSnapshots.delete(id);
};

type Props = {
  id: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  shell?: string;
  env?: Record<string, string>;
  className?: string;
  variant?: 'dark' | 'light';
  themeOverride?: any; // optional xterm theme overrides
  contentFilter?: string; // CSS filter applied to terminal content container
  keepAlive?: boolean;
  onActivity?: () => void;
  onStartError?: (message: string) => void;
  onStartSuccess?: () => void;
};

const TerminalPaneComponent: React.FC<Props> = ({
  id,
  cwd,
  cols = 80,
  rows = 24,
  shell,
  env,
  className,
  variant = 'dark',
  themeOverride,
  contentFilter,
  keepAlive = false,
  onActivity,
  onStartError,
  onStartSuccess,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const disposeFns = useRef<Array<() => void>>([]);

  const pendingOscRef = useRef<string>('');

  useEffect(() => {
    pendingOscRef.current = '';
    disposeFns.current = [];
    const el = containerRef.current;
    if (!el) {
      log.error('TerminalPane: No container element found');
      return;
    }

    log.debug('TerminalPane: Creating terminal, container dimensions:', {
      width: el.offsetWidth,
      height: el.offsetHeight,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
    });

    const isLight = variant === 'light';
    const baseTheme = isLight
      ? {
          // Light theme defaults
          background: '#ffffff',
          foreground: '#000000',
          cursor: '#000000',
          selectionBackground: '#00000022',
          black: '#000000',
          red: '#cc0000',
          green: '#008000',
          yellow: '#a16207',
          blue: '#1d4ed8',
          magenta: '#7c3aed',
          cyan: '#0ea5e9',
          white: '#111827',
          brightBlack: '#4b5563',
          brightRed: '#ef4444',
          brightGreen: '#22c55e',
          brightYellow: '#f59e0b',
          brightBlue: '#3b82f6',
          brightMagenta: '#8b5cf6',
          brightCyan: '#22d3ee',
          brightWhite: '#111827',
        }
      : {
          // Dark theme defaults
          background: '#1f2937',
          foreground: '#ffffff',
          cursor: '#ffffff',
          selectionBackground: '#ffffff33',
          black: '#1f2937',
          red: '#ff6b6b',
          green: '#2ecc71',
          yellow: '#f1c40f',
          blue: '#3498db',
          magenta: '#9b59b6',
          cyan: '#1abc9c',
          white: '#ecf0f1',
          brightBlack: '#bfbfbf',
          brightRed: '#ff6b6b',
          brightGreen: '#2ecc71',
          brightYellow: '#f1c40f',
          brightBlue: '#3498db',
          brightMagenta: '#9b59b6',
          brightCyan: '#1abc9c',
          brightWhite: '#ffffff',
        };
    const theme = { ...(baseTheme as any), ...(themeOverride || {}) } as any;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      disableStdin: false,
      cols: cols,
      rows: rows,
      theme,
      allowTransparency: false,
      scrollback: 1000,
    });
    termRef.current = term;
    term.open(el);
    term.focus();
    setTimeout(() => term.focus(), 0);

    const requestPasteFromSystem = async () => {
      try {
        term.focus();
        if (typeof window.electronAPI?.triggerPaste === 'function') {
          const result = await window.electronAPI.triggerPaste();
          if (result?.success) {
            return;
          }
        }
      } catch (error) {
        log.error('TerminalPane: triggerPaste failed', error);
      }

      try {
        if (navigator.clipboard?.readText) {
          const text = await navigator.clipboard.readText();
          if (text) {
            term.paste(text);
          }
        }
      } catch (error) {
        log.error('TerminalPane: clipboard read failed', error);
      }
    };

    const keyDisp = term.onData((data) => {
      log.debug('xterm onData', JSON.stringify(data));
      try {
        onActivity && onActivity();
      } catch {}
      window.electronAPI.ptyInput({ id, data });
    });
    const keyDisp2 = term.onKey((ev) => {
      log.debug('xterm onKey', ev.key);
    });
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') {
        return true;
      }
      const rawKey = ev.key;
      const key = typeof rawKey === 'string' ? rawKey.toLowerCase() : '';
      const isPasteCombo = (ev.ctrlKey || ev.metaKey) && !ev.altKey && key === 'v';
      const isShiftInsert =
        ev.shiftKey && !ev.ctrlKey && !ev.metaKey && rawKey === 'Insert';

      if (isPasteCombo || isShiftInsert) {
        ev.preventDefault();
        ev.stopPropagation();
        void requestPasteFromSystem();
        return false;
      }

      return true;
    });

    // Listen for history first, then live data, then start/attach to PTY
    const sanitizeEchoArtifacts = (chunk: string) => {
      let working = '';
      try {
        // Preserve any previously buffered but incomplete OSC sequence
        working = pendingOscRef.current + chunk;
        pendingOscRef.current = '';

        // Strip common terminal response artifacts that sometimes get echoed by TTY in cooked mode.
        // 1) Remove ANSI Device Attributes responses (e.g., "\x1b[?1;2c")
        working = working.replace(/\x1b\[\?\d+(?:;\d+)*c/g, '');
        // 2) Remove bare echoed fragments like "1;2c" or "24;80R" when ESC sequences were stripped by echo
        working = working.replace(/(^|[\s>])\d+(?:;\d+)*[cR](?=$|\s)/g, '$1');
        // 3) Remove complete Operating System Command sequences (e.g., "\x1b]10;..."); these often contain color info
        working = working.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '');

        // Keep any trailing, incomplete OSC sequence buffered for the next chunk
        const lastOscStart = working.lastIndexOf('\x1b]');
        if (lastOscStart !== -1) {
          const tail = working.slice(lastOscStart);
          if (!/(\x07|\x1b\\)/.test(tail)) {
            pendingOscRef.current = tail;
            working = working.slice(0, lastOscStart);
          }
        }

        return working;
      } catch {
        // On parser errors, fall back to the original chunk to avoid dropping data silently.
        pendingOscRef.current = '';
        return chunk;
      }
    };

    let historyReceived = false;
    let historyReplayedViaFallback = false;

    const handleIncoming = (data: string, isHistory: boolean) => {
      const sanitized = sanitizeEchoArtifacts(data);
      if (!sanitized) return;

      if (isHistory && historyReplayedViaFallback) {
        const cached = getSnapshotText(id);
        if (cached && sanitized.startsWith(cached)) {
          const diff = sanitized.slice(cached.length);
          if (diff) {
            term.write(diff);
            appendSnapshotChunk(id, diff);
          }
          return;
        }
      }

      term.write(sanitized);
      appendSnapshotChunk(id, sanitized);
    };

    const offHistory = (window as any).electronAPI.onPtyHistory?.(id, (data: string) => {
      historyReceived = true;
      handleIncoming(data, true);
    });
    const offData = window.electronAPI.onPtyData(id, (data) => {
      handleIncoming(data, false);
    });
    const offExit = window.electronAPI.onPtyExit(id, (info) => {
      try {
        // If the process exits very quickly after start, it's likely the CLI wasn't found
        const elapsed = Date.now() - startTsRef.current;
        if (elapsed < 1500 && onStartError) {
          onStartError(`PTY exited early (code ${info?.exitCode ?? 'n/a'})`);
        }
      } catch {}
    });
    const handleResize = () => {
      if (termRef.current && el) {
        const { width, height } = el.getBoundingClientRect();
        const newCols = Math.max(20, Math.floor(width / 9));
        const newRows = Math.max(10, Math.floor(height / 17));

        if (newCols !== cols || newRows !== rows) {
          termRef.current.resize(newCols, newRows);
          window.electronAPI.ptyResize({ id, cols: newCols, rows: newRows });
        }
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(el);

    const fallbackTimer = setTimeout(() => {
      if (!historyReceived) {
        const cached = getSnapshotText(id);
        if (cached) {
          historyReplayedViaFallback = true;
          term.write(cached);
        }
      }
    }, 250);

    disposeFns.current.push(() => keyDisp.dispose());
    if (offHistory) disposeFns.current.push(offHistory);
    disposeFns.current.push(offData);
    disposeFns.current.push(offExit);
    disposeFns.current.push(() => keyDisp2.dispose());
    disposeFns.current.push(() => resizeObserver.disconnect());
    disposeFns.current.push(() => clearTimeout(fallbackTimer));

    // Start PTY session after listeners are attached so we don't miss initial output/history
    const startTsRef = { current: Date.now() } as { current: number };
    (async () => {
      try {
        try {
          const envKeys = env ? Object.keys(env) : [];
          if (envKeys.length) log.info('PTY starting with env', { id, envKeys });
        } catch {}
        const res = await window.electronAPI.ptyStart({
          id,
          cwd,
          cols,
          rows,
          shell,
          env,
        });
        if (!res?.ok) {
          term.writeln('\x1b[31mFailed to start PTY:\x1b[0m ' + (res as any)?.error);
          try {
            onStartError && onStartError((res as any)?.error || 'Failed to start PTY');
          } catch {}
        }
        if (res?.ok) {
          try {
            log.info('PTY started', { id });
            onStartSuccess && onStartSuccess();
          } catch {}
        }
      } catch (e: any) {
        term.writeln('\x1b[31mError starting PTY:\x1b[0m ' + (e?.message || String(e)));
        try {
          onStartError && onStartError(e?.message || String(e));
        } catch {}
      }
    })();

    return () => {
      if (!keepAlive) {
        window.electronAPI.ptyKill(id);
        clearSnapshot(id);
      }
      disposeFns.current.forEach((fn) => fn());
      disposeFns.current = [];
      term.dispose();
      termRef.current = null;
    };
  }, [id, cwd, cols, rows, variant, keepAlive, shell]);

  return (
    <div
      className={className}
      style={{
        width: '100%',
        height: '100%',
        minHeight: '0',
        backgroundColor: variant === 'light' ? '#ffffff' : '#1f2937',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
      onContextMenu={(e) => {
        const showMenu = window.electronAPI?.showTerminalContextMenu;
        if (typeof showMenu === 'function') {
          e.preventDefault();
          termRef.current?.focus();
          void showMenu();
        }
      }}
      onClick={() => termRef.current?.focus()}
      onMouseDown={() => termRef.current?.focus()}
      onDragOver={(e) => {
        // Allow dropping files onto the terminal surface
        e.preventDefault();
      }}
      onDrop={(e) => {
        try {
          e.preventDefault();
          const dt = e.dataTransfer;
          if (!dt || !dt.files || dt.files.length === 0) return;
          const paths: string[] = [];
          for (let i = 0; i < dt.files.length; i++) {
            const file = dt.files[i] as any;
            const p: string | undefined = file?.path;
            if (p) paths.push(p);
          }
          if (paths.length === 0) return;
          // Insert absolute paths (quoted) into the PTY, separated by spaces
          const escaped = paths.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(' ');
          window.electronAPI.ptyInput({ id, data: escaped });
          termRef.current?.focus();
        } catch {
          // ignore
        }
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          minHeight: '0',
          overflow: 'hidden',
          filter: contentFilter || undefined,
        }}
      />
    </div>
  );
};

export const TerminalPane = React.memo(TerminalPaneComponent);

export default TerminalPane;
