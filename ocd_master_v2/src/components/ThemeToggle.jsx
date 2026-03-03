import React, { useEffect, useState } from "react";

const STORAGE_KEY = "ocd_theme";

const applyTheme = (theme) => {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
};

export default function ThemeToggle({
  label = "Switch Theme",
  className = "",
  floating = false
}) {
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    const next = saved || "dark";
    setTheme(next);
    applyTheme(next);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
    applyTheme(next);
  };

  const buttonLabel = label || (theme === "dark" ? "Light" : "Dark");

  return (
    <button
      className={`${floating ? "theme-toggle" : ""} ${className}`.trim()}
      onClick={toggleTheme}
    >
      {buttonLabel}
    </button>
  );
}
