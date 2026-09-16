#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const firmwareRepo = path.resolve(process.env.RYZOBEE_FIRMWARE_ROOT ?? path.join(root, '../ryzobee-firmware'))
const firmware = path.join(firmwareRepo, 'firmware/rootmaker')
const lockPath = path.join(root, 'simulator/firmware.lock.json')
const sourcePaths = [
  'dependencies.lock', 'sdkconfig.defaults',
  'components/ryz_runtime', 'components/ryz_lvgl', 'components/ryz_font',
  'components/ryz_system_ui/ryz_v5_font.c', 'components/ryz_system_ui/include',
  'components/ryz_system_ui/ryz_v5_font_data.inc',
  'components/ryz_system_ui/assets', 'components/ryz_board/display_font.h',
  'components/ryz_board/include', 'components/ryz_tools/include',
  'components/ryz_i2c_scan/include', 'components/ryz_rgb/include',
  'components/ryz_monitor/include', 'host/pixels/platform.c', 'host/pixels/stubs',
  'managed_components/lvgl__lvgl', 'managed_components/georgik__lua',
]
function files(relative) {
  const absolute = path.join(firmware, relative)
  try {
    return readdirSync(absolute, {withFileTypes:true}).flatMap(entry =>
      entry.name.startsWith('.') ? [] : entry.isDirectory() ? files(path.join(relative, entry.name)) : [path.join(relative, entry.name)])
  } catch (error) {
    if (error.code === 'ENOTDIR') return [relative]
    throw error
  }
}
const inputFiles = sourcePaths.flatMap(files).sort()
const hash = createHash('sha256')
for (const name of inputFiles) hash.update(name.replaceAll(path.sep, '/') + '\0').update(readFileSync(path.join(firmware, name)))
const componentVersion = name => {
  const match = readFileSync(path.join(firmware, 'managed_components', name, 'idf_component.yml'),'utf8').match(/^version:\s*([^\s]+)\s*$/m)
  if (!match) throw new Error(`Missing component version: ${name}`)
  return match[1]
}
const actual = {
  repository: 'ryzobee-firmware',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd:firmwareRepo, encoding:'utf8'}).trim(),
  sourceTreeSHA256: hash.digest('hex'),
  sourcePaths,
  emscripten: '4.0.15', lua: componentVersion('georgik__lua').split('~')[0],
  luaComponent: `georgik/lua@${componentVersion('georgik__lua')}`, lvgl: componentVersion('lvgl__lvgl'),
}
if (process.argv.includes('--pin')) {
  writeFileSync(lockPath, JSON.stringify(actual, null, 2) + '\n')
  console.log('Pinned firmware source. Review this lock change before committing.')
  process.exit(0)
}
const expected = JSON.parse(readFileSync(lockPath, 'utf8'))
if (actual.commit !== expected.commit || actual.sourceTreeSHA256 !== expected.sourceTreeSHA256)
  throw new Error('Firmware source differs from simulator/firmware.lock.json; use the pinned checkout or explicitly review and re-pin it.')
const build = path.join(root, '.cache/simulator')
const output = path.join(root, 'public/simulator')
mkdirSync(build, {recursive:true}); mkdirSync(output, {recursive:true})
const execute = (program, args) => execFileSync(program, args, {cwd:root, stdio:'inherit'})
const compilerVersion = execFileSync('emcc', ['--version'], {encoding:'utf8'})
if (!compilerVersion.includes(expected.emscripten)) throw new Error(`Use Emscripten ${expected.emscripten}`)
execute('emcmake', ['cmake','-S',path.join(root,'simulator'),'-B',build,'-G','Ninja',`-DRYZ_FIRMWARE=${firmware}`,'-DCMAKE_BUILD_TYPE=Release'])
execute('cmake', ['--build',build,'--parallel','8'])
for (const name of ['ryzobee.js','ryzobee.wasm']) copyFileSync(path.join(build,name),path.join(output,name))
const licenseDir = path.join(output, 'licenses')
mkdirSync(licenseDir, {recursive:true})
copyFileSync(path.join(firmware,'managed_components/lvgl__lvgl/LICENCE.txt'),path.join(licenseDir,'LVGL-MIT.txt'))
for (const [from,to] of [
  ['src/stdlib/builtin/LICENSE_TLSF.txt','LVGL-TLSF.txt'],
  ['src/stdlib/builtin/LICENSE_SPRINTF.txt','LVGL-PRINTF-MIT.txt'],
  ['scripts/built_in_font/font_license/Montserrat/OFL.txt','LVGL-Montserrat-OFL.txt'],
  ['scripts/built_in_font/font_license/FontAwesome5/LICENSE.txt','LVGL-FontAwesome5.txt'],
  ['scripts/built_in_font/font_license/unscii/unscii.html','LVGL-Unscii-NOTICE.txt'],
]) copyFileSync(path.join(firmware,'managed_components/lvgl__lvgl',from),path.join(licenseDir,to))
copyFileSync(path.join(firmware,'components/ryz_font/LICENSES/OFL-1.1.txt'),path.join(licenseDir,'Fonts-OFL-1.1.txt'))
copyFileSync(path.join(firmware,'components/ryz_font/LICENSES/RobotoMono-OFL.txt'),path.join(licenseDir,'RobotoMono-OFL.txt'))
const fontNotices = readFileSync(path.join(firmware,'components/ryz_font/THIRD_PARTY_NOTICES.md'),'utf8').split('\n## FreeType')[0]
writeFileSync(path.join(licenseDir,'Fonts-NOTICES.md'),fontNotices + '\n')
const luaHeader = readFileSync(path.join(firmware,'managed_components/georgik__lua/lua/lua.h'),'utf8')
const luaLicense = luaHeader.slice(luaHeader.lastIndexOf('Copyright (C)')).split('*/')[0]
writeFileSync(path.join(licenseDir,'Lua-MIT.txt'),luaLicense + '\n')
const adapterHash = createHash('sha256')
for (const name of ['CMakeLists.txt','bridge.c','display.c','lv_conf.h'])
  adapterHash.update(name + '\0').update(readFileSync(path.join(root,'simulator',name)))
writeFileSync(path.join(output,'build.json'),JSON.stringify({...actual, adapterTreeSHA256:adapterHash.digest('hex'), artifacts:Object.fromEntries(['ryzobee.js','ryzobee.wasm'].map(name=>[name,createHash('sha256').update(readFileSync(path.join(output,name))).digest('hex')]))},null,2)+'\n')
console.log('Built real firmware Lua + LVGL browser runtime. No Node backend is required at runtime.')
