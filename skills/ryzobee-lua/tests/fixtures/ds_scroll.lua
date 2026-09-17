-- ryz-app/1
-- @author: Unknown
-- @version: 0.1.0
-- @description: Full-screen six-item list; drag to scroll, tap an item to show SELECTED name. Hold BOOT to exit.

local board = require('ryzobee')
local ui = require('ui')

local ITEMS = {'ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT'}
local ITEM_HEIGHT = 40
local VIEW_HEIGHT = 200
local CONTENT_HEIGHT = ITEM_HEIGHT * #ITEMS
local MAX_OFFSET = CONTENT_HEIGHT - VIEW_HEIGHT

local objects = {
    {id='header', kind='label', x=0, y=0, width=240, height=36,
     text='SELECTED NONE', font='body_16', foreground=0xFB40, align='center'},
    {id='list', kind='viewport', x=0, y=40, width=240, height=VIEW_HEIGHT,
     content_height=CONTENT_HEIGHT, scroll_y=0, background=0x0000},
}
for index = 1, #ITEMS do
    objects[#objects + 1] = {
        id = 'item_' .. index,
        kind = 'button',
        parent = 'list',
        x = 0,
        y = (index - 1) * ITEM_HEIGHT,
        width = 240,
        height = ITEM_HEIGHT,
        text = ITEMS[index],
        font = 'button_16',
        foreground = 0xFFFF,
        background = 0x1082,
        border = 0xFB40,
        border_width = 1,
        radius = 4,
    }
end

local generation = ui.mount({id='list_app', background=0x0000, objects=objects})

local offset = 0

while true do
    local event = ui.poll('list')
    if event and event.generation == generation then
        if event.kind == 'scroll' then
            local next_offset = offset - event.dy
            if next_offset < 0 then next_offset = 0 end
            if next_offset > MAX_OFFSET then next_offset = MAX_OFFSET end
            if next_offset ~= offset then
                offset = next_offset
                ui.update(generation, {{id='list', scroll_y=offset}})
            end
        elseif event.kind == 'activate' then
            for index = 1, #ITEMS do
                if event.id == 'item_' .. index then
                    ui.update(generation, {{id='header', text='SELECTED '..ITEMS[index]}})
                    break
                end
            end
        end
    end
    board.sleep_ms(20)
end
