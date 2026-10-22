import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A short "Added" state for the button that was pressed: the label and icon change for 1.6s
 * after the bag accepts the item. It is a state change, not movement, so it reads the same
 * with reduced motion (where the icon's pop-in is instant).
 */
export function useAddedFlash(duration = 1600): [boolean, () => void] {
  const [added, setAdded] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flash = useCallback(() => {
    window.clearTimeout(timer.current);
    setAdded(true);
    timer.current = window.setTimeout(() => {
      setAdded(false);
    }, duration);
  }, [duration]);
  return [added, flash];
}
