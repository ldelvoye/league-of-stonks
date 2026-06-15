import { useRef, useEffect, useState } from "react";

interface Props {
  value: number;
  formatter?: (v: number) => string;
}

/**
 * Renders a number with a per-digit slide animation whenever the value changes.
 * Going up → digits scroll upward (new value enters from below).
 * Going down → digits scroll downward (new value enters from above).
 * Separators (commas, spaces) are static.
 */
export function AnimatedNumber({ value, formatter }: Props) {
  const prevValueRef = useRef(value);
  const [animKey, setAnimKey] = useState(0);
  const directionRef = useRef<"up" | "down" | null>(null);

  const fmt = formatter ?? ((v: number) => v.toLocaleString());

  useEffect(() => {
    if (value !== prevValueRef.current) {
      directionRef.current = value > prevValueRef.current ? "up" : "down";
      prevValueRef.current = value;
      setAnimKey((k) => k + 1);
    }
  }, [value]);

  const formatted = fmt(value);
  const dir = directionRef.current;
  const shouldAnimate = dir !== null && animKey > 0;

  // Pre-compute digit positions so we can stagger from right to left.
  const chars = formatted.split("");
  const digitIndices = chars.reduce<number[]>((acc, char, i) => {
    if (/\d/.test(char)) acc.push(i);
    return acc;
  }, []);

  return (
    <span className="anim-number" aria-label={formatted} role="text">
      {chars.map((char, i) => {
        if (!/\d/.test(char)) {
          return (
            <span key={i} className="anim-number__sep" aria-hidden="true">
              {char}
            </span>
          );
        }

        // Rightmost digit = rank 0 → animates first (no delay).
        const rankFromLeft = digitIndices.indexOf(i);
        const rankFromRight = digitIndices.length - 1 - rankFromLeft;
        const delay = shouldAnimate ? rankFromRight * 25 : 0;

        return (
          <span key={i} className="anim-number__slot" aria-hidden="true">
            <span
              key={`${animKey}-${i}`}
              className={`anim-number__digit${shouldAnimate ? ` anim-number__digit--${dir}` : ""}`}
              style={shouldAnimate ? { animationDelay: `${delay}ms` } : undefined}
            >
              {char}
            </span>
          </span>
        );
      })}
    </span>
  );
}
