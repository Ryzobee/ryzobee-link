#!/usr/bin/env python3
"""Real VM/typed-adapter contract tests; successful open is required for methods."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from check_hardware_runtime import build, execute


OPEN = {
    'gpio': "{pin=13,mode='output',initial=1}",
    'timer': '{period_ms=10}', 'pwm': '{pin=13,frequency_hz=100,duty=500}',
    'i2c': '{sda=13,scl=14}', 'spi': '{sclk=13,mosi=14,miso=15,cs=16}',
    'uart': '{tx=16,rx=17}', 'adc': '{pin=13}', 'log': "{level='info'}", 'led': '{board=true}',
}
METHODS = {
    'gpio': {'read': ('', '1'), 'write': ('0', '2')},
    'timer': {'poll': ('', '1')}, 'pwm': {'set_duty': ('500', "'500'")},
    'i2c': {'probe': ('0x50', '7'), 'read': ('0x50,1', '0x50,257'),
            'write': ("0x50,'x'", '0x50,123'), 'transfer': ("0x50,'x',1", "0x50,'x',1,21")},
    'spi': {'read': ('1', '257'), 'write': ("'x'", '123'), 'transfer': ("'x'", "'x',21")},
    'uart': {'read': ('1,0', '257,0'), 'write': ("'x'", '123')},
    'adc': {'read': ('', '1'), 'read_mv': ('', '1')},
    'log': {'read': ('1,0', '257,0')},
    'led': {'write': ('1,2,3', '1,2,256'), 'status': ('', '1')},
}
TOOLS = {
    'i2c.configure': "{sda=13,scl=14,hz=100000,expected_revision='1'}",
    'i2c.start': "'1'", 'i2c.status': '', 'i2c.cancel': "'1'",
    'rgb.set': '{red=1,green=2,blue=3}', 'rgb.status': '',
    'monitor.configure': "{source='system',expected_revision='1'}",
    'monitor.start': "'1'", 'monitor.status': '', 'monitor.stop': "'1'",
    'monitor.pause': "{operation_id='1',view_generation='1',paused=true}",
    'monitor.clear': "{operation_id='1',view_generation='1'}",
    'monitor.read': "{operation_id='1',view_generation='1',after_sequence='0'}",
}
HARDWARE = ['wifi.is_connected', 'ble.is_connected', 'imu.init', 'imu.read',
            'imu.deinit', 'hid.is_ready', 'hid.tap']


def cases():
    result = []
    def add(name, code, phase='done', *, coverage=(), opened=0, mode='success', no_callback=None, marker=True, budget=1000, uart_tx=None):
        result.append(dict(name=name, code=('-- ryz-app/1\n' if marker else '')+code,
                           phase=phase, coverage=list(coverage), opened=opened,
                           mode=mode, no_callback=no_callback, budget=budget, uart_tx=uart_tx))
    for module, config in OPEN.items():
        prepare = f"local h=assert(require('{module}').open{config}); "
        method_names = [f'{module}.open', *[f'{module}:{m}' for m in METHODS[module]], f'{module}:close']
        body = prepare + '; '.join(f'assert(h:{method}({args[0]}))' for method,args in METHODS[module].items())
        add(module+'_all_methods', body+'; assert(h:close()); assert(h:close())', coverage=method_names, opened=1)
        add(module+'_open_unknown_field', f"require('{module}').open{{invented=1}}", 'runtime', no_callback=('peripherals',module,'open'))
        add(module+'_open_wrong_type', f"require('{module}').open('invalid')", 'runtime', no_callback=('peripherals',module,'open'))
        add(module+'_open_metatable', f"require('{module}').open(setmetatable({config},{{}}))", 'runtime', no_callback=('peripherals',module,'open'))
        add(module+'_unavailable', f"local h,e=require('{module}').open{config}; assert(h==nil and e=='unavailable')", mode='unavailable')
        for method, args in METHODS[module].items():
            add(module+'_'+method+'_bad_argument', prepare+f'h:{method}({args[1]})', 'runtime', opened=1,
                no_callback=('peripherals',module,method))
        add(module+'_close_bad_argument', prepare+'h:close(1)', 'runtime', opened=1)
        add(module+'_invented_method', prepare+'h:invented()', 'runtime', opened=1)
    add('log_write', "assert(require('log').write('info','CONTRACT'))", coverage=['log.write'])
    add('log_write_bad_level', "require('log').write('INFO','x')", 'runtime', no_callback=('peripherals','log','write'))
    add('log_write_bad_type', "require('log').write('info',1)", 'runtime', no_callback=('peripherals','log','write'))
    add('hardware_all_methods', """
