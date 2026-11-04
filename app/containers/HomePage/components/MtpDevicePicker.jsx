import React, { useEffect, useState } from 'react';
import { connect } from 'react-redux';
import IconButton from '@material-ui/core/IconButton';
import Tooltip from '@material-ui/core/Tooltip';
import Snackbar from '@material-ui/core/Snackbar';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExchangeAlt } from '@fortawesome/free-solid-svg-icons';
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

function MtpDevicePicker({ dispatch, home, settings, styles }) {
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
    <React.Fragment>
      <Tooltip title="Switch Android device">
        <div className={`${styles.navBtns} ${styles.noAppDrag}`}>
          <IconButton
            aria-label="Switch Android device"
            onClick={switchDevice}
            disabled={
              busy ||
              home.fileTransfer.progress.toggle ||
              home.mtpDevice.isLoading
            }
          >
            <FontAwesomeIcon
              icon={faExchangeAlt}
              className={styles.navBtnIcons}
            />
          </IconButton>
        </div>
      </Tooltip>
      <Snackbar
        key={error || accessStatus}
        open={Boolean(error || accessStatus)}
        message={error || accessStatus}
        autoHideDuration={error ? 6000 : 10000}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        ContentProps={{ role: error ? 'alert' : 'status' }}
        onClose={() => {
          setError('');
          setAccessStatus('');
        }}
      />
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
    </React.Fragment>
  );
}

export default connect((state) => ({
  home: state.Home,
  settings: state.Settings,
}))(MtpDevicePicker);
