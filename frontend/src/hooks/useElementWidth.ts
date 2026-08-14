import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Container width via `ResizeObserver`.
 *
 * The window here is a resizable panel inside a host page, so layout decisions
 * follow the *element's* width, not the viewport's — media queries would report
 * the browser window and get every docked-mode breakpoint wrong.
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });

    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);

    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
