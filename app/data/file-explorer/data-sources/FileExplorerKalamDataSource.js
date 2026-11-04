import { exec } from 'child_process';
import { promisify } from 'node:util';
import {
  recoverMtpAccess,
  setMtpAccessStatus,
} from '../../../services/mtpAccessRecovery';
import { chooseMtpDevice } from '../../../services/mtpDeviceSelection';
import { log } from '../../../utils/log';
import { Kalam } from '../../../../ffi/kalam/src/Kalam';
import { checkIf } from '../../../utils/checkIf';
import { isArray, isEmpty } from '../../../utils/funcs';
import { getFilesPreprocessingBeforeTransferSetting } from '../../../helpers/settings';
import { msToTime } from '../../../utils/date';
import { kalamDebugReportCli } from '../../../helpers/binaries';

export class FileExplorerKalamDataSource {
  constructor() {
    this.kalamFfi = new Kalam();
    this.execPromise = promisify(exec);
  }

  /**
   * Execute a binary file
   * @param command
   * @return {Promise<unknown>}
   * @private
   */
  async _exec(command) {
    try {
      return new Promise((resolve) => {
        this.execPromise(command, (error, stdout, stderr) => {
          return resolve({
            data: stdout,
            stderr,
            error,
          });
        });
      });
    } catch (e) {
      log.error(e);
    }
  }

  /**
   * description - Initialize Kalam MTP
   *
   * @return {Promise<{data: object, error: string|null, stderr: string|null}>}
   */
  async initialize({ recoverAccess = false } = {}) {
    this.recoverOnNoStorage = recoverAccess;
    try {
      const devices = await this.kalamFfi.deviceCall('ListDevices');

      if (devices.error) return devices;
      const choices = devices.data || [];

      if (!choices.length) {
        this.selectedDeviceKey = null;
        await this.kalamFfi.dispose();

        return { error: 'No MTP devices found', stderr: null, data: null };
      }

      if (!choices.some((d) => d.key === this.selectedDeviceKey)) {
        const key =
          choices.length === 1
            ? choices[0].key
            : await chooseMtpDevice(choices);

        if (!key)
          return {
            error: 'Device selection cancelled',
            stderr: null,
            data: null,
          };
        const result = await this.kalamFfi.deviceCall('SelectDevice', key);

        if (result.error) return result;
        this.selectedDeviceKey = key;
      }

      this.selectedDeviceChoice = choices.find(
        (d) => d.key === this.selectedDeviceKey
      );

      return this.kalamFfi.initialize();
    } catch (e) {
      log.error(e);

      return {
        error: e,
        stderr: null,
        data: null,
      };
    }
  }

