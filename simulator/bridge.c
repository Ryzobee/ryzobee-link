#include <emscripten.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include "app_runtime.h"
#include "display.h"
#include "ryz_lvgl.h"
#include "ryz_font.h"

static bool stop_requested;
static ryz_app_pointer_t pointers[64];
static unsigned read_at, write_at;
static ryz_app_pointer_t last_pointer;
static double last_yield;
void link_display_flush(void);
EM_JS(void, publish_log, (const char *text, unsigned length), {
  if (Module.onLog) Module.onLog(UTF8ToString(text, length));
});
EM_JS(void, publish_result, (int ok, const char *phase, const char *error), {
  if (Module.onResult) Module.onResult({ok: !!ok, phase: UTF8ToString(phase), error: UTF8ToString(error)});
});
static void *resize(void *p, size_t size) { if (!size) { free(p); return NULL; } return realloc(p, size); }
static uint64_t now_ms(void *context) { return (uint64_t)emscripten_get_now(); }
static bool cancelled(void *context) { return stop_requested; }
static void pause_ms(void *context, unsigned ms)
{
  /* The production instruction hook calls pause_ms(0) every 10k instructions.
   * Throttle hook suspension, but always release the Worker within 8 ms. */
  if (ms || emscripten_get_now() - last_yield >= 8) {
    last_yield = emscripten_get_now();
    emscripten_sleep(ms ? ms : 0);
  }
}
EMSCRIPTEN_KEEPALIVE void link_stop(void) { stop_requested = true; }
EMSCRIPTEN_KEEPALIVE void link_pointer(int x, int y, int pressed)
{
  if (x < 0 || x > 239 || y < 0 || y > 239) {
    memset(&last_pointer, 0, sizeof(last_pointer));
    read_at = write_at;
    pointers[write_at++ % 64] = (ryz_app_pointer_t){
      .phase=RYZ_APP_POINTER_NONE, .interrupted=true,
      .sampled_ms=(uint32_t)emscripten_get_now(),
    };
    return;
  }
  ryz_app_pointer_t next = {.x=x, .y=y, .has_position=true,
    .pressed=pressed != 0, .sampled_ms=(uint32_t)emscripten_get_now()};
  next.phase = pressed ? (last_pointer.pressed ? RYZ_APP_POINTER_MOVE : RYZ_APP_POINTER_DOWN) : RYZ_APP_POINTER_UP;
  last_pointer = next;
  if (write_at != read_at && next.phase == RYZ_APP_POINTER_MOVE &&
      pointers[(write_at - 1) % 64].phase == RYZ_APP_POINTER_MOVE) {
    pointers[(write_at - 1) % 64] = next; return;
  }
  if (write_at - read_at >= 64) {
    read_at = write_at;
    pointers[write_at++ % 64] = (ryz_app_pointer_t){
      .phase=RYZ_APP_POINTER_NONE, .interrupted=true,
      .sampled_ms=next.sampled_ms,
    };
  }
  pointers[write_at++ % 64] = next;
}
static int pointer_read(void *context, ryz_app_pointer_t *out)
{
  if (read_at != write_at) *out = pointers[read_at++ % 64];
  else { *out = last_pointer; out->phase = RYZ_APP_POINTER_NONE; out->interrupted = false; }
  return ESP_OK;
}
static int mount(void *context, const ryz_ui_scene_t *scene) { return ryz_lvgl_mount_checked(scene, cancelled, NULL); }
static int update(void *context, const ryz_ui_scene_t *scene) { return ryz_lvgl_update_checked(scene, cancelled, NULL); }
static int pump(void *context) { return ryz_lvgl_pump_checked(cancelled, NULL); }
static void close_ui(void *context) { ryz_lvgl_release(); }
static int draw(void *context, const ryz_app_display_op_t *op)
{
  switch (op->kind) {
    case RYZ_APP_DISPLAY_CLEAR: return ryz_display_clear(op->color);
    case RYZ_APP_DISPLAY_RECT: return ryz_display_rect(op->x,op->y,op->width,op->height,op->color);
    case RYZ_APP_DISPLAY_TEXT: return ryz_display_text(op->x,op->y,op->text,strlen(op->text),op->color,op->scale);
    default: return ESP_ERR_NOT_SUPPORTED;
  }
}
static int show(void *context) { return ryz_display_show_checked(cancelled, NULL); }
static void output(void *context, const char *text, size_t length) { publish_log(text, length); }
EMSCRIPTEN_KEEPALIVE int link_run(const char *source, unsigned length)
{
  stop_requested = false; read_at = write_at = 0;
  memset(&last_pointer, 0, sizeof(last_pointer));
  last_yield = emscripten_get_now();
  ryz_font_init();
  const ryz_app_platform_t platform = {
    .resize=resize, .now_ms=now_ms, .pause_ms=pause_ms, .cancelled=cancelled,
    .pointer_read=pointer_read, .ui_mount=mount, .ui_update=update,
    .ui_pump=pump, .ui_close=close_ui, .display_draw=draw, .display_show=show,
    .output=output, .seed=(uint32_t)emscripten_get_now(),
  };
  ryz_lua_result_t result;
  ryz_app_execute(source, length, "@main.lua", 0, &platform, &result);
  link_display_flush();
  publish_result(result.ok, result.phase, result.error);
  return result.ok ? 0 : 1;
}
