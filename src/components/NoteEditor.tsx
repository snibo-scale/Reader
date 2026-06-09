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
  const ref = useRef(initial);
  ref.current = v;
  useEffect(
    () => () => {
      if (ref.current !== initial) onCommit(ref.current);
    },
    [initial, onCommit]
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
