// The "weather" prompt's card body, in the Weather app's report style: the location on top,
// Pebble's weather icon on its coloured disc with the condition, temperature and high / low
// stacked beside it, and the report's forecast sentence beneath. The demo's data is
// hardcoded: the address is 10 Berners Street, London.
import Poco from "commodetto/Poco";
import {WEATHER_DISC, WEATHER_ICON} from "assets";
import {render, ink, font, drawText, textWidth, drawWrapped, art} from "theme";

export const DEMO = {
  location: "Fitzrovia, London",
  condition: "Overcast",
  // What the Weather app's report builds for these readings: rain 20%, wind W at 12mph.
  forecast: "Chance of rain. Winds W at 12mph. Precipitation 20%.",
  temperature: "14°",
  range: "16° / 9°",
};

// Bearings come from the PBFs: where each font's cap ink starts inside its text box, so
// rows align on ink. The body fills a widget card's 154px body with a two-line forecast.
const PADDING_X = 10, PADDING_Y = 10, ICON = 50, DISC = 70;
const LOCATION_CAP_TOP = 10, LOCATION_CAP = 18, CONDITION_CAP_TOP = 7, CONDITION_CAP = 11;
const FORECAST_CAP_TOP = 5, RANGE_CAP_TOP = 7, RANGE_CAP = 11;
const TEMPERATURE_CAP_TOP = 11, TEMPERATURE_CAP = 25;
const CONDITION_GAP = 7, RANGE_GAP = 7, LOCATION_GAP = 10, DISC_GAP = 10;

// Draws the content of a framed card whose body starts at `body` ({x, y, w}). Shade is the
// reveal's opacity (255 = fully shown); the disc and icon appear once it is fully shown.
export function drawWeather(card, body, shade) {
  const left = body.x + PADDING_X, top = body.y + PADDING_Y;
  const width = body.w - 2 * PADDING_X;
  const discTop = top + LOCATION_CAP + LOCATION_GAP;
  if (shade === 255) {
    // Looked up per draw: Alloy caches a resource object only while something holds it, so
    // keeping these would hold the 50px bitmap in the heap after the card scrolls away.
    const disc = art(WEATHER_DISC);
    const icon = new Poco.PebbleBitmap(WEATHER_ICON);
    const cx = left + DISC / 2, cy = discTop + DISC / 2;
    render.drawDCI(disc, cx - DISC / 2, cy - DISC / 2);
    render.drawBitmap(icon, cx - ICON / 2, cy - ICON / 2);
  }
  // The condition, temperature and high / low, right-aligned, centred as a group on the disc.
  const conditionTop = discTop + Math.trunc((DISC - (CONDITION_CAP + CONDITION_GAP + TEMPERATURE_CAP +
                                                     RANGE_GAP + RANGE_CAP)) / 2);
  const temperatureTop = conditionTop + CONDITION_CAP + CONDITION_GAP;
  const rangeTop = temperatureTop + TEMPERATURE_CAP + RANGE_GAP;
  const forecastTop = discTop + DISC + DISC_GAP;
  const color = ink(shade);
  const right = left + width;
  const alignRight = (text, f, boxTop) => drawText(text, f, color, right - textWidth(text, f), boxTop);
  drawText(card.location, font("Gothic-Bold", 28), color, left, top - LOCATION_CAP_TOP);
  alignRight(card.condition, font("Gothic-Regular", 18), conditionTop - CONDITION_CAP_TOP);
  alignRight(card.temperature, font("Leco-Bold", 36), temperatureTop - TEMPERATURE_CAP_TOP);
  alignRight(card.range, font("Gothic-Bold", 18), rangeTop - RANGE_CAP_TOP);
  drawWrapped(card.forecast, font("Gothic-Bold", 14), color, left, forecastTop - FORECAST_CAP_TOP, width);
}
