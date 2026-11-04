import React, { useEffect, useState } from 'react';
import { connect } from 'react-redux';
import Button from '@material-ui/core/Button';
import Selection from '../../../components/DialogBox/components/Selection';
import fileExplorerController from '../../../data/file-explorer/controllers/FileExplorerController';
import {
  initializeMtp,
  actionSetSelectedDirLists,
  actionChangeMtpStorage,
  actionListDirectory,
  clearFileTransfer,
} from '../actions';
import { DEVICE_TYPE, MTP_MODE } from '../../../enums';

function MtpDevicePicker({ dispatch, home, settings }) {
  const [request, setRequest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accessStatus, setAccessStatus] = useState('');

  useEffect(() => {
    const listener = (event) => setRequest(event.detail);

    window.addEventListener('mtp-device-choice', listener);
    const accessListener = (event) => setAccessStatus(event.detail);

    window.addEventListener('mtp-access-status', accessListener);

    return () => {
      window.removeEventListener('mtp-device-choice', listener);
      window.removeEventListener('mtp-access-status', accessListener);
    };
  }, []);
  const source = fileExplorerController.repository.kalamMtpDataSource;
  const switchDevice = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await source.kalamFfi.deviceCall('ListDevices');

      if (result.error) {
        setError(String(result.error));

        return;
      }

      if (!result.data?.length) {
        setError(
          'No MTP devices found. Unlock your phone and enable File Transfer.'
        );

        return;
      }

      setRequest({
        devices: result.data,
        finish: async (key) => {
          if (!key) return;
          const selected = await source.kalamFfi.deviceCall(
            'SelectDevice',
            key
          );

          if (selected.error) {
            setError(String(selected.error));

            return;
          }

          source.selectedDeviceKey = key;
          dispatch(
            actionSetSelectedDirLists({ selected: [] }, DEVICE_TYPE.mtp)
          );
          dispatch(actionListDirectory([], DEVICE_TYPE.mtp));
          dispatch(actionChangeMtpStorage({}));
          dispatch(clearFileTransfer());
          await dispatch((_, getState) =>
            dispatch(
              initializeMtp(
                {
                  filePath: '/',
                  ignoreHidden: settings.hideHiddenFiles[DEVICE_TYPE.mtp],
                  changeLegacyMtpStorageOnlyOnDeviceChange: false,
                  deviceType: DEVICE_TYPE.mtp,
                },
                getState
              )
            )
          );
        },
      });
    } finally {
      setBusy(false);
    }
  };

  if (settings.mtpMode !== MTP_MODE.kalam) return null;

  return (
    <div style={{ padding: '4px 12px' }}>
      <Button
        size="small"
        onClick={switchDevice}
        disabled={
          busy || home.fileTransfer.progress.toggle || home.mtpDevice.isLoading
        }
      >
        Select Android device
      </Button>
      {error && <span role="alert">{error}</span>}
      {accessStatus && <span role="status">{accessStatus}</span>}
      <Selection
        titleText="Select Android device"
        showAvatar={false}
        open={!!request}
        list={(request?.devices || []).map((d) => ({
          value: d.key,
          name: d.label,
        }))}
        onClose={({ selectedValue }) => {
          const current = request;

          setRequest(null);
          current?.finish(selectedValue);
        }}
      />
    </div>
  );
}

export default connect((state) => ({
  home: state.Home,
  settings: state.Settings,
}))(MtpDevicePicker);
