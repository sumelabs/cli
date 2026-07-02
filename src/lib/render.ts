import { emitHuman, outputJson } from "./output.js";
import { formatFields } from "./ui.js";

type HumanLine = string | [string, unknown];

export function renderResult(
  value: unknown,
  options: {
    json: boolean;
    human?: HumanLine[];
    transform?: unknown;
  },
) {
  if (options.json) {
    outputJson(options.transform ?? value);
    return;
  }

  if (options.human) {
    emitHuman(formatHuman(options.human));
    return;
  }

  emitHuman([JSON.stringify(value)]);
}

function formatHuman(lines: HumanLine[]) {
  const formatted: string[] = [];
  let fields: Array<[string, unknown]> = [];

  const flushFields = () => {
    if (!fields.length) return;
    formatted.push(...formatFields(fields));
    fields = [];
  };

  for (const line of lines) {
    if (Array.isArray(line)) {
      fields.push(line);
    } else {
      flushFields();
      formatted.push(line);
    }
  }
  flushFields();
  return formatted;
}
