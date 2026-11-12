// The demo's content: the history the page opens on, the ten demo requests the playtest
// asks in turn, and how a transcribed request picks its hardcoded result (a widget card
// and its text). Nothing is really sent, set or switched.

// What Index has done before, oldest first, as the phone's Index feed lists it: a day
// label (["Today"]), or a result's widget and text (["", "home", "Turned the fan off"]).
// Made on request so it is not kept after use. The demo opens on a blank page: none.
export const history = () => [];

// The demo reel's requests, in order: [question, widget, result] and, for an action Index
// asks about before taking it (confirm.js), [its question, what it says to a No].
export const DEMO = [
  ["Unlock the front door.", "home", "Unlocked the front door",
   ["Unlock the front door?", "The front door stays locked"]],
  ["Tell Sam I'm running late.", "beeper", "Sent 'running late' to Sam",
   ["Send 'running late' to Sam?", "Message to Sam not sent"]],
  ["Send a message to my wife. Roz just said there's a bike in the distance.", "beeper",
   "Sent 'Roz just said there's a bike in the distance' to your wife",
   ["Send 'Roz just said there's a bike in the distance' to your wife?", "Message to your wife not sent"]],
  ["Remind me tomorrow at 4 pm to adjust the bike brakes.", "reminder", "Reminder set for 4pm tomorrow"],
  ["Turn the living room lights off.", "home", "Turned lights off"],
  ["What do I have to do today?", "today", "3 to-dos and 2 events today"],
  ["Does the GDPR say you have to delete every possible piece of personally identifiable information?",
   "web", "No, you do not have to delete everything. Under GDPR Article 17, the right to erasure " +
   "does not apply when retaining data is necessary to comply with a legal obligation, such as " +
   "statutory tax and accounting retention laws."],
  ["Where is Elizabeth?", "map", "Elizabeth is near 10 Berners St, London"],
  ["What's the weather this afternoon?", "weather", "It's 14° and overcast in London."],
  ["What's the Spanish word for afternoon?", "translate", "Afternoon in Spanish is la tarde."],
];

// @strip dictation
// Words that pick a demo result from a request said differently (the voice build).
const KEYWORDS = [["unlock", 0], ["running late", 1], ["message", 2], ["remind", 3], ["light", 4],
                  ["today", 5], ["gdpr", 6], ["where", 7], ["weather", 8], ["spanish", 9]];

// A message's recipient and words. Compiled once: a regular expression made per request
// needs a fresh chunk of memory, and failing to get one reads as a syntax error.
const MESSAGE = /message to (my )?(\w+)[.,:!]*\s+(.+?)[.!?]*$/i;

// The result for a transcribed request: {widget, text, confirm}. A message names its own
// recipient and words, and is asked about before it goes; anything unrecognised gets a
// plain text reply listing what to try.
export const resolve = question => {
  const spoken = (question ?? "").toLowerCase();
  const message = MESSAGE.exec(question ?? "");
  const exact = DEMO.find(([asked]) => asked.toLowerCase() === spoken.trim());
  if (!exact && message) {
    const to = `${message[1] ? "your " : ""}${message[2]}`;
    return {widget: "beeper", text: `Sent '${message[3]}' to ${to}`,
            confirm: [`Send '${message[3]}' to ${to}?`, `Message to ${to} not sent`]};
  }
  const found = exact ?? DEMO[KEYWORDS.find(([word]) => spoken.includes(word))?.[1]];
  if (found) return {widget: found[1], text: found[2], confirm: found[3]};
  return {text: "Try asking me to send a message, set a reminder or turn off the lights, " +
                "what's on today, where Elizabeth is, the weather, or a Spanish word."};
};
// @endstrip
