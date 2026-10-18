// The demo's prompts: an exact spoken phrase (any case and spacing, with optional closing
// punctuation from dictation) picks a hardcoded reply, and for most a widget card.

const SPACE = /\s/;

function matches(text, prompt) {
  if (!text) return false;
  let at = 0;
  while (at < text.length && SPACE.test(text[at])) at++;
  for (const expected of prompt) {
    if (expected === " ") {
      if (!SPACE.test(text[at] ?? "")) return false;
      while (at < text.length && SPACE.test(text[at])) at++;
    } else {
      if ((text[at] ?? "").toLowerCase() !== expected) return false;
      at++;
    }
  }
  // Dictation can append sentence punctuation. Do not accept extra words, partial
  // matches, or phrases embedded in unrelated requests.
  while (at < text.length && SPACE.test(text[at])) at++;
  while (text[at] === "." || text[at] === "!" || text[at] === "?") at++;
  while (at < text.length && SPACE.test(text[at])) at++;
  return at === text.length;
}

// Each widget's spoken phrase and its reply text (the card's text, and its fallback).
const WIDGET_PROMPTS = [
  ["weather", "weather", "It's 14° and overcast in London."],
  ["alarm", "alarm", "Alarm set for today at 12:00 PM"],
  ["beeper", "beeper", "Sending msg via Beeper"],
  ["timer", "timer", "Timer set for 10 minutes"],
  ["reminder", "reminder", "Reminder set for today at 5:00 PM"],
  ["note", "new note", "New note created"],
  ["tool", "use a tool", "Using tool via MCP"],
];

export function widgetFor(transcription) {
  for (const [widget, phrase] of WIDGET_PROMPTS) {
    if (matches(transcription, phrase)) return widget;
  }
  return undefined;
}

export function replyFor(transcription) {
  for (const [, phrase, reply] of WIDGET_PROMPTS) {
    if (matches(transcription, phrase)) return reply;
  }
  if (matches(transcription, "add to note")) return "noted";
  return "INDEX UI demo. prompts include: new note, add to note, reminder, alarm, timer, beeper, use a tool, weather";
}
