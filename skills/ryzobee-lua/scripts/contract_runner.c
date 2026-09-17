/* Host contract runner. Production VM/facades + the repository's exact
 * peripheral fixture. No ESP Adapter, serial API, socket, or device is linked.
 * The renamed test entrypoint is never called. It keeps the fixture's own
 * helpers intact without copying its private protocol into a second model. */
#define main ryz_repository_peripheral_tests_not_executed
/* C gives main an implicit return 0; that exception ends after renaming.
 * The unused repository test entrypoint is intentionally never executed. */
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wreturn-type"
#include "tests/lua_peripherals_test.c"
#pragma GCC diagnostic pop
#undef main
#include <errno.h>
#include <inttypes.h>
#include <sys/stat.h>

static bool unavailable, imu_owned;
static unsigned peripheral_calls[RYZ_PERIPHERAL_KIND_COUNT][10];
static unsigned peripheral_results[10], hardware_calls[13], tool_calls[13];
static unsigned opened, closed, cleanups, imu_reads, imu_cleaned;
static uint8_t uart_tx_prefix[256];
static size_t uart_tx_length;
static bool uart_tx_overflow;
static unsigned draw_calls, show_calls, mount_calls, update_calls, ui_closes;
static uint32_t tool_id;
static ryz_i2c_scan_snapshot_t tool_i2c;
static ryz_rgb_snapshot_t tool_rgb;
static ryz_monitor_snapshot_t tool_monitor;

static ryz_peripheral_result_t counted_peripheral(void *ctx,
    const ryz_peripheral_request_t *r, ryz_peripheral_reply_t *out)
{
    assert((unsigned)r->kind < RYZ_PERIPHERAL_KIND_COUNT && (unsigned)r->op < 10);
    ++peripheral_calls[r->kind][r->op];
    memset(out, 0, sizeof(*out));
    ryz_peripheral_result_t result = unavailable ? RYZ_PERIPHERAL_UNAVAILABLE : virtual_call(ctx,r,out);
    assert((unsigned)result < 10);
    ++peripheral_results[result];
    if (result == RYZ_PERIPHERAL_OK && r->op == RYZ_PERIPHERAL_OPEN) ++opened;
    if (result == RYZ_PERIPHERAL_OK && r->op == RYZ_PERIPHERAL_CLOSE) ++closed;
    /* Only bytes actually accepted by the typed UART callback are TX evidence.
     * Request suffixes rejected by partial writes must not enter the trace. */
    if (result == RYZ_PERIPHERAL_OK && r->kind == RYZ_PERIPHERAL_UART &&
        r->op == RYZ_PERIPHERAL_WRITE) {
        assert(out->length <= r->length);
        size_t room = sizeof(uart_tx_prefix) - uart_tx_length;
        size_t accepted = out->length < room ? out->length : room;
        if (accepted) memcpy(uart_tx_prefix + uart_tx_length, r->data, accepted);
        uart_tx_length += accepted;
        if (out->length > room) uart_tx_overflow = true;
    }
    return result;
}

/* Copy-only deterministic values, based on lua_hardware_test.c and the
 * hardware_script_runner.c typed seam. A true radio value is synthetic input
 * in this executable, never an observation of connectivity. */
static ryz_lua_hardware_result_t counted_hardware(void *ctx,
    ryz_lua_hardware_op_t op, ryz_lua_hardware_value_t *out)
{
    (void)ctx;
    assert((unsigned)op < 13); ++hardware_calls[op];
    memset(out, 0, sizeof(*out));
    if (unavailable) return RYZ_LUA_HW_UNAVAILABLE;
    if (op == RYZ_LUA_IMU_INIT) { imu_owned = true; return RYZ_LUA_HW_OK; }
    if (op == RYZ_LUA_IMU_DEINIT) { imu_owned = false; return RYZ_LUA_HW_OK; }
    if (op == RYZ_LUA_IMU_READ) {
        if (!imu_owned) return RYZ_LUA_HW_NOT_INITIALIZED;
        *out = (ryz_lua_hardware_value_t){.x_mg=123.25f,.y_mg=-456.5f,.z_mg=1000.f,
            .timestamp_us=UINT64_C(5000000000)+clock_ms*1000,.sequence=++imu_reads};
        return RYZ_LUA_HW_OK;
    }
    out->connected = true;
    return RYZ_LUA_HW_OK;
}

/* This is an admission/snapshot fixture like app_tools_test.c, not the native
 * tool worker/state machine. Operations complete synchronously in memory. */
