import argparse
import json
from pathlib import Path
import sys
import tempfile
import unittest

SKILL = Path(__file__).resolve().parents[1]
ROOT = None
sys.path.insert(0, str(SKILL / 'scripts'))
from check_ui_runtime import UiRuntime
from check_script import FirmwareParser

HEADER = '-- ryz-app/1\n-- @author: Test\n-- @version: 1.0.0\n-- @description: Isolated API contract test.\n'
LABEL = "{id='value',kind='label',x=0,y=0,width=120,height=30,text='OK'}"
SCENE = "{id='main',background=0,objects={" + LABEL + "}}"
SETUP = "local ui=require('ui'); local generation=ui.mount(" + SCENE + "); "

POSITIVE = {
 'board_all': "local b=require('ryzobee'); assert(b.info().width==240); assert(type(b.seed())=='number'); local t=b.millis(); b.sleep_ms(1); assert(b.millis()>t); b.mark('ok',true); b.mark('ok',123); b.mark('ok','ready')",
 'display_all': "local d=require('display'); d.clear(0); d.rect(0,0,240,240,0xFB40); d.text(8,8,'ABC',0xFFFF,2); assert(d.show())",
 'touch_all': "local t=require('touch'); assert(t.info().width==240); local p=t.read(); assert(type(p.pressed)=='boolean'); assert(t.demo(true)); assert(t.demo(false))",
 'ui_all': SETUP + "assert(ui.update(generation,{{id='value',text='NEW'}})==generation); assert(ui.poll()==nil)",
 'viewport': "local ui=require('ui'); local g=ui.mount{id='scene',background=0,objects={{id='list',kind='viewport',x=0,y=0,width=240,height=200,content_height=400},{id='item',kind='button',parent='list',x=0,y=300,width=200,height=30,text='ONE'}}}; ui.update(g,{{id='list',scroll_y=200}}); ui.poll('list')",
 'image': "require('ui').mount{id='scene',background=0,objects={{id='picture',kind='image',x=0,y=0,width=88,height=88,asset='rootmaker_a_face'}}}",
 'box_geometry': "local ui=require('ui'); local g=ui.mount{id='scene',background=0,objects={{id='box',kind='box',x=0,y=0,width=40,height=40}}}; ui.update(g,{{id='box',y=10,width=80,height=50}})",
 'cooperative': "local b=require('ryzobee'); local co=coroutine.create(function() coroutine.yield(7); return 9 end); local ok,n=coroutine.resume(co); assert(ok and n==7); b.sleep_ms(1); ok,n=coroutine.resume(co); assert(ok and n==9)",
}
NEGATIVE = {
 'unknown_module': ("require('lvgl')", 'module not allowed'),
 'unknown_create': ("require('ui').create()", 'nil value'),
 'unknown_events': ("require('ui').events()", 'nil value'),
 'unknown_display_canvas': ("require('display').canvas()", 'nil value'),
 'missing_generation': (SETUP + "ui.update({{id='value',text='X'}})", 'generation'),
 'stale_generation': (SETUP + "ui.update(generation+1,{{id='value',text='X'}})", 'generation'),
 'unknown_patch': (SETUP + "ui.update(generation,{{id='value',font_size=16}})", 'unknown'),
 'patch_type': (SETUP + "ui.update(generation,{{id='value',enabled=1}})", 'boolean'),
 'patch_duplicate': (SETUP + "ui.update(generation,{{id='value',text='A'},{id='value',text='B'}})", 'duplicate'),
 'patch_label_move': (SETUP + "ui.update(generation,{{id='value',y=10}})", 'only box'),
 'unknown_poll': (SETUP + "ui.poll('missing')", 'scroll'),
 'mixed_screen_owner': (SETUP + "require('display').clear(0)", 'conflicts'),
 'mixed_touch_owner': (SETUP + "ui.poll(); require('touch').read()", 'conflicts'),
 'bad_mark_name': ("require('ryzobee').mark('1bad',true)", 'identifier'),
 'bad_mark_string': ("require('ryzobee').mark('good','1bad')", 'identifier'),
 'bad_mark_value': ("require('ryzobee').mark('good',{})", 'expected'),
 'bad_sleep': ("require('ryzobee').sleep_ms(5001)", '0..5000'),
 'negative_rect': ("require('display').rect(0,0,-1,10,0)", '240x240'),
 'out_of_bounds': ("require('display').rect(230,0,20,10,0)", '240x240'),
 'web_color': ("require('display').clear('#FF6A00')", 'number'),
 'wide_color': ("require('display').clear(0xFF6A00)", 'RGB565'),
 'bad_scale': ("require('display').text(0,0,'A',0,7)", '1..6'),
 'bad_touch_bool': ("require('touch').demo(1)", 'boolean'),
}
for name, changes, expected in [
 ('bad_font', ",font='body_18'", 'font'),
 ('bad_field', ',font_size=16', 'unknown'),
 ('bad_bool', ',visible=1', 'boolean'),
 ('bad_line_height', ',line_height=1', 'line height'),
 # Current C integer_field_value uses %lld with luaL_error, unsupported by Lua.
 # It still rejects the invalid field; preserve evidence of the firmware diagnostic defect.
 ('bad_radius', ',radius=40', "invalid option '%l'"),
]:
    NEGATIVE[name] = ("require('ui').mount({id='scene',background=0,objects={" + LABEL[:-1] + changes + '}}})', expected)
