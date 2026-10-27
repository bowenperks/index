#include <pebble.h>
#include <string.h>

// Alloy draws straight into the app's frame buffer through the graphics context the
// firmware hands a layer's update proc: Poco keeps that context from the root layer's
// first render and leaves the layer's update proc a stub. Index takes that stub over,
// once Poco has set it, to keep the context too. Scrolling can then move the rows
// already on the screen instead of drawing every card again (see chat.js).
static GContext *s_ctx;
// Render passes so far: one per frame the firmware takes from the app (instrumented
// builds compare it with the frames drawn).
static int32_t s_renders;

// Milliseconds on the wall clock (seconds wrap every ~28 hours of uptime: harmless here).
static int32_t prv_now_ms(void) {
  time_t seconds;
  uint16_t ms;
  time_ms(&seconds, &ms);
  return (int32_t)(seconds % 100000) * 1000 + ms;
}

// When the last render pass ran, and the gaps between passes since the last renderLog
// (the first 48 kept, for the bench's log).
static int32_t s_render_at, s_gap_min = 0x7fffffff, s_gap_max, s_gap_sum, s_gap_count;
static bool s_gap_skip;
static uint8_t s_gaps[48];

static void prv_keep_context(Layer *layer, GContext *ctx) {
  s_ctx = ctx;
  s_renders++;
  const int32_t now = prv_now_ms();
  if (s_render_at && !s_gap_skip) {
    const int32_t gap = now - s_render_at;
    if (gap < s_gap_min) s_gap_min = gap;
    if (gap > s_gap_max) s_gap_max = gap;
    if (s_gap_count < (int32_t)sizeof(s_gaps)) s_gaps[s_gap_count] = gap > 255 ? 255 : gap;
    s_gap_sum += gap;
    s_gap_count++;
  }
  s_gap_skip = false;
  s_render_at = now;
}

int32_t renderStamp(void) {
  return s_render_at;
}

int32_t nowMs(void) {
  return prv_now_ms();
}

void renderLog(void) {
  if (s_gap_count) {
    APP_LOG(APP_LOG_LEVEL_INFO, "render passes: %ld, gap min %ld avg %ld max %ld ms", (long)s_gap_count,
            (long)s_gap_min, (long)(s_gap_sum / s_gap_count), (long)s_gap_max);
    char line[200];
    int used = 0;
    const int32_t kept = s_gap_count < (int32_t)sizeof(s_gaps) ? s_gap_count : (int32_t)sizeof(s_gaps);
    for (int32_t i = 0; i < kept && used < (int)sizeof(line) - 5; i++) {
      used += snprintf(line + used, sizeof(line) - used, "%d ", s_gaps[i]);
    }
    APP_LOG(APP_LOG_LEVEL_INFO, "gaps: %s", line);
  }
  s_gap_min = 0x7fffffff;
  s_gap_max = s_gap_sum = s_gap_count = 0;
  // The gap to the next pass spans whatever came before this reading: not counted.
  s_gap_skip = true;
}

// Called after the first frame, which is when Poco sets its stub.
void hookRender(void) {
  Window *window = window_stack_get_top_window();
  if (window) layer_set_update_proc(window_get_root_layer(window), prv_keep_context);
}

int32_t renderCount(void) {
  return s_renders;
}

// The thinking cube's frames are bitmaps (tools/build_cube.py), drawn here with their
// transparency. One is kept loaded at a time and freed when the next replaces it or the
// cube goes: Alloy's own bitmaps (Poco.PebbleBitmap) never free their native memory. A
// frame that cannot be loaded (memory) is skipped. Returns whether it drew.
static GBitmap *s_cube;
static int32_t s_cube_id;

int32_t cubeDraw(int32_t id, int32_t x, int32_t y) {
  if (!s_ctx) return 0;
  if (id != s_cube_id) {
    if (s_cube) gbitmap_destroy(s_cube);
    s_cube = gbitmap_create_with_resource(id);
    s_cube_id = s_cube ? id : 0;
  }
  if (!s_cube) return 0;
  GRect bounds = gbitmap_get_bounds(s_cube);
  graphics_context_set_compositing_mode(s_ctx, GCompOpSet);
  graphics_draw_bitmap_in_rect(s_ctx, s_cube, GRect(x, y, bounds.size.w, bounds.size.h));
  graphics_context_set_compositing_mode(s_ctx, GCompOpAssign);
  return 1;
}

void cubeRelease(void) {
  if (s_cube) gbitmap_destroy(s_cube);
  s_cube = NULL;
  s_cube_id = 0;
}

// For the scroll bench's micro-benchmark (tools/bench.c).
GContext *scroll_context(void) {
  return s_ctx;
}

