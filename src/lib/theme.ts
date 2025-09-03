const root = document.documentElement;
let autoWatcher: MediaQueryList | null = null;

function setTheme(theme: string) {
  localStorage.setItem("theme", theme);

  // If previously in auto mode, unsubscribe first
  if (autoWatcher) {
    autoWatcher.removeEventListener("change", handleAutoChange);
    autoWatcher = null;
  }

  if (theme === "auto") {
    // Check current system preference
    autoWatcher = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme(autoWatcher.matches ? "dark" : "light");

    // Watch for system theme changes in auto mode
    autoWatcher.addEventListener("change", handleAutoChange);
  } else {
    applyTheme(theme);
  }
}

function handleAutoChange(e: MediaQueryListEvent) {
  applyTheme(e.matches ? "dark" : "light");
}

function applyTheme(mode: string) {
  root.setAttribute("data-theme", mode === "light" ? "light" : "dark");
}

for (let theme of ["dark", "light", "auto"]) {
  let btn = document.getElementById(`theme-${theme}`);
  btn?.addEventListener("click", () => {
    setTheme(theme);
    document
      .querySelectorAll("#theme-btn-group input")
      .forEach((b) => ((b as HTMLInputElement).checked = false));
    (btn as HTMLInputElement).checked = true;
  });
}

let theme = localStorage.getItem("theme") ?? "auto";
setTheme(theme);
(document.getElementById(`theme-${theme}`) as HTMLInputElement).checked = true;
