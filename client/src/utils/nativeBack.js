import { useEffect, useRef } from 'react';

let sequence = 0;
const handlers = [];

/**
 * Register a transient back handler. Higher priority handlers run first, and
 * the newest handler wins when priorities match (for stacked dialogs).
 */
export function registerNativeBackHandler(handler, priority = 0) {
  const entry = { id: ++sequence, handler, priority };
  handlers.push(entry);
  return () => {
    const index = handlers.findIndex((item) => item.id === entry.id);
    if (index >= 0) handlers.splice(index, 1);
  };
}

export function consumeNativeBack() {
  if (!handlers.length) return false;
  const entry = handlers.reduce((best, item) => {
    if (!best || item.priority > best.priority) return item;
    if (item.priority === best.priority && item.id > best.id) return item;
    return best;
  }, null);
  entry?.handler?.();
  return !!entry;
}

export function useNativeBackHandler(enabled, handler, priority = 0) {
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; }, [handler]);

  useEffect(() => {
    if (!enabled) return undefined;
    return registerNativeBackHandler(() => handlerRef.current?.(), priority);
  }, [enabled, priority]);
}
