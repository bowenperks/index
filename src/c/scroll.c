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

static void prv_keep_context(Layer *layer, GContext *ctx) {
  s_ctx = ctx;
  s_renders++;
}

// Called after the first frame, which is when Poco sets its stub.
void hookRender(void) {
  Window *window = window_stack_get_top_window();
  if (window) layer_set_update_proc(window_get_root_layer(window), prv_keep_context);
}

int32_t renderCount(void) {
  return s_renders;
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

// Returns 0 when the icon could not be drawn (no context yet, or no memory for it).
int32_t stretchIcon(int32_t id, int32_t x, int32_t y, int32_t height, int32_t natural) {
  if (!s_ctx || natural <= 0) return 0;
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
  for (int i = 0; i < STRETCH_SLOTS; i++) prv_stretch_free(&s_stretch[i]);
  s_stretch_next = 0;
}
