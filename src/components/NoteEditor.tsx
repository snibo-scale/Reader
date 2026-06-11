import { useEffect, useRef, useState } from "react";

interface Props {
  initial: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

/** Textarea that commits its value on blur and on unmount, so edits are never lost
 *  when a popover closes or a slide changes. Key it by the highlight id. */
export default function NoteEditor({ initial, onCommit, placeholder, className, autoFocus }: Props) {
  const [v, setV] = useState(initial);
  // Commit only on REAL unmount (empty deps), reading the latest props through a
  // ref. Parents pass fresh inline closures every render, so depending on
  // `onCommit` would fire the cleanup on every parent re-render — committing
  // through a stale closure over an old paper and clobbering concurrent changes.
  const latest = useRef({ v, initial, onCommit });
  latest.current = { v, initial, onCommit };
  useEffect(
    () => () => {
      const { v, initial, onCommit } = latest.current;
      if (v !== initial) onCommit(v);
    },
    []
  );
  return (
    <textarea
      className={className}
      value={v}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== initial) onCommit(v);
      }}
    />
  );
}
