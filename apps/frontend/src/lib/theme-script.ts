// Plain module (no "use client") so the server-rendered root layout receives the script as a string.

export const THEME_STORAGE_KEY = "linkroom-theme";

// Runs in <head> before first paint: saved choice wins, otherwise follow the OS.
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.classList.toggle("dark",t==="dark")}catch(e){}})()`;
