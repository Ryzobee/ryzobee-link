-- ryz-app/1
-- @author: Unknown
-- @version: 0.1.0
-- @description: Send a 4-byte UART1 ping, read a bounded reply window, and show the result on the board LED.

local board = require('ryzobee')
local uart = require('uart')
local led = require('led')

-- Protocol payload is exact bytes: 'ping' == 70 69 6e 67. Never case-fold it.
local PING = 'ping'
local WRITE_ATTEMPTS = 8
local READ_WINDOW_MS = 300
local READ_SLICE_MS = 20
local READ_CHUNK = 64
local MAX_RX = 256
local LED_POLLS = 20

local function show(handle, red, green, blue)
    if not handle then return end
    local ok, reason = handle:write(red, green, blue)
    if not ok then
        print('LED write:', reason)
        return
    end
    for _ = 1, LED_POLLS do
        local status, err = handle:status()
        if not status then
            print('LED status:', err)
            return
        end
        if status.state == 'failed' then
            print('LED output failed')
            return
        end
        if status.state == 'ready' and status.output_known then
            return
        end
        board.sleep_ms(10)
    end
    print('LED output not confirmed')
end

local function close(handle, label)
    if not handle then return end
    local ok, reason = handle:close()
    if not ok then print(label .. ' close:', reason) end
end

local led_handle = led.open{board=true}
if not led_handle then print('LED open failed') end

local uart_handle, uart_err = uart.open{
    port = 1, tx = 13, rx = 14,
    baud = 115200, bits = 8, parity = 'none', stop = 1,
}
if not uart_handle then
    print('UART open failed:', uart_err)
    show(led_handle, 255, 0, 0)
    close(led_handle, 'LED')
    return
end

-- Bounded write: keep the unsent remainder and retry a fixed number of times.
local sent, write_error = 0, nil
for _ = 1, WRITE_ATTEMPTS do
    local chunk = string.sub(PING, sent + 1)
    local n, reason = uart_handle:write(chunk)
    if not n then
        write_error = reason
        break
    end
    sent = sent + n
    if sent >= #PING then break end
    board.sleep_ms(5)
end

-- Bounded read: no reply protocol is defined, so read until the window expires
-- or the byte cap is reached. Never wait for a fixed expected length.
local received = ''
local loss_possible = false
local error_events = '0'
local read_error = nil
local started = board.millis()
while #received < MAX_RX do
    if board.millis() - started >= READ_WINDOW_MS then break end
    local chunk, info = uart_handle:read(READ_CHUNK, READ_SLICE_MS)
    if not chunk then
        read_error = info
        break
    end
    if info then
        if info.loss_possible then loss_possible = true end
        if info.error_events then error_events = info.error_events end
    end
    if #chunk > 0 then received = received .. chunk end
    board.sleep_ms(5)
end

print(string.format('UART1 ping sent=%d/%d received=%d loss_possible=%s error_events=%s',
    sent, #PING, #received, tostring(loss_possible), error_events))
if write_error then print('UART write error:', write_error) end
if read_error then print('UART read error:', read_error) end
if #received > 0 then
    local hex = {}
    for i = 1, #received do hex[i] = string.format('%02X', string.byte(received, i)) end
    print('UART1 rx:', table.concat(hex, ' '))
end

board.mark('uart_ping_sent', sent)
board.mark('uart_ping_received', #received)
board.mark('uart_ping_loss', loss_possible)

local sent_ok = (sent == #PING) and (not write_error)
if sent_ok and #received > 0 and not loss_possible then
    show(led_handle, 0, 255, 0)      -- green: ping sent, reply received, no loss
elseif sent_ok and #received > 0 then
    show(led_handle, 255, 255, 0)    -- yellow: reply incomplete or loss possible
else
    show(led_handle, 255, 0, 0)      -- red: send failed or no reply
end

close(uart_handle, 'UART')
close(led_handle, 'LED')
