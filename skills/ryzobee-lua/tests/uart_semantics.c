/* Read-only source trial, deterministic UART peer through the real App ABI. */
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wreturn-type"
#define main upstream_contract_main
/* The build adds the selected firmware's tests directory to the include path. */
#include "lua_peripherals_test.c"
#undef main
#pragma GCC diagnostic pop

static int scenario;
static unsigned read_calls, delivered, write_calls, sent_bytes;
static unsigned led_count, completed_count;
static unsigned led_colors[16][3], completed_colors[16][3];
static int marked_received = -1;
static int marked_truncated = -1;
static bool failed_read_injected;

static void quoted(const char *value)
{
    putchar('"');
    for (const unsigned char *p = (const unsigned char *)value; *p; ++p) {
        if (*p == '"' || *p == '\\') { putchar('\\'); putchar(*p); }
        else if (*p < 32) printf("\\u%04x", *p);
        else putchar(*p);
    }
    putchar('"');
}

static void mark(void *context, const char *name, const ryz_app_value_t *value)
{
    (void)context;
    if (!strcmp(name, "uart_ping_received") && value->kind == RYZ_APP_VALUE_INTEGER)
        marked_received = value->integer;
    if (!strcmp(name, "uart_ping_truncated") && value->kind == RYZ_APP_VALUE_BOOLEAN)
        marked_truncated = value->boolean ? 1 : 0;
}

static ryz_peripheral_result_t semantic_call(void *context,
    const ryz_peripheral_request_t *request, ryz_peripheral_reply_t *reply)
{
    memset(reply, 0, sizeof(*reply));
    if (scenario == 3 && request->op == RYZ_PERIPHERAL_OPEN)
        return RYZ_PERIPHERAL_UNAVAILABLE;
    if (request->kind == RYZ_PERIPHERAL_UART) {
        if (request->op == RYZ_PERIPHERAL_OPEN) {
            assert(request->config.uart.port == 1 && request->config.uart.tx == 13 &&
                request->config.uart.rx == 14 && request->config.uart.baud == 115200);
        }
        if (request->op == RYZ_PERIPHERAL_WRITE) {
            ++write_calls;
            ryz_peripheral_result_t result = virtual_call(context, request, reply);
            sent_bytes += reply->length;
            return result;
        }
        if (request->op == RYZ_PERIPHERAL_READ) {
            assert(serial_ports[0].id == request->handle && request->read_length > 0);
            ++read_calls;
            if (scenario == 1 && read_calls > 1) {
                failed_read_injected = true;
                return RYZ_PERIPHERAL_FAILED;
            }
            size_t count = 0;
            if (scenario == 2) count = read_calls == 1 ? 63 : 64;
            else if (read_calls == 1) count = 3;
            if (count > request->read_length) count = request->read_length;
            reply->length = count;
            memset(reply->data, scenario == 2 ? 'X' : 'O', count);
            reply->error_events = 0;
            reply->loss_possible = false;
            delivered += count;
            /* Reads consume their bounded timeout in the deterministic clock. */
            clock_ms += request->timeout_ms;
            return RYZ_PERIPHERAL_OK;
        }
    }
    ryz_peripheral_result_t result = virtual_call(context, request, reply);
    if (result == RYZ_PERIPHERAL_OK && request->kind == RYZ_PERIPHERAL_LED) {
        if (request->op == RYZ_PERIPHERAL_WRITE && led_count < 16) {
            for (unsigned i = 0; i < 3; ++i) led_colors[led_count][i] = request->data[i];
            ++led_count;
        }
        if (request->op == RYZ_PERIPHERAL_STATUS &&
            reply->led.state == RYZ_PERIPHERAL_LED_READY &&
            reply->led.output_known && completed_count < 16) {
            completed_colors[completed_count][0] = reply->led.red;
            completed_colors[completed_count][1] = reply->led.green;
            completed_colors[completed_count][2] = reply->led.blue;
            ++completed_count;
        }
    }
    return result;
}

static void colors(const unsigned values[16][3], unsigned count)
{
    putchar('[');
    for (unsigned i = 0; i < count; ++i) {
        if (i) putchar(',');
        printf("[%u,%u,%u]", values[i][0], values[i][1], values[i][2]);
    }
    putchar(']');
}

int main(int argc, char **argv)
{
    assert(argc == 3);
    scenario = atoi(argv[2]);
    assert(scenario >= 0 && scenario <= 3);
    FILE *file = fopen(argv[1], "rb"); assert(file);
    char source[RYZ_LUA_SOURCE_MAX + 1];
    size_t length = fread(source, 1, sizeof(source), file); fclose(file);
    assert(length > 0 && length <= RYZ_LUA_SOURCE_MAX);
    ryz_app_platform_t platform = {.resize=resize, .now_ms=now, .pause_ms=pause_ms,
        .peripheral_call=semantic_call, .mark=mark};
    ryz_lua_result_t result;
    ryz_app_execute(source, length, argv[1], 10000, &platform, &result);
    bool green = false;
    for (unsigned i = 0; i < completed_count; ++i)
        if (completed_colors[i][0] == 0 && completed_colors[i][1] > 0 &&
            completed_colors[i][2] == 0) green = true;
    const bool clean = !serial_ports[0].id && !led_peer.id;
    const bool confirmed_green = completed_count == 1 &&
        completed_colors[0][0] == 0 && completed_colors[0][1] == 255 && completed_colors[0][2] == 0;
    const bool confirmed_red = completed_count == 1 &&
        completed_colors[0][0] == 255 && completed_colors[0][1] == 0 && completed_colors[0][2] == 0;
    const bool confirmed_yellow = completed_count == 1 &&
        completed_colors[0][0] == 255 && completed_colors[0][1] == 255 && completed_colors[0][2] == 0;
    const bool tx_ok = sent_bytes == 4 && write_calls == 2;
    const bool symptom_pass = scenario == 0 ?
        tx_ok && confirmed_green && delivered == 3 && marked_received == 3 :
        scenario == 1 ? tx_ok && failed_read_injected && read_calls == 2 &&
            delivered == 3 && marked_received == 3 && confirmed_red &&
            strstr(result.output, "UART read failed:") != NULL :
        scenario == 2 ? tx_ok && delivered == 256 && marked_received == 256 &&
            marked_truncated == 1 && confirmed_yellow &&
            strstr(result.output, "truncated=true") != NULL :
        !green && !delivered && !read_calls && !sent_bytes && !led_count &&
            !completed_count && strstr(result.output, "unavailable") != NULL;
    const bool passed = !strcmp(result.phase, "done") && !result.output_truncated &&
        clean && symptom_pass;
    printf("{\"scenario\":%d,\"phase\":", scenario); quoted(result.phase);
    printf(",\"passed\":%s,\"delivered\":%u,\"marked_received\":%d,\"marked_truncated\":%d,"
        "\"read_calls\":%u,\"write_calls\":%u,\"sent_bytes\":%u,"
        "\"failed_read_injected\":%s,\"green_completed\":%s,\"resources_clean\":%s,"
        "\"elapsed_ms\":%u,\"led_submitted\":",
        passed ? "true" : "false", delivered, marked_received, marked_truncated, read_calls,
        write_calls, sent_bytes, failed_read_injected ? "true" : "false",
        green ? "true" : "false", clean ? "true" : "false", result.elapsed_ms);
    colors(led_colors, led_count);
    fputs(",\"led_completed\":", stdout); colors(completed_colors, completed_count);
    fputs(",\"output\":", stdout); quoted(result.output);
    fputs(",\"error\":", stdout); quoted(result.error);
    puts("}");
    return passed ? 0 : 1;
}
