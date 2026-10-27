// The demo's content: the history the page opens on, the eight demo requests the playtest
// asks in turn, and how a transcribed request picks its hardcoded result (a widget card
// and its text). Nothing is really sent, set or switched.

// What Index has done before, oldest first, as the phone's Index feed lists it: a day
// label (["Today"]), or a result's widget and text (["", "home", "Turned the fan off"]).
// Made on request so it is not kept after use. The demo opens on a blank page: none.
export const history = () => [];

// The demo reel's requests, in order: [question, widget, result].
export const DEMO = [
  ["Send a message to my wife. Roz just said there's a bike in the distance.", "beeper",
   "Sent 'Roz just said there's a bike in the distance' to your wife"],
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
const KEYWORDS = [["message", 0], ["remind", 1], ["light", 2], ["today", 3], ["gdpr", 4],
                  ["where", 5], ["weather", 6], ["spanish", 7]];

// A message's recipient and words. Compiled once: a regular expression made per request
// needs a fresh chunk of memory, and failing to get one reads as a syntax error.
const MESSAGE = /message to (my )?(\w+)[.,:!]*\s+(.+?)[.!?]*$/i;

// The result for a transcribed request: {widget, text}. A message names its own recipient
// and words; anything unrecognised gets a plain text reply listing what to try.
export const resolve = question => {
  const spoken = (question ?? "").toLowerCase();
  const message = MESSAGE.exec(question ?? "");
  const exact = DEMO.find(([asked]) => asked.toLowerCase() === spoken.trim());
  if (!exact && message) {
    return {widget: "beeper", text: `Sent '${message[3]}' to ${message[1] ? "your " : ""}${message[2]}`};
  }
  const found = exact ?? DEMO[KEYWORDS.find(([word]) => spoken.includes(word))?.[1]];
  if (found) return {widget: found[1], text: found[2]};
  return {text: "Try asking me to send a message, set a reminder or turn off the lights, " +
                "what's on today, where Elizabeth is, the weather, or a Spanish word."};
};
// @endstrip