// Moves the frame buffer's rows from `top` up to `bottom` by `dy`: up for a positive dy
// (the rows from top + dy take the place of those from top) and down for a negative one.
// Returns 0 until the context is known, which is the first render after hooking.
int32_t shiftRows(int32_t top, int32_t bottom, int32_t dy) {
  if (!s_ctx) return 0;
  GBitmap *buffer = graphics_capture_frame_buffer(s_ctx);
  if (!buffer) return 0;
  const GRect bounds = gbitmap_get_bounds(buffer);
  const uint16_t stride = gbitmap_get_bytes_per_row(buffer);
  uint8_t *data = gbitmap_get_data(buffer);
  if (top < bounds.origin.y) top = bounds.origin.y;
  if (bottom > bounds.origin.y + bounds.size.h) bottom = bounds.origin.y + bounds.size.h;
  const int32_t rows = bottom - top - (dy < 0 ? -dy : dy);
  if (rows > 0) {
    if (dy > 0) memmove(data + top * stride, data + (top + dy) * stride, rows * stride);
    else memmove(data + (top - dy) * stride, data + top * stride, rows * stride);
  }
  graphics_release_frame_buffer(s_ctx, buffer);
  return 1;
}

// Native memory taken during an Up / Down step leaves this much of the app's heap free:
// the JavaScript heaps grow into it (by 1 KB at a time), and when they cannot, the app
// aborts. Short of it, the step's icons stand straight, which is safe.
#define HEAP_RESERVE 2560

// A card's icon stretched to `height` rows as the page scrolls on Up and Down. Alloy can
// only stretch a fresh copy of an image, native memory that waits for a garbage
// collection, every icon every frame. Here each icon has one image whose points are set
// each frame from their rest heights, kept alongside: scaled down the page as the
// firmware's gdraw_command_list_scale would (points only, x unchanged), and drawn into
// the current clip. stretchRelease frees them once the page rests.
#define STRETCH_SLOTS 4
typedef struct {
  uint32_t id;
  GDrawCommandImage *work;
  int16_t *rest;
} Stretch;
static Stretch s_stretch[STRETCH_SLOTS];
static uint8_t s_stretch_next;

static void prv_stretch_free(Stretch *slot) {
  if (slot->work) gdraw_command_image_destroy(slot->work);
  free(slot->rest);
  slot->work = NULL;
  slot->rest = NULL;
}

static Stretch *prv_stretch(uint32_t id) {
  for (int i = 0; i < STRETCH_SLOTS; i++) {
    if (s_stretch[i].work && s_stretch[i].id == id) return &s_stretch[i];
  }
  Stretch *slot = &s_stretch[s_stretch_next];
  s_stretch_next = (s_stretch_next + 1) % STRETCH_SLOTS;
  prv_stretch_free(slot);
  if (heap_bytes_free() < HEAP_RESERVE + 512) return NULL;
  slot->id = id;
  slot->work = gdraw_command_image_create_with_resource(id);
  if (!slot->work) return NULL;
  GDrawCommandList *list = gdraw_command_image_get_command_list(slot->work);
  const uint32_t commands = gdraw_command_list_get_num_commands(list);
  uint32_t total = 0;
  for (uint32_t c = 0; c < commands; c++) {
    total += gdraw_command_get_num_points(gdraw_command_list_get_command(list, c));
  }
  slot->rest = malloc(total * sizeof(int16_t) + 1);
  if (!slot->rest) {
    prv_stretch_free(slot);
    return NULL;
  }
  uint32_t k = 0;
  for (uint32_t c = 0; c < commands; c++) {
    GDrawCommand *command = gdraw_command_list_get_command(list, c);
    const uint16_t points = gdraw_command_get_num_points(command);
    for (uint16_t p = 0; p < points; p++) slot->rest[k++] = gdraw_command_get_point(command, p).y;
  }
  return slot;
}

// Cheaper still: as a step starts, each visible icon stands at rest in its cutout, on
// white, so its pixels are copied off the screen (iconCapture) and each frame stretched
// by rows into place, non-white pixels only, in a fraction of what drawing the vector art
// costs (3-5 ms an icon on the watch). The vector path stays for an icon that could not
// be captured: partly off screen, or no memory for it.
#define CAPTURE_WIDTH 40
#define CAPTURE_HEIGHT 36
typedef struct {
  uint32_t id;
  uint8_t *pixels;
} Capture;
static Capture s_capture[STRETCH_SLOTS];
static uint8_t s_capture_next;

static Capture *prv_capture(uint32_t id) {
  for (int i = 0; i < STRETCH_SLOTS; i++) {
    if (s_capture[i].pixels && s_capture[i].id == id) return &s_capture[i];
  }
  return NULL;
}

