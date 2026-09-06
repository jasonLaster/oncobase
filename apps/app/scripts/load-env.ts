import path from "node:path";
import dotenv from "dotenv";

const root = path.join(import.meta.dir, "..");

dotenv.config({
  path: path.join(root, ".env.local"),
  override: false,
  quiet: true,
});
dotenv.config({ path: path.join(root, ".env"), override: false, quiet: true });
