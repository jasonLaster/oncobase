// Vite's `?inline` CSS imports resolve to the processed stylesheet text.
declare module "*.css?inline" {
  const css: string;
  export default css;
}
