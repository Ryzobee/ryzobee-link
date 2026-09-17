-- ryz-app/1
-- @author: Unknown
-- @version: 0.1.0
-- @description: Sweep onboard I2C addresses 0x08-0x77, print ACKs, and report errors without stopping the scan.
local board = require('ryzobee')
local i2c = require('i2c')

local bus, open_reason = i2c.open{board = true}
if not bus then
    print('i2c open failed:', open_reason)
    return
end

local ack_count = 0
local nack_count = 0
local error_count = 0
local incomplete = false

for address = 0x08, 0x77 do
    local ack, reason = bus:probe(address, 10)
    if ack == true then
        ack_count = ack_count + 1
        print(string.format('ACK 0x%02X', address))
    elseif ack == false then
        nack_count = nack_count + 1
    else
        error_count = error_count + 1
        incomplete = true
        print(string.format('ERR 0x%02X %s', address, tostring(reason)))
    end
    board.sleep_ms(1)
end

print(string.format('scan done ack=%d nack=%d err=%d', ack_count, nack_count, error_count))
if incomplete then
    print('scan incomplete: some addresses could not be probed')
else
    print('scan complete')
end

local closed, close_reason = bus:close()
if not closed then
    print('i2c close failed:', close_reason)
end