for name, old, new, expected in [
 ('chinese_text', "text='OK'", "text='你好'", 'ASCII'),
 ('empty_text', "text='OK'", "text=''", '1..40'),
 ('bad_id', "id='value'", "id='1value'", 'identifier'),
 ('bad_x', 'x=0', 'x=239', '240x240'),
 ('bad_width', 'width=120', 'width=0', "invalid option '%l'"),
 ('bad_kind', "kind='label'", "kind='text'", 'kind'),
]:
    NEGATIVE[name] = ('require(\'ui\').mount(' + SCENE.replace(old,new) + ')', expected)


class UiContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if ROOT is None:
            raise RuntimeError('Run this file with --firmware-root ROOT')
        cls.temporary = tempfile.TemporaryDirectory(prefix='ryz-ui-contract-cases-')
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.build = Path(cls.temporary.name)
        cls.runtime = UiRuntime(ROOT, cls.build)
        cls.syntax = FirmwareParser(ROOT, cls.build)

    def check_case(self, name, source, expected=None):
        path = self.build / (name + '.lua')
        path.write_text(HEADER + source)
        # Demonstrate that every invalid native call passes the older syntax check.
        self.assertTrue(self.syntax.check(path)['ok'], name)
        outcome = self.runtime.run(path)
        self.assertEqual(outcome['ok'], expected is None, (name, outcome))
        if expected is not None:
            self.assertIn(expected.lower(), outcome.get('error','').lower(), (name, outcome))


for name, source in POSITIVE.items():
    setattr(UiContract, 'test_valid_' + name, lambda self,n=name,s=source: self.check_case(n,s))
for name, (source, expected) in NEGATIVE.items():
    setattr(UiContract, 'test_reject_' + name, lambda self,n=name,s=source,e=expected: self.check_case(n,s,e))
for font in ('body_12','body_14','body_16','medium_12','medium_14','button_12','button_14','button_16',
             'title_24','display_20','mono_12','mono_14','mono_medium_12','mono_medium_13','mono_semibold_12','mono_semibold_14'):
    source = "require('ui').mount({id='scene',background=0,objects={" + LABEL[:-1] + ",font='" + font + "'}}})"
    setattr(UiContract,'test_font_'+font,lambda self,f=font,s=source:self.check_case('font_'+f,s))

if __name__ == '__main__':
    arguments = argparse.ArgumentParser(add_help=False)
    arguments.add_argument('--firmware-root', type=Path, required=True)
    args, rest = arguments.parse_known_args()
    ROOT = args.firmware_root.expanduser().resolve(strict=True)
    unittest.main(argv=[sys.argv[0], *rest], verbosity=2)
