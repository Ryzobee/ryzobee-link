-- ryz-app/1
-- @author: Unknown
-- @version: 0.1.1
-- @description: Print WiFi/BLE/HID status, then init IMU and collect up to 10 samples within 100 attempts.
local board = require('ryzobee')
local wifi = require('wifi')
local ble = require('ble')
local hid = require('hid')
local imu = require('imu')

local TARGET_SAMPLES = 10
local MAX_ATTEMPTS = 100
local INTERVAL_MS = 20

local function report_status()
    local connected, reason = wifi.is_connected()
    if reason ~= nil then
        print('WiFi error: ' .. tostring(reason))
    elseif connected then
        print('WiFi connected: true')
    else
        print('WiFi connected: false')
    end

    local ble_ok, ble_reason = ble.is_connected()
    if ble_reason ~= nil then
        print('BLE error: ' .. tostring(ble_reason))
    elseif ble_ok then
        print('BLE connected: true')
    else
        print('BLE connected: false')
    end

    local ready, hid_reason = hid.is_ready()
    if hid_reason ~= nil then
        print('HID error: ' .. tostring(hid_reason))
    elseif ready then
        print('HID ready: true')
    else
        print('HID ready: false')
    end
end

local function collect_samples()
    local ok, reason = imu.init()
    if not ok then
        print('IMU init failed: ' .. tostring(reason))
        return
    end

    local collected = 0
    local attempts = 0
    local fatal = nil

    while collected < TARGET_SAMPLES and attempts < MAX_ATTEMPTS do
        attempts = attempts + 1
        local sample, err = imu.read()
        if sample then
            collected = collected + 1
            print(string.format(
                'IMU %d/%d seq=%s x=%s y=%s z=%s mg',
                collected, TARGET_SAMPLES,
                tostring(sample.sequence),
                tostring(sample.x_mg),
                tostring(sample.y_mg),
                tostring(sample.z_mg)))
        elseif err == 'not_ready' then
            -- transient: keep retrying within the attempt budget
        else
            fatal = err
            break
        end
        board.sleep_ms(INTERVAL_MS)
    end

    if fatal then
        print('IMU read failed: ' .. tostring(fatal))
    elseif collected < TARGET_SAMPLES then
        print(string.format('IMU incomplete: %d/%d samples in %d attempts',
            collected, TARGET_SAMPLES, attempts))
    else
        print(string.format('IMU done: %d samples in %d attempts',
            collected, attempts))
    end

    local closed, close_reason = imu.deinit()
    if not closed then
        print('IMU deinit failed: ' .. tostring(close_reason))
    end
end

report_status()
collect_samples()
print('done')
