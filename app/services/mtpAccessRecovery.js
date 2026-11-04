/* eslint-disable no-await-in-loop -- USB reconnection polling must be sequential. */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { accessSync, constants } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const findAdb = () => {
  const candidates = [
    join(homedir(), '.local/bin/adb'),
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
    join(homedir(), 'Library/Android/sdk/platform-tools/adb'),
    ...(process.env.PATH || '')
      .split(':')
      .filter(Boolean)
      .map((p) => join(p, 'adb')),
  ];

  return candidates.find((p) => {
    try {
      accessSync(p, constants.X_OK);

      return true;
    } catch (_) {
      return false;
    }
  });
};

export const setMtpAccessStatus = (message) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('mtp-access-status', { detail: message })
    );
  }
};

// Re-enable MTP on the exact already-authorized USB ADB serial. This never
// accepts the phone's permission prompt and never changes ADB authorization.
export const createMtpAccessRecovery =
  ({
    run = promisify(execFile),
    pause = delay,
    now = Date.now,
    locateAdb = findAdb,
  } = {}) =>
  async (choice, status = setMtpAccessStatus) => {
    if (!choice?.serial)
      throw new Error('无法识别所选手机的 USB 序列号，请重新选择设备。');
    const adb = locateAdb();

    if (!adb)
      throw new Error(
        '重新请求授权需要已安装的 ADB，并在手机上允许 USB 调试。'
      );
    const options = { encoding: 'utf8', timeout: 4000, maxBuffer: 65536 };
    const devices = await run(adb, ['devices', '-l'], options);
    const matches = devices.stdout
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/))
      .filter(
        (parts) =>
          parts[0] === choice.serial &&
          parts[1] === 'device' &&
          parts.some((p) => p.startsWith('usb:'))
      );

    if (matches.length !== 1)
      throw new Error(
        '所选手机未通过有线 ADB 授权，请确认手机上的 USB 调试授权。'
      );
    const command = (...args) =>
      run(adb, ['-s', choice.serial, ...args], options);
    const config = (await command('shell', 'getprop', 'sys.usb.config')).stdout
      .trim()
      .split(',')
      .sort()
      .join(',');

    if (config !== 'adb,mtp')
      throw new Error('手机当前不是 MTP + ADB 模式，请先选择文件传输。');
    const waitForAdb = async () => {
      const deadline = now() + 12000;

      while (now() < deadline) {
        try {
          if ((await command('get-state')).stdout.trim() === 'device') return;
        } catch (_) {
          /* reconnecting */
        }

        await pause(250);
      }

      throw new Error('等待所选手机重新连接超时，请检查数据线。');
    };
    const setFunctions = async (...functions) => {
      try {
        await command('shell', 'svc', 'usb', 'setFunctions', ...functions);
      } catch (error) {
        // USB function changes can close the command's own transport before exit.
        const detail = `${error.stderr || ''} ${error.stdout || ''} ${
          error.message || ''
        }`;

        if (/SecurityException|Permission Denial|Unknown command/i.test(detail))
          throw error;
        if (
          error.code !== 255 &&
          !/closed|offline|disconnect|device .*not found/i.test(detail)
        )
          throw error;
      }
    };

    const waitForFunctions = async (mtpEnabled) => {
      const deadline = now() + 4000;

      do {
        const state = (
          await command('shell', 'getprop', 'sys.usb.state')
        ).stdout
          .trim()
          .split(',');

        if (state.includes('adb') && state.includes('mtp') === mtpEnabled)
          return;
        await pause(200);
      } while (now() < deadline);

      throw new Error(
        '手机的 USB 模式切换未完成，请在手机 USB 选项中选择文件传输。'
      );
    };

    status('正在重新连接所选手机的 USB，请稍候…');
    try {
      await setFunctions();
      await waitForAdb();
      await pause(700);
    } finally {
      // Restore the original MTP + ADB mode even when the off-stage fails.
      await waitForAdb();
      await setFunctions('mtp');
      await waitForAdb();
    }

    await waitForFunctions(true);
    status('请在手机上点击“允许访问设备数据”…');
  };

export const recoverMtpAccess = createMtpAccessRecovery();
