import React, { useEffect, useRef, useState } from "react";

export default function MultiSelectDropdown({
  label,
  options,
  value,
  onChange,
  enableSelectAll = false,
  selectAllLabel = "Select All"
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClick = (event) => {
      if (!wrapperRef.current || wrapperRef.current.contains(event.target)) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  const toggleOption = (optionValue) => {
    const next = value.includes(optionValue)
      ? value.filter((item) => item !== optionValue)
      : [...value, optionValue];
    onChange(next);
  };

  const allSelected = options.length > 0 && value.length === options.length;

  const toggleAll = () => {
    if (allSelected) {
      onChange([]);
    } else {
      onChange(options.map((option) => option.value));
    }
  };

  const displayValue = value.length ? value.join(", ") : "Select";
  const optionStyle = { justifyContent: "flex-start", textAlign: "left", alignItems: "center" };
  const optionTextStyle = { marginLeft: 0, marginRight: "auto", textAlign: "left" };

  return (
    <div className="dropdown" ref={wrapperRef}>
      <button
        type="button"
        className="dropdown-trigger"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{displayValue}</span>
        <span className="dropdown-caret">▾</span>
      </button>
      {open ? (
        <div className="dropdown-panel compact">
          {label ? <p className="dropdown-label">{label}</p> : null}
          {enableSelectAll ? (
            <label className="dropdown-option" style={optionStyle}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                style={{ margin: 0 }}
              />
              <span style={optionTextStyle}>{selectAllLabel}</span>
            </label>
          ) : null}
          {options.map((option) => (
            <label key={option.value} className="dropdown-option" style={optionStyle}>
              <input
                type="checkbox"
                checked={value.includes(option.value)}
                onChange={() => toggleOption(option.value)}
                style={{ margin: 0 }}
              />
              <span style={optionTextStyle}>{option.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