static ryz_tool_call_result_t counted_tool(void *ctx,
    const ryz_tool_request_t *r, ryz_tool_reply_t *out)
{
    (void)ctx;
    assert((unsigned)r->action < 13); ++tool_calls[r->action];
    memset(out, 0, sizeof(*out));
    if (unavailable) return RYZ_TOOL_CALL_UNAVAILABLE;
    out->started = true;
    out->operation_id = ++tool_id;
    out->revision = out->view_generation = 1;
    switch (r->action) {
    case RYZ_TOOL_I2C_CONFIGURE:
        tool_i2c.config = r->config.i2c;
        out->revision = ++tool_i2c.config_revision;
        break;
    case RYZ_TOOL_I2C_START:
        tool_i2c.scan_id = out->operation_id;
        tool_i2c.scan_config = tool_i2c.config;
        tool_i2c.scan_config_revision = tool_i2c.config_revision;
        tool_i2c.phase = RYZ_I2C_SCAN_COMPLETED;
        tool_i2c.completed_addresses = tool_i2c.nack_count = RYZ_I2C_SCAN_ADDRESSES;
        for (unsigned i=RYZ_I2C_SCAN_FIRST;i<=RYZ_I2C_SCAN_LAST;++i)
            tool_i2c.results[i] = RYZ_I2C_SCAN_NACK;
        break;
    case RYZ_TOOL_I2C_STATUS: out->state.i2c = tool_i2c; break;
    case RYZ_TOOL_I2C_CANCEL: tool_i2c.phase = RYZ_I2C_SCAN_CANCELLED; break;
    case RYZ_TOOL_RGB_SET:
        tool_rgb.request_id = tool_rgb.last_completed_id = out->operation_id;
        tool_rgb.phase = RYZ_RGB_COMPLETED;
        tool_rgb.requested = tool_rgb.last_completed_color = r->config.rgb;
        tool_rgb.output_known = true;
        break;
    case RYZ_TOOL_RGB_STATUS: out->state.rgb = tool_rgb; break;
    case RYZ_TOOL_MONITOR_CONFIGURE:
        tool_monitor.config = tool_monitor.requested_config = r->config.monitor;
        out->revision = ++tool_monitor.config_revision;
        break;
    case RYZ_TOOL_MONITOR_START:
        tool_monitor.session_id = tool_monitor.operation_id = out->operation_id;
        tool_monitor.phase = RYZ_MONITOR_RUNNING;
        tool_monitor.capture_config = tool_monitor.config;
        tool_monitor.stream = (ryz_monitor_stream_info_t){.session_id=out->operation_id,
            .config_revision=tool_monitor.config_revision,.view_generation=1,
            .source=tool_monitor.config.source,.accepting=true};
        break;
    case RYZ_TOOL_MONITOR_STATUS: out->state.monitor = tool_monitor; break;
    case RYZ_TOOL_MONITOR_STOP:
        tool_monitor.phase = RYZ_MONITOR_STOPPED;
        tool_monitor.stream.accepting = false;
        break;
    case RYZ_TOOL_MONITOR_PAUSE: tool_monitor.stream.paused = r->paused; break;
    case RYZ_TOOL_MONITOR_CLEAR:
        out->view_generation = ++tool_monitor.stream.view_generation;
        break;
    case RYZ_TOOL_MONITOR_READ:
        out->state.page.stream = tool_monitor.stream;
        if (!out->state.page.stream.session_id) {
            out->state.page.stream.session_id = r->operation_id;
            out->state.page.stream.view_generation = r->view_generation;
        }
        out->state.page.next_sequence = r->after_sequence;
        break;
    }
    return RYZ_TOOL_CALL_OK;
}

/* UI is acknowledged for interface validation only. No hit testing, pixels,
 * layout correctness, input replay, or physical display evidence is claimed. */
static int draw(void *ctx, const ryz_app_display_op_t *op)
{ (void)ctx; (void)op; ++draw_calls; return 0; }
static int show(void *ctx) { (void)ctx; ++show_calls; return 0; }
static int mount(void *ctx, const ryz_ui_scene_t *scene)
{ (void)ctx; (void)scene; ++mount_calls; return 0; }
static int update(void *ctx, const ryz_ui_scene_t *scene)
{ (void)ctx; (void)scene; ++update_calls; return 0; }
static int pump(void *ctx) { (void)ctx; return 0; }
static void ui_close(void *ctx) { (void)ctx; ++ui_closes; }
static void cleanup(void *ctx)
{ (void)ctx; ++cleanups; if (imu_owned) { ++imu_cleaned; imu_owned=false; } }

