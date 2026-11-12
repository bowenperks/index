// The "weather" prompt's card body, in the Weather app's report style: the location on top,
// Pebble's weather icon on its coloured disc with the condition, temperature and high / low
// stacked beside it, and the report's forecast sentence beneath. The demo's data is
// hardcoded: the address is 10 Berners Street, London.
import {WEATHER_DISC, WEATHER_ICON} from "assets";
import {render, ink, font, drawText, textWidth, wrap, art, inBand} from "theme";

export const DEMO = {
  location: "Fitzrovia, London",
  condition: "Overcast",
  // What the Weather app's report builds for these readings: rain 20%, wind W at 12mph.
  forecast: "Chance of rain. Winds W at 12mph. Precipitation 20%.",
  temperature: "14°",
  range: "16° / 9°",
};

// Bearings come from the PBFs: where each font's cap ink starts inside its text box, so
// rows align on ink. The forecast is set in Gothic 18, Emery's caption at its default text
// size; its descenders reach FORECAST_DESCENDER rows below the baseline.
const PADDING_X = 10, PADDING_Y = 10, ICON = 50, DISC = 70;
const LOCATION_CAP_TOP = 10, LOCATION_CAP = 18, CONDITION_CAP_TOP = 7, CONDITION_CAP = 11;
const FORECAST_CAP_TOP = 7, FORECAST_CAP = 11, FORECAST_DESCENDER = 3, RANGE_CAP_TOP = 7, RANGE_CAP = 11;
const TEMPERATURE_CAP_TOP = 11, TEMPERATURE_CAP = 25;
const CONDITION_GAP = 7, RANGE_GAP = 7, LOCATION_GAP = 10, DISC_GAP = 10;

// Draws the content of a framed card whose body starts at `body` ({x, y, w}). Shade is the
// reveal's opacity (255 = fully shown); the disc and icon appear once it is fully shown.
export const drawWeather = (card, body, shade) => {
  const left = body.x + PADDING_X, top = body.y + PADDING_Y;
  const width = body.w - 2 * PADDING_X;
  const discTop = top + LOCATION_CAP + LOCATION_GAP;
  if (shade === 255 && inBand(discTop, discTop + DISC)) {
    const cx = left + DISC / 2, cy = discTop + DISC / 2;
    render.drawDCI(art(WEATHER_DISC), cx - DISC / 2, cy - DISC / 2);
    // The 50px bitmap is loaded for this one draw and freed straight after, natively
    // (scroll.c): one of Alloy's own bitmaps would stay in the heap for good once drawn.
    Natives.bitmapDraw(WEATHER_ICON, cx - ICON / 2, cy - ICON / 2);
  }
  // The condition, temperature and high / low, right-aligned, centred as a group on the disc.
  const conditionTop = discTop + ((DISC - (CONDITION_CAP + CONDITION_GAP + TEMPERATURE_CAP +
                                           RANGE_GAP + RANGE_CAP)) / 2 | 0);
  const temperatureTop = conditionTop + CONDITION_CAP + CONDITION_GAP;
  const rangeTop = temperatureTop + TEMPERATURE_CAP + RANGE_GAP;
  const forecastTop = discTop + DISC + DISC_GAP;
  const color = ink(shade);
  const right = left + width;
  // The right-aligned readings' widths, measured once: the demo's readings are fixed.
  const widths = card.widths ??= [textWidth(card.condition, font("Gothic-Regular", 18)),
                                  textWidth(card.temperature, font("Leco-Bold", 36)),
                                  textWidth(card.range, font("Gothic-Bold", 18))];
  drawText(card.location, font("Gothic-Bold", 28), color, left, top - LOCATION_CAP_TOP);
  drawText(card.condition, font("Gothic-Regular", 18), color, right - widths[0],
           conditionTop - CONDITION_CAP_TOP);
  drawText(card.temperature, font("Leco-Bold", 36), color, right - widths[1],
           temperatureTop - TEMPERATURE_CAP_TOP);
  drawText(card.range, font("Gothic-Bold", 18), color, right - widths[2], rangeTop - RANGE_CAP_TOP);
  const forecastFont = font("Gothic-Regular", 18), lineHeight = forecastFont.height;
  const lines = forecastLines(card, width);
  for (let index = 0; index < lines.length; index++) {
    drawText(lines[index], forecastFont, color, left, forecastTop - FORECAST_CAP_TOP + index * lineHeight);
  }
};

// The forecast is fixed, so it is wrapped once and kept with the card: wrapping it again
// every frame would be garbage, and collections stall motion on the watch.
const forecastLines = (card, width) => card.forecastLines ??= wrap(card.forecast, font("Gothic-Regular", 18), width);

// The body's height in a card `w` wide: down to the forecast's last baseline, its
// descenders, then PADDING_Y.
export const weatherHeight = (card, w) => {
  const lines = forecastLines(card, w - 2 * PADDING_X);
  return PADDING_Y + LOCATION_CAP + LOCATION_GAP + DISC + DISC_GAP + (lines.length - 1) * font("Gothic-Regular", 18).height +
         FORECAST_CAP + FORECAST_DESCENDER + PADDING_Y;
};
