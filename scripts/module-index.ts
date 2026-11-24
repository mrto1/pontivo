import { writeFileSync } from "node:fs";
import { moduleIndex } from "../src/docs/module-index";

writeFileSync("docs/MODULES.md", moduleIndex());
console.log("docs/MODULES.md geschrieben");