static void json_text(const char *value)
{
    putchar('"');
    for (const unsigned char *p=(const unsigned char *)value;*p;++p) {
        if (*p == '"' || *p == '\\') { putchar('\\'); putchar(*p); }
        else if (*p < 32 || *p >= 127) printf("\\u%04x",*p);
        else putchar(*p);
    }
    putchar('"');
}
static void counts(const char *const *names, const unsigned *values, size_t n)
{
    putchar('{');
    for (size_t i=0;i<n;++i) {
        if (i) putchar(','); json_text(names[i]); printf(":%u",values[i]);
    }
    putchar('}');
}
static int error_result(const char *message)
{
    fputs("{\"ok\":false,\"phase\":\"harness_input\",\"error\":",stdout);
    json_text(message); puts("}"); return 2;
}
int main(int argc, char **argv)
{
    if (argc != 4) return error_result("usage: contract-runner SOURCE success|unavailable VIRTUAL_MS");
    if (!strcmp(argv[2],"unavailable")) unavailable=true;
    else if (strcmp(argv[2],"success")) return error_result("mode must be success or unavailable");
    char *end=NULL; errno=0; unsigned long budget=strtoul(argv[3],&end,10);
    if (errno || !*argv[3] || *end || budget < 1 || budget > 600000)
        return error_result("virtual deadline must be 1..600000 ms");
    struct stat source_info;
    if (stat(argv[1],&source_info) || !S_ISREG(source_info.st_mode))
        return error_result("source must be a regular file");
    FILE *file=fopen(argv[1],"rb");
    if (!file) return error_result("cannot read source file");
    char source[RYZ_LUA_SOURCE_MAX+1];
    size_t length=fread(source,1,sizeof(source),file);
    bool read_failed=ferror(file); fclose(file);
    if (read_failed) return error_result("source read failed");
    tool_i2c.config = RYZ_I2C_SCAN_DEFAULT_CONFIG; tool_i2c.config_revision=1;
    tool_monitor.config = tool_monitor.capture_config = tool_monitor.requested_config = RYZ_MONITOR_DEFAULT_CONFIG;
    tool_monitor.config_revision=1;
    ryz_app_platform_t platform={.resize=resize,.now_ms=now,.pause_ms=pause_ms,.cancelled=cancel,
        .cleanup=cleanup,.peripheral_call=counted_peripheral,.hardware_call=counted_hardware,
        .tool_call=counted_tool,.display_draw=draw,.display_show=show,.ui_mount=mount,
        .ui_update=update,.ui_pump=pump,.ui_close=ui_close,.seed=1};
    ryz_lua_result_t result;
    ryz_app_execute(source,length,argv[1],(uint32_t)budget,&platform,&result);
    printf("{\"schema\":\"ryz-lua-contract/1\",\"environment\":\"host-virtual-contract-only\",\"mode\":");
    json_text(argv[2]); printf(",\"ok\":%s,\"phase\":",result.ok ? "true" : "false");
    json_text(result.phase); fputs(",\"error\":",stdout); json_text(result.error);
    fputs(",\"output\":",stdout); json_text(result.output);
    printf(",\"output_truncated\":%s,\"elapsed_virtual_ms\":%u,\"peak_lua_bytes\":%zu,\"adapter\":{\"peripherals\":{",
        result.output_truncated ? "true" : "false",result.elapsed_ms,result.peak_bytes);
    const char *kinds[]={"gpio","timer","pwm","i2c","spi","uart","adc","log","led"};
    const char *ops[]={"open","close","read","write","transfer","probe","set_duty","poll","read_mv","status"};
    for (unsigned i=0;i<RYZ_PERIPHERAL_KIND_COUNT;++i) {
        if (i) putchar(','); json_text(kinds[i]); putchar(':'); counts(ops,peripheral_calls[i],10);
    }
    const char *codes[]={"ok","unavailable","invalid","busy","closed","timeout","not_found","no_memory","unsupported","failed"};
    const char *hardware[]={"wifi.is_connected","ble.is_connected","imu.init","imu.read","imu.deinit","hid.is_ready",
        "hid.tap(play_pause)","hid.tap(stop)","hid.tap(next_track)","hid.tap(previous_track)","hid.tap(mute)","hid.tap(volume_up)","hid.tap(volume_down)"};
    const char *tool_names[]={"i2c.configure","i2c.start","i2c.status","i2c.cancel","rgb.set","rgb.status",
        "monitor.configure","monitor.start","monitor.status","monitor.stop","monitor.pause","monitor.clear","monitor.read"};
    fputs("},\"peripheral_results\":",stdout); counts(codes,peripheral_results,10);
    fputs(",\"hardware\":",stdout); counts(hardware,hardware_calls,13);
    fputs(",\"tools\":",stdout); counts(tool_names,tool_calls,13);
    fputs(",\"uart_tx_hex\":\"",stdout);
    for (size_t i=0;i<uart_tx_length;++i) printf("%02x",(unsigned)uart_tx_prefix[i]);
    printf("\",\"uart_tx_overflow\":%s",uart_tx_overflow ? "true" : "false");
    printf(",\"handles_opened\":%u,\"handles_closed\":%u,\"handles_remaining\":%u,\"cleanup_calls\":%u,\"imu_cleaned\":%u,"
        "\"ui\":{\"draw\":%u,\"show\":%u,\"mount\":%u,\"update\":%u,\"close\":%u}}}\n",
        opened,closed,opened-closed,cleanups,imu_cleaned,draw_calls,show_calls,mount_calls,update_calls,ui_closes);
    return result.ok ? 0 : 1;
}
