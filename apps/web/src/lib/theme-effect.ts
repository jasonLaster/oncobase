export function themeEffect() {
  const preference = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (preference === "dark" || (preference === null && prefersDark)) {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
    return "dark";
  } else {
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "light";
    return "light";
  }
}
