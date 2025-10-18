type FocusHandler = () => void;

const registry = new Map<string, FocusHandler>();

export const registerTerminalFocus = (id: string, handler: FocusHandler) => {
  if (!id || typeof handler !== 'function') return;
  registry.set(id, handler);
};

export const unregisterTerminalFocus = (id: string, handler?: FocusHandler) => {
  if (!id) return;
  if (!handler) {
    registry.delete(id);
    return;
  }

  const current = registry.get(id);
  if (current === handler) {
    registry.delete(id);
  }
};

export const focusTerminalById = (id: string): boolean => {
  const handler = registry.get(id);
  if (!handler) return false;
  try {
    handler();
    return true;
  } catch {
    return false;
  }
};

export const focusTerminalMatching = (
  predicate: (id: string, handler: FocusHandler) => boolean
): boolean => {
  for (const [id, handler] of registry.entries()) {
    try {
      if (predicate(id, handler)) {
        handler();
        return true;
      }
    } catch {
      // Ignore individual handler failures; continue scanning remaining terminals.
    }
  }
  return false;
};

export const getRegisteredTerminalIds = (): string[] => Array.from(registry.keys());