  /* eslint-disable no-await-in-loop -- USB rediscovery and permission polling are sequential. */
  async _rebindSelectedDevice(chosen, deadline) {
    await this.kalamFfi.dispose();
    while (Date.now() < deadline) {
      const devices = await this.kalamFfi.deviceCall('ListDevices');
      const matches = (devices.data || []).filter(
        (d) =>
          d.serial === chosen.serial &&
          d.vendorId === chosen.vendorId &&
          d.productId === chosen.productId
      );

      if (matches.length > 1)
        throw new Error('发现重复设备标识，请手动选择手机。');
      if (matches.length === 1) {
        const [match] = matches;
        const selected = await this.kalamFfi.deviceCall(
          'SelectDevice',
          match.key
        );

        if (selected.error) throw new Error(String(selected.error));
        this.selectedDeviceKey = match.key;
        this.selectedDeviceChoice = match;
        const opened = await this.kalamFfi.initialize();

        if (!opened.error) return;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error('所选手机尚未重新连接，请稍后刷新。');
  }

  async _recoverStorageAccess() {
    const chosen = this.selectedDeviceChoice;
    const closed = await this.kalamFfi.dispose();

    if (closed?.error) throw new Error(String(closed.error));
    await recoverMtpAccess(chosen);
    const permissionDeadline = Date.now() + 60000;

    await this._rebindSelectedDevice(
      chosen,
      Math.min(permissionDeadline, Date.now() + 10000)
    );
    let result;

    do {
      result = await this.kalamFfi.listStorages();
      if (!result.error) break;
      if (
        /LIBUSB_ERROR_NO_DEVICE|ErrorMtpDetectFailed|EOF/.test(
          String(result.error)
        )
      ) {
        setMtpAccessStatus('正在等待所选手机重新连接…');
        await this._rebindSelectedDevice(chosen, permissionDeadline);
      } else if (result.stderr !== 'ErrorNoStorage') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } while (Date.now() < permissionDeadline);

    setMtpAccessStatus(
      result.error ? '尚未允许访问，可再次点击刷新重新请求手机授权。' : ''
    );

    return result;
  }

  /* eslint-enable no-await-in-loop */

  /**
   * description - Dispose Kalam MTP
   *
   * @return {Promise<{data: object, error: string|null, stderr: string|null}>}
   */
  async dispose() {
    try {
      return this.kalamFfi.dispose();
    } catch (e) {
      log.error(e);

      return {
        error: e,
        stderr: null,
        data: null,
      };
    }
  }

  /**
   * description - Fetch Kalam MTP storages
   *
   * @return {Promise<{data: {}, error: string|null, stderr: string|null}>}
   */
  async listStorages() {
    try {
      let result = await this.kalamFfi.listStorages();
      const shouldRecover = this.recoverOnNoStorage;

      this.recoverOnNoStorage = false;
      if (shouldRecover && result.error && result.stderr === 'ErrorNoStorage') {
        try {
          result = await this._recoverStorageAccess();
        } catch (error) {
          setMtpAccessStatus(error.message);

          return { error: error.message, stderr: 'ErrorNoStorage', data: null };
        }
      }

      const { error, stderr, data } = result;

      if (error || stderr || !data) {
        return { error, stderr, data };
      }

      const storageList = {};

      data.forEach((a, index) => {
        storageList[a.Sid] = {
          name: a.Info.StorageDescription,
          selected: index === 0,
          info: a.Info,
        };
      });

      return { error, stderr, data: storageList };
    } catch (e) {
      log.error(e);

      return {
        error: e,
        stderr: null,
        data: null,
      };
    }
  }

  /**
   * description - Fetch device files in the path
   *
   * @param filePath
   * @param ignoreHidden
   * @param storageId
   * @return {Promise<{data: array|null, error: string|null, stderr: string|null}>}
   */
  async listFiles({ filePath, ignoreHidden, storageId }) {
    checkIf(filePath, 'string');
    checkIf(ignoreHidden, 'boolean');
    checkIf(storageId, 'number');

    try {
      return this.kalamFfi.walk({
        fullPath: filePath,
        storageId,
        skipHiddenFiles: ignoreHidden,
      });
    } catch (e) {
      log.error(e);

      return {
        error: e,
        stderr: null,
        data: null,
      };
    }
  }

  /**
   * description - Rename a device file
   *
   * @param filePath
   * @param newFilename
   * @param storageId
   * @return {Promise<{data: null|boolean, error: string|null, stderr: string|null}>}
   */
  async renameFile({ filePath, newFilename, storageId }) {
    checkIf(filePath, 'string');
    checkIf(newFilename, 'string');
    checkIf(storageId, 'number');

    try {
      return this.kalamFfi.renameFile({
        fullPath: filePath,
        storageId,
        newFilename,
      });
    } catch (e) {
      log.error(e);

      return {
        error: e,
        stderr: null,
        data: null,
      };
    }
  }

  /**
   * description - Check if files exist in the device
   *
   * @param {[string]} fileList
   * @param {string} storageId
   * @return {Promise<boolean>}
   */
  async filesExist({ fileList, storageId }) {
    checkIf(fileList, 'array');
    checkIf(storageId, 'number');

    try {
      const { error, stderr, data } = await this.kalamFfi.fileExist({
        storageId,
        files: fileList,
      });

      if (error || stderr) {
        return true;
      }

      if (isEmpty(data)) {
        return true;
      }

      const existsItems = data.filter((a) => a.exists);

      return existsItems.length > 0;
    } catch (e) {
      log.error(e);

      return {
        error: e,
        stderr: null,
        data: null,
      };
    }
  }

  /**
   * description - Create a device directory
   *
   * @param filePath
   * @param storageId
   * @return {Promise<{data: null|boolean, error: string|null, stderr: string|null}>}
   */
  async makeDirectory({ filePath, storageId }) {
    checkIf(filePath, 'string');
    checkIf(storageId, 'number');

    try {
      return this.kalamFfi.makeDirectory({
        storageId,
        fullPath: filePath,
      });
    } catch (e) {
      log.error(e);

      return { error: e, stderr: null, data: false };
    }
  }

  /**
   * description - Delete device files
   *
   * @param fileList [string]
   * @param storageId
   * @return {Promise<{data: null|boolean, error: string|null, stderr: string|null}>}
   */
  async deleteFiles({ fileList, storageId }) {
    checkIf(fileList, 'array');
    checkIf(storageId, 'number');

    return this.kalamFfi.deleteFile({
      storageId,
      files: fileList,
    });
  }

  /**
   * @typedef {function(errorCallbackInfo)} errorCallback
   * @callback errorCallback
   * @param {errorCallbackInfo} args - error object
   */

  /**
   * @typedef {Object} errorCallbackInfo
   * @property {string} error - error text
   * @property {string} stderr - std error text
   * @property {null} data - data
   */

  /**
   * @typedef {function(preprocessCallbackInfo)} preprocessCallback
   * @callback preprocessCallback
   * @param {preprocessCallbackInfo} args - preprocess object
   */

  /**
   * @typedef {Object} preprocessCallbackInfo
   * @property {string} fullPath - full file path
   * @property {number} name - file name
   */

  /**
   * @typedef {function(progressCallbackInfo)} progressCallback
   * @callback progressCallback
   * @param {progressCallbackInfo} args - progress object
   */

  /**
   * @typedef {Object} progressCallbackInfo
   * @property {number} totalFiles - [count] total number of files to transfer. note: this value will be 0 if pre-processing is false
   * @property {number} filesSent - [count] total number of files sent
   * @property {number} filesSentProgress - [count] total number of files sent (in percentage)
   *
   * @property {number} totalFileSize - [size] total size to transfer. note: this value will be 0 if pre-processing was false
   * @property {number} totalFileSizeSent - [size] total size sent
   * @property {number} totalFileProgress - [size] total size sent (in percentage)
   *
   * @property {number} activeFileSize - [size] total size of the current file
   * @property {number} activeFileSizeSent - [size] total size of the current file sent
   * @property {number} activeFileProgress - [size] total size of the current file sent (in percentage)
   *
   * @property {string} currentFile - current file (full path)
   * @property {int} speed - speed in MBs
   * @property {string} elapsedTime - elapsed time
   *
   * @property {'upload'|'download'} direction - direction of file transfer
   */

  /**
   * @typedef {function()} completedCallback
   * @callback completedCallback
   */

  /**
   * description - Upload or download files from MTP device to local or vice versa
   *
   * @param {string} deviceType
   * @param {string} destination
   * @param {'upload'|'download'} direction
   * @param {[string]} fileList
   * @param {string} storageId
   * @param {errorCallback} onError
   * @param {preprocessCallback} onPreprocess
   * @param {progressCallback} onProgress
   * @param {completedCallback} onCompleted
   *
   * @return
   */
  async transferFiles({
    deviceType,
    destination,
    fileList,
    direction,
    storageId,
    onError,
    onPreprocess,
    onProgress,
    onCompleted,
  }) {
    checkIf(deviceType, 'string');
    checkIf(direction, 'string');
    checkIf(fileList, 'array');
    checkIf(storageId, 'number');
    checkIf(onError, 'function');
    checkIf(onPreprocess, 'function');
    checkIf(onProgress, 'function');
    checkIf(onCompleted, 'function');

    try {
      if (isEmpty(destination)) {
        onError({
          error: `Invalid path`,
          stderr: null,
          data: null,
        });

        return;
      }

      if (isEmpty(fileList) || !isArray(fileList)) {
        onError({
          error: `No files selected`,
          stderr: null,
          data: null,
        });

        return;
      }

      return this.kalamFfi.transferFiles({
        direction,
        storageId,
        destination,
        preprocessFiles: getFilesPreprocessingBeforeTransferSetting({
          direction,
        }),
        sources: fileList,
        onPreprocess,
        onProgress: ({
          fullPath,
          elapsedTime,
          speed,
          totalFiles,
          filesSent,
          filesSentProgress,
          activeFileSize,
          bulkFileSize,
        }) => {
          onProgress({
            currentFile: fullPath,
            elapsedTime: msToTime(elapsedTime),
            speed,
            totalFiles,
            filesSent,
            filesSentProgress,
            totalFileSize: bulkFileSize.total,
            totalFileSizeSent: bulkFileSize.sent,
            totalFileProgress: bulkFileSize.progress,
            activeFileSize: activeFileSize.total,
            activeFileSizeSent: activeFileSize.sent,
            activeFileProgress: activeFileSize.progress,
            direction,
          });
        },
        onError,
        onCompleted,
      });
    } catch (e) {
      log.error(e);

      return { error: e, stderr: null, data: false };
    }
  }

  /**
   * description: fetch the required data for generating bug/error reports
   *
   * @return {Promise<{data: string|null, error: string|null, stderr: string|null}>}
   */
  async fetchDebugReport() {
    try {
      const { data, error, stderr } = await this._exec(kalamDebugReportCli);

      if (error) {
        log.doLog(error, `FileExplorerKalamDataSource.fetchDebugReport.error`);

        return { error, stderr, data: null };
      }

      if (stderr) {
        log.doLog(
          stderr,
          `FileExplorerKalamDataSource.fetchDebugReport.stderr`
        );

        return { error, stderr, data: null };
      }

      return { error: null, stderr: null, data };
    } catch (e) {
      log.error(e);

      return { error: null, stderr: null, data: null };
    }
  }
}
