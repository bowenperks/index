// One native timer drives every app timer. Registering native timers from their own
// callbacks can leave expired evented timers queued in Alloy's Pebble host.
import Time from "time";

const TICK_MS = 33;
const jobs = [];
let nextId = 1;
let nativeTimer;

function add(callback, delay, repeating, args) {
  if (typeof callback !== "function") throw new TypeError("Timer callback must be a function");
  delay = Math.max(0, Math.min(0x7fffffff, Math.trunc(Number(delay) || 0)));
  const interval = repeating ? Math.max(TICK_MS, delay) : 0;
  const id = nextId++;
  jobs.push({id, callback, args, interval, due: (Time.ticks + (interval || delay)) >>> 0});
  return id;
}

export function setTimeout(callback, delay = 0, ...args) {
  return add(callback, delay, false, args);
}

export function setInterval(callback, delay = 0, ...args) {
  return add(callback, delay, true, args);
}

export function clearTimeout(id) {
  const index = jobs.findIndex(job => job.id === id);
  if (index >= 0) jobs.splice(index, 1);
}

export function clearInterval(id) {
  clearTimeout(id);
}

function pump() {
  if (!jobs.length) return;
  const now = Time.ticks >>> 0;
  // A snapshot defers newly scheduled jobs until the next tick. A callback may also
  // cancel another ready job, so check that it is still registered before running it.
  // The snapshot is only made when a job is due: this runs 30 times a second, and
  // garbage made here forces collections that stall scrolling on the watch.
  let ready;
  for (let index = 0; index < jobs.length; index++) {
    if (((now - jobs[index].due) | 0) >= 0) (ready ??= []).push(jobs[index]);
  }
  if (!ready) return;
  for (const job of ready) {
    if (jobs.indexOf(job) < 0) continue;
    if (job.interval) {
      // Keep the interval's phase, but skip missed ticks instead of replaying a burst.
      const elapsed = (now - job.due) | 0;
      job.due = (job.due + (Math.floor(elapsed / job.interval) + 1) * job.interval) >>> 0;
    } else {
      clearTimeout(job.id);
    }
    job.callback(...job.args);
  }
}

// Start after the app has finished constructing its page and registering initial jobs.
// Keep this one timer alive even while idle; callbacks never add or remove native timers.
export function startTimers() {
  if (nativeTimer !== undefined) return;
  nativeTimer = globalThis.setInterval(pump, TICK_MS);
}
