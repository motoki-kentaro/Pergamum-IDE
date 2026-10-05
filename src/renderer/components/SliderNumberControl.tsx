import { useEffect, useState, type JSX } from "react";

interface SliderNumberControlProps {
  /** Id of the number input (the Settings row's `settingControl-<key>`). */
  readonly id: string;
  readonly labelId: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** Slider step; also the granularity the number input validates against. */
  readonly sliderStep: number;
  /** Amount moved by the number input's spinner and ArrowUp / ArrowDown. */
  readonly spinStep: number;
  readonly disabled: boolean;
  /** Whether a typed value may be committed (catalog validation). */
  readonly isValid: (value: number) => boolean;
  readonly onChange: (value: number) => void;
}

// Float-safe rounding to a step grid (0.35 + 0.1 must give 0.45, not
// 0.44999999999999996).
function snapToStep(
  value: number,
  step: number,
  min: number,
  max: number
): number {
  const snapped = Number((Math.round(value / step) * step).toFixed(10));
  return Math.min(max, Math.max(min, snapped));
}

/**
 * #731: a slider plus a number input whose spinner increment differs from the
 * slider step (the native `step` attribute alone cannot express both: it also
 * snaps the spinner to its own grid). The input keeps `step={sliderStep}` so
 * every 0.05 multiple is valid, and the spinner / arrow keys are mapped to
 * `spinStep` moves here.
 */
export function SliderNumberControl({
  id,
  labelId,
  value,
  min,
  max,
  sliderStep,
  spinStep,
  disabled,
  isValid,
  onChange
}: SliderNumberControlProps): JSX.Element {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const parsed = text.trim() === "" ? Number.NaN : Number(text);
  const invalid = !Number.isFinite(parsed) || !isValid(parsed);
  const current = invalid ? value : parsed;

  function commit(next: number): void {
    setText(String(next));
    if (isValid(next)) {
      onChange(next);
    }
  }

  function spin(direction: 1 | -1): void {
    commit(snapToStep(current + direction * spinStep, sliderStep, min, max));
  }

  return (
    <div className="settingsSliderNumberGroup">
      <input
        className="settingsSlider"
        type="range"
        min={min}
        max={max}
        step={sliderStep}
        value={current}
        disabled={disabled}
        aria-labelledby={labelId}
        onChange={(event) => commit(Number(event.target.value))}
      />
      <input
        id={id}
        className="settingsNumberInput"
        type="number"
        min={min}
        max={max}
        step={sliderStep}
        value={text}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-invalid={invalid}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            spin(event.key === "ArrowUp" ? 1 : -1);
          }
        }}
        onChange={(event) => {
          const raw = event.target.value;
          const next = Number(raw);
          const inputType = (event.nativeEvent as InputEvent).inputType;

          // A spinner click (no `inputType`, unlike typing / pasting) moves
          // by the native step; re-map it to the spinner increment.
          if (
            !inputType &&
            raw.trim() !== "" &&
            Number.isFinite(next) &&
            !invalid &&
            Math.abs(Math.abs(next - current) - sliderStep) < 1e-9
          ) {
            spin(next > current ? 1 : -1);
            return;
          }

          setText(raw);
          if (raw.trim() !== "" && Number.isFinite(next) && isValid(next)) {
            onChange(next);
          }
        }}
      />
    </div>
  );
}
