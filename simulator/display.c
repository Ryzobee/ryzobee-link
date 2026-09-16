/* Browser panel adapter: the firmware LVGL renderer writes native RGB565.
 * Legacy 5x7 canvas glyphs are the firmware's exact checked-in glyph table. */
#include <emscripten.h>
#include <stdint.h>
#include <string.h>
#include "display.h"
#include "display_font.h"
#include "esp_timer.h"

static uint16_t canvas[240 * 240];
static uint16_t presented[240 * 240];
static bool dirty, has_presented;
EM_JS(void, publish_frame, (const uint16_t *pixels, int force), {
  var now = performance.now();
  if (!force && now - (Module.lastFrameTime || 0) < 16) return;
  Module.lastFrameTime = now;
  var source = HEAPU16.subarray(pixels >>> 1, (pixels >>> 1) + 240 * 240);
  var rgba = new Uint8ClampedArray(240 * 240 * 4);
  for (var i = 0; i < source.length; i++) {
    var p = source[i], at = i * 4;
    var r = p >>> 11, g = (p >>> 5) & 63, b = p & 31;
    rgba[at] = (r << 3) | (r >>> 2);
    rgba[at + 1] = (g << 2) | (g >>> 4);
    rgba[at + 2] = (b << 3) | (b >>> 2);
    rgba[at + 3] = 255;
  }
  if (Module.onFrame) Module.onFrame(rgba);
});
int64_t esp_timer_get_time(void) { return (int64_t)(emscripten_get_now() * 1000.0); }
esp_err_t ryz_display_clear(uint16_t color)
{ for (int i = 0; i < 240 * 240; ++i) canvas[i] = color; dirty = true; return ESP_OK; }
esp_err_t ryz_display_rect(int x, int y, int w, int h, uint16_t color)
{
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x > 240-w || y > 240-h) return ESP_ERR_INVALID_ARG;
  for (int row = y; row < y+h; ++row)
    for (int col = x; col < x+w; ++col) canvas[row * 240 + col] = color;
  dirty = true;
  return ESP_OK;
}
esp_err_t ryz_display_blit_rgb565_native(int x, int y, int w, int h,
    const uint16_t *pixels, size_t count)
{
  if (!pixels || x < 0 || y < 0 || w <= 0 || h <= 0 || x > 240-w || y > 240-h || count != (size_t)w*h)
    return ESP_ERR_INVALID_ARG;
  for (int row = 0; row < h; ++row) memcpy(canvas+(y+row)*240+x, pixels+row*w, w*2);
  dirty = true;
  return ESP_OK;
}
esp_err_t ryz_display_text(int x, int y, const char *text, size_t length, uint16_t color, int scale)
{
  if (!text || !length || length > 40 || scale < 1 || scale > 6) return ESP_ERR_INVALID_ARG;
  int width = ((int)length * 6 - 1) * scale;
  if (x < 0 || y < 0 || x > 240-width || y > 240-7*scale) return ESP_ERR_INVALID_ARG;
  for (size_t i = 0; i < length; ++i) if (!display_glyph(text[i])) return ESP_ERR_NOT_SUPPORTED;
  for (size_t i = 0; i < length; ++i) {
    const uint8_t *rows = display_glyph(text[i]);
    for (int row = 0; row < 7; ++row) for (int col = 0; col < 5; ++col)
      if (rows[row] & (1 << (4-col))) ryz_display_rect(x+((int)i*6+col)*scale, y+row*scale, scale, scale, color);
  }
  return ESP_OK;
}
esp_err_t ryz_display_read_pixel(int x, int y, uint16_t *color)
{
  if (!color || x < 0 || y < 0 || x >= 240 || y >= 240) return ESP_ERR_INVALID_ARG;
  *color = canvas[y*240+x]; return ESP_OK;
}
esp_err_t ryz_display_show_checked_status(bool (*cancelled)(void *), void *context, bool *out)
{
  bool stop = cancelled && cancelled(context);
  if (out) *out = stop;
  if (stop) return ESP_ERR_TIMEOUT;
  if (dirty) {
    memcpy(presented, canvas, sizeof(canvas)); dirty = false; has_presented = true;
    publish_frame(presented, 0);
  }
  return ESP_OK;
}
esp_err_t ryz_display_show_checked(bool (*cancelled)(void *), void *context)
{ return ryz_display_show_checked_status(cancelled, context, NULL); }
esp_err_t ryz_display_show(void) { return ryz_display_show_checked(NULL, NULL); }
void link_display_flush(void) { if (has_presented) publish_frame(presented, 1); }
