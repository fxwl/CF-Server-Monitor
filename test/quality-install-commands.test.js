import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { attachQualitySidecar } from '../src/frontend/utils/qualityInstallCommand.js'

const script = readFileSync(new URL('../src/frontend/views/admin/index.vue', import.meta.url), 'utf8')

test('server-specific Linux installer also installs quality after primary probe', () => {
  assert.match(script, /return attachQualitySidecar\(mainCommand, \{ baseUrl: HOST, installMode: installMode.value \}\)/)
  assert.match(script, /const mainCommand = isDedicatedUserInstall/)
})

test('auto-discovery Linux installer also installs quality after primary probe', () => {
  assert.match(script, /return attachQualitySidecar\(mainCommand, \{ baseUrl: HOST, installMode: mode \}\)/)
  assert.match(script, /if \(os !== 'linux'\) return installCommand/)
})

for (const mode of ['cfsm-user', 'current-user']) {
  test(`quality sidecar shell command is valid for ${mode}`, () => {
    const main = '( echo "primary agent installed" )'
    const command = attachQualitySidecar(main, {
      baseUrl: 'https://monitor.nnot.de/',
      installMode: mode
    })
    assert.equal(spawnSync('bash', ['-n'], { input: command }).status, 0)
    assert.ok(command.indexOf(main) < command.indexOf('quality_script=$(mktemp)'))
    assert.match(command, /CFSM_QUALITY_WAIT_FOR_REGISTRATION=1/)
    assert.match(command, /as_root env CFSM_PROBE_CONFIG="\$CFSM_MAIN_CONFIG"/)
    assert.match(command, /as_root systemctl start --no-block cfsm-quality.service/)
    assert.match(command, /as_root systemctl enable --now cfsm-quality.timer/)
    if (mode === 'cfsm-user') {
      assert.match(command, /getent passwd cfsm/)
      assert.match(command, /CFSM_MAIN_HOME/)
    } else {
      assert.match(command, /CFSM_MAIN_CONFIG="\$HOME\/\.cf-probe\/config.conf"/)
      assert.match(command, /CFSM_MAIN_CONFIG="\/etc\/config\/cf-probe\/config.conf"/)
    }
  })
}

test('quality installer rejects an unsafe non-HTTPS base URL', () => {
  assert.throws(() => attachQualitySidecar('true', { baseUrl: 'http://example.invalid' }), /HTTPS/)
})

test('non-Linux primary install return paths remain independent', () => {
  assert.match(script, /if \(targetOs.value === 'windows'\)/)
  assert.match(script, /if \(targetOs.value === 'docker'\)/)
  assert.match(script, /if \(os === 'windows'\)/)
  assert.match(script, /if \(os !== 'linux'\) return installCommand/)
})
