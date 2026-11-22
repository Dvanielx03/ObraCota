import { DEFAULT_THEME, THEME_STORAGE_KEY } from "./theme";

/**
 * Inline script for <head>: sets <html data-theme> from storage before the first paint,
 * so a stored dark mode never flashes light. Storage may be blocked; then the system decides.
 */
export const themeScript = "(function(){var d=document.documentElement,m=" + JSON.stringify(DEFAULT_THEME) + ";" +
  "try{var v=localStorage.getItem(" + JSON.stringify(THEME_STORAGE_KEY) + ");" +
  "if(v===\"light\"||v===\"dark\"||v===\"system\")m=v;}catch(e){}d.dataset.theme=m;})();";