int32_t iconCapture(int32_t id, int32_t x, int32_t y) {
  if (!s_ctx || prv_capture(id)) return s_ctx && prv_capture(id);
  if (heap_bytes_free() < HEAP_RESERVE + CAPTURE_WIDTH * CAPTURE_HEIGHT) return 0;
  GBitmap *buffer = graphics_capture_frame_buffer(s_ctx);
  if (!buffer) return 0;
  const GRect bounds = gbitmap_get_bounds(buffer);
  const uint16_t stride = gbitmap_get_bytes_per_row(buffer);
  int32_t kept = 0;
  if (x >= 0 && y >= bounds.origin.y && x + CAPTURE_WIDTH <= bounds.size.w &&
      y + CAPTURE_HEIGHT <= bounds.origin.y + bounds.size.h) {
    Capture *slot = &s_capture[s_capture_next];
    s_capture_next = (s_capture_next + 1) % STRETCH_SLOTS;
    free(slot->pixels);
    slot->pixels = malloc(CAPTURE_WIDTH * CAPTURE_HEIGHT);
    if (slot->pixels) {
      const uint8_t *data = gbitmap_get_data(buffer);
      for (int32_t row = 0; row < CAPTURE_HEIGHT; row++) {
        memcpy(slot->pixels + row * CAPTURE_WIDTH, data + (y + row) * stride + x, CAPTURE_WIDTH);
      }
      slot->id = id;
      kept = 1;
    }
  }
  graphics_release_frame_buffer(s_ctx, buffer);
  return kept;
}

// Blits the captured icon `height` rows tall from (x, y), each output row the nearest
// source row, within the rows being painted (the caller's clip: a GContext is opaque to
// an app, so the clip comes with the call), white left alone.
static int32_t prv_blit_capture(Capture *capture, int32_t x, int32_t y, int32_t height,
                                int32_t clipTop, int32_t clipBottom) {
  GBitmap *buffer = graphics_capture_frame_buffer(s_ctx);
  if (!buffer) return 0;
  const GRect bounds = gbitmap_get_bounds(buffer);
  const uint16_t stride = gbitmap_get_bytes_per_row(buffer);
  uint8_t *data = gbitmap_get_data(buffer);
  int32_t top = y, bottom = y + height;
  if (top < clipTop) top = clipTop;
  if (bottom > clipBottom) bottom = clipBottom;
  if (top < bounds.origin.y) top = bounds.origin.y;
  if (bottom > bounds.origin.y + bounds.size.h) bottom = bounds.origin.y + bounds.size.h;
  int32_t left = x, right = x + CAPTURE_WIDTH;
  if (left < 0) left = 0;
  if (right > bounds.size.w) right = bounds.size.w;
  for (int32_t row = top; row < bottom; row++) {
    const int32_t source = (row - y) * CAPTURE_HEIGHT / height;
    const uint8_t *in = capture->pixels + source * CAPTURE_WIDTH + (left - x);
    uint8_t *out = data + row * stride + left;
    for (int32_t i = 0; i < right - left; i++) {
      if (in[i] != 0xFF) out[i] = in[i];
    }
  }
  graphics_release_frame_buffer(s_ctx, buffer);
  return 1;
}

// Returns 0 when the icon could not be drawn (no context yet, or no memory for it).
int32_t stretchIcon(int32_t id, int32_t x, int32_t y, int32_t height, int32_t natural,
                    int32_t clipTop, int32_t clipBottom) {
  if (!s_ctx || natural <= 0) return 0;
  Capture *capture = prv_capture(id);
  if (capture && height > 0 && natural == CAPTURE_HEIGHT) {
    return prv_blit_capture(capture, x, y, height, clipTop, clipBottom);
  }
  Stretch *slot = prv_stretch(id);
  if (!slot) return 0;
  // The scale as Alloy passes it, in 8.8 fixed point.
  const int32_t to = (height < 1 ? 1 : height) * 256 / natural;
  GDrawCommandList *list = gdraw_command_image_get_command_list(slot->work);
  const uint32_t commands = gdraw_command_list_get_num_commands(list);
  uint32_t k = 0;
  for (uint32_t c = 0; c < commands; c++) {
    GDrawCommand *command = gdraw_command_list_get_command(list, c);
    const uint16_t points = gdraw_command_get_num_points(command);
    for (uint16_t p = 0; p < points; p++) {
      GPoint point = gdraw_command_get_point(command, p);
      point.y = (int16_t)(((int32_t)slot->rest[k++] * to) / 256);
      gdraw_command_set_point(command, p, point);
    }
  }
  gdraw_command_image_draw(s_ctx, slot->work, GPoint(x, y));
  return 1;
}

void stretchRelease(void) {
  for (int i = 0; i < STRETCH_SLOTS; i++) {
    prv_stretch_free(&s_stretch[i]);
    free(s_capture[i].pixels);
    s_capture[i].pixels = NULL;
  }
  s_stretch_next = s_capture_next = 0;
}
