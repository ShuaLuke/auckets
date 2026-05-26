// TextInput — text field with optional $/unit prefix or suffix.
// Matches the prototype's TextInput from
// design/ui_kits/auckets/components/Fields.jsx.
//
// `mono` switches the font to the monospace family — used by numeric
// inputs (price, group size) for tabular alignment.

"use client";

import { type InputHTMLAttributes, useState } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> & {
  prefix?: string;
  suffix?: string;
  mono?: boolean;
  // Style passed to the WRAPPER (when prefix/suffix is used) or the
  // input itself (when it's bare).
  wrapperStyle?: React.CSSProperties;
};

export function TextInput({
  prefix,
  suffix,
  mono = false,
  type = "text",
  className = "",
  style,
  wrapperStyle,
  onFocus,
  onBlur,
  ...rest
}: Props) {
  const [focused, setFocused] = useState(false);
  const borderColor = focused ? "var(--brand)" : "var(--border-strong)";
  const boxShadow = focused ? "0 0 0 3px rgba(31, 74, 46, 0.15)" : "none";
  const fontFamily = mono
    ? "var(--font-mono)"
    : "var(--font-sans)";

  if (prefix || suffix) {
    return (
      <div
        className="flex items-stretch overflow-hidden rounded-lg transition-shadow duration-150"
        style={{
          border: `1px solid ${borderColor}`,
          background: "var(--page)",
          boxShadow,
          ...wrapperStyle,
        }}
      >
        {prefix && (
          <span
            className="font-mono text-sm"
            style={{
              padding: "10px 4px 10px 12px",
              color: "var(--fg-subtle)",
            }}
          >
            {prefix}
          </span>
        )}
        <input
          type={type}
          className={`flex-1 border-0 bg-transparent text-sm outline-none ${className}`.trim()}
          style={{
            padding: prefix ? "10px 12px 10px 0" : "10px 12px",
            fontFamily,
            color: "var(--fg)",
            fontVariantNumeric: mono ? "tabular-nums" : "normal",
            ...style,
          }}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {suffix && (
          <span
            className="font-mono text-sm"
            style={{
              padding: "10px 12px 10px 4px",
              color: "var(--fg-subtle)",
            }}
          >
            {suffix}
          </span>
        )}
      </div>
    );
  }

  return (
    <input
      type={type}
      className={`rounded-lg text-sm outline-none transition-shadow duration-150 ${className}`.trim()}
      style={{
        fontFamily,
        color: "var(--fg)",
        background: "var(--page)",
        border: `1px solid ${borderColor}`,
        padding: "10px 12px",
        boxShadow,
        fontVariantNumeric: mono ? "tabular-nums" : "normal",
        ...style,
      }}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      {...rest}
    />
  );
}
