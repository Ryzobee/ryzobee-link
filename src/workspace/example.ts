export const exampleSource = `-- ryz-app/1
-- RYZOBEE LINK · 点击屏幕中的按钮
local board = require('ryzobee')
local ui = require('ui')
local count = 0

local scene = ui.mount({
  id = 'link_demo', background = 0x0000,
  objects = {
    {id='brand', kind='label', x=16, y=24,
      width=208, height=36, text='RYZOBEE',
      font='title_24', foreground=0xFB40, align='center'},
    {id='count', kind='label', x=16, y=84,
      width=208, height=36, text='COUNT 0',
      font='title_24', foreground=0xFFFF, align='center'},
    {id='add', kind='button', x=28, y=152,
      width=184, height=56, text='ADD +1',
      font='body_16', background=0xFB40, foreground=0x0000}
  }
})

while true do
  local event = ui.poll()
  if event and event.id == 'add' then
    count = count + 1
    ui.update(scene, {{id='count', text='COUNT '..count}})
    print('count', count)
  end
  board.sleep_ms(20)
end
`;
