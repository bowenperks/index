#include <pebble.h>

// The scroll bench's drawing micro-benchmark (INDEX_SCROLLBENCH=1 builds only: tools/build.sh
// copies this into the build). It times the firmware calls a scrolled frame makes, each
// repeated for sub-millisecond resolution, in whatever clip Poco has set, and logs them.
GContext *scroll_context(void);

static GContext *s_ctx;
static GDrawCommandImage *s_rest, *s_work, *s_map, *s_pen;
static GFont s_face;
static uint32_t s_icon;

static int32_t prv_now(void) {
  time_t seconds;
  uint16_t ms;
  time_ms(&seconds, &ms);
  return (int32_t)(seconds % 100000) * 1000 + ms;
}

static void prv_points(int32_t height) {
  const int32_t to = height * 256 / 36;
  GDrawCommandList *rest = gdraw_command_image_get_command_list(s_rest);
  GDrawCommandList *work = gdraw_command_image_get_command_list(s_work);
  const uint32_t commands = gdraw_command_list_get_num_commands(rest);
  for (uint32_t c = 0; c < commands; c++) {
    GDrawCommand *from = gdraw_command_list_get_command(rest, c);
    GDrawCommand *into = gdraw_command_list_get_command(work, c);
    const uint16_t points = gdraw_command_get_num_points(from);
    for (uint16_t p = 0; p < points; p++) {
      GPoint point = gdraw_command_get_point(from, p);
      point.y = (int16_t)(((int32_t)point.y * to) / 256);
      gdraw_command_set_point(into, p, point);
    }
  }
}

static void op_fill(void) {
  graphics_context_set_fill_color(s_ctx, GColorWhite);
  graphics_fill_rect(s_ctx, GRect(0, 100, 200, 45), 0, GCornerNone);
}

static void op_frame(void) {
  graphics_context_set_stroke_color(s_ctx, GColorDarkGray);
  graphics_context_set_stroke_width(s_ctx, 1);
  graphics_draw_round_rect(s_ctx, GRect(6, 40, 188, 150), 7);
}

static void op_line(void) {
  graphics_context_set_stroke_color(s_ctx, GColorDarkGray);
  graphics_context_set_stroke_width(s_ctx, 1);
  graphics_draw_line(s_ctx, GPoint(10, 120), GPoint(190, 120));
}

static void op_text(void) {
  graphics_context_set_text_color(s_ctx, GColorBlack);
  graphics_draw_text(s_ctx, "Turned the fan off", s_face, GRect(16, 100, 10000, 127),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
}

static void op_icon(void) {
  gdraw_command_image_draw(s_ctx, s_rest, GPoint(6, 100));
}

static void op_points(void) {
  prv_points(100);
}

static void op_stretched(void) {
  gdraw_command_image_draw(s_ctx, s_work, GPoint(6, 60));
}

static void op_load(void) {
  GDrawCommandImage *image = gdraw_command_image_create_with_resource(s_icon);
  gdraw_command_image_destroy(image);
}

static void op_pen(void) {
  gdraw_command_image_draw(s_ctx, s_pen, GPoint(-16, -16));
}

static void op_circle(void) {
  graphics_context_set_fill_color(s_ctx, GColorCobaltBlue);
  graphics_fill_circle(s_ctx, GPoint(20, 120), 4);
}

static void op_map(void) {
  gdraw_command_image_draw(s_ctx, s_map, GPoint(12, 40));
}

static void prv_time(const char *name, int count, void (*op)(void), const char *tag) {
  const int32_t start = prv_now();
  for (int i = 0; i < count; i++) op();
  const int32_t total = prv_now() - start;
  APP_LOG(APP_LOG_LEVEL_INFO, "op %s%s: %ld us", name, tag, (long)(total * 1000 / count));
}

void benchDraw(int32_t icon, int32_t map, int32_t pen, int32_t clipped) {
  s_ctx = scroll_context();
  if (!s_ctx) return;
  s_icon = icon;
  s_face = fonts_get_system_font(FONT_KEY_GOTHIC_28);
  s_rest = gdraw_command_image_create_with_resource(icon);
  s_work = s_rest ? gdraw_command_image_clone(s_rest) : NULL;
  s_map = gdraw_command_image_create_with_resource(map);
  s_pen = gdraw_command_image_create_with_resource(pen);
  if (s_rest && s_work && s_map && s_pen) {
    const char *tag = clipped ? " (40x100 clip)" : "";
    prv_points(100);
    prv_time("fill 200x45", 100, op_fill, tag);
    prv_time("frame 188x150", 30, op_frame, tag);
    prv_time("line 180", 100, op_line, tag);
    prv_time("text 28", 30, op_text, tag);
    prv_time("icon 36", 30, op_icon, tag);
    prv_time("icon 100 tall", 30, op_stretched, tag);
    prv_time("map", 10, op_map, tag);
    prv_time("pen", 50, op_pen, tag);
    prv_time("circle 4", 50, op_circle, tag);
    // The same without antialiasing (the context's default is on).
    graphics_context_set_antialiased(s_ctx, false);
    prv_time("no-AA frame 188x150", 30, op_frame, tag);
    prv_time("no-AA icon 36", 30, op_icon, tag);
    prv_time("no-AA icon 100 tall", 30, op_stretched, tag);
    graphics_context_set_antialiased(s_ctx, true);
    if (!clipped) {
      prv_time("stretch points", 100, op_points, tag);
      prv_time("load icon", 20, op_load, tag);
    }
  }
  if (s_rest) gdraw_command_image_destroy(s_rest);
  if (s_work) gdraw_command_image_destroy(s_work);
  if (s_map) gdraw_command_image_destroy(s_map);
  if (s_pen) gdraw_command_image_destroy(s_pen);
}