local wifi,ble,imu,hid=require('wifi'),require('ble'),require('imu'),require('hid')
assert(wifi.is_connected()); assert(ble.is_connected()); assert(hid.is_ready())
local before,e=imu.read(); assert(before==nil and e=='not_initialized')
assert(imu.init()); local s=assert(imu.read())
assert(s.x_mg==123.25 and type(s.timestamp_us)=='string' and type(s.sequence)=='string')
assert(imu.deinit()); assert(imu.deinit())
for _,k in ipairs({'play_pause','stop','next_track','previous_track','mute','volume_up','volume_down'}) do assert(hid.tap(k)) end
""", coverage=HARDWARE)
    for api in HARDWARE:
        module, method = api.split('.')
        arg = "'UNKNOWN'" if method=='tap' else '1'
        add(api+'_bad_argument', f"require('{module}').{method}({arg})", 'runtime', no_callback=('hardware',api))
        arg = "'stop'" if method=='tap' else ''
        status = method in ['is_connected','is_ready']
        add(api+'_unavailable', f"local r,e=require('{module}').{method}({arg}); assert(r=={'false' if status else 'nil'} and e=='unavailable')", mode='unavailable')
    for api, args in TOOLS.items():
        add('tools.'+api, f"local r=require('tools').{api}({args}); assert(r.ok and r.code=='ok')", coverage=['tools.'+api])
        add('tools.'+api+'_bad_argument', f"require('tools').{api}({'1' if not args else ''})", 'runtime', no_callback=('tools',api))
        add('tools.'+api+'_unavailable', f"local r=require('tools').{api}({args}); assert(not r.ok and r.code=='unavailable')", mode='unavailable')
    add('tools_state_chain', """
