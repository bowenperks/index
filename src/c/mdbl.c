#include <pebble.h>

// Index runs entirely in JavaScript (src/embeddedjs). This entry point only starts the
// Moddable machine, with the FFI table so the script can read the watch's text size.
int main(void) {
  Window *window = window_create();
  window_stack_push(window, true);
  moddable_createMachine(&(ModdableCreationRecord){
    .recordSize = sizeof(ModdableCreationRecord),
#ifdef PBL_DEBUG
    .flags = kModdableCreationFlagDebug,
#endif
    .fxBuildFFI = fxBuildFFI,
  });
  window_destroy(window);
  return 0;
}
