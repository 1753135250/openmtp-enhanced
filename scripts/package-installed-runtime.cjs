const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const asar = require('asar');
async function main() {
  const root = path.resolve(__dirname, '..');
  const installed = process.argv[2] || '/Applications/OpenMTP Enhanced.app';
  const output = path.join(root, 'dist/OpenMTP Enhanced.app');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'openmtp-stage-'));
  asar.extractAll(path.join(installed, 'Contents/Resources/app.asar'), stage);
  const old = JSON.parse(fs.readFileSync(path.join(stage, 'package.json')));
  if (!old.version.startsWith('3.3.1-enhanced.'))
    throw Error('Expected the existing Enhanced Electron 18 runtime');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.rmSync(output, { recursive: true, force: true });
  fs.cpSync(installed, output, { recursive: true, verbatimSymlinks: true });
  fs.rmSync(path.join(stage, 'app/dist'), { recursive: true, force: true });
  fs.cpSync(path.join(root, 'app/dist'), path.join(stage, 'app/dist'), {
    recursive: true,
  });
  for (const name of fs
    .readdirSync(path.join(root, 'app'))
    .filter((n) => /prod\.js(?:\.map)?$/.test(n) || n === 'app.html'))
    fs.copyFileSync(
      path.join(root, 'app', name),
      path.join(stage, 'app', name)
    );
  fs.copyFileSync(
    path.join(root, 'package.json'),
    path.join(stage, 'package.json')
  );
  const resources = path.join(output, 'Contents/Resources');
  fs.copyFileSync(
    path.join(root, 'build/icon.icns'),
    path.join(resources, 'icon.icns')
  );
  const finderIcon = path.join(output, 'Icon\r');
  if (fs.existsSync(finderIcon)) fs.unlinkSync(finderIcon);
  const archive = path.join(resources, 'app.asar');
  await asar.createPackage(stage, archive);
  for (const name of ['kalam.dylib', 'kalam-seg5.dylib', 'libusb.dylib'])
    fs.copyFileSync(
      path.join(root, 'build/mac/bin/arm64', name),
      path.join(resources, 'bin/arm64', name)
    );
  const hash = crypto
    .createHash('sha256')
    .update(asar.getRawHeader(archive).headerString)
    .digest('hex');
  const py = `import pathlib,plistlib,sys
p=pathlib.Path(sys.argv[1])/'Contents/Info.plist'
d=plistlib.loads(p.read_bytes());d['CFBundleShortVersionString']=sys.argv[3];d['CFBundleVersion']='3.3.1';d['ElectronAsarIntegrity']['Resources/app.asar']['hash']=sys.argv[2];p.write_bytes(plistlib.dumps(d))
`;
  cp.execFileSync('python3', [
    '-c',
    py,
    output,
    hash,
    require('../package.json').version,
  ]);
  cp.spawnSync('xattr', ['-r', '-d', 'com.apple.FinderInfo', output]);
  cp.execFileSync(
    'codesign',
    [
      '--force',
      '--deep',
      '--sign',
      '-',
      '--entitlements',
      path.join(root, 'build/entitlements.mac.plist'),
      output,
    ],
    { stdio: 'inherit' }
  );
  cp.execFileSync('codesign', ['--verify', '--deep', '--strict', output]);
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(output);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
