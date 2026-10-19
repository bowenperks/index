#include <pebble.h>
#include <string.h>

// Alloy draws straight into the app's frame buffer through the graphics context the
// firmware hands a layer's update proc: Poco keeps that context from the root layer's
// first render and leaves the layer's update proc a stub. Index takes that stub over,
// once Poco has set it, to keep the context too. Scrolling can then move the rows
// already on the screen instead of drawing every card again (see chat.js).
static GContext *s_ctx;

static void prv_keep_context(Layer *layer, GContext *ctx) {
  s_ctx = ctx;
}

// Called after the first frame, which is when Poco sets its stub.
void hookRender(void) {
  Window *window = window_stack_get_top_window();
  if (window) layer_set_update_proc(window_get_root_layer(window), prv_keep_context);
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