local t=require('tools')
local s=t.i2c.status(); assert(s.ok)
local c=t.i2c.configure{sda=13,scl=14,hz=400000,expected_revision=s.config_revision}; assert(c.ok)
local a=t.i2c.start(c.revision); assert(a.ok)
s=t.i2c.status(); assert(s.ok and s.scan_id==a.operation_id and s.phase=='completed' and s.empty)
local m=t.monitor.start(t.monitor.status().config_revision); assert(m.ok)
s=t.monitor.status(); assert(s.session_id==m.operation_id and s.phase=='running')
local clear=t.monitor.clear{operation_id=s.session_id,view_generation=s.stream.view_generation}; assert(clear.ok)
local page=t.monitor.read{operation_id=s.session_id,view_generation=clear.view_generation,after_sequence='0'}
assert(page.ok and page.count==0 and #page.records==0)
assert(t.monitor.stop(s.session_id).ok)
""")
    for token in ['0','01','-1','+1',' 1','1 ','1.0','1e2','4294967296','99999999999','']:
        add('bad_token_'+repr(token), f"require('tools').i2c.start('{token}')", 'runtime', no_callback=('tools','i2c.start'))
    for name,source in {
        'gpio_field_type': "require('gpio').open{pin='13'}",
        'uart_bad_enum': "require('uart').open{rx=17,parity='NONE'}",
        'timer_range': "require('timer').open{period_ms=0}",
        'pwm_range': "require('pwm').open{pin=13,duty=1001}",
        'i2c_field_name': "require('i2c').open{sda=13,scl=14,hz=100000}",
        'spi_duplicate_pin': "require('spi').open{sclk=13,mosi=13,cs=16}",
        'adc_range': "require('adc').open{pin=13,attenuation_db=3}",
        'led_board_false': "require('led').open{board=false}",
        'broker_unknown_field': "require('tools').rgb.set{red=1,green=2,blue=3,pin=45}",
        'broker_uint_number': "require('tools').i2c.start(1)",
        'broker_color_type': "require('tools').rgb.set{red='1',green=2,blue=3}",
        'broker_monitor_limit': "require('tools').monitor.read{operation_id='1',view_generation='1',after_sequence='0',limit=8}",
        'broker_baud': "require('tools').monitor.configure{source='uart',rx=17,tx=16,baud=300,expected_revision='1'}",
        'broker_system_pins': "require('tools').monitor.configure{source='system',rx=17,expected_revision='1'}",
        'broker_invented_method': "require('tools').rgb.off()",
        'board_invented_api': "require('ryzobee').uart_open()",
        'pin_out_of_range': "require('gpio').open{pin=49}",
        'missing_battery': "require('battery')",
        'missing_rgb': "require('rgb')",
        'no_io': 'io.open("/dev/null")',
    }.items():
        add(name,source,'runtime')
    add('binary_uart', "local h=assert(require('uart').open{rx=17,tx=16}); assert(h:read(4)=='A\\0B'..string.char(255)); assert(h:write('X\\0YZ')==3); assert(h:read(3)=='X\\0Y')", opened=1)
    add('uart_tx_lowercase_partial', "local h=assert(require('uart').open{tx=16}); local s='ping'; local n=assert(h:write(s)); assert(n==3); assert(h:write(s:sub(n+1))==1)", opened=1, uart_tx=('70696e67',False))
    add('uart_tx_unaccepted_suffix', "local h=assert(require('uart').open{tx=16}); assert(h:write('pingjunk')==3)", opened=1, uart_tx=('70696e',False))
    add('uart_tx_binary_partial', "local h=assert(require('uart').open{tx=16}); local s='p\\0ng'; local n=assert(h:write(s)); assert(n==3); assert(h:write(s:sub(n+1))==1)", opened=1, uart_tx=('70006e67',False))
    add('uart_tx_failed_write', "local h=assert(require('uart').open{rx=17}); local n,e=h:write('ping'); assert(n==nil and e=='unsupported')", opened=1, uart_tx=('',False))
    tx_loop="local h=assert(require('uart').open{tx=16,rx=17}); h:read(); for i=1,85 do assert(h:write('abc')==3); assert(h:read(3)=='abc') end; "
    add('uart_tx_exact_bound', tx_loop+"assert(h:write('p')==1)", opened=1, uart_tx=('616263'*85+'70',False))
    add('uart_tx_bounded_overflow', tx_loop+"assert(h:write('abc')==3)", opened=1, uart_tx=('616263'*85+'61',True))
    add('busy_loop_deadline','while true do end','timeout',budget=10)
    add('sleep_deadline',"require('ryzobee').sleep_ms(20)",'timeout',budget=10)
    add('coroutine_deadline',"local c=coroutine.create(function() while true do end end); coroutine.resume(c)",'timeout',budget=10)
    add('memory_quota',"local s=string.rep('x',300000)",'memory')
    add('missing_marker','print(1)','init',marker=False)
    add('syntax_error','local =','syntax')
    return result


def observed_calls(adapter, api):
    if api.startswith('tools.'):
        return adapter.get('tools',{}).get(api[6:],0)
    if api=='hid.tap':
        keys=['play_pause','stop','next_track','previous_track','mute','volume_up','volume_down']
        values={key:adapter.get('hardware',{}).get(f'hid.tap({key})',0) for key in keys}
        return values
    if api in HARDWARE:
        return adapter.get('hardware',{}).get(api,0)
    if ':' in api:
        module,method=api.split(':')
    else:
        module,method=api.split('.')
    return adapter.get('peripherals',{}).get(module,{}).get(method,0)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--firmware-root',type=Path,required=True)
    parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--trial',type=Path,action='append',default=[],help='Also execute this source in both modes with a 5000 ms virtual deadline')
    args=parser.parse_args()
    directory=args.output_dir.resolve(); directory.mkdir(parents=True,exist_ok=True)
    source_dir=directory/'cases'; source_dir.mkdir(exist_ok=True)
    binary, identity=build(args.firmware_root.resolve(),directory/'build')
    checks=[]; failures=[]; coverage=set()
    all_cases=cases()
    for trial in args.trial:
        for mode in ['success','unavailable']:
            all_cases.append(dict(name=f'trial:{trial.name}:{mode}',code=trial.read_text(),phase='done',
                                  coverage=[],opened=0,mode=mode,no_callback=None,budget=5000))
    for index,case in enumerate(all_cases):
        source=source_dir/f'{index:03d}.lua'; source.write_text(case['code'])
        result=execute(binary,source,case['mode'],case['budget'],5)
        problems=[]
        if result['phase']!=case['phase']: problems.append(f"expected phase {case['phase']}")
        if case['phase']=='done':
            if result.get('ok') is not True or result.get('process_returncode')!=0:
                problems.append('expected ok=true and process_returncode=0')
        elif result.get('ok') is not False or result.get('process_returncode') in (None,0):
            problems.append('expected ok=false and nonzero process_returncode')
        adapter=result.get('adapter') or {}
        if adapter.get('handles_opened',0)<case['opened']: problems.append('required real virtual handle was not opened')
        if adapter.get('handles_remaining',0): problems.append('virtual handle leaked')
        if case.get('uart_tx') is not None:
            expected_hex,expected_overflow=case['uart_tx']
            if adapter.get('uart_tx_hex')!=expected_hex:
                problems.append('UART trace differs from accepted TX bytes')
            if adapter.get('uart_tx_overflow') is not expected_overflow:
                problems.append('UART trace overflow flag differs')
        if case['no_callback']:
            if case['no_callback']==('hardware','hid.tap'):
                value=sum(observed_calls(adapter,'hid.tap').values())
            else:
                value=adapter
                for part in case['no_callback']: value=value.get(part,0) if isinstance(value,dict) else 0
            if value: problems.append('invalid argument crossed typed callback seam')
        coverage_evidence={api:observed_calls(adapter,api) for api in case['coverage']}
        for api,count in coverage_evidence.items():
            observed=all(n>0 for n in count.values()) if isinstance(count,dict) else count>0
            if not observed: problems.append(f'{api} did not reach every required typed callback')
        if not problems: coverage.update(case['coverage'])
        record={'name':case['name'],'passed':not problems,'expected_phase':case['phase'],
                'coverage':case['coverage'],'coverage_evidence':coverage_evidence,
                'problems':problems,'source':str(source),'result':result}
        checks.append(record)
        if problems: failures.append({'name':case['name'],'problems':problems,'phase':result['phase'],'error':result.get('error')})
    expected={*HARDWARE,*['tools.'+api for api in TOOLS],'log.write'}
    for module in OPEN:
        expected.update([module+'.open',module+':close',*[module+':'+name for name in METHODS[module]]])
    missing=sorted(expected-coverage)
    report={'ok':not failures and not missing,'tests':len(checks),'passed':len(checks)-len(failures),
            'coverage_count':len(coverage),'coverage':sorted(coverage),'missing_coverage':missing,
            'failures':failures,'build':identity,'checks':checks,
            'boundary':'Real app_runtime/app_tools/frozen Lua and typed contract fixtures; not physical peripherals, native tool workers, UI pixels, or a hostile-code OS sandbox.'}
    output=directory/'report.json'; output.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='checks'},ensure_ascii=False))
    return 0 if report['ok'] else 1


if __name__=='__main__':
    raise SystemExit(main())
