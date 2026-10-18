#include <pebble.h>

// The watch's text size setting (Settings > Display > Text Size), which Alloy does not
// expose: 0 small, 1 medium, 2 large, 3 extra large. Index sizes its type from it, as
// Pebble's own apps do.
int32_t contentSize(void) {
  return preferred_content_size();
}
