#include <pebble.h>

// The watch's text size setting (Settings > Notifications > Text Size), which Alloy does
// not expose. Emery reports it as 1 medium, 2 large (its default) or 3 extra large, never 0
// small. Index sizes its type from it, as Pebble's own apps do.
int32_t contentSize(void) {
  return preferred_content_size();
}
