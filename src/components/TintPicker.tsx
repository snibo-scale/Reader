import { useState } from "react";
import { hslString, type TintColor, type TintMode } from "../lib/tints";

interface Props {
  mode: TintMode;
  color: TintColor;
  onChange: (mode: TintMode, color: TintColor) => void;
}

const HUE_STOPS = [0, 60, 120, 180, 240, 300, 360];

export default function TintPicker({ mode, color, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const swatch = mode === "dark" ? "#2b2926" : mode === "white" ? "#ffffff" : hslString(color);
  const setColor = (patch: Partial<TintColor>) => onChange("color", { ...color, ...patch });

  const hueGradient = `linear-gradient(to right, ${HUE_STOPS.map(
    (h) => `hsl(${h}, ${color.s}%, ${color.l}%)`
  ).join(", ")})`;
  const satGradient = `linear-gradient(to right, hsl(${color.h}, 0%, ${color.l}%), hsl(${color.h}, 100%, ${color.l}%))`;
  const lightGradient = `linear-gradient(to right, hsl(${color.h}, ${color.s}%, 55%), #ffffff)`;

  return (
    <div className="tintpicker">
      <button
        className="swatch tint-trigger"
        style={{ background: swatch }}
        title="Page tint"
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <>
          <div className="tint-backdrop" onClick={() => setOpen(false)} />
          <div className="tint-pop">
            <div className="tint-presets">
              <button
                className={"swatch" + (mode === "white" ? " current" : "")}
                style={{ background: "#ffffff" }}
                title="White"
                onClick={() => onChange("white", color)}
              />
              <button
                className={"swatch" + (mode === "color" ? " current" : "")}
                style={{ background: hslString(color) }}
                title="Custom color"
                onClick={() => onChange("color", color)}
              />
              <button
                className={"swatch" + (mode === "dark" ? " current" : "")}
                style={{ background: "#2b2926" }}
                title="Dark"
                onClick={() => onChange("dark", color)}
              />
              <div className="tint-preview" style={{ background: swatch }} />
            </div>

            <label className="tint-slider">
              <span>Hue</span>
              <input
                type="range"
                min={0}
                max={360}
                value={color.h}
                style={{ background: hueGradient }}
                onChange={(e) => setColor({ h: Number(e.target.value) })}
              />
            </label>
            <label className="tint-slider">
              <span>Saturation</span>
              <input
                type="range"
                min={0}
                max={100}
                value={color.s}
                style={{ background: satGradient }}
                onChange={(e) => setColor({ s: Number(e.target.value) })}
              />
            </label>
            <label className="tint-slider">
              <span>Lightness</span>
              <input
                type="range"
                min={50}
                max={98}
                value={color.l}
                style={{ background: lightGradient }}
                onChange={(e) => setColor({ l: Number(e.target.value) })}
              />
            </label>
          </div>
        </>
      )}
    </div>
  );
}
