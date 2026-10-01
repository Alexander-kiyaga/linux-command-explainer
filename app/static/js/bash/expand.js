import { utf8Length } from "../simulation/model.js";
import { bashError } from "./errors.js";
import { BASH_LIMITS } from "./limits.js";

export function expandWord(word, variables, session, lastStatus) {
  let value = "";
  for (const part of word.parts) {
    if (part.kind === "text") value += part.value;
    else if (part.kind === "status") value += String(lastStatus);
    else if (part.value === "HOME") value += session.home;
    else if (part.value === "PWD") value += session.cwd;
    else if (variables.has(part.value)) value += variables.get(part.value);
    else bashError("runtime", `undefined variable $${part.value}`, word);
    if (utf8Length(value) > BASH_LIMITS.expandedWordBytes) bashError("budget", "expanded word exceeds 2 KiB", word);
  }
  return {
    kind: "word", value,
    homeExpansion: word.parts[0]?.kind === "text" && word.parts[0].quote === null && word.parts[0].value.startsWith("~"),
  };
}
