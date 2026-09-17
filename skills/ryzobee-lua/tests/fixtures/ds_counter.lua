-- ryz-app/1
-- @author: Unknown
-- @version: 0.1.0
-- @description: Full-screen 240x240 touch counter starting at COUNT 0; tap ADD to increment. Hold BOOT to exit.

local board = require('ryzobee')
local ui = require('ui')

local count, maximum = 0, 9999

local generation = ui.mount({
    id = 'counter', background = 0x0000,
    objects = {
        {id='value', kind='label', x=12, y=88, width=216, height=32,
         text='COUNT 0', font='body_16', foreground=0xFFFF, align='center'},
        {id='add', kind='button', x=24, y=164, width=192, height=48,
         text='ADD', font='button_16', foreground=0x0000,
         background=0xFB40, radius=4},
    },
})

-- Persistent app: the host owns cancellation and resource cleanup.
while true do
    local event = ui.poll()
    if event and event.generation == generation
       and event.kind == 'activate' and event.id == 'add' and count < maximum then
        count = count + 1
        ui.update(generation, {
            {id='value', text='COUNT '..count},
            {id='add', enabled=count < maximum},
        })
    end
    board.sleep_ms(20)
end
