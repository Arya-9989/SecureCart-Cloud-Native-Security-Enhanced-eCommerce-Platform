// Applies the saved/system colour scheme before first paint (external file so the CSP
// can forbid inline scripts).
(function () {
  try {
    var saved = localStorage.getItem("securecart-theme");
    var dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {
    /* storage unavailable: fall back to light */
  }
})();
